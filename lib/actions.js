"use strict";
/**
 * Family action items — the small, family-scoped commitment primitive that
 * later Today/onboarding surfaces project into a queue.
 *
 * The model owns shape validation and persistence. Route modules own
 * authentication and the role-specific decision about which fields a caller
 * may change. Actions are deliberately separate from homework, calendar,
 * meals, trips, and chat: those domains remain their own sources of truth
 * until a later projection phase.
 *
 * root.actions[familyId] = [action, ...]
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");

const STATUSES = new Set(["open", "done", "snoozed"]);
const ASSIGNEE_TYPES = new Set(["parent", "kid", "family"]);
const SOURCE_TYPES = new Set(["manual", "homework", "calendar", "meal", "trip", "chat", "school"]);

const MAX_TITLE_LENGTH = 200;
const MAX_NOTES_LENGTH = 2000;
const MAX_SOURCE_ID_LENGTH = 200;
const MAX_ACTIONS_PER_LIST = 200;
const MAX_DATE_WINDOW_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function root() {
  const r = db.load();
  if (!r.actions) r.actions = {};
  return r;
}

// A deleted imported action must stay dismissed even though source rows are
// re-derived on every sync/confirm. Keep this separate from the action list so
// the action shape and the public API remain unchanged.
function dismissedSourceIds(familyId, create = false) {
  const r = root();
  if (!r.actionDismissals || typeof r.actionDismissals !== "object" || Array.isArray(r.actionDismissals)) {
    if (!create) return [];
    r.actionDismissals = {};
  }
  if (!Array.isArray(r.actionDismissals[familyId])) {
    if (!create) return [];
    r.actionDismissals[familyId] = [];
  }
  return r.actionDismissals[familyId];
}

function isSourceDismissed(familyId, sourceType, sourceId) {
  if (!sourceId) return false;
  // Keep the existing public-feed dismissal shape readable for old data;
  // Moodle homework gets a namespace so identical opaque ids cannot collide.
  const key = sourceType === "homework" ? `homework::${sourceId}` : sourceId;
  return (sourceType === "school" || sourceType === "homework")
    && dismissedSourceIds(familyId).includes(key);
}

function rememberSourceDismissal(familyId, action) {
  if (!action || (action.sourceType !== "school" && action.sourceType !== "homework") || !action.sourceId) return;
  const dismissed = dismissedSourceIds(familyId, true);
  const key = action.sourceType === "homework"
    ? `homework::${action.sourceId}`
    : action.sourceId;
  if (!dismissed.includes(key)) dismissed.push(key);
}

function famList(familyId) {
  const r = root();
  if (!r.actions[familyId]) r.actions[familyId] = [];
  return r.actions[familyId];
}

function actionId() {
  return "act_" + crypto.randomBytes(9).toString("hex");
}

function cleanText(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function cleanReference(value) {
  if (value == null) return null;
  const s = String(value).trim();
  // IDs are references, not free text: never truncate them before checking
  // family membership, or a malformed/foreign reference could be transformed
  // into a valid one by accident.
  return s || null;
}

function sanitizeTitle(value) {
  return cleanText(value, MAX_TITLE_LENGTH);
}

function sanitizeNotes(value) {
  return cleanText(value, MAX_NOTES_LENGTH);
}

function sanitizeSourceId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, MAX_SOURCE_ID_LENGTH) : null;
}

// Date-only values are compared lexicographically throughout the app. Check
// the calendar day as well as the shape so values such as 2026-02-31 never
// enter the datastore.
function isValidDate(value) {
  const s = String(value == null ? "" : value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Date.UTC treats years 0-99 as 1900-1999, so set the full year after
  // construction to keep this validator deterministic for every 4-digit year.
  const dt = new Date(0);
  dt.setUTCHours(0, 0, 0, 0);
  dt.setUTCFullYear(year, month - 1, day);
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

function sanitizeDate(value) {
  if (value == null || String(value).trim() === "") return null;
  const s = String(value).trim();
  return isValidDate(s) ? s : null;
}

function isValidTime(value) {
  const s = String(value == null ? "" : value).trim();
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return false;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function sanitizeTime(value) {
  if (value == null || String(value).trim() === "") return null;
  const s = String(value).trim();
  return isValidTime(s) ? s : null;
}

// Snooze timestamps follow the app's ISO timestamp convention. Require an
// explicit timezone so the same input means the same instant on every host.
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function sanitizeSnoozedUntil(value) {
  if (value == null || String(value).trim() === "") return null;
  const s = String(value).trim();
  if (!ISO_TIMESTAMP.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function validateOptionalDate(value, label) {
  if (value == null || String(value).trim() === "") return { value: null };
  const clean = sanitizeDate(value);
  return clean ? { value: clean } : { error: `${label} must be a valid YYYY-MM-DD date.` };
}

function validateOptionalTime(value, label) {
  if (value == null || String(value).trim() === "") return { value: null };
  const clean = sanitizeTime(value);
  return clean ? { value: clean } : { error: `${label} must be a valid HH:MM time.` };
}

function validateOptionalSnooze(value) {
  if (value == null || String(value).trim() === "") return { value: null };
  const clean = sanitizeSnoozedUntil(value);
  return clean ? { value: clean } : { error: "snoozedUntil must be a valid ISO timestamp with a timezone." };
}

function validateAssignee(fam, assigneeType, assigneeId, kidId) {
  const type = assigneeType == null || String(assigneeType).trim() === ""
    ? "family"
    : String(assigneeType).trim();
  if (!ASSIGNEE_TYPES.has(type)) return { error: "assigneeType must be parent, kid, or family." };

  let id = cleanReference(assigneeId);
  let kid = cleanReference(kidId);

  if (type === "family") {
    if (id || kid) return { error: "A family action cannot have an assigneeId or kidId." };
    return { assigneeType: "family", assigneeId: null, kidId: null };
  }

  if (type === "parent") {
    if (!id || !fam.parentIds.includes(id)) return { error: "Assignee parent is not in this family." };
    if (kid) return { error: "A parent-assigned action cannot have a kidId." };
    return { assigneeType: "parent", assigneeId: id, kidId: null };
  }

  // A kid action uses the kid profile id in both fields. Accepting kidId as a
  // shorthand keeps the primitive easy to consume while still canonicalizing
  // the stored shape and checking the reference against this family.
  if (id && kid && id !== kid) return { error: "assigneeId and kidId must identify the same kid." };
  const targetKid = id || kid;
  if (!targetKid || !fam.kids.some((k) => k.id === targetKid)) {
    return { error: "Assignee kid is not in this family." };
  }
  return { assigneeType: "kid", assigneeId: targetKid, kidId: targetKid };
}

function validateCreatedBy(fam, createdBy) {
  const creator = cleanReference(createdBy);
  if (creator && !fam.parentIds.includes(creator)) return { error: "createdBy must be a parent in this family." };
  return { value: creator };
}

function normalizeCreateStatus(input) {
  const requested = input.status == null || String(input.status).trim() === "" ? "open" : String(input.status).trim();
  if (!STATUSES.has(requested)) return { error: "status must be open, done, or snoozed." };
  return { value: requested };
}

function createAction(familyId, input = {}) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };

  const title = sanitizeTitle(input.title);
  if (!title) return { error: "Title is required." };

  const dueDate = validateOptionalDate(input.dueDate, "dueDate");
  if (dueDate.error) return dueDate;
  const dueTime = validateOptionalTime(input.dueTime, "dueTime");
  if (dueTime.error) return dueTime;

  const sourceType = input.sourceType == null || String(input.sourceType).trim() === ""
    ? "manual"
    : String(input.sourceType).trim();
  if (!SOURCE_TYPES.has(sourceType)) return { error: "sourceType is not supported." };

  const createdBy = validateCreatedBy(fam, input.createdBy);
  if (createdBy.error) return createdBy;

  // Explicit assigneeType remains canonical, but the kidId/assigneeId fields
  // are useful enough to accept as unambiguous shorthands for model callers.
  // With none of those fields present, the locked default is shared family.
  let assigneeType = input.assigneeType;
  if (assigneeType == null || String(assigneeType).trim() === "") {
    const kidRef = cleanReference(input.kidId) || cleanReference(input.assigneeId);
    if (kidRef && fam.kids.some((k) => k.id === kidRef)) assigneeType = "kid";
    else if (cleanReference(input.assigneeId)) assigneeType = "parent";
    else assigneeType = "family";
  }
  const assignee = validateAssignee(fam, assigneeType, input.assigneeId, input.kidId);
  if (assignee.error) return assignee;

  const status = normalizeCreateStatus(input);
  if (status.error) return status;
  const snoozed = validateOptionalSnooze(input.snoozedUntil);
  if (snoozed.error) return snoozed;
  let actionStatus = status.value;
  let snoozedUntil = snoozed.value;
  if (actionStatus === "snoozed" && !snoozedUntil) {
    return { error: "A snoozed action needs a snoozedUntil timestamp." };
  }
  if (actionStatus !== "snoozed" && snoozedUntil) {
    // A supplied snooze timestamp is an unambiguous request to snooze when no
    // status was supplied; an explicit contradictory status is rejected.
    if (input.status != null && String(input.status).trim() !== "") {
      return { error: "snoozedUntil requires status snoozed." };
    }
    actionStatus = "snoozed";
  }
  if (actionStatus !== "snoozed") snoozedUntil = null;

  const now = new Date().toISOString();
  const action = {
    id: actionId(),
    familyId,
    title,
    notes: sanitizeNotes(input.notes),
    status: actionStatus,
    dueDate: dueDate.value,
    dueTime: dueTime.value,
    assigneeType: assignee.assigneeType,
    assigneeId: assignee.assigneeId,
    kidId: assignee.kidId,
    sourceType,
    sourceId: sanitizeSourceId(input.sourceId),
    createdBy: createdBy.value,
    createdAt: now,
    updatedAt: now,
    snoozedUntil,
  };
  famList(familyId).push(action);
  db.persist();
  return { action };
}

function getAction(familyId, id) {
  return famList(familyId).find((a) => a.id === id) || null;
}

function getById(familyId, id) {
  return getAction(familyId, id);
}

function getBySource(familyId, sourceType, sourceId) {
  if (!sourceType || !sourceId) return null;
  return famList(familyId).find((action) =>
    action.sourceType === sourceType && action.sourceId === sourceId
  ) || null;
}

function assigneePatch(fam, existing, patch) {
  const hasType = hasOwn(patch, "assigneeType");
  const hasId = hasOwn(patch, "assigneeId");
  const hasKid = hasOwn(patch, "kidId");
  if (!hasType && !hasId && !hasKid) {
    return {
      assigneeType: existing.assigneeType,
      assigneeId: existing.assigneeId,
      kidId: existing.kidId,
    };
  }

  let type;
  if (hasType) {
    type = patch.assigneeType == null || String(patch.assigneeType).trim() === ""
      ? "family"
      : String(patch.assigneeType).trim();
  } else if (hasKid && cleanReference(patch.kidId)) {
    type = "kid";
  } else if (existing.assigneeType !== "family") {
    type = existing.assigneeType;
  } else if (hasId && cleanReference(patch.assigneeId) == null) {
    type = "family";
  } else if (hasId && fam.parentIds.includes(cleanReference(patch.assigneeId))) {
    type = "parent";
  } else if (hasId && fam.kids.some((k) => k.id === cleanReference(patch.assigneeId))) {
    type = "kid";
  } else {
    // Let validateAssignee produce the stable invalid-reference error for an
    // unknown id, rather than silently converting it to shared/family scope.
    type = hasKid ? "kid" : "parent";
  }

  let id = hasId ? patch.assigneeId : existing.assigneeId;
  let kid = hasKid ? patch.kidId : existing.kidId;

  // Changing type is a replacement, not a merge with the old target. This
  // avoids carrying a kid id into a parent/family assignment by accident.
  if (type !== existing.assigneeType) {
    if (!hasId) id = null;
    if (!hasKid) kid = null;
  }
  if (type === "family" && hasType && !hasId && !hasKid) {
    id = null;
    kid = null;
  }
  return validateAssignee(fam, type, id, kid);
}

function updateStatus(existing, patch) {
  const hasStatus = hasOwn(patch, "status");
  const hasSnooze = hasOwn(patch, "snoozedUntil");
  let status = STATUSES.has(existing.status) ? existing.status : "open";
  let snoozedUntil = existing.snoozedUntil || null;

  if (hasSnooze) {
    const snooze = validateOptionalSnooze(patch.snoozedUntil);
    if (snooze.error) return snooze;
    snoozedUntil = snooze.value;
  }
  if (hasStatus) {
    const requested = patch.status == null ? "" : String(patch.status).trim();
    if (!STATUSES.has(requested)) return { error: "status must be open, done, or snoozed." };
    status = requested;
  }

  // A timestamp by itself is the compact snooze operation. Clearing a
  // snooze re-opens the item; completing/opening always clears stale snooze
  // metadata so the state cannot contradict itself.
  if (hasSnooze && !hasStatus) {
    if (snoozedUntil) status = "snoozed";
    else if (status === "snoozed") status = "open";
  }
  if (status === "snoozed" && !snoozedUntil) {
    return { error: "A snoozed action needs a snoozedUntil timestamp." };
  }
  if (status !== "snoozed") {
    if (hasSnooze && snoozedUntil) return { error: "snoozedUntil requires status snoozed." };
    snoozedUntil = null;
  }
  return { status, snoozedUntil };
}

function updateAction(familyId, id, patch = {}) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  const action = getAction(familyId, id);
  if (!action) return { error: "Action not found." };

  const next = Object.assign({}, action);
  if (hasOwn(patch, "title")) {
    const title = sanitizeTitle(patch.title);
    if (!title) return { error: "Title cannot be empty." };
    next.title = title;
  }
  if (hasOwn(patch, "notes")) next.notes = sanitizeNotes(patch.notes);

  if (hasOwn(patch, "dueDate")) {
    const dueDate = validateOptionalDate(patch.dueDate, "dueDate");
    if (dueDate.error) return dueDate;
    next.dueDate = dueDate.value;
  }
  if (hasOwn(patch, "dueTime")) {
    const dueTime = validateOptionalTime(patch.dueTime, "dueTime");
    if (dueTime.error) return dueTime;
    next.dueTime = dueTime.value;
  }

  const assignee = assigneePatch(fam, action, patch);
  if (assignee.error) return assignee;
  next.assigneeType = assignee.assigneeType;
  next.assigneeId = assignee.assigneeId;
  next.kidId = assignee.kidId;

  const state = updateStatus(action, patch);
  if (state.error) return state;
  next.status = state.status;
  next.snoozedUntil = state.snoozedUntil;
  next.updatedAt = new Date().toISOString();

  const list = famList(familyId);
  const index = list.findIndex((a) => a.id === id);
  list[index] = next;
  db.persist();
  return { action: next };
}

function deleteAction(familyId, id) {
  const list = famList(familyId);
  const index = list.findIndex((a) => a.id === id);
  if (index < 0) return { error: "Action not found." };
  const deleted = list[index];
  list.splice(index, 1);
  rememberSourceDismissal(familyId, deleted);
  db.persist();
  return { ok: true };
}

function removeAction(familyId, id) {
  return deleteAction(familyId, id);
}

function splitFilter(value) {
  if (value == null || value === "") return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function addDays(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const dt = new Date(0);
  dt.setUTCHours(0, 0, 0, 0);
  dt.setUTCFullYear(year, month - 1, day);
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${String(dt.getUTCFullYear()).padStart(4, "0")}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function dateDistance(from, to) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = new Date(0);
  const b = new Date(0);
  a.setUTCHours(0, 0, 0, 0);
  b.setUTCHours(0, 0, 0, 0);
  a.setUTCFullYear(fy, fm - 1, fd);
  b.setUTCFullYear(ty, tm - 1, td);
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

// Parse and validate public list filters once at the route boundary. This
// keeps malformed query input from quietly turning into a broad family read.
function normalizeListFilters(raw = {}, familyId) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  const filters = {};

  const statuses = splitFilter(raw.status);
  if (statuses.some((s) => !STATUSES.has(s))) return { error: "status filter is not supported." };
  if (statuses.length) filters.statuses = statuses;

  const assigneeValues = splitFilter(raw.assignee !== undefined ? raw.assignee : raw.assigneeId);
  if (assigneeValues.length) {
    const assignees = [];
    for (const value of assigneeValues) {
      if (ASSIGNEE_TYPES.has(value)) {
        assignees.push({ type: value });
      } else if (fam.parentIds.includes(value) || fam.kids.some((k) => k.id === value)) {
        assignees.push({ id: value });
      } else {
        return { error: "assignee filter is not in this family." };
      }
    }
    filters.assignees = assignees;
  }

  const kidValues = splitFilter(raw.kid !== undefined ? raw.kid : raw.kidId);
  if (kidValues.length) {
    if (kidValues.some((kidId) => !fam.kids.some((k) => k.id === kidId))) {
      return { error: "kid filter is not in this family." };
    }
    filters.kidIds = kidValues;
  }

  const sourceValues = splitFilter(raw.source !== undefined ? raw.source : raw.sourceType);
  if (sourceValues.some((s) => !SOURCE_TYPES.has(s))) return { error: "source filter is not supported." };
  if (sourceValues.length) filters.sourceTypes = sourceValues;

  const rawFrom = raw.from == null || String(raw.from).trim() === "" ? null : String(raw.from).trim();
  const rawTo = raw.to == null || String(raw.to).trim() === "" ? null : String(raw.to).trim();
  if (rawFrom && !isValidDate(rawFrom)) return { error: "from must be a valid YYYY-MM-DD date." };
  if (rawTo && !isValidDate(rawTo)) return { error: "to must be a valid YYYY-MM-DD date." };
  let from = rawFrom;
  let to = rawTo;
  if (from && !to) to = addDays(from, MAX_DATE_WINDOW_DAYS);
  if (!from && to) from = addDays(to, -MAX_DATE_WINDOW_DAYS);
  if (from && to && from > to) return { error: "from cannot be after to." };
  if (from && to && dateDistance(from, to) > MAX_DATE_WINDOW_DAYS) {
    return { error: `Date window cannot exceed ${MAX_DATE_WINDOW_DAYS} days.` };
  }
  if (from) filters.from = from;
  if (to) filters.to = to;

  return { filters };
}

function matchesAssignee(action, filters) {
  if (!filters || !filters.length) return true;
  return filters.some((filter) => filter.type
    ? action.assigneeType === filter.type
    : action.assigneeId === filter.id);
}

function sortActions(a, b) {
  const aDate = a.dueDate || "9999-12-31";
  const bDate = b.dueDate || "9999-12-31";
  const aKey = `${aDate} ${a.dueTime || "99:99"} ${a.createdAt || ""} ${a.id || ""}`;
  const bKey = `${bDate} ${b.dueTime || "99:99"} ${b.createdAt || ""} ${b.id || ""}`;
  return aKey.localeCompare(bKey);
}

function listActions(familyId, filters = {}) {
  // Accept both the normalized filter shape used by the HTTP route and the
  // conventional `{ status, kidId, ... }` options used by model callers.
  const normalizedKeys = ["statuses", "assignees", "kidIds", "sourceTypes"];
  const rawKeys = ["status", "assignee", "assigneeId", "kid", "kidId", "source", "sourceType", "from", "to"];
  let effective = filters;
  if (!normalizedKeys.some((key) => hasOwn(filters, key)) && rawKeys.some((key) => hasOwn(filters, key))) {
    const parsed = normalizeListFilters(filters, familyId);
    if (parsed.error) return [];
    effective = Object.assign({}, parsed.filters, { viewerKidId: filters.viewerKidId });
  }

  let items = famList(familyId).filter((action) => {
    if (effective.statuses && !effective.statuses.includes(action.status)) return false;
    if (effective.sourceTypes && !effective.sourceTypes.includes(action.sourceType)) return false;
    if (effective.kidIds && !effective.kidIds.includes(action.kidId)) return false;
    if (effective.assignees && !matchesAssignee(action, effective.assignees)) return false;
    if (effective.from && (!action.dueDate || action.dueDate < effective.from)) return false;
    if (effective.to && (!action.dueDate || action.dueDate > effective.to)) return false;
    if (effective.viewerKidId && !(action.assigneeType === "family" || canKidManage(action, effective.viewerKidId))) return false;
    return true;
  });
  return items.sort(sortActions).slice(0, MAX_ACTIONS_PER_LIST);
}

function listForFamily(familyId, filters = {}) {
  return listActions(familyId, filters);
}

function canKidView(action, kidId) {
  return !!action && (action.assigneeType === "family" || canKidManage(action, kidId));
}

function canKidManage(action, kidId) {
  return !!kidId && !!action && action.assigneeType === "kid" && action.assigneeId === kidId && action.kidId === kidId;
}

function canAccess(user, role, familyId, action, { kidId } = {}) {
  if (!action || action.familyId !== familyId) return false;
  if (role !== "kid") return true;
  const linkedKidId = kidId || (user && user.data && user.data.kid && user.data.kid.kidId);
  return canKidView(action, linkedKidId);
}

// Keep ordinary school-event projection decisions here with the action model:
// the route passes only the successful sync's returned events, and this helper
// owns validation, source identity, dismissal checks, and source-owned refresh
// semantics. It intentionally does not infer homework, exams, or reminders.
function schoolSourceId(subscriptionId, uid) {
  const raw = `${subscriptionId}::${uid}`;
  if (raw.length <= MAX_SOURCE_ID_LENGTH) return raw;
  const digest = crypto.createHash("sha256").update(raw).digest("hex");
  return `${raw.slice(0, MAX_SOURCE_ID_LENGTH - digest.length - 2)}::${digest}`;
}

function parseSchoolDeadlineEvent(fam, event) {
  if (!event || typeof event !== "object") return null;
  if (event.isDeadline !== true && event.type !== "deadline") return null;

  const subscriptionId = cleanReference(event.subscriptionId);
  const uid = cleanReference(event.uid);
  const title = sanitizeTitle(event.title);
  const kidId = cleanReference(event.kidId);
  if (!subscriptionId || !uid || !title || !kidId || !fam.kids.some((kid) => kid.id === kidId)) return null;

  const start = event.start == null ? "" : String(event.start).trim();
  let dueDate;
  let dueTime = null;
  if (event.allDay === true) {
    dueDate = sanitizeDate(start);
    if (!dueDate) return null;
  } else {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(start);
    if (!match) return null;
    dueDate = sanitizeDate(match[1]);
    dueTime = sanitizeTime(`${match[2]}:${match[3]}`);
    if (!dueDate || !dueTime) return null;
    if (match[4] != null && Number(match[4]) > 59) return null;
    if (match[6] && match[6] !== "Z") {
      const zone = match[6].replace(":", "");
      if (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(3, 5)) > 59) return null;
    }
  }

  return {
    title,
    dueDate,
    dueTime,
    kidId,
    sourceId: schoolSourceId(subscriptionId, uid),
  };
}

function projectSchoolDeadlines(familyId, events = []) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  if (!Array.isArray(events)) return { created: 0, updated: 0, skipped: 0, dismissed: 0 };

  const list = famList(familyId);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let dismissed = 0;
  let needsPersist = false;

  for (const event of events) {
    const candidate = parseSchoolDeadlineEvent(fam, event);
    if (!candidate) {
      skipped += 1;
      continue;
    }
    if (isSourceDismissed(familyId, "school", candidate.sourceId)) {
      dismissed += 1;
      continue;
    }

    const existingIndex = list.findIndex((action) =>
      action.sourceType === "school" && action.sourceId === candidate.sourceId
    );
    if (existingIndex >= 0) {
      const existing = list[existingIndex];
      if (existing.title === candidate.title && existing.dueDate === candidate.dueDate && existing.dueTime === candidate.dueTime) {
        continue;
      }
      list[existingIndex] = Object.assign({}, existing, {
        title: candidate.title,
        dueDate: candidate.dueDate,
        dueTime: candidate.dueTime,
        updatedAt: new Date().toISOString(),
      });
      updated += 1;
      needsPersist = true;
      continue;
    }

    const result = createAction(familyId, {
      title: candidate.title,
      dueDate: candidate.dueDate,
      dueTime: candidate.dueTime,
      assigneeType: "kid",
      assigneeId: candidate.kidId,
      kidId: candidate.kidId,
      sourceType: "school",
      sourceId: candidate.sourceId,
      createdBy: null,
    });
    if (result.error) {
      skipped += 1;
      continue;
    }
    created += 1;
  }

  if (needsPersist) db.persist();
  return { created, updated, skipped, dismissed };
}

// Project canonical Moodle homework records into the Today action queue. The
// homework row is the source of truth; action status, snooze, notes, and
// assignee remain family-owned after the initial kid assignment. This helper
// deliberately accepts only the explicit Moodle source marker — it does not
// infer exams or classify records from their titles.
function projectMoodleAssignments(familyId, homeworkItems = []) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  if (!Array.isArray(homeworkItems)) return { created: 0, updated: 0, skipped: 0, dismissed: 0 };

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let dismissed = 0;

  for (const item of homeworkItems) {
    if (!item || item.source !== "school-portal") {
      skipped += 1;
      continue;
    }
    const sourceId = cleanReference(item.id);
    const title = sanitizeTitle(item.title);
    const kidId = cleanReference(item.kidId);
    const dueDate = validateOptionalDate(item.dueDate, "dueDate");
    const dueTime = validateOptionalTime(item.dueTime, "dueTime");
    if (!sourceId || !title || !kidId || !fam.kids.some((kid) => kid.id === kidId) || dueDate.error || dueTime.error) {
      skipped += 1;
      continue;
    }
    if (isSourceDismissed(familyId, "homework", sourceId)) {
      dismissed += 1;
      continue;
    }

    const existing = getBySource(familyId, "homework", sourceId);
    if (existing) {
      if (existing.title === title && existing.dueDate === dueDate.value && existing.dueTime === dueTime.value) continue;
      const next = Object.assign({}, existing, {
        title,
        dueDate: dueDate.value,
        dueTime: dueTime.value,
        updatedAt: new Date().toISOString(),
      });
      const list = famList(familyId);
      const index = list.findIndex((action) => action.id === existing.id);
      list[index] = next;
      updated += 1;
      continue;
    }

    const result = createAction(familyId, {
      title,
      dueDate: dueDate.value,
      dueTime: dueTime.value,
      assigneeType: "kid",
      assigneeId: kidId,
      kidId,
      sourceType: "homework",
      sourceId,
      status: item.status === "done" ? "done" : "open",
      createdBy: null,
    });
    if (result.error) {
      skipped += 1;
      continue;
    }
    created += 1;
  }

  if (updated) db.persist();
  return { created, updated, skipped, dismissed };
}

module.exports = {
  STATUSES,
  ASSIGNEE_TYPES,
  SOURCE_TYPES,
  MAX_TITLE_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_SOURCE_ID_LENGTH,
  MAX_ACTIONS_PER_LIST,
  MAX_DATE_WINDOW_DAYS,
  sanitizeTitle,
  sanitizeNotes,
  sanitizeSourceId,
  sanitizeDate,
  sanitizeTime,
  sanitizeSnoozedUntil,
  isValidDate,
  isValidTime,
  createAction,
  listActions,
  getAction,
  getById,
  getBySource,
  updateAction,
  deleteAction,
  removeAction,
  normalizeListFilters,
  canKidView,
  canKidManage,
  canAccess,
  projectSchoolDeadlines,
  projectMoodleAssignments,
  schoolSourceId,
  isSourceDismissed,
  // Naming aliases mirror the neighboring family models (addHomework,
  // listForFamily, removeHomework) while keeping create/list/get/update/delete
  // names available to the phase-2 consumer.
  addAction: createAction,
  listForFamily,
};

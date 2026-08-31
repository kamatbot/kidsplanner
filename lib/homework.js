"use strict";
/**
 * Phase 3 — Homework hub.
 *
 * Homework is FAMILY/KID-scoped and lives SERVER-side (db.json, same pattern
 * as lib/family.js and lib/school-feeds.js) — shared across parents, and it
 * ingests server-side Phase 2 feed deadlines (see lib/school-feeds.js
 * collectFromCache(), which flags deadline events with isDeadline/
 * type:"deadline").
 *
 * Homework item shape:
 *   { id, familyId, kidId, title, subject, dueDate (YYYY-MM-DD), dueTime?,
 *     status: "todo"|"in_progress"|"done", effortMin?, source: "school"|
 *     "school-portal"|"manual"|"ai", sourceUid?, moodleIdentity?, notes?,
 *     checklist: [{text, done}],
 *     createdAt, updatedAt }
 *
 * Permissions are enforced by the CALLER (server.js routes) using the
 * exported canAccess() helper, mirroring how lib/family.js leaves auth
 * decisions to server.js while providing the primitives here.
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");
const moodleCompletionOutbox = require("./moodle-completion-outbox");

const STATUSES = new Set(["todo", "in_progress", "done"]);
// "school" = ingested from Phase 2 public calendar deadline feeds (see
// ingestDeadlines below); "school-portal" = imported from a parent's
// connected Moodle account (see lib/school-account.js + server.js
// /api/school/import/confirm) — kept distinct so each source's re-sync/
// dedup logic never cross-matches the other's items.
const SOURCES = new Set(["school", "school-portal", "manual", "ai"]);

// Work-session suggestions are deliberately bounded and read-only. A client
// can use the returned date/duration to render a timer or a confirmation flow,
// but this module never creates a calendar event or a persisted commitment.
const MAX_WORK_SESSION_MIN = 90;

function root() {
  const r = db.load();
  if (!r.homework) r.homework = {};
  return r;
}

// root.homework[familyId] = [homework items...]
function famList(familyId) {
  const r = root();
  if (!r.homework[familyId]) r.homework[familyId] = [];
  return r.homework[familyId];
}

function hwId() {
  return "hw_" + crypto.randomBytes(9).toString("hex");
}

function sanitizeChecklist(checklist) {
  if (!Array.isArray(checklist)) return [];
  return checklist
    .slice(0, 50)
    .map((c) => ({
      text: String((c && c.text) || "").trim().slice(0, 200),
      done: !!(c && c.done),
    }))
    .filter((c) => c.text);
}

function sanitizeDueDate(dueDate) {
  const s = String(dueDate || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function sanitizeDueTime(dueTime) {
  const s = String(dueTime || "").trim();
  return /^\d{2}:\d{2}$/.test(s) ? s : null;
}

function isValidCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  // Date.UTC maps years 0-99 to 1900-1999, so set the full year after
  // construction to keep this validator correct for every four-digit year.
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function shiftCalendarDate(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCDate(date.getUTCDate() + days);
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function suggestionResult(suggestion, reason) {
  return suggestion ? { suggestion } : { suggestion: null, reason };
}

// Produce one useful, date-only work block from a canonical homework item.
// The caller may inject todayIso for deterministic clients/tests; no current
// time, calendar availability, or other family data is consulted. A due date
// in the past falls back to today so an overdue child still gets a usable next
// step. Long assignments expose the remaining effort rather than creating a
// multi-session plan or silently scheduling several commitments.
function buildWorkSessionSuggestion(item, { todayIso } = {}) {
  if (!item) return suggestionResult(null, "homework_not_found");
  if (item.status === "done") return suggestionResult(null, "completed");

  const dueDate = String(item.dueDate || "").trim();
  if (!isValidCalendarDate(dueDate)) return suggestionResult(null, "missing_or_invalid_due_date");

  const effort = Number(item.effortMin);
  const effortMin = Number.isFinite(effort) ? Math.round(effort) : 0;
  if (effortMin <= 0) return suggestionResult(null, "missing_or_invalid_effort");

  const today = todayIso == null
    ? new Date().toISOString().slice(0, 10)
    : String(todayIso).trim();
  if (!isValidCalendarDate(today)) return suggestionResult(null, "missing_or_invalid_today");

  const dayBeforeDue = shiftCalendarDate(dueDate, -1);
  const sessionDate = dayBeforeDue < today ? today : dayBeforeDue;
  const durationMin = Math.min(effortMin, MAX_WORK_SESSION_MIN);

  return suggestionResult({
    id: `hws_${item.id}`,
    homeworkId: item.id,
    familyId: item.familyId,
    kidId: item.kidId,
    title: `Work on ${item.title}`,
    date: sessionDate,
    durationMin,
    effortMin,
    remainingEffortMin: effortMin - durationMin,
    dueDate,
    source: "homework",
    status: "suggested",
    // This is a suggestion contract, not an event or a commitment. Keeping
    // these explicit makes it safe for a kid-facing client to act on without
    // accidentally treating the response as a calendar write.
    time: null,
    calendarEventId: null,
    autoScheduled: false,
    requiresParentConfirmation: false,
  });
}

// Family-scoped lookup wrapper for the route and non-HTTP callers. This is
// intentionally a pure read: repeated calls return the same value for the
// same homework fields and do not alter homework lifecycle/edit metadata.
function suggestWorkSession(familyId, homeworkId, options = {}) {
  const item = getById(familyId, homeworkId);
  if (!item) return { error: "Homework item not found." };
  if (item.familyId !== familyId) return { error: "Homework item not found." };
  return buildWorkSessionSuggestion(item, options);
}

// ---------- CRUD ----------

// List homework for a family, optionally filtered by kidId/subject.
// Ownership scoping (kid sees only their own) is applied by the CALLER —
// this just filters by the params given, same division of labor as
// school-feeds.listFeedsForFamily / syncFamily.
function listForFamily(familyId, { kidId, subject } = {}) {
  let items = famList(familyId).slice();
  if (kidId) items = items.filter((h) => h.kidId === kidId);
  if (subject) {
    const s = String(subject).trim().toLowerCase();
    items = items.filter((h) => (h.subject || "").toLowerCase() === s);
  }
  return items.sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
}

function getById(familyId, id) {
  return famList(familyId).find((h) => h.id === id) || null;
}

function addHomework(familyId, { kidId, title, subject, dueDate, dueTime, effortMin, source, notes, checklist, moodleIdentity } = {}) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  if (!kidId || !fam.kids.some((k) => k.id === kidId)) return { error: "Kid not found in this family." };
  const t = String(title || "").trim().slice(0, 200);
  if (!t) return { error: "Title is required." };
  const dd = sanitizeDueDate(dueDate);
  if (!dd) return { error: "A valid due date (YYYY-MM-DD) is required." };
  const src = SOURCES.has(source) ? source : "manual";
  const cleanMoodleIdentity = src === "school-portal"
    ? moodleCompletionOutbox.sanitizeMoodleIdentity(moodleIdentity)
    : null;
  if (src === "school-portal" && moodleIdentity != null && !cleanMoodleIdentity) {
    return { error: "A valid Moodle identity is required." };
  }

  const item = {
    id: hwId(),
    familyId,
    kidId,
    title: t,
    subject: String(subject || "").trim().slice(0, 60),
    dueDate: dd,
    dueTime: sanitizeDueTime(dueTime),
    status: "todo",
    effortMin: Number.isFinite(Number(effortMin)) && Number(effortMin) > 0 ? Math.round(Number(effortMin)) : null,
    source: src,
    sourceUid: cleanMoodleIdentity ? moodleCompletionOutbox.sourceUidForIdentity(cleanMoodleIdentity) : null,
    notes: String(notes || "").trim().slice(0, 2000),
    checklist: sanitizeChecklist(checklist),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (cleanMoodleIdentity) item.moodleIdentity = cleanMoodleIdentity;
  famList(familyId).push(item);
  db.persist();
  return { homework: item };
}

// Updates status/fields/checklist. `patch` fields are all optional; only
// provided fields are applied. Ownership is checked by the caller before
// calling this (see canAccess below) — this function just applies the patch.
function updateHomework(familyId, id, patch = {}) {
  const item = getById(familyId, id);
  if (!item) return { error: "Homework item not found." };
  const previousStatus = item.status;

  if (patch.title != null) {
    const t = String(patch.title).trim().slice(0, 200);
    if (!t) return { error: "Title cannot be empty." };
    item.title = t;
  }
  if (patch.subject != null) item.subject = String(patch.subject).trim().slice(0, 60);
  if (patch.dueDate != null) {
    const dd = sanitizeDueDate(patch.dueDate);
    if (!dd) return { error: "A valid due date (YYYY-MM-DD) is required." };
    item.dueDate = dd;
  }
  if (patch.dueTime !== undefined) item.dueTime = patch.dueTime ? sanitizeDueTime(patch.dueTime) : null;
  if (patch.status != null) {
    if (!STATUSES.has(patch.status)) return { error: "Invalid status." };
    item.status = patch.status;
  }
  if (patch.effortMin !== undefined) {
    item.effortMin = Number.isFinite(Number(patch.effortMin)) && Number(patch.effortMin) > 0
      ? Math.round(Number(patch.effortMin)) : null;
  }
  if (patch.notes != null) item.notes = String(patch.notes).trim().slice(0, 2000);
  if (patch.checklist != null) item.checklist = sanitizeChecklist(patch.checklist);

  item.updatedAt = new Date().toISOString();
  let completionSync = null;
  if (previousStatus !== "done" && item.status === "done") {
    if (item.source !== "school-portal") {
      completionSync = { queued: false, reason: "not_moodle_homework" };
    } else {
      const queued = moodleCompletionOutbox.enqueueInMemory(familyId, item);
      completionSync = queued.queued
        ? { queued: true, requestId: queued.request.requestId }
        : { queued: false, reason: queued.reason };
    }
  } else if (previousStatus === "done" && item.status !== "done") {
    const cancelledRequestIds = moodleCompletionOutbox.cancelPendingInMemory(familyId, item.id);
    completionSync = {
      queued: false,
      reason: "completion_cancelled",
      cancelledRequestIds,
    };
  } else if (patch.status === "done") {
    completionSync = { queued: false, reason: "already_done" };
  }
  db.persist();
  return completionSync ? { homework: item, completionSync } : { homework: item };
}

function setMoodleIdentity(familyId, id, identity) {
  const item = getById(familyId, id);
  if (!item) return { error: "Homework item not found." };
  if (item.source !== "school-portal") return { error: "Only Moodle-imported homework can have a Moodle identity." };
  const clean = moodleCompletionOutbox.sanitizeMoodleIdentity(identity);
  if (!clean) return { error: "A valid Moodle identity is required." };
  const sourceUid = moodleCompletionOutbox.sourceUidForIdentity(clean);
  if (item.sourceUid === sourceUid && moodleCompletionOutbox.identityMatches(item.moodleIdentity, clean)) {
    return { homework: item, completionSync: { queued: false, reason: "identity_unchanged" } };
  }

  const cancelledRequestIds = moodleCompletionOutbox.cancelPendingInMemory(familyId, item.id);
  item.moodleIdentity = clean;
  item.sourceUid = sourceUid;
  item.updatedAt = new Date().toISOString();

  let completionSync = {
    queued: false,
    reason: "identity_updated",
    cancelledRequestIds,
  };
  if (item.status === "done") {
    const queued = moodleCompletionOutbox.enqueueInMemory(familyId, item);
    completionSync = queued.queued
      ? { queued: true, requestId: queued.request.requestId, cancelledRequestIds }
      : { queued: false, reason: queued.reason, cancelledRequestIds };
  }
  db.persist();
  return { homework: item, completionSync };
}

function listPendingMoodleCompletions(familyId, options) {
  const result = moodleCompletionOutbox.listPending(
    familyId,
    (homeworkId) => getById(familyId, homeworkId),
    options
  );
  if (result.changed) db.persist();
  return { completions: result.completions, hasMore: result.hasMore };
}

function claimMoodleCompletion(familyId, requestId) {
  const result = moodleCompletionOutbox.claimInMemory(
    familyId,
    requestId,
    (homeworkId) => getById(familyId, homeworkId)
  );
  if (result.changed) db.persist();
  return { completion: result.completion };
}

function acknowledgeMoodleCompletions(familyId, requestIds) {
  const result = moodleCompletionOutbox.acknowledgeInMemory(
    familyId,
    requestIds
  );
  if (result.changed) db.persist();
  return { acknowledgedRequestIds: result.acknowledgedRequestIds };
}

function removeHomework(familyId, id) {
  const list = famList(familyId);
  const before = list.length;
  const filtered = list.filter((h) => h.id !== id);
  if (filtered.length === before) return { error: "Homework item not found." };
  moodleCompletionOutbox.cancelPendingInMemory(familyId, id);
  root().homework[familyId] = filtered;
  db.persist();
  return { ok: true };
}

// Remove every homework item with a given source (e.g. "school"). Used to
// purge items that were auto-ingested from public calendars, which we no
// longer treat as homework. Returns the number removed.
function removeBySource(familyId, source) {
  const list = famList(familyId);
  const kept = list.filter((h) => h.source !== source);
  const removed = list.length - kept.length;
  if (removed > 0) {
    root().homework[familyId] = kept;
    db.persist();
  }
  return removed;
}

function toggleChecklistItem(familyId, id, index, done) {
  const item = getById(familyId, id);
  if (!item) return { error: "Homework item not found." };
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= item.checklist.length) {
    return { error: "Checklist item not found." };
  }
  item.checklist[idx].done = done === undefined ? !item.checklist[idx].done : !!done;
  item.updatedAt = new Date().toISOString();
  db.persist();
  return { homework: item };
}

// ---------- permissions ----------

// A kid may only touch homework where kidId === their own kid profile id; a
// parent may touch any homework in the family. `user` is the authenticated
// req.user; `role` is userRole(user) ("parent"|"kid") from server.js.
function canAccess(user, role, familyId, item) {
  if (!item || item.familyId !== familyId) return false;
  if (role === "kid") {
    const myKidId = user && user.data && user.data.kid && user.data.kid.kidId;
    return !!myKidId && item.kidId === myKidId;
  }
  return true; // any parent in the family may touch any homework in it
}

// ---------- ingestion from Phase 2 feed deadlines ----------

// Upserts homework from Phase 2 deadline events, keyed by sourceUid (the
// feed's iCal UID, scoped per subscription so it can't collide across kids/
// feeds — same key shape school-feeds.collectFromCache() dedups events by:
// `${subscriptionId}::${uid}`). A re-sync UPDATES the school-sourced fields
// (title/subject/dueDate/dueTime) but NEVER touches user-owned fields
// (status, notes, checklist, effortMin) so a kid's progress/notes survive
// re-ingestion. Only items with isDeadline/type:"deadline" are ingested —
// callers should already filter to those, but this defends in depth too.
function ingestDeadlines(familyId, deadlineEvents = []) {
  const list = famList(familyId);
  const bySourceUid = new Map(list.filter((h) => h.sourceUid).map((h) => [h.sourceUid, h]));
  let created = 0;
  let updated = 0;

  for (const ev of deadlineEvents) {
    if (!ev || !ev.isDeadline && ev.type !== "deadline") continue;
    if (!ev.kidId || !ev.uid || !ev.subscriptionId) continue; // need a kid + stable key to ingest
    const dueDate = ev.allDay ? ev.start : String(ev.start || "").slice(0, 10);
    if (!sanitizeDueDate(dueDate)) continue;
    const dueTime = (!ev.allDay && ev.start && ev.start.length > 10) ? ev.start.slice(11, 16) : null;
    const sourceUid = `${ev.subscriptionId}::${ev.uid}`;

    const existing = bySourceUid.get(sourceUid);
    if (existing) {
      // Update school-sourced descriptive fields only — never clobber status,
      // notes, checklist, or effortMin (the user's own progress/annotations).
      existing.title = String(ev.title || existing.title).trim().slice(0, 200);
      existing.dueDate = sanitizeDueDate(dueDate) || existing.dueDate;
      existing.dueTime = sanitizeDueTime(dueTime);
      existing.subject = existing.subject || (ev.feedLabel ? String(ev.feedLabel).slice(0, 60) : "");
      existing.updatedAt = new Date().toISOString();
      updated++;
    } else {
      const item = {
        id: hwId(),
        familyId,
        kidId: ev.kidId,
        title: String(ev.title || "Deadline").trim().slice(0, 200),
        subject: ev.feedLabel ? String(ev.feedLabel).slice(0, 60) : "",
        dueDate: sanitizeDueDate(dueDate),
        dueTime: sanitizeDueTime(dueTime),
        status: "todo",
        effortMin: null,
        source: "school",
        sourceUid,
        notes: ev.description ? String(ev.description).trim().slice(0, 2000) : "",
        checklist: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      list.push(item);
      bySourceUid.set(sourceUid, item);
      created++;
    }
  }

  if (created || updated) db.persist();
  return { created, updated };
}

// ---------- due-date grouping ----------
// Overdue / Today / This week / Later — used by both the client (rendering)
// and tests. `todayIso` defaults to real today but is injectable for tests.
function groupByDueDate(items, todayIso) {
  const today = todayIso || new Date().toISOString().slice(0, 10);
  const todayDate = new Date(today + "T00:00:00");
  const weekEnd = new Date(todayDate);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndIso = weekEnd.toISOString().slice(0, 10);

  const groups = { overdue: [], today: [], thisWeek: [], later: [] };
  for (const item of items) {
    if (!item.dueDate) { groups.later.push(item); continue; }
    if (item.status === "done") {
      // Completed items still need a home in the UI; keep them with their
      // natural due-date bucket rather than a separate "done" pile so
      // parents/kids see them in context (rendered with strikethrough).
    }
    if (item.dueDate < today) groups.overdue.push(item);
    else if (item.dueDate === today) groups.today.push(item);
    else if (item.dueDate <= weekEndIso) groups.thisWeek.push(item);
    else groups.later.push(item);
  }
  return groups;
}

module.exports = {
  listForFamily,
  getById,
  addHomework,
  updateHomework,
  setMoodleIdentity,
  listPendingMoodleCompletions,
  claimMoodleCompletion,
  acknowledgeMoodleCompletions,
  removeHomework,
  removeBySource,
  toggleChecklistItem,
  buildWorkSessionSuggestion,
  suggestWorkSession,
  canAccess,
  ingestDeadlines,
  groupByDueDate,
  STATUSES,
  SOURCES,
  MAX_WORK_SESSION_MIN,
};

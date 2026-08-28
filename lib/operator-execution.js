"use strict";

/**
 * Approval decisions and constrained execution for Hermes Family Operator.
 *
 * Every execution reloads the exact encrypted action approved by a parent.
 * M3 extends the allowlist to reversible FamETC-native writes while preserving
 * the same exact-hash, short-lived capability and transactional audit model.
 */
const crypto = require("crypto");
const operatorStore = require("./operator-store");
const operator = require("./operator");
const operatorRisk = require("./operator-risk");
const family = require("./family");
const events = require("./events");
const actions = require("./actions");
const trips = require("./trips");
const datacrypto = require("./datacrypto");
const { ensureDataDir } = require("./paths");

const EXECUTION_STATES = Object.freeze(["ready", "claimed", "running", "consumed", "failed", "expired", "cancelled"]);
const TOKEN_PREFIX = "oprun1";
const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;
const MAX_TOKEN_TTL_MS = 15 * 60 * 1000;
const ACTION_HASH_RE = /^[0-9a-f]{64}$/i;
const CALENDAR_FIELDS = new Set(["title", "date", "time", "endTime", "notes", "category", "kidId", "endDate", "repeat", "repeatUntil"]);
const CALENDAR_REPEATS = new Set(["none", "daily", "weekly", "biweekly", "monthly"]);
const ACTION_CREATE_FIELDS = new Set(["title", "notes", "dueDate", "dueTime", "assigneeType", "assigneeId", "kidId", "status", "snoozedUntil"]);
const ACTION_UPDATE_FIELDS = new Set([...ACTION_CREATE_FIELDS]);
const ACTION_STATUSES = new Set(["open", "done", "snoozed"]);
const ASSIGNEE_TYPES = new Set(["family", "parent", "kid"]);
const TRIP_ITEM_FIELDS = new Set(["date", "time", "title", "category", "note"]);

class OperatorExecutionError extends Error {
  constructor(message, code = "OPERATOR_EXECUTION_ERROR") {
    super(message);
    this.name = "OperatorExecutionError";
    this.code = code;
  }
}

function nowIso() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}_${crypto.randomBytes(12).toString("hex")}`; }
function encryptionKey() {
  const key = datacrypto.loadKey();
  if (!key) throw new OperatorExecutionError("DATA_ENCRYPTION_KEY is required for Operator approval/execution storage.", "OPERATOR_EXECUTION_UNAVAILABLE");
  return key;
}
function encodeSecret(value) {
  const raw = typeof value === "string" ? value : JSON.stringify(value == null ? null : value);
  return datacrypto.encrypt(raw, encryptionKey());
}
function decodeSecret(value, { json = false } = {}) {
  if (value == null) return json ? null : "";
  const encrypted = String(value);
  if (!datacrypto.isEncrypted(encrypted)) throw new OperatorExecutionError("Operator execution payload is not encrypted.", "OPERATOR_EXECUTION_UNAVAILABLE");
  const raw = datacrypto.decrypt(encrypted, encryptionKey());
  if (!json) return raw;
  try { return JSON.parse(raw); } catch (_) { throw new OperatorExecutionError("Operator execution payload could not be decoded.", "OPERATOR_EXECUTION_UNAVAILABLE"); }
}
function tokenHash(token) { return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex"); }
function cleanActionHash(value) {
  const hash = String(value || "").trim().toLowerCase();
  if (!ACTION_HASH_RE.test(hash)) throw new OperatorExecutionError("A valid approved actionHash is required.", "APPROVAL_HASH_INVALID");
  return hash;
}
function actionObject(value, label = "action") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OperatorExecutionError(`${label} must be an object.`, "EXECUTION_ACTION_INVALID");
  return value;
}
function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new OperatorExecutionError(`Unsupported ${label} field: ${key}.`, "EXECUTION_ACTION_INVALID");
}
function text(value, field, max, { required = false } = {}) {
  const out = String(value == null ? "" : value).trim();
  if (required && !out) throw new OperatorExecutionError(`${field} is required.`, "EXECUTION_ACTION_INVALID");
  if (out.length > max) throw new OperatorExecutionError(`${field} must be ${max} characters or fewer.`, "EXECUTION_ACTION_INVALID");
  return out;
}
function isoDate(value, field, { optional = false } = {}) {
  if ((value == null || value === "") && optional) return null;
  const raw = String(value || "");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) throw new OperatorExecutionError(`${field} must be YYYY-MM-DD.`, "EXECUTION_ACTION_INVALID");
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const dt = new Date(0); dt.setUTCHours(0, 0, 0, 0); dt.setUTCFullYear(y, mo - 1, d);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) throw new OperatorExecutionError(`${field} is not a valid calendar date.`, "EXECUTION_ACTION_INVALID");
  return raw;
}
function time(value, field, { optional = true } = {}) {
  if ((value == null || value === "") && optional) return "";
  const raw = String(value || "");
  const m = /^(\d{2}):(\d{2})$/.exec(raw);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new OperatorExecutionError(`${field} must be HH:MM in 24-hour time.`, "EXECUTION_ACTION_INVALID");
  return raw;
}
function isoTimestamp(value, field, { optional = true } = {}) {
  if ((value == null || value === "") && optional) return null;
  const raw = String(value || "");
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || !Number.isFinite(Date.parse(raw))) throw new OperatorExecutionError(`${field} must be an ISO timestamp with timezone.`, "EXECUTION_ACTION_INVALID");
  return new Date(Date.parse(raw)).toISOString();
}
function familyRecord(familyId) {
  const fam = family.getFamily(familyId);
  if (!fam) throw new OperatorExecutionError("Family not found.", "OPERATOR_FAMILY_NOT_FOUND");
  return fam;
}
function kidRef(fam, value, field = "kidId") {
  if (value == null || value === "") return null;
  const id = String(value);
  if (!(fam.kids || []).some((kid) => kid.id === id)) throw new OperatorExecutionError(`${field} does not belong to this family.`, "EXECUTION_ACTION_INVALID");
  return id;
}
function parentRef(fam, value, field = "assigneeId") {
  const id = String(value || "");
  if (!(fam.parentIds || []).includes(id)) throw new OperatorExecutionError(`${field} is not a parent in this family.`, "EXECUTION_ACTION_INVALID");
  return id;
}
function wrapDomain(result, message) {
  if (!result || result.error) throw new OperatorExecutionError((result && result.error) || message, "EXECUTION_DRIVER_FAILED");
  return result;
}
function executablePolicy(actionType) {
  try { return operatorRisk.requireExecutable(actionType); }
  catch (error) { throw new OperatorExecutionError(error.message, error.code || "OPERATOR_EXECUTION_UNSUPPORTED_ACTION"); }
}

function validateCalendarPayload(familyId, action) {
  actionObject(action); onlyKeys(action, CALENDAR_FIELDS, "calendar action");
  const fam = familyRecord(familyId);
  const date = isoDate(action.date, "date");
  const endDate = isoDate(action.endDate, "endDate", { optional: true });
  if (endDate && endDate < date) throw new OperatorExecutionError("endDate cannot be before date.", "EXECUTION_ACTION_INVALID");
  const repeat = action.repeat == null ? "none" : String(action.repeat);
  if (!CALENDAR_REPEATS.has(repeat)) throw new OperatorExecutionError("Unsupported calendar repeat value.", "EXECUTION_ACTION_INVALID");
  const repeatUntil = isoDate(action.repeatUntil, "repeatUntil", { optional: true });
  if (repeatUntil && repeatUntil < date) throw new OperatorExecutionError("repeatUntil cannot be before date.", "EXECUTION_ACTION_INVALID");
  const category = action.category == null ? "other" : String(action.category);
  if (!events.CATEGORIES.has(category)) throw new OperatorExecutionError("Unsupported calendar category.", "EXECUTION_ACTION_INVALID");
  return {
    title: text(action.title, "Calendar title", 200, { required: true }), date,
    time: time(action.time, "time"), endTime: time(action.endTime, "endTime"),
    notes: text(action.notes, "Calendar notes", 1000), category,
    kidId: kidRef(fam, action.kidId), endDate, repeat, repeatUntil,
  };
}

function validateCalendarUpdate(familyId, action) {
  actionObject(action);
  onlyKeys(action, new Set(["eventId", "patch"]), "calendar update");
  const eventId = text(action.eventId, "eventId", 160, { required: true });
  const current = events.getById(familyId, eventId);
  if (!current) throw new OperatorExecutionError("Calendar event not found.", "EXECUTION_ACTION_INVALID");
  const patch = actionObject(action.patch, "patch"); onlyKeys(patch, CALENDAR_FIELDS, "calendar patch");
  if (!Object.keys(patch).length) throw new OperatorExecutionError("Calendar update patch is empty.", "EXECUTION_ACTION_INVALID");
  const merged = {};
  for (const key of CALENDAR_FIELDS) merged[key] = Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : current[key];
  const normalized = validateCalendarPayload(familyId, merged);
  return { eventId, patch: normalized };
}

function validateAssignee(fam, input) {
  let type = input.assigneeType == null || input.assigneeType === "" ? null : String(input.assigneeType);
  const id = input.assigneeId == null || input.assigneeId === "" ? null : String(input.assigneeId);
  const kid = input.kidId == null || input.kidId === "" ? null : String(input.kidId);
  if (!type) {
    if (kid) type = "kid";
    else if (id && (fam.parentIds || []).includes(id)) type = "parent";
    else if (id && (fam.kids || []).some((k) => k.id === id)) type = "kid";
    else type = "family";
  }
  if (!ASSIGNEE_TYPES.has(type)) throw new OperatorExecutionError("assigneeType must be family, parent or kid.", "EXECUTION_ACTION_INVALID");
  if (type === "family") {
    if (id || kid) throw new OperatorExecutionError("A family action cannot have an assignee id.", "EXECUTION_ACTION_INVALID");
    return { assigneeType: "family", assigneeId: null, kidId: null };
  }
  if (type === "parent") {
    if (kid) throw new OperatorExecutionError("Parent action cannot have kidId.", "EXECUTION_ACTION_INVALID");
    return { assigneeType: "parent", assigneeId: parentRef(fam, id), kidId: null };
  }
  const target = kid || id;
  const validKid = kidRef(fam, target, "assignee kid");
  if (id && kid && id !== kid) throw new OperatorExecutionError("assigneeId and kidId must identify the same kid.", "EXECUTION_ACTION_INVALID");
  return { assigneeType: "kid", assigneeId: validKid, kidId: validKid };
}

function validateActionCreate(familyId, action) {
  actionObject(action); onlyKeys(action, ACTION_CREATE_FIELDS, "family action");
  const fam = familyRecord(familyId);
  const status = action.status == null || action.status === "" ? "open" : String(action.status);
  if (!ACTION_STATUSES.has(status)) throw new OperatorExecutionError("status must be open, done or snoozed.", "EXECUTION_ACTION_INVALID");
  const dueDate = isoDate(action.dueDate, "dueDate", { optional: true });
  const dueTime = action.dueTime == null || action.dueTime === "" ? null : time(action.dueTime, "dueTime", { optional: false });
  const snoozedUntil = isoTimestamp(action.snoozedUntil, "snoozedUntil");
  if (status === "snoozed" && !snoozedUntil) throw new OperatorExecutionError("A snoozed action needs snoozedUntil.", "EXECUTION_ACTION_INVALID");
  if (status !== "snoozed" && snoozedUntil) throw new OperatorExecutionError("snoozedUntil requires status snoozed.", "EXECUTION_ACTION_INVALID");
  return {
    title: text(action.title, "Action title", 200, { required: true }),
    notes: text(action.notes, "Action notes", 2000), dueDate, dueTime,
    ...validateAssignee(fam, action), status, snoozedUntil,
  };
}

function validateActionUpdate(familyId, action) {
  actionObject(action); onlyKeys(action, new Set(["actionId", "patch"]), "action update");
  const actionId = text(action.actionId, "actionId", 160, { required: true });
  const current = actions.getById(familyId, actionId);
  if (!current) throw new OperatorExecutionError("Family action not found.", "EXECUTION_ACTION_INVALID");
  const patch = actionObject(action.patch, "patch"); onlyKeys(patch, ACTION_UPDATE_FIELDS, "action patch");
  if (!Object.keys(patch).length) throw new OperatorExecutionError("Action update patch is empty.", "EXECUTION_ACTION_INVALID");
  const merged = {};
  for (const key of ACTION_CREATE_FIELDS) merged[key] = Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : current[key];
  const normalized = validateActionCreate(familyId, merged);
  return { actionId, patch: normalized };
}

function familyCanManageTrip(fam, trip, parentUserId) {
  if (!trip) return false;
  return (trip.members || []).some((member) => member.userId === parentUserId && ["owner", "editor"].includes(member.role));
}
function validateTripItem(item, { allowPartial = false } = {}) {
  actionObject(item, "item"); onlyKeys(item, TRIP_ITEM_FIELDS, "itinerary item");
  const out = {};
  if (!allowPartial || Object.prototype.hasOwnProperty.call(item, "date")) out.date = item.date == null || item.date === "" ? null : isoDate(item.date, "date");
  if (!allowPartial || Object.prototype.hasOwnProperty.call(item, "time")) out.time = item.time == null || item.time === "" ? "" : time(item.time, "time", { optional: false });
  if (!allowPartial || Object.prototype.hasOwnProperty.call(item, "title")) out.title = text(item.title, "Itinerary title", 200, { required: !allowPartial });
  if (!allowPartial || Object.prototype.hasOwnProperty.call(item, "category")) {
    const category = item.category == null ? "" : String(item.category);
    if (!trips.CATEGORIES.has(category)) throw new OperatorExecutionError("Unsupported itinerary category.", "EXECUTION_ACTION_INVALID");
    out.category = category;
  }
  if (!allowPartial || Object.prototype.hasOwnProperty.call(item, "note")) out.note = text(item.note, "Itinerary note", 1000);
  return out;
}
function validateTripItinerary(familyId, action) {
  actionObject(action); onlyKeys(action, new Set(["tripId", "operation", "itemId", "item"]), "trip itinerary action");
  const fam = familyRecord(familyId);
  const tripId = text(action.tripId, "tripId", 160, { required: true });
  const trip = trips.getTrip(tripId);
  if (!trip || !(trip.familyId === fam.id || (trip.members || []).some((m) => (fam.parentIds || []).includes(m.userId)))) throw new OperatorExecutionError("Trip is not associated with this family.", "EXECUTION_ACTION_INVALID");
  const operation = String(action.operation || "add");
  if (!new Set(["add", "update"]).has(operation)) throw new OperatorExecutionError("Trip itinerary operation must be add or update.", "EXECUTION_ACTION_INVALID");
  if (operation === "add") {
    const item = validateTripItem(action.item || {});
    if (item.date && (item.date < trip.startDate || item.date > trip.endDate)) throw new OperatorExecutionError("Itinerary date must be within trip dates.", "EXECUTION_ACTION_INVALID");
    return { tripId, operation, item };
  }
  const itemId = text(action.itemId, "itemId", 160, { required: true });
  if (!trips.getItineraryItem(trip, itemId)) throw new OperatorExecutionError("Itinerary item not found.", "EXECUTION_ACTION_INVALID");
  const patch = validateTripItem(action.item || {}, { allowPartial: true });
  if (!Object.keys(patch).length) throw new OperatorExecutionError("Itinerary update is empty.", "EXECUTION_ACTION_INVALID");
  if (patch.date && (patch.date < trip.startDate || patch.date > trip.endDate)) throw new OperatorExecutionError("Itinerary date must be within trip dates.", "EXECUTION_ACTION_INVALID");
  return { tripId, operation, itemId, item: patch };
}

const ACTION_DRIVERS = Object.freeze({
  "calendar.create": {
    validate: validateCalendarPayload,
    execute({ familyId, action, grant, decidedBy }) {
      const payload = validateCalendarPayload(familyId, action);
      const existing = events.getBySource(familyId, "operator", grant.id);
      if (existing) return { driver: "calendar.create", eventId: existing.id, existing: true, sourceType: "operator", sourceId: grant.id };
      const result = wrapDomain(events.addEvent(familyId, { ...payload, createdBy: decidedBy || null, sourceType: "operator", sourceId: grant.id }), "Calendar event could not be created.");
      return { driver: "calendar.create", eventId: result.event.id, existing: result.existing === true, sourceType: "operator", sourceId: grant.id };
    },
  },
  "calendar.update": {
    validate: validateCalendarUpdate,
    execute({ familyId, action }) {
      const payload = validateCalendarUpdate(familyId, action);
      const result = wrapDomain(events.updateEvent(familyId, payload.eventId, payload.patch), "Calendar event could not be updated.");
      return { driver: "calendar.update", eventId: result.event.id, updated: true };
    },
  },
  "action.create": {
    validate: validateActionCreate,
    execute({ familyId, action, grant, decidedBy }) {
      const payload = validateActionCreate(familyId, action);
      const existing = actions.getBySource(familyId, "manual", grant.id);
      if (existing) return { driver: "action.create", actionId: existing.id, existing: true, sourceId: grant.id };
      const result = wrapDomain(actions.createAction(familyId, { ...payload, sourceType: "manual", sourceId: grant.id, createdBy: decidedBy || null }), "Family action could not be created.");
      return { driver: "action.create", actionId: result.action.id, existing: false, sourceId: grant.id };
    },
  },
  "action.update": {
    validate: validateActionUpdate,
    execute({ familyId, action }) {
      const payload = validateActionUpdate(familyId, action);
      const result = wrapDomain(actions.updateAction(familyId, payload.actionId, payload.patch), "Family action could not be updated.");
      return { driver: "action.update", actionId: result.action.id, updated: true };
    },
  },
  "trip.itinerary.update": {
    validate: validateTripItinerary,
    execute({ familyId, action, decidedBy }) {
      const payload = validateTripItinerary(familyId, action);
      const fam = familyRecord(familyId);
      const trip = trips.getTrip(payload.tripId);
      if (!familyCanManageTrip(fam, trip, decidedBy)) throw new OperatorExecutionError("The approving parent is not a writable member of this trip.", "EXECUTION_DRIVER_FAILED");
      if (payload.operation === "add") {
        const duplicate = trips.findItineraryDuplicates(payload.tripId, [payload.item])[0];
        if (duplicate && duplicate.existingItem) return { driver: "trip.itinerary.update", operation: "add", tripId: payload.tripId, itemId: duplicate.existingItem.id, existing: true };
        const result = wrapDomain(trips.addItineraryItem(payload.tripId, decidedBy, payload.item), "Itinerary item could not be added.");
        return { driver: "trip.itinerary.update", operation: "add", tripId: payload.tripId, itemId: result.item.id, existing: false };
      }
      const result = wrapDomain(trips.updateItineraryItem(payload.tripId, payload.itemId, payload.item), "Itinerary item could not be updated.");
      return { driver: "trip.itinerary.update", operation: "update", tripId: payload.tripId, itemId: result.item.id, updated: true };
    },
  },
});

function supportedActionTypes() { return Object.keys(ACTION_DRIVERS); }
function validateAction(familyId, actionType, action) {
  const type = String(actionType || "").trim();
  executablePolicy(type);
  const driver = ACTION_DRIVERS[type];
  if (!driver) throw new OperatorExecutionError(`Action type ${type || "(missing)"} has no approved execution driver.`, "EXECUTION_UNSUPPORTED_ACTION");
  return driver.validate(familyId, action);
}

function createOperatorExecution(options = {}) {
  const dbFile = options.dbFile || operatorStore.DEFAULT_DB_FILE;
  let Database = options.Database || null;
  let database = null;
  let initAttempted = false;

  function initialize() {
    if (database || initAttempted) return database;
    initAttempted = true;
    try {
      encryptionKey();
      if (!Database) Database = require("better-sqlite3");
      ensureDataDir();
      const foundationStore = operatorStore.createOperatorStore({ dbFile, Database });
      const foundationStatus = foundationStore.status(); foundationStore.close();
      if (!foundationStatus.available) throw new Error("operator-store schema is unavailable.");
      database = new Database(dbFile);
      database.pragma("journal_mode = WAL"); database.pragma("foreign_keys = ON"); database.pragma("busy_timeout = 5000"); database.pragma("synchronous = NORMAL");
      const columns = new Set(database.prepare("PRAGMA table_info(operator_approvals)").all().map((row) => row.name));
      if (!columns.has("decided_by")) database.exec("ALTER TABLE operator_approvals ADD COLUMN decided_by TEXT");
      database.exec(`
        CREATE TABLE IF NOT EXISTS operator_execution_grants (
          id TEXT PRIMARY KEY, family_id TEXT NOT NULL, case_id TEXT NOT NULL,
          approval_id TEXT NOT NULL UNIQUE, action_type TEXT NOT NULL, action_hash TEXT NOT NULL,
          state TEXT NOT NULL, executor_type TEXT, token_hash TEXT, token_expires_at TEXT,
          claimed_at TEXT, consumed_at TEXT, result_secret TEXT, error_secret TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          FOREIGN KEY(case_id) REFERENCES operator_cases(id) ON DELETE CASCADE,
          FOREIGN KEY(approval_id) REFERENCES operator_approvals(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_operator_execution_family_state ON operator_execution_grants(family_id, state, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_operator_execution_case ON operator_execution_grants(case_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_operator_execution_token ON operator_execution_grants(token_hash);
      `);
      return database;
    } catch (error) {
      if (database) { try { database.close(); } catch (_) {} }
      database = null; return null;
    }
  }
  function requireDb() {
    const db = initialize();
    if (!db) throw new OperatorExecutionError("Hermes Operator approval/execution storage is unavailable; refusing to execute.", "OPERATOR_EXECUTION_UNAVAILABLE");
    return db;
  }
  function status() {
    const db = initialize();
    return { available: !!db, backend: "sqlite", fallback: false, supportedActionTypes: supportedActionTypes(), errorCode: db ? null : "OPERATOR_EXECUTION_UNAVAILABLE" };
  }
  function insertAudit(db, { familyId, caseId = null, actorId = null, eventType, payload = null, createdAt = nowIso() }) {
    db.prepare("INSERT INTO operator_audit_events (id, family_id, case_id, actor_id, event_type, payload_secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(newId("audit"), familyId, caseId, actorId, eventType, payload == null ? null : encodeSecret(payload), createdAt);
  }
  function hydrateApproval(row) {
    if (!row) return null;
    return { id: row.id, caseId: row.case_id, requestedBy: row.requested_by || null, approverUserId: row.approver_user_id || null, actionType: row.action_type, actionHash: row.action_hash, action: decodeSecret(row.action_secret, { json: true }), state: row.state, expiresAt: row.expires_at || null, decidedAt: row.decided_at || null, decidedBy: row.decided_by || null, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  function hydrateGrant(row) {
    if (!row) return null;
    return { id: row.id, familyId: row.family_id, caseId: row.case_id, approvalId: row.approval_id, actionType: row.action_type, actionHash: row.action_hash, state: row.state, executorType: row.executor_type || null, tokenExpiresAt: row.token_expires_at || null, claimedAt: row.claimed_at || null, consumedAt: row.consumed_at || null, result: row.result_secret ? decodeSecret(row.result_secret, { json: true }) : null, error: row.error_secret ? decodeSecret(row.error_secret, { json: true }) : null, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  function parentActor(familyId, actor) {
    const fam = family.getFamily(familyId); const validated = operator.validateActor(fam, actor);
    if (validated.type !== "parent" || !validated.userId) throw new OperatorExecutionError("Only a parent can decide or execute an Operator approval.", "APPROVAL_PARENT_REQUIRED");
    return validated;
  }
  function ownedApprovalRow(db, familyId, approvalId) {
    return db.prepare("SELECT a.*, c.family_id, c.state AS case_state FROM operator_approvals a JOIN operator_cases c ON c.id = a.case_id WHERE a.id = ? AND c.family_id = ?").get(approvalId, familyId) || null;
  }
  function transitionCaseInTx(db, familyId, caseId, nextState, actorId, detail) {
    const row = db.prepare("SELECT state FROM operator_cases WHERE id = ? AND family_id = ?").get(caseId, familyId);
    if (!row) throw new OperatorExecutionError("Operator case not found.", "OPERATOR_CASE_NOT_FOUND");
    if (row.state === nextState) return row.state;
    const allowed = operator.ALLOWED_TRANSITIONS[row.state];
    if (!allowed || !allowed.has(nextState)) throw new OperatorExecutionError(`Case cannot transition from ${row.state} to ${nextState}.`, "OPERATOR_INVALID_TRANSITION");
    const updatedAt = nowIso();
    db.prepare("UPDATE operator_cases SET state = ?, updated_at = ? WHERE id = ? AND family_id = ?").run(nextState, updatedAt, caseId, familyId);
    insertAudit(db, { familyId, caseId, actorId, eventType: "case.state_changed", payload: { from: row.state, to: nextState, detail: detail || null }, createdAt: updatedAt });
    return nextState;
  }
  function validateApprovedAction(familyId, row) {
    const action = decodeSecret(row.action_secret, { json: true });
    validateAction(familyId, row.action_type, action);
    return action;
  }
  function getGrantByApproval(db, familyId, approvalId) {
    return hydrateGrant(db.prepare("SELECT * FROM operator_execution_grants WHERE family_id = ? AND approval_id = ?").get(familyId, approvalId));
  }
  function listApprovalsForParent(familyId, parentUserId, options = {}) {
    const db = requireDb(); parentActor(familyId, { type: "parent", userId: parentUserId, principalId: parentUserId });
    const limit = Math.max(1, Math.min(Number(options.limit) || 50, 200));
    const state = options.state ? String(options.state) : null;
    if (state && !operatorStore.APPROVAL_STATES.includes(state)) throw new OperatorExecutionError("Invalid approval state.", "APPROVAL_STATE_INVALID");
    const whereState = state ? " AND a.state = ?" : "";
    const params = state ? [familyId, parentUserId, state, limit] : [familyId, parentUserId, limit];
    return db.prepare(`SELECT a.*, c.family_id, c.state AS case_state FROM operator_approvals a JOIN operator_cases c ON c.id = a.case_id WHERE c.family_id = ? AND (a.approver_user_id IS NULL OR a.approver_user_id = ?) ${whereState} ORDER BY a.created_at DESC LIMIT ?`).all(...params)
      .map((row) => ({ ...hydrateApproval(row), caseState: row.case_state, execution: getGrantByApproval(db, familyId, row.id) }));
  }
  function getApprovalForParent(familyId, parentUserId, approvalId) {
    const db = requireDb(); parentActor(familyId, { type: "parent", userId: parentUserId, principalId: parentUserId });
    const row = ownedApprovalRow(db, familyId, approvalId);
    if (!row || (row.approver_user_id && row.approver_user_id !== parentUserId)) return null;
    return { ...hydrateApproval(row), caseState: row.case_state, execution: getGrantByApproval(db, familyId, approvalId) };
  }
  function decideApproval(familyId, approvalId, input = {}) {
    const db = requireDb(); const actor = parentActor(familyId, input.actor);
    const decision = String(input.decision || "").trim().toLowerCase();
    if (!new Set(["approve", "reject"]).has(decision)) throw new OperatorExecutionError("decision must be approve or reject.", "APPROVAL_DECISION_INVALID");
    const expectedHash = cleanActionHash(input.actionHash); const targetState = decision === "approve" ? "approved" : "rejected";
    const tx = db.transaction(() => {
      const row = ownedApprovalRow(db, familyId, approvalId); if (!row) return { missing: true };
      if (row.approver_user_id && row.approver_user_id !== actor.userId) throw new OperatorExecutionError("This approval is assigned to another parent.", "APPROVAL_WRONG_APPROVER");
      if (row.action_hash.toLowerCase() !== expectedHash) throw new OperatorExecutionError("The proposed action changed. Review the latest action before deciding.", "APPROVAL_HASH_MISMATCH");
      if (row.state !== "pending") {
        if (row.state === targetState && row.decided_by === actor.userId) return { idempotent: true, row };
        throw new OperatorExecutionError(`Approval is already ${row.state}.`, "APPROVAL_NOT_PENDING");
      }
      if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
        const expiredAt = nowIso();
        db.prepare("UPDATE operator_approvals SET state = 'expired', updated_at = ? WHERE id = ? AND state = 'pending'").run(expiredAt, approvalId);
        insertAudit(db, { familyId, caseId: row.case_id, actorId: actor.userId, eventType: "approval.expired", payload: { approvalId, actionHash: row.action_hash }, createdAt: expiredAt });
        if (row.case_state === "waiting_for_approval") transitionCaseInTx(db, familyId, row.case_id, "planning", actor.userId, "Approval expired before decision.");
        return { expired: true };
      }
      if (decision === "approve") validateApprovedAction(familyId, row);
      const decidedAt = nowIso(); const grantId = decision === "approve" ? newId("exec") : null;
      const update = db.prepare("UPDATE operator_approvals SET state = ?, decided_at = ?, decided_by = ?, updated_at = ? WHERE id = ? AND state = 'pending'").run(targetState, decidedAt, actor.userId, decidedAt, approvalId);
      if (update.changes !== 1) throw new OperatorExecutionError("Approval was decided by another request.", "APPROVAL_NOT_PENDING");
      insertAudit(db, { familyId, caseId: row.case_id, actorId: actor.userId, eventType: `approval.${targetState}`, payload: { approvalId, actionType: row.action_type, actionHash: row.action_hash, approverUserId: actor.userId }, createdAt: decidedAt });
      if (decision === "approve") {
        db.prepare("INSERT INTO operator_execution_grants (id, family_id, case_id, approval_id, action_type, action_hash, state, executor_type, token_hash, token_expires_at, claimed_at, consumed_at, result_secret, error_secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'ready', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)")
          .run(grantId, familyId, row.case_id, approvalId, row.action_type, row.action_hash, decidedAt, decidedAt);
        insertAudit(db, { familyId, caseId: row.case_id, actorId: actor.userId, eventType: "execution.authorized", payload: { grantId, approvalId, actionType: row.action_type, actionHash: row.action_hash }, createdAt: decidedAt });
        transitionCaseInTx(db, familyId, row.case_id, "executing", actor.userId, "Parent approved exact action.");
      } else if (row.case_state === "waiting_for_approval") transitionCaseInTx(db, familyId, row.case_id, "planning", actor.userId, "Parent rejected proposed action.");
      return { idempotent: false };
    });
    const outcome = tx.immediate();
    if (outcome.missing) return null;
    if (outcome.expired) throw new OperatorExecutionError("Approval has expired.", "APPROVAL_EXPIRED");
    if (outcome.idempotent) return { approval: hydrateApproval(outcome.row), execution: getGrantByApproval(db, familyId, approvalId), idempotent: true };
    return { approval: hydrateApproval(ownedApprovalRow(db, familyId, approvalId)), execution: getGrantByApproval(db, familyId, approvalId), idempotent: false };
  }
  function claimExecution(familyId, approvalId, input = {}) {
    const db = requireDb(); const actor = parentActor(familyId, input.actor);
    const executorType = String(input.executorType || "hermes").trim().slice(0, 80) || "hermes";
    const ttlMs = Math.max(1000, Math.min(Number(input.ttlMs) || DEFAULT_TOKEN_TTL_MS, MAX_TOKEN_TTL_MS));
    const tx = db.transaction(() => {
      const row = db.prepare("SELECT g.*, a.state AS approval_state, a.action_secret, a.decided_by FROM operator_execution_grants g JOIN operator_approvals a ON a.id = g.approval_id WHERE g.family_id = ? AND g.approval_id = ?").get(familyId, approvalId);
      if (!row || row.approval_state !== "approved") throw new OperatorExecutionError("No approved execution is available.", "EXECUTION_NOT_READY");
      if (!row.decided_by || row.decided_by !== actor.userId) throw new OperatorExecutionError("Execution must be claimed in the approving parent's authorized turn.", "EXECUTION_APPROVER_REQUIRED");
      executablePolicy(row.action_type);
      if (!ACTION_DRIVERS[row.action_type]) throw new OperatorExecutionError("Approved action has no execution driver.", "EXECUTION_UNSUPPORTED_ACTION");
      const now = Date.now(); const tokenExpired = row.token_expires_at && Date.parse(row.token_expires_at) <= now;
      if (!["ready", "claimed", "running"].includes(row.state)) throw new OperatorExecutionError(`Execution is ${row.state}.`, "EXECUTION_NOT_READY");
      if (row.state === "running" || (row.state === "claimed" && !tokenExpired)) throw new OperatorExecutionError("Execution is already claimed.", "EXECUTION_ALREADY_CLAIMED");
      const executionToken = `${TOKEN_PREFIX}.${row.id}.${crypto.randomBytes(32).toString("base64url")}`;
      const expiresAt = new Date(now + ttlMs).toISOString(); const claimedAt = nowIso();
      const update = db.prepare("UPDATE operator_execution_grants SET state = 'claimed', executor_type = ?, token_hash = ?, token_expires_at = ?, claimed_at = ?, error_secret = NULL, updated_at = ? WHERE id = ? AND state = ?")
        .run(executorType, tokenHash(executionToken), expiresAt, claimedAt, claimedAt, row.id, row.state);
      if (update.changes !== 1) throw new OperatorExecutionError("Execution was claimed by another request.", "EXECUTION_ALREADY_CLAIMED");
      insertAudit(db, { familyId, caseId: row.case_id, actorId: actor.userId, eventType: "execution.claimed", payload: { grantId: row.id, approvalId, actionHash: row.action_hash, tokenExpiresAt: expiresAt, executorType }, createdAt: claimedAt });
      return { executionToken, tokenExpiresAt: expiresAt, row };
    });
    const claimed = tx.immediate();
    return { executionToken: claimed.executionToken, tokenExpiresAt: claimed.tokenExpiresAt, grant: getGrantByApproval(db, familyId, approvalId), action: decodeSecret(claimed.row.action_secret, { json: true }), actionHash: claimed.row.action_hash };
  }
  function runExecution(familyId, executionToken, actionHash, input = {}) {
    const db = requireDb(); const actor = parentActor(familyId, input.actor);
    const token = String(executionToken || "");
    if (!token.startsWith(`${TOKEN_PREFIX}.`) || token.length > 512) throw new OperatorExecutionError("Execution token is invalid.", "EXECUTION_TOKEN_INVALID");
    const expectedHash = cleanActionHash(actionHash); const hash = tokenHash(token);
    const txStart = db.transaction(() => {
      const row = db.prepare("SELECT g.*, a.action_secret, a.decided_by, a.state AS approval_state FROM operator_execution_grants g JOIN operator_approvals a ON a.id = g.approval_id WHERE g.family_id = ? AND g.token_hash = ?").get(familyId, hash);
      if (!row || row.approval_state !== "approved") throw new OperatorExecutionError("Execution token is invalid.", "EXECUTION_TOKEN_INVALID");
      if (!row.decided_by || row.decided_by !== actor.userId) throw new OperatorExecutionError("Execution must run in the approving parent's authorized turn.", "EXECUTION_APPROVER_REQUIRED");
      if (row.action_hash.toLowerCase() !== expectedHash) throw new OperatorExecutionError("Approved action hash does not match this execution.", "EXECUTION_HASH_MISMATCH");
      if (row.state !== "claimed") throw new OperatorExecutionError(`Execution is ${row.state}.`, "EXECUTION_NOT_READY");
      if (!row.token_expires_at || Date.parse(row.token_expires_at) <= Date.now()) {
        const expiredAt = nowIso();
        const update = db.prepare("UPDATE operator_execution_grants SET state = 'ready', token_hash = NULL, token_expires_at = NULL, updated_at = ? WHERE id = ? AND state = 'claimed' AND token_hash = ?").run(expiredAt, row.id, hash);
        if (update.changes !== 1) throw new OperatorExecutionError("Execution claim is no longer valid.", "EXECUTION_NOT_READY");
        insertAudit(db, { familyId, caseId: row.case_id, actorId: actor.userId, eventType: "execution.token_expired", payload: { grantId: row.id, approvalId: row.approval_id }, createdAt: expiredAt });
        return { expired: true };
      }
      executablePolicy(row.action_type);
      const driver = ACTION_DRIVERS[row.action_type];
      if (!driver) throw new OperatorExecutionError("Approved action has no execution driver.", "EXECUTION_UNSUPPORTED_ACTION");
      const action = decodeSecret(row.action_secret, { json: true }); driver.validate(familyId, action);
      const runningAt = nowIso();
      const update = db.prepare("UPDATE operator_execution_grants SET state = 'running', updated_at = ? WHERE id = ? AND state = 'claimed' AND token_hash = ?").run(runningAt, row.id, hash);
      if (update.changes !== 1) throw new OperatorExecutionError("Execution claim is no longer valid.", "EXECUTION_NOT_READY");
      insertAudit(db, { familyId, caseId: row.case_id, actorId: actor.userId, eventType: "execution.started", payload: { grantId: row.id, approvalId: row.approval_id, actionHash: row.action_hash, actionType: row.action_type }, createdAt: runningAt });
      return { expired: false, row: { ...row, state: "running" }, driver, action };
    });
    const started = txStart.immediate();
    if (started.expired) throw new OperatorExecutionError("Execution token has expired; claim a new token.", "EXECUTION_TOKEN_EXPIRED");
    const { row, driver, action } = started;
    let result;
    try { result = driver.execute({ familyId, action, grant: hydrateGrant(row), decidedBy: row.decided_by || null }); }
    catch (error) {
      const failedAt = nowIso(); const safeError = { code: error && error.code ? String(error.code) : "EXECUTION_DRIVER_FAILED", message: error && error.message ? String(error.message).slice(0, 1000) : "Execution failed." };
      const txFailed = db.transaction(() => {
        const update = db.prepare("UPDATE operator_execution_grants SET state = 'failed', error_secret = ?, token_hash = NULL, token_expires_at = NULL, updated_at = ? WHERE id = ? AND state = 'running'").run(encodeSecret(safeError), failedAt, row.id);
        if (update.changes !== 1) throw new OperatorExecutionError("Execution state changed before failure was recorded.", "EXECUTION_NOT_READY");
        insertAudit(db, { familyId, caseId: row.case_id, actorId: actor.userId, eventType: "execution.failed", payload: { grantId: row.id, approvalId: row.approval_id, error: safeError }, createdAt: failedAt });
        const current = db.prepare("SELECT state FROM operator_cases WHERE id = ? AND family_id = ?").get(row.case_id, familyId);
        if (current && current.state === "executing") transitionCaseInTx(db, familyId, row.case_id, "failed", actor.userId, "Approved execution failed.");
      });
      txFailed();
      throw error instanceof OperatorExecutionError ? error : new OperatorExecutionError(safeError.message, safeError.code);
    }
    const consumedAt = nowIso();
    const txConsumed = db.transaction(() => {
      const update = db.prepare("UPDATE operator_execution_grants SET state = 'consumed', consumed_at = ?, result_secret = ?, token_hash = NULL, token_expires_at = NULL, updated_at = ? WHERE id = ? AND state = 'running'")
        .run(consumedAt, encodeSecret(result), consumedAt, row.id);
      if (update.changes !== 1) throw new OperatorExecutionError("Execution state changed before completion was recorded.", "EXECUTION_NOT_READY");
      insertAudit(db, { familyId, caseId: row.case_id, actorId: actor.userId, eventType: "execution.completed", payload: { grantId: row.id, approvalId: row.approval_id, actionType: row.action_type, result }, createdAt: consumedAt });
      transitionCaseInTx(db, familyId, row.case_id, "verifying", actor.userId, "Approved execution completed; verification required.");
    });
    txConsumed();
    return { execution: hydrateGrant(db.prepare("SELECT * FROM operator_execution_grants WHERE id = ?").get(row.id)), result };
  }
  function getExecutionForApproval(familyId, approvalId) { return getGrantByApproval(requireDb(), familyId, approvalId); }
  function close() { if (!database) return; try { database.close(); } finally { database = null; initAttempted = true; } }
  return { status, supportedActionTypes, validateAction, listApprovalsForParent, getApprovalForParent, decideApproval, claimExecution, runExecution, getExecutionForApproval, close };
}

let singleton = null;
function defaultExecution() { if (!singleton) singleton = createOperatorExecution(); return singleton; }
module.exports = {
  EXECUTION_STATES, TOKEN_PREFIX, DEFAULT_TOKEN_TTL_MS, MAX_TOKEN_TTL_MS, OperatorExecutionError,
  supportedActionTypes, validateAction, createOperatorExecution,
  status: (...args) => defaultExecution().status(...args),
  listApprovalsForParent: (...args) => defaultExecution().listApprovalsForParent(...args),
  getApprovalForParent: (...args) => defaultExecution().getApprovalForParent(...args),
  decideApproval: (...args) => defaultExecution().decideApproval(...args),
  claimExecution: (...args) => defaultExecution().claimExecution(...args),
  runExecution: (...args) => defaultExecution().runExecution(...args),
  getExecutionForApproval: (...args) => defaultExecution().getExecutionForApproval(...args),
};

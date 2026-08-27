"use strict";

/**
 * Durable storage for Hermes Family Operator cases, steps, approvals and audit.
 *
 * This store is intentionally SQLite-only. Operator automation must never fall
 * back to db.json: multi-step work, approvals and audit records require atomic
 * transactions. If better-sqlite3 cannot be loaded/opened, status() reports the
 * subsystem unavailable and every data operation fails closed.
 *
 * User-authored/operator payloads are encrypted field-by-field with the same
 * AES-256-GCM key used by the rest of FamETC. DATA_ENCRYPTION_KEY is mandatory
 * for this subsystem. Structural fields needed for indexes
 * (family/state/timestamps) remain plaintext.
 */
const crypto = require("crypto");
const { ensureDataDir, dataFile } = require("./paths");
const datacrypto = require("./datacrypto");

const DEFAULT_DB_FILE = dataFile("operator.sqlite");
const CASE_STATES = Object.freeze([
  "draft",
  "planning",
  "researching",
  "waiting_for_input",
  "proposal_ready",
  "waiting_for_approval",
  "executing",
  "verifying",
  "completed",
  "failed",
  "cancelled",
]);
const CASE_STATE_SET = new Set(CASE_STATES);
const RISK_LEVELS = Object.freeze(["low", "medium", "high", "critical"]);
const RISK_LEVEL_SET = new Set(RISK_LEVELS);
const APPROVAL_STATES = Object.freeze(["pending", "approved", "rejected", "expired", "cancelled"]);
const APPROVAL_STATE_SET = new Set(APPROVAL_STATES);
const STEP_STATES = Object.freeze(["pending", "running", "blocked", "completed", "failed", "cancelled"]);
const STEP_STATE_SET = new Set(STEP_STATES);

class OperatorStorageUnavailableError extends Error {
  constructor(cause) {
    super("Hermes Operator storage is unavailable; refusing to use a non-transactional fallback.");
    this.name = "OperatorStorageUnavailableError";
    this.code = "OPERATOR_STORAGE_UNAVAILABLE";
    if (cause) this.cause = cause;
  }
}

class OperatorValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "OperatorValidationError";
    this.code = "OPERATOR_VALIDATION_ERROR";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function boundedString(value, name, max, { required = false } = {}) {
  const out = String(value == null ? "" : value).trim();
  if (required && !out) throw new OperatorValidationError(`${name} is required.`);
  if (out.length > max) throw new OperatorValidationError(`${name} must be ${max} characters or fewer.`);
  return out;
}

function optionalInteger(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new OperatorValidationError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return n;
}

function assertEnum(value, set, name) {
  const out = String(value || "").trim();
  if (!set.has(out)) throw new OperatorValidationError(`Invalid ${name}: ${out || "(empty)"}.`);
  return out;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key]);
    return out;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value == null ? null : value));
}

function encryptionKey() {
  const key = datacrypto.loadKey();
  if (!key) {
    throw new OperatorStorageUnavailableError(new Error("DATA_ENCRYPTION_KEY is required for Hermes Operator storage."));
  }
  return key;
}

function encodeSecret(value) {
  const raw = typeof value === "string" ? value : JSON.stringify(value == null ? null : value);
  return datacrypto.encrypt(raw, encryptionKey());
}

function decodeSecret(value, { json = false } = {}) {
  if (value == null) return json ? null : "";
  let raw = String(value);
  if (!datacrypto.isEncrypted(raw)) {
    throw new OperatorStorageUnavailableError(new Error("Operator payload is not encrypted."));
  }
  raw = datacrypto.decrypt(raw, encryptionKey());
  if (!json) return raw;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new OperatorStorageUnavailableError(new Error("Operator payload could not be decoded."));
  }
}

function createOperatorStore(options = {}) {
  const dbFile = options.dbFile || DEFAULT_DB_FILE;
  let Database = options.Database || null;
  let database = null;
  let initAttempted = false;
  let initError = null;

  function initialize() {
    if (database || initAttempted) return database;
    initAttempted = true;
    try {
      encryptionKey();
      if (!Database) Database = require("better-sqlite3");
      ensureDataDir();
      database = new Database(dbFile);
      database.pragma("journal_mode = WAL");
      database.pragma("foreign_keys = ON");
      database.pragma("busy_timeout = 5000");
      database.pragma("synchronous = NORMAL");
      database.exec(`
        CREATE TABLE IF NOT EXISTS operator_cases (
          id TEXT PRIMARY KEY,
          family_id TEXT NOT NULL,
          actor_id TEXT,
          actor_type TEXT NOT NULL,
          room_id TEXT,
          title_secret TEXT NOT NULL,
          goal_secret TEXT NOT NULL,
          state TEXT NOT NULL,
          risk_level TEXT NOT NULL,
          budget_cents INTEGER,
          context_secret TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_operator_cases_family_state
          ON operator_cases(family_id, state, updated_at DESC);

        CREATE TABLE IF NOT EXISTS operator_case_steps (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          kind TEXT NOT NULL,
          state TEXT NOT NULL,
          input_secret TEXT,
          output_secret TEXT,
          idempotency_key TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(case_id) REFERENCES operator_cases(id) ON DELETE CASCADE,
          UNIQUE(case_id, position),
          UNIQUE(case_id, idempotency_key)
        );
        CREATE INDEX IF NOT EXISTS idx_operator_steps_case_position
          ON operator_case_steps(case_id, position);

        CREATE TABLE IF NOT EXISTS operator_approvals (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          requested_by TEXT,
          approver_user_id TEXT,
          action_type TEXT NOT NULL,
          action_hash TEXT NOT NULL,
          action_secret TEXT NOT NULL,
          state TEXT NOT NULL,
          expires_at TEXT,
          decided_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(case_id) REFERENCES operator_cases(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_operator_approvals_case_state
          ON operator_approvals(case_id, state, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_operator_approvals_approver_state
          ON operator_approvals(approver_user_id, state, created_at DESC);

        CREATE TABLE IF NOT EXISTS operator_audit_events (
          id TEXT PRIMARY KEY,
          family_id TEXT NOT NULL,
          case_id TEXT,
          actor_id TEXT,
          event_type TEXT NOT NULL,
          payload_secret TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY(case_id) REFERENCES operator_cases(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_operator_audit_family_created
          ON operator_audit_events(family_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_operator_audit_case_created
          ON operator_audit_events(case_id, created_at DESC);
      `);
      return database;
    } catch (error) {
      initError = error;
      if (database) {
        try { database.close(); } catch (_) { /* best effort */ }
      }
      database = null;
      return null;
    }
  }

  function requireDb() {
    const db = initialize();
    if (!db) throw new OperatorStorageUnavailableError(initError);
    return db;
  }

  function status() {
    const db = initialize();
    return {
      available: !!db,
      backend: "sqlite",
      fallback: false,
      errorCode: db ? null : "OPERATOR_STORAGE_UNAVAILABLE",
    };
  }

  function hydrateCase(row, { includeChildren = false } = {}) {
    if (!row) return null;
    const out = {
      id: row.id,
      familyId: row.family_id,
      actorId: row.actor_id || null,
      actorType: row.actor_type,
      roomId: row.room_id || null,
      title: decodeSecret(row.title_secret),
      goal: decodeSecret(row.goal_secret),
      state: row.state,
      riskLevel: row.risk_level,
      budgetCents: row.budget_cents == null ? null : Number(row.budget_cents),
      context: row.context_secret ? decodeSecret(row.context_secret, { json: true }) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (includeChildren) {
      out.steps = listSteps(out.familyId, out.id);
      out.approvals = listApprovals(out.familyId, out.id);
    }
    return out;
  }

  function hydrateStep(row) {
    if (!row) return null;
    return {
      id: row.id,
      caseId: row.case_id,
      position: Number(row.position),
      kind: row.kind,
      state: row.state,
      input: row.input_secret ? decodeSecret(row.input_secret, { json: true }) : null,
      output: row.output_secret ? decodeSecret(row.output_secret, { json: true }) : null,
      idempotencyKey: row.idempotency_key || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function hydrateApproval(row) {
    if (!row) return null;
    return {
      id: row.id,
      caseId: row.case_id,
      requestedBy: row.requested_by || null,
      approverUserId: row.approver_user_id || null,
      actionType: row.action_type,
      actionHash: row.action_hash,
      action: decodeSecret(row.action_secret, { json: true }),
      state: row.state,
      expiresAt: row.expires_at || null,
      decidedAt: row.decided_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function hydrateAudit(row) {
    if (!row) return null;
    return {
      id: row.id,
      familyId: row.family_id,
      caseId: row.case_id || null,
      actorId: row.actor_id || null,
      eventType: row.event_type,
      payload: row.payload_secret ? decodeSecret(row.payload_secret, { json: true }) : null,
      createdAt: row.created_at,
    };
  }

  function insertAudit(db, { familyId, caseId = null, actorId = null, eventType, payload = null, createdAt = nowIso() }) {
    const auditId = newId("audit");
    db.prepare(`
      INSERT INTO operator_audit_events
        (id, family_id, case_id, actor_id, event_type, payload_secret, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      auditId,
      boundedString(familyId, "familyId", 128, { required: true }),
      caseId || null,
      actorId || null,
      boundedString(eventType, "eventType", 120, { required: true }),
      payload == null ? null : encodeSecret(payload),
      createdAt,
    );
    return auditId;
  }

  function createCase(input = {}) {
    const db = requireDb();
    const id = newId("case");
    const familyId = boundedString(input.familyId, "familyId", 128, { required: true });
    const actorType = boundedString(input.actorType || "parent", "actorType", 40, { required: true });
    const actorId = boundedString(input.actorId, "actorId", 128) || null;
    const roomId = boundedString(input.roomId, "roomId", 160) || null;
    const title = boundedString(input.title, "title", 180, { required: true });
    const goal = boundedString(input.goal, "goal", 8000, { required: true });
    const state = assertEnum(input.state || "draft", CASE_STATE_SET, "case state");
    const riskLevel = assertEnum(input.riskLevel || "low", RISK_LEVEL_SET, "risk level");
    const budgetCents = optionalInteger(input.budgetCents, "budgetCents", { min: 0, max: 1000000000 });
    const createdAt = nowIso();

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO operator_cases
          (id, family_id, actor_id, actor_type, room_id, title_secret, goal_secret,
           state, risk_level, budget_cents, context_secret, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, familyId, actorId, actorType, roomId,
        encodeSecret(title), encodeSecret(goal), state, riskLevel, budgetCents,
        input.context == null ? null : encodeSecret(input.context), createdAt, createdAt,
      );
      insertAudit(db, {
        familyId,
        caseId: id,
        actorId,
        eventType: "case.created",
        payload: { state, riskLevel, roomId, budgetCents },
        createdAt,
      });
    });
    tx();
    return getCase(familyId, id, { includeChildren: true });
  }

  function getCase(familyId, caseId, options = {}) {
    const db = requireDb();
    const row = db.prepare("SELECT * FROM operator_cases WHERE id = ? AND family_id = ?")
      .get(caseId, familyId);
    return hydrateCase(row, options);
  }

  function listCases(familyId, options = {}) {
    const db = requireDb();
    const limit = Math.min(optionalInteger(options.limit == null ? 50 : options.limit, "limit", { min: 1, max: 200 }) || 50, 200);
    if (options.state) {
      const state = assertEnum(options.state, CASE_STATE_SET, "case state");
      return db.prepare(`
        SELECT * FROM operator_cases
        WHERE family_id = ? AND state = ?
        ORDER BY updated_at DESC LIMIT ?
      `).all(familyId, state, limit).map((row) => hydrateCase(row));
    }
    return db.prepare(`
      SELECT * FROM operator_cases
      WHERE family_id = ?
      ORDER BY updated_at DESC LIMIT ?
    `).all(familyId, limit).map((row) => hydrateCase(row));
  }

  function updateCaseState(familyId, caseId, nextState, { actorId = null, detail = null } = {}) {
    const db = requireDb();
    const state = assertEnum(nextState, CASE_STATE_SET, "case state");
    const existing = db.prepare("SELECT state FROM operator_cases WHERE id = ? AND family_id = ?").get(caseId, familyId);
    if (!existing) return null;
    const updatedAt = nowIso();
    const tx = db.transaction(() => {
      db.prepare("UPDATE operator_cases SET state = ?, updated_at = ? WHERE id = ? AND family_id = ?")
        .run(state, updatedAt, caseId, familyId);
      insertAudit(db, {
        familyId,
        caseId,
        actorId,
        eventType: "case.state_changed",
        payload: { from: existing.state, to: state, detail },
        createdAt: updatedAt,
      });
    });
    tx();
    return getCase(familyId, caseId);
  }

  function addStep(familyId, caseId, input = {}) {
    const db = requireDb();
    const ownedCase = db.prepare("SELECT id FROM operator_cases WHERE id = ? AND family_id = ?").get(caseId, familyId);
    if (!ownedCase) return null;
    const id = newId("step");
    const kind = boundedString(input.kind || "task", "kind", 80, { required: true });
    const state = assertEnum(input.state || "pending", STEP_STATE_SET, "step state");
    const idempotencyKey = boundedString(input.idempotencyKey, "idempotencyKey", 200) || null;
    if (idempotencyKey) {
      const existing = db.prepare("SELECT * FROM operator_case_steps WHERE case_id = ? AND idempotency_key = ?")
        .get(caseId, idempotencyKey);
      if (existing) return hydrateStep(existing);
    }
    const position = input.position == null
      ? Number(db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM operator_case_steps WHERE case_id = ?").get(caseId).next_position)
      : optionalInteger(input.position, "position", { min: 0, max: 100000 });
    const createdAt = nowIso();
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO operator_case_steps
          (id, case_id, position, kind, state, input_secret, output_secret, idempotency_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, caseId, position, kind, state,
        input.input == null ? null : encodeSecret(input.input),
        input.output == null ? null : encodeSecret(input.output),
        idempotencyKey, createdAt, createdAt,
      );
      insertAudit(db, {
        familyId,
        caseId,
        actorId: input.actorId || null,
        eventType: "case.step_added",
        payload: { stepId: id, position, kind, state, idempotencyKey },
        createdAt,
      });
    });
    tx();
    return hydrateStep(db.prepare("SELECT * FROM operator_case_steps WHERE id = ?").get(id));
  }

  function listSteps(familyId, caseId) {
    const db = requireDb();
    const ownedCase = db.prepare("SELECT id FROM operator_cases WHERE id = ? AND family_id = ?").get(caseId, familyId);
    if (!ownedCase) return [];
    return db.prepare("SELECT * FROM operator_case_steps WHERE case_id = ? ORDER BY position ASC")
      .all(caseId).map(hydrateStep);
  }

  function requestApproval(familyId, caseId, input = {}) {
    const db = requireDb();
    const ownedCase = db.prepare("SELECT id FROM operator_cases WHERE id = ? AND family_id = ?").get(caseId, familyId);
    if (!ownedCase) return null;
    const id = newId("approval");
    const actionType = boundedString(input.actionType, "actionType", 120, { required: true });
    if (!input.action || typeof input.action !== "object" || Array.isArray(input.action)) {
      throw new OperatorValidationError("action must be an object.");
    }
    const actionCanonical = stableStringify(input.action);
    const actionHash = crypto.createHash("sha256").update(actionCanonical, "utf8").digest("hex");
    const state = assertEnum(input.state || "pending", APPROVAL_STATE_SET, "approval state");
    const requestedBy = boundedString(input.requestedBy, "requestedBy", 128) || null;
    const approverUserId = boundedString(input.approverUserId, "approverUserId", 128) || null;
    const expiresAt = input.expiresAt == null ? null : boundedString(input.expiresAt, "expiresAt", 40, { required: true });
    if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) throw new OperatorValidationError("expiresAt must be an ISO date/time.");
    const createdAt = nowIso();

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO operator_approvals
          (id, case_id, requested_by, approver_user_id, action_type, action_hash,
           action_secret, state, expires_at, decided_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(
        id, caseId, requestedBy, approverUserId, actionType, actionHash,
        encodeSecret(input.action), state, expiresAt, createdAt, createdAt,
      );
      insertAudit(db, {
        familyId,
        caseId,
        actorId: requestedBy,
        eventType: "approval.requested",
        payload: { approvalId: id, actionType, actionHash, approverUserId, expiresAt },
        createdAt,
      });
    });
    tx();
    return hydrateApproval(db.prepare("SELECT * FROM operator_approvals WHERE id = ?").get(id));
  }

  function listApprovals(familyId, caseId) {
    const db = requireDb();
    const ownedCase = db.prepare("SELECT id FROM operator_cases WHERE id = ? AND family_id = ?").get(caseId, familyId);
    if (!ownedCase) return [];
    return db.prepare("SELECT * FROM operator_approvals WHERE case_id = ? ORDER BY created_at DESC")
      .all(caseId).map(hydrateApproval);
  }

  function recordAudit(input = {}) {
    const db = requireDb();
    const familyId = boundedString(input.familyId, "familyId", 128, { required: true });
    if (input.caseId) {
      const ownedCase = db.prepare("SELECT id FROM operator_cases WHERE id = ? AND family_id = ?").get(input.caseId, familyId);
      if (!ownedCase) return null;
    }
    const createdAt = nowIso();
    const id = insertAudit(db, {
      familyId,
      caseId: input.caseId || null,
      actorId: input.actorId || null,
      eventType: input.eventType,
      payload: input.payload == null ? null : input.payload,
      createdAt,
    });
    return hydrateAudit(db.prepare("SELECT * FROM operator_audit_events WHERE id = ?").get(id));
  }

  function listAudit(familyId, { caseId = null, limit = 100 } = {}) {
    const db = requireDb();
    const capped = Math.min(optionalInteger(limit, "limit", { min: 1, max: 500 }) || 100, 500);
    const rows = caseId
      ? db.prepare("SELECT * FROM operator_audit_events WHERE family_id = ? AND case_id = ? ORDER BY created_at DESC LIMIT ?").all(familyId, caseId, capped)
      : db.prepare("SELECT * FROM operator_audit_events WHERE family_id = ? ORDER BY created_at DESC LIMIT ?").all(familyId, capped);
    return rows.map(hydrateAudit);
  }

  function close() {
    if (!database) return;
    try { database.close(); } finally { database = null; initAttempted = true; }
  }

  return {
    status,
    createCase,
    getCase,
    listCases,
    updateCaseState,
    addStep,
    listSteps,
    requestApproval,
    listApprovals,
    recordAudit,
    listAudit,
    close,
  };
}

let singleton = null;
function defaultStore() {
  if (!singleton) singleton = createOperatorStore();
  return singleton;
}

module.exports = {
  DEFAULT_DB_FILE,
  CASE_STATES,
  RISK_LEVELS,
  APPROVAL_STATES,
  STEP_STATES,
  OperatorStorageUnavailableError,
  OperatorValidationError,
  createOperatorStore,
  status: (...args) => defaultStore().status(...args),
  createCase: (...args) => defaultStore().createCase(...args),
  getCase: (...args) => defaultStore().getCase(...args),
  listCases: (...args) => defaultStore().listCases(...args),
  updateCaseState: (...args) => defaultStore().updateCaseState(...args),
  addStep: (...args) => defaultStore().addStep(...args),
  listSteps: (...args) => defaultStore().listSteps(...args),
  requestApproval: (...args) => defaultStore().requestApproval(...args),
  listApprovals: (...args) => defaultStore().listApprovals(...args),
  recordAudit: (...args) => defaultStore().recordAudit(...args),
  listAudit: (...args) => defaultStore().listAudit(...args),
};

"use strict";

/**
 * Approval decisions and constrained execution for Hermes Family Operator.
 *
 * The approval record is the authority boundary: an approved action is bound to
 * an exact canonical action hash. Execution never accepts a replacement action
 * payload from Hermes. Instead, Hermes claims a short-lived single-use token and
 * FamETC loads the approved payload directly from SQLite before dispatching a
 * small allowlisted driver.
 *
 * This module intentionally shares operator.sqlite with operator-store. It is
 * SQLite-only and fails closed for the same reason as the case store: approvals,
 * grants, audit events and case-state changes need transactional semantics.
 */
const crypto = require("crypto");
const operatorStore = require("./operator-store");
const operator = require("./operator");
const family = require("./family");
const events = require("./events");
const datacrypto = require("./datacrypto");
const { ensureDataDir } = require("./paths");

const EXECUTION_STATES = Object.freeze([
  "ready",
  "claimed",
  "running",
  "consumed",
  "failed",
  "expired",
  "cancelled",
]);
const TOKEN_PREFIX = "oprun1";
const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;
const MAX_TOKEN_TTL_MS = 15 * 60 * 1000;
const ACTION_HASH_RE = /^[0-9a-f]{64}$/i;
const CALENDAR_ACTION_KEYS = new Set([
  "title", "date", "time", "endTime", "notes", "category",
  "kidId", "endDate", "repeat", "repeatUntil",
]);
const CALENDAR_REPEATS = new Set(["none", "daily", "weekly", "biweekly", "monthly"]);

class OperatorExecutionError extends Error {
  constructor(message, code = "OPERATOR_EXECUTION_ERROR") {
    super(message);
    this.name = "OperatorExecutionError";
    this.code = code;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function encryptionKey() {
  const key = datacrypto.loadKey();
  if (!key) {
    throw new OperatorExecutionError(
      "DATA_ENCRYPTION_KEY is required for Operator approval/execution storage.",
      "OPERATOR_EXECUTION_UNAVAILABLE",
    );
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
    throw new OperatorExecutionError(
      "Operator execution payload is not encrypted.",
      "OPERATOR_EXECUTION_UNAVAILABLE",
    );
  }
  raw = datacrypto.decrypt(raw, encryptionKey());
  if (!json) return raw;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new OperatorExecutionError("Operator execution payload could not be decoded.", "OPERATOR_EXECUTION_UNAVAILABLE");
  }
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function cleanActionHash(value) {
  const hash = String(value || "").trim().toLowerCase();
  if (!ACTION_HASH_RE.test(hash)) {
    throw new OperatorExecutionError("A valid approved actionHash is required.", "APPROVAL_HASH_INVALID");
  }
  return hash;
}

function ensureIsoDate(value, field, { optional = false } = {}) {
  if ((value == null || value === "") && optional) return null;
  const raw = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new OperatorExecutionError(`${field} must be YYYY-MM-DD.`, "EXECUTION_ACTION_INVALID");
  }
  const [year, month, day] = raw.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    throw new OperatorExecutionError(`${field} is not a valid calendar date.`, "EXECUTION_ACTION_INVALID");
  }
  return raw;
}

function ensureTime(value, field) {
  if (value == null || value === "") return "";
  const raw = String(value);
  const match = /^(\d{2}):(\d{2})$/.exec(raw);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new OperatorExecutionError(`${field} must be HH:MM in 24-hour time.`, "EXECUTION_ACTION_INVALID");
  }
  return raw;
}

function validateCalendarCreate(familyId, action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new OperatorExecutionError("Approved calendar action must be an object.", "EXECUTION_ACTION_INVALID");
  }
  for (const key of Object.keys(action)) {
    if (!CALENDAR_ACTION_KEYS.has(key)) {
      throw new OperatorExecutionError(`Unsupported calendar action field: ${key}.`, "EXECUTION_ACTION_INVALID");
    }
  }

  const fam = family.getFamily(familyId);
  if (!fam) throw new OperatorExecutionError("Family not found.", "OPERATOR_FAMILY_NOT_FOUND");

  const title = String(action.title || "");
  if (!title.trim() || title.length > 200) {
    throw new OperatorExecutionError("Calendar title must be 1-200 characters.", "EXECUTION_ACTION_INVALID");
  }
  const date = ensureIsoDate(action.date, "date");
  const endDate = ensureIsoDate(action.endDate, "endDate", { optional: true });
  if (endDate && endDate < date) {
    throw new OperatorExecutionError("endDate cannot be before date.", "EXECUTION_ACTION_INVALID");
  }

  const notes = action.notes == null ? "" : String(action.notes);
  if (notes.length > 1000) {
    throw new OperatorExecutionError("Calendar notes must be 1000 characters or fewer.", "EXECUTION_ACTION_INVALID");
  }

  const category = action.category == null ? "other" : String(action.category);
  if (!events.CATEGORIES.has(category)) {
    throw new OperatorExecutionError("Unsupported calendar category.", "EXECUTION_ACTION_INVALID");
  }

  const repeat = action.repeat == null ? "none" : String(action.repeat);
  if (!CALENDAR_REPEATS.has(repeat)) {
    throw new OperatorExecutionError("Unsupported calendar repeat value.", "EXECUTION_ACTION_INVALID");
  }
  const repeatUntil = ensureIsoDate(action.repeatUntil, "repeatUntil", { optional: true });
  if (repeatUntil && repeatUntil < date) {
    throw new OperatorExecutionError("repeatUntil cannot be before date.", "EXECUTION_ACTION_INVALID");
  }

  let kidId = null;
  if (action.kidId != null && action.kidId !== "") {
    kidId = String(action.kidId);
    if (!(fam.kids || []).some((kid) => kid.id === kidId)) {
      throw new OperatorExecutionError("Calendar kidId does not belong to this family.", "EXECUTION_ACTION_INVALID");
    }
  }

  return {
    title,
    date,
    time: ensureTime(action.time, "time"),
    endTime: ensureTime(action.endTime, "endTime"),
    notes,
    category,
    kidId,
    endDate,
    repeat,
    repeatUntil,
  };
}

const ACTION_DRIVERS = Object.freeze({
  "calendar.create": {
    validate: validateCalendarCreate,
    execute({ familyId, action, grant, decidedBy }) {
      const payload = validateCalendarCreate(familyId, action);
      const result = events.addEvent(familyId, {
        ...payload,
        createdBy: decidedBy || null,
        sourceType: "operator",
        sourceId: grant.id,
      });
      if (!result || result.error || !result.event) {
        throw new OperatorExecutionError(
          (result && result.error) || "Calendar event could not be created.",
          "EXECUTION_DRIVER_FAILED",
        );
      }
      return {
        driver: "calendar.create",
        eventId: result.event.id,
        existing: result.existing === true,
        sourceType: "operator",
        sourceId: grant.id,
      };
    },
  },
});

function supportedActionTypes() {
  return Object.keys(ACTION_DRIVERS);
}

function validateAction(familyId, actionType, action) {
  const type = String(actionType || "").trim();
  const driver = ACTION_DRIVERS[type];
  if (!driver) {
    throw new OperatorExecutionError(
      `Action type ${type || "(missing)"} has no approved execution driver.`,
      "EXECUTION_UNSUPPORTED_ACTION",
    );
  }
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

      // Ensure the foundation schema exists even when the first Operator request
      // is a parent opening the approval inbox before Hermes has created a case.
      const foundationStore = operatorStore.createOperatorStore({ dbFile, Database });
      const foundationStatus = foundationStore.status();
      foundationStore.close();
      if (!foundationStatus.available) throw new Error("operator-store schema is unavailable.");

      database = new Database(dbFile);
      database.pragma("journal_mode = WAL");
      database.pragma("foreign_keys = ON");
      database.pragma("busy_timeout = 5000");
      database.pragma("synchronous = NORMAL");

      // Foundation releases created operator_approvals without decided_by.
      const columns = new Set(database.prepare("PRAGMA table_info(operator_approvals)").all().map((row) => row.name));
      if (!columns.has("decided_by")) {
        database.exec("ALTER TABLE operator_approvals ADD COLUMN decided_by TEXT");
      }

      database.exec(`
        CREATE TABLE IF NOT EXISTS operator_execution_grants (
          id TEXT PRIMARY KEY,
          family_id TEXT NOT NULL,
          case_id TEXT NOT NULL,
          approval_id TEXT NOT NULL UNIQUE,
          action_type TEXT NOT NULL,
          action_hash TEXT NOT NULL,
          state TEXT NOT NULL,
          executor_type TEXT,
          token_hash TEXT,
          token_expires_at TEXT,
          claimed_at TEXT,
          consumed_at TEXT,
          result_secret TEXT,
          error_secret TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(case_id) REFERENCES operator_cases(id) ON DELETE CASCADE,
          FOREIGN KEY(approval_id) REFERENCES operator_approvals(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_operator_execution_family_state
          ON operator_execution_grants(family_id, state, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_operator_execution_case
          ON operator_execution_grants(case_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_operator_execution_token
          ON operator_execution_grants(token_hash);
      `);
      return database;
    } catch (error) {
      if (database) {
        try { database.close(); } catch (_) { /* best effort */ }
      }
      database = null;
      return null;
    }
  }

  function requireDb() {
    const db = initialize();
    if (!db) {
      throw new OperatorExecutionError(
        "Hermes Operator approval/execution storage is unavailable; refusing to execute.",
        "OPERATOR_EXECUTION_UNAVAILABLE",
      );
    }
    return db;
  }

  function status() {
    const db = initialize();
    return {
      available: !!db,
      backend: "sqlite",
      fallback: false,
      supportedActionTypes: supportedActionTypes(),
      errorCode: db ? null : "OPERATOR_EXECUTION_UNAVAILABLE",
    };
  }

  function insertAudit(db, { familyId, caseId = null, actorId = null, eventType, payload = null, createdAt = nowIso() }) {
    db.prepare(`
      INSERT INTO operator_audit_events
        (id, family_id, case_id, actor_id, event_type, payload_secret, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId("audit"), familyId, caseId, actorId, eventType,
      payload == null ? null : encodeSecret(payload), createdAt,
    );
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
      decidedBy: row.decided_by || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function hydrateGrant(row) {
    if (!row) return null;
    return {
      id: row.id,
      familyId: row.family_id,
      caseId: row.case_id,
      approvalId: row.approval_id,
      actionType: row.action_type,
      actionHash: row.action_hash,
      state: row.state,
      executorType: row.executor_type || null,
      tokenExpiresAt: row.token_expires_at || null,
      claimedAt: row.claimed_at || null,
      consumedAt: row.consumed_at || null,
      result: row.result_secret ? decodeSecret(row.result_secret, { json: true }) : null,
      error: row.error_secret ? decodeSecret(row.error_secret, { json: true }) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function parentActor(familyId, actor) {
    const fam = family.getFamily(familyId);
    const validated = operator.validateActor(fam, actor);
    if (validated.type !== "parent" || !validated.userId) {
      throw new OperatorExecutionError("Only a parent can decide or execute an Operator approval.", "APPROVAL_PARENT_REQUIRED");
    }
    return validated;
  }

  function ownedApprovalRow(db, familyId, approvalId) {
    return db.prepare(`
      SELECT a.*, c.family_id, c.state AS case_state
      FROM operator_approvals a
      JOIN operator_cases c ON c.id = a.case_id
      WHERE a.id = ? AND c.family_id = ?
    `).get(approvalId, familyId) || null;
  }

  function transitionCaseInTx(db, familyId, caseId, nextState, actorId, detail) {
    const row = db.prepare("SELECT state FROM operator_cases WHERE id = ? AND family_id = ?").get(caseId, familyId);
    if (!row) throw new OperatorExecutionError("Operator case not found.", "OPERATOR_CASE_NOT_FOUND");
    if (row.state === nextState) return row.state;
    const allowed = operator.ALLOWED_TRANSITIONS[row.state];
    if (!allowed || !allowed.has(nextState)) {
      throw new OperatorExecutionError(
        `Case cannot transition from ${row.state} to ${nextState}.`,
        "OPERATOR_INVALID_TRANSITION",
      );
    }
    const updatedAt = nowIso();
    db.prepare("UPDATE operator_cases SET state = ?, updated_at = ? WHERE id = ? AND family_id = ?")
      .run(nextState, updatedAt, caseId, familyId);
    insertAudit(db, {
      familyId,
      caseId,
      actorId,
      eventType: "case.state_changed",
      payload: { from: row.state, to: nextState, detail: detail || null },
      createdAt: updatedAt,
    });
    return nextState;
  }

  function validateApprovedAction(familyId, row) {
    const action = decodeSecret(row.action_secret, { json: true });
    validateAction(familyId, row.action_type, action);
    return action;
  }

  function getGrantByApproval(db, familyId, approvalId) {
    const row = db.prepare(`
      SELECT * FROM operator_execution_grants
      WHERE family_id = ? AND approval_id = ?
    `).get(familyId, approvalId);
    return hydrateGrant(row);
  }

  function listApprovalsForParent(familyId, parentUserId, options = {}) {
    const db = requireDb();
    parentActor(familyId, { type: "parent", userId: parentUserId, principalId: parentUserId });
    const limit = Math.max(1, Math.min(Number(options.limit) || 50, 200));
    const state = options.state ? String(options.state) : null;
    if (state && !operatorStore.APPROVAL_STATES.includes(state)) {
      throw new OperatorExecutionError("Invalid approval state.", "APPROVAL_STATE_INVALID");
    }
    const whereState = state ? " AND a.state = ?" : "";
    const params = state
      ? [familyId, parentUserId, state, limit]
      : [familyId, parentUserId, limit];
    const rows = db.prepare(`
      SELECT a.*, c.family_id, c.state AS case_state
      FROM operator_approvals a
      JOIN operator_cases c ON c.id = a.case_id
      WHERE c.family_id = ?
        AND (a.approver_user_id IS NULL OR a.approver_user_id = ?)
        ${whereState}
      ORDER BY a.created_at DESC
      LIMIT ?
    `).all(...params);
    return rows.map((row) => ({
      ...hydrateApproval(row),
      caseState: row.case_state,
      execution: getGrantByApproval(db, familyId, row.id),
    }));
  }

  function getApprovalForParent(familyId, parentUserId, approvalId) {
    const db = requireDb();
    parentActor(familyId, { type: "parent", userId: parentUserId, principalId: parentUserId });
    const row = ownedApprovalRow(db, familyId, approvalId);
    if (!row || (row.approver_user_id && row.approver_user_id !== parentUserId)) return null;
    return {
      ...hydrateApproval(row),
      caseState: row.case_state,
      execution: getGrantByApproval(db, familyId, approvalId),
    };
  }

  function decideApproval(familyId, approvalId, input = {}) {
    const db = requireDb();
    const actor = parentActor(familyId, input.actor);
    const decision = String(input.decision || "").trim().toLowerCase();
    if (!new Set(["approve", "reject"]).has(decision)) {
      throw new OperatorExecutionError("decision must be approve or reject.", "APPROVAL_DECISION_INVALID");
    }
    const expectedHash = cleanActionHash(input.actionHash);
    const targetState = decision === "approve" ? "approved" : "rejected";
    const tx = db.transaction(() => {
      const row = ownedApprovalRow(db, familyId, approvalId);
      if (!row) return { missing: true };
      if (row.approver_user_id && row.approver_user_id !== actor.userId) {
        throw new OperatorExecutionError("This approval is assigned to another parent.", "APPROVAL_WRONG_APPROVER");
      }
      if (row.action_hash.toLowerCase() !== expectedHash) {
        throw new OperatorExecutionError(
          "The proposed action changed. Review the latest action before deciding.",
          "APPROVAL_HASH_MISMATCH",
        );
      }
      if (row.state !== "pending") {
        if (row.state === targetState && row.decided_by === actor.userId) {
          return { idempotent: true, row };
        }
        throw new OperatorExecutionError(`Approval is already ${row.state}.`, "APPROVAL_NOT_PENDING");
      }

      if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
        const expiredAt = nowIso();
        db.prepare(`
          UPDATE operator_approvals
          SET state = 'expired', updated_at = ?
          WHERE id = ? AND state = 'pending'
        `).run(expiredAt, approvalId);
        insertAudit(db, {
          familyId,
          caseId: row.case_id,
          actorId: actor.userId,
          eventType: "approval.expired",
          payload: { approvalId, actionHash: row.action_hash },
          createdAt: expiredAt,
        });
        if (row.case_state === "waiting_for_approval") {
          transitionCaseInTx(db, familyId, row.case_id, "planning", actor.userId, "Approval expired before decision.");
        }
        return { expired: true };
      }

      if (decision === "approve") validateApprovedAction(familyId, row);
      const decidedAt = nowIso();
      const grantId = decision === "approve" ? newId("exec") : null;
      const update = db.prepare(`
        UPDATE operator_approvals
        SET state = ?, decided_at = ?, decided_by = ?, updated_at = ?
        WHERE id = ? AND state = 'pending'
      `).run(targetState, decidedAt, actor.userId, decidedAt, approvalId);
      if (update.changes !== 1) {
        throw new OperatorExecutionError("Approval was decided by another request.", "APPROVAL_NOT_PENDING");
      }

      insertAudit(db, {
        familyId,
        caseId: row.case_id,
        actorId: actor.userId,
        eventType: `approval.${targetState}`,
        payload: {
          approvalId,
          actionType: row.action_type,
          actionHash: row.action_hash,
          approverUserId: actor.userId,
        },
        createdAt: decidedAt,
      });

      if (decision === "approve") {
        db.prepare(`
          INSERT INTO operator_execution_grants
            (id, family_id, case_id, approval_id, action_type, action_hash, state,
             executor_type, token_hash, token_expires_at, claimed_at, consumed_at,
             result_secret, error_secret, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'ready', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
        `).run(
          grantId, familyId, row.case_id, approvalId, row.action_type, row.action_hash,
          decidedAt, decidedAt,
        );
        insertAudit(db, {
          familyId,
          caseId: row.case_id,
          actorId: actor.userId,
          eventType: "execution.authorized",
          payload: { grantId, approvalId, actionType: row.action_type, actionHash: row.action_hash },
          createdAt: decidedAt,
        });
        transitionCaseInTx(db, familyId, row.case_id, "executing", actor.userId, "Parent approved exact action.");
      } else if (row.case_state === "waiting_for_approval") {
        transitionCaseInTx(db, familyId, row.case_id, "planning", actor.userId, "Parent rejected proposed action.");
      }
      return { idempotent: false };
    });
    const outcome = tx.immediate();
    if (outcome.missing) return null;
    if (outcome.expired) {
      throw new OperatorExecutionError("Approval has expired.", "APPROVAL_EXPIRED");
    }
    if (outcome.idempotent) {
      return {
        approval: hydrateApproval(outcome.row),
        execution: getGrantByApproval(db, familyId, approvalId),
        idempotent: true,
      };
    }

    const fresh = ownedApprovalRow(db, familyId, approvalId);
    return {
      approval: hydrateApproval(fresh),
      execution: getGrantByApproval(db, familyId, approvalId),
      idempotent: false,
    };
  }

  function claimExecution(familyId, approvalId, input = {}) {
    const db = requireDb();
    const actor = parentActor(familyId, input.actor);
    const executorType = String(input.executorType || "hermes").trim().slice(0, 80) || "hermes";
    const ttlMs = Math.max(1000, Math.min(Number(input.ttlMs) || DEFAULT_TOKEN_TTL_MS, MAX_TOKEN_TTL_MS));
    const tx = db.transaction(() => {
      const row = db.prepare(`
        SELECT g.*, a.state AS approval_state, a.action_secret, a.decided_by
        FROM operator_execution_grants g
        JOIN operator_approvals a ON a.id = g.approval_id
        WHERE g.family_id = ? AND g.approval_id = ?
      `).get(familyId, approvalId);
      if (!row || row.approval_state !== "approved") {
        throw new OperatorExecutionError("No approved execution is available.", "EXECUTION_NOT_READY");
      }
      if (!row.decided_by || row.decided_by !== actor.userId) {
        throw new OperatorExecutionError(
          "Execution must be claimed in the approving parent's authorized turn.",
          "EXECUTION_APPROVER_REQUIRED",
        );
      }
      if (!ACTION_DRIVERS[row.action_type]) {
        throw new OperatorExecutionError("Approved action has no execution driver.", "EXECUTION_UNSUPPORTED_ACTION");
      }

      const now = Date.now();
      const tokenExpired = row.token_expires_at && Date.parse(row.token_expires_at) <= now;
      if (!["ready", "claimed", "running"].includes(row.state)) {
        throw new OperatorExecutionError(`Execution is ${row.state}.`, "EXECUTION_NOT_READY");
      }
      // A running driver may still be doing external work after its claim TTL.
      // Never reissue authority until that run is explicitly reconciled.
      if (row.state === "running" || (row.state === "claimed" && !tokenExpired)) {
        throw new OperatorExecutionError("Execution is already claimed.", "EXECUTION_ALREADY_CLAIMED");
      }

      const random = crypto.randomBytes(32).toString("base64url");
      const executionToken = `${TOKEN_PREFIX}.${row.id}.${random}`;
      const expiresAt = new Date(now + ttlMs).toISOString();
      const claimedAt = nowIso();
      const update = db.prepare(`
        UPDATE operator_execution_grants
        SET state = 'claimed', executor_type = ?, token_hash = ?, token_expires_at = ?,
            claimed_at = ?, error_secret = NULL, updated_at = ?
        WHERE id = ? AND state = ?
      `).run(executorType, tokenHash(executionToken), expiresAt, claimedAt, claimedAt, row.id, row.state);
      if (update.changes !== 1) {
        throw new OperatorExecutionError("Execution was claimed by another request.", "EXECUTION_ALREADY_CLAIMED");
      }
      insertAudit(db, {
        familyId,
        caseId: row.case_id,
        actorId: actor.userId,
        eventType: "execution.claimed",
        payload: { grantId: row.id, approvalId, actionHash: row.action_hash, tokenExpiresAt: expiresAt, executorType },
        createdAt: claimedAt,
      });
      return {
        executionToken,
        tokenExpiresAt: expiresAt,
        row,
      };
    });
    const claimed = tx.immediate();

    return {
      executionToken: claimed.executionToken,
      tokenExpiresAt: claimed.tokenExpiresAt,
      grant: getGrantByApproval(db, familyId, approvalId),
      action: decodeSecret(claimed.row.action_secret, { json: true }),
      actionHash: claimed.row.action_hash,
    };
  }

  function runExecution(familyId, executionToken, actionHash, input = {}) {
    const db = requireDb();
    const actor = parentActor(familyId, input.actor);
    const token = String(executionToken || "");
    if (!token.startsWith(`${TOKEN_PREFIX}.`) || token.length > 512) {
      throw new OperatorExecutionError("Execution token is invalid.", "EXECUTION_TOKEN_INVALID");
    }
    const expectedHash = cleanActionHash(actionHash);
    const hash = tokenHash(token);
    const txStart = db.transaction(() => {
      const row = db.prepare(`
        SELECT g.*, a.action_secret, a.decided_by, a.state AS approval_state
        FROM operator_execution_grants g
        JOIN operator_approvals a ON a.id = g.approval_id
        WHERE g.family_id = ? AND g.token_hash = ?
      `).get(familyId, hash);
      if (!row || row.approval_state !== "approved") {
        throw new OperatorExecutionError("Execution token is invalid.", "EXECUTION_TOKEN_INVALID");
      }
      if (!row.decided_by || row.decided_by !== actor.userId) {
        throw new OperatorExecutionError(
          "Execution must run in the approving parent's authorized turn.",
          "EXECUTION_APPROVER_REQUIRED",
        );
      }
      if (row.action_hash.toLowerCase() !== expectedHash) {
        throw new OperatorExecutionError("Approved action hash does not match this execution.", "EXECUTION_HASH_MISMATCH");
      }
      if (row.state !== "claimed") {
        throw new OperatorExecutionError(`Execution is ${row.state}.`, "EXECUTION_NOT_READY");
      }
      if (!row.token_expires_at || Date.parse(row.token_expires_at) <= Date.now()) {
        const expiredAt = nowIso();
        const update = db.prepare(`
          UPDATE operator_execution_grants
          SET state = 'ready', token_hash = NULL, token_expires_at = NULL, updated_at = ?
          WHERE id = ? AND state = 'claimed' AND token_hash = ?
        `).run(expiredAt, row.id, hash);
        if (update.changes !== 1) {
          throw new OperatorExecutionError("Execution claim is no longer valid.", "EXECUTION_NOT_READY");
        }
        insertAudit(db, {
          familyId,
          caseId: row.case_id,
          actorId: actor.userId,
          eventType: "execution.token_expired",
          payload: { grantId: row.id, approvalId: row.approval_id },
          createdAt: expiredAt,
        });
        return { expired: true };
      }

      const driver = ACTION_DRIVERS[row.action_type];
      if (!driver) {
        throw new OperatorExecutionError("Approved action has no execution driver.", "EXECUTION_UNSUPPORTED_ACTION");
      }
      const action = decodeSecret(row.action_secret, { json: true });
      driver.validate(familyId, action);

      const runningAt = nowIso();
      const update = db.prepare(`
        UPDATE operator_execution_grants
        SET state = 'running', updated_at = ?
        WHERE id = ? AND state = 'claimed' AND token_hash = ?
      `).run(runningAt, row.id, hash);
      if (update.changes !== 1) {
        throw new OperatorExecutionError("Execution claim is no longer valid.", "EXECUTION_NOT_READY");
      }
      insertAudit(db, {
        familyId,
        caseId: row.case_id,
        actorId: actor.userId,
        eventType: "execution.started",
        payload: { grantId: row.id, approvalId: row.approval_id, actionHash: row.action_hash },
        createdAt: runningAt,
      });
      return { expired: false, row: { ...row, state: "running" }, driver, action };
    });
    const started = txStart.immediate();
    if (started.expired) {
      throw new OperatorExecutionError("Execution token has expired; claim a new token.", "EXECUTION_TOKEN_EXPIRED");
    }
    const { row, driver, action } = started;

    let result;
    try {
      result = driver.execute({
        familyId,
        action,
        grant: hydrateGrant(row),
        decidedBy: row.decided_by || null,
      });
    } catch (error) {
      const failedAt = nowIso();
      const safeError = {
        code: error && error.code ? String(error.code) : "EXECUTION_DRIVER_FAILED",
        message: error && error.message ? String(error.message).slice(0, 1000) : "Execution failed.",
      };
      const txFailed = db.transaction(() => {
        const update = db.prepare(`
          UPDATE operator_execution_grants
          SET state = 'failed', error_secret = ?, token_hash = NULL,
              token_expires_at = NULL, updated_at = ?
          WHERE id = ? AND state = 'running'
        `).run(encodeSecret(safeError), failedAt, row.id);
        if (update.changes !== 1) {
          throw new OperatorExecutionError("Execution state changed before failure was recorded.", "EXECUTION_NOT_READY");
        }
        insertAudit(db, {
          familyId,
          caseId: row.case_id,
          actorId: actor.userId,
          eventType: "execution.failed",
          payload: { grantId: row.id, approvalId: row.approval_id, error: safeError },
          createdAt: failedAt,
        });
        const current = db.prepare("SELECT state FROM operator_cases WHERE id = ? AND family_id = ?")
          .get(row.case_id, familyId);
        if (current && current.state === "executing") {
          transitionCaseInTx(db, familyId, row.case_id, "failed", actor.userId, "Approved execution failed.");
        }
      });
      txFailed();
      throw error instanceof OperatorExecutionError
        ? error
        : new OperatorExecutionError(safeError.message, safeError.code);
    }

    const consumedAt = nowIso();
    const txConsumed = db.transaction(() => {
      const update = db.prepare(`
        UPDATE operator_execution_grants
        SET state = 'consumed', consumed_at = ?, result_secret = ?,
            token_hash = NULL, token_expires_at = NULL, updated_at = ?
        WHERE id = ? AND state = 'running'
      `).run(consumedAt, encodeSecret(result), consumedAt, row.id);
      if (update.changes !== 1) {
        throw new OperatorExecutionError("Execution state changed before completion was recorded.", "EXECUTION_NOT_READY");
      }
      insertAudit(db, {
        familyId,
        caseId: row.case_id,
        actorId: actor.userId,
        eventType: "execution.completed",
        payload: { grantId: row.id, approvalId: row.approval_id, result },
        createdAt: consumedAt,
      });
      transitionCaseInTx(db, familyId, row.case_id, "verifying", actor.userId, "Approved execution completed; verification required.");
    });
    txConsumed();

    return {
      execution: hydrateGrant(db.prepare("SELECT * FROM operator_execution_grants WHERE id = ?").get(row.id)),
      result,
    };
  }

  function getExecutionForApproval(familyId, approvalId) {
    const db = requireDb();
    return getGrantByApproval(db, familyId, approvalId);
  }

  function close() {
    if (!database) return;
    try { database.close(); } finally {
      database = null;
      initAttempted = true;
    }
  }

  return {
    status,
    supportedActionTypes,
    validateAction,
    listApprovalsForParent,
    getApprovalForParent,
    decideApproval,
    claimExecution,
    runExecution,
    getExecutionForApproval,
    close,
  };
}

let singleton = null;
function defaultExecution() {
  if (!singleton) singleton = createOperatorExecution();
  return singleton;
}

module.exports = {
  EXECUTION_STATES,
  TOKEN_PREFIX,
  DEFAULT_TOKEN_TTL_MS,
  MAX_TOKEN_TTL_MS,
  OperatorExecutionError,
  supportedActionTypes,
  validateAction,
  createOperatorExecution,
  status: (...args) => defaultExecution().status(...args),
  listApprovalsForParent: (...args) => defaultExecution().listApprovalsForParent(...args),
  getApprovalForParent: (...args) => defaultExecution().getApprovalForParent(...args),
  decideApproval: (...args) => defaultExecution().decideApproval(...args),
  claimExecution: (...args) => defaultExecution().claimExecution(...args),
  runExecution: (...args) => defaultExecution().runExecution(...args),
  getExecutionForApproval: (...args) => defaultExecution().getExecutionForApproval(...args),
};

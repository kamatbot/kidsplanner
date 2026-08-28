"use strict";

/**
 * Limited-family beta control plane for Hermes Family Operator.
 *
 * Production live execution is deny-by-default unless a family is explicitly
 * enrolled. The control plane adds per-family autonomy ceilings, launch-action
 * allowlists, quotas, global/family kill switches, durable execution evidence,
 * explicit parent feedback, and aggregate beta safety reporting.
 *
 * The underlying approval/execution engine still owns exact-action authority.
 * This module never creates an approval or an execution capability.
 */
const crypto = require("crypto");
const family = require("./family");
const operatorStore = require("./operator-store");
const operatorRisk = require("./operator-risk");
const operatorShadow = require("./operator-shadow");
const datacrypto = require("./datacrypto");
const { ensureDataDir } = require("./paths");

const AUTONOMY_CEILINGS = Object.freeze(["shadow-only", "approved-low-risk"]);
const AUTONOMY_SET = new Set(AUTONOMY_CEILINGS);
const LAUNCH_ACTION_TYPES = Object.freeze([
  "calendar.create",
  "calendar.update",
  "action.create",
  "action.update",
  "trip.itinerary.update",
]);
const LAUNCH_ACTION_SET = new Set(LAUNCH_ACTION_TYPES);
const FEEDBACK_OUTCOMES = Object.freeze([
  "helpful",
  "not-helpful",
  "block-correct",
  "block-incorrect",
]);
const FEEDBACK_SET = new Set(FEEDBACK_OUTCOMES);
const DEFAULT_HOURLY_QUOTA = 10;
const DEFAULT_DAILY_QUOTA = 25;
const DEFAULT_EVIDENCE_RETENTION_DAYS = 365;
const MAX_EVIDENCE_PER_CASE = 100;
const ACTION_HASH_RE = /^[0-9a-f]{64}$/i;

class OperatorBetaError extends Error {
  constructor(message, code = "OPERATOR_BETA_ERROR") {
    super(message);
    this.name = "OperatorBetaError";
    this.code = code;
  }
}

function nowIso() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}_${crypto.randomBytes(12).toString("hex")}`; }
function cleanText(value, max = 1000) { return String(value == null ? "" : value).trim().slice(0, max); }
function boolValue(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  return value === true || value === 1;
}
function boundedInt(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new OperatorBetaError(`Expected an integer between ${min} and ${max}.`, "OPERATOR_BETA_CONFIG_INVALID");
  }
  return number;
}
function encryptionKey() {
  const key = datacrypto.loadKey();
  if (!key) throw new OperatorBetaError("DATA_ENCRYPTION_KEY is required for Operator beta controls.", "OPERATOR_BETA_UNAVAILABLE");
  return key;
}
function encodeSecret(value) {
  return datacrypto.encrypt(JSON.stringify(value == null ? null : value), encryptionKey());
}
function decodeSecret(value) {
  if (value == null) return null;
  if (!datacrypto.isEncrypted(String(value))) throw new OperatorBetaError("Operator beta evidence is not encrypted.", "OPERATOR_BETA_UNAVAILABLE");
  try { return JSON.parse(datacrypto.decrypt(String(value), encryptionKey())); }
  catch (error) { throw new OperatorBetaError("Operator beta evidence could not be decoded.", "OPERATOR_BETA_UNAVAILABLE"); }
}
function tokenHash(token) { return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex"); }
function enforcementDefault() {
  // Production enrollment is a hard safety boundary, not a feature flag. An
  // environment override may force enforcement on in development, but it must
  // never turn the production deny-by-default posture off.
  if (process.env.NODE_ENV === "production") return true;
  return boolValue(process.env.OPERATOR_BETA_ENFORCE);
}
function envKillSwitch() { return boolValue(process.env.OPERATOR_BETA_KILL_SWITCH); }
function envGlobalDisabled() { return String(process.env.OPERATOR_BETA_ENABLED || "").trim() === "0"; }

function createOperatorBeta(options = {}) {
  const dbFile = options.dbFile || operatorStore.DEFAULT_DB_FILE;
  const enforceEnrollment = options.enforce == null ? enforcementDefault() : !!options.enforce;
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
      const foundation = operatorStore.createOperatorStore({ dbFile, Database });
      const foundationStatus = foundation.status();
      foundation.close();
      if (!foundationStatus.available) throw new Error("Operator store unavailable.");
      database = new Database(dbFile);
      database.pragma("journal_mode = WAL");
      database.pragma("foreign_keys = ON");
      database.pragma("busy_timeout = 5000");
      database.pragma("synchronous = NORMAL");
      database.exec(`
        CREATE TABLE IF NOT EXISTS operator_beta_global (
          id INTEGER PRIMARY KEY CHECK(id = 1),
          enabled INTEGER NOT NULL,
          kill_switch INTEGER NOT NULL,
          evidence_retention_days INTEGER NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS operator_beta_families (
          family_id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL,
          kill_switch INTEGER NOT NULL,
          autonomy_ceiling TEXT NOT NULL,
          hourly_quota INTEGER NOT NULL,
          daily_quota INTEGER NOT NULL,
          allowed_action_types TEXT NOT NULL,
          enrolled_at TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS operator_beta_usage (
          id TEXT PRIMARY KEY,
          family_id TEXT NOT NULL,
          case_id TEXT NOT NULL,
          grant_id TEXT NOT NULL UNIQUE,
          action_type TEXT NOT NULL,
          state TEXT NOT NULL,
          created_at TEXT NOT NULL,
          completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_operator_beta_usage_family_created
          ON operator_beta_usage(family_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS operator_beta_evidence (
          id TEXT PRIMARY KEY,
          family_id TEXT NOT NULL,
          case_id TEXT NOT NULL,
          grant_id TEXT,
          kind TEXT NOT NULL,
          action_type TEXT,
          code TEXT,
          payload_secret TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_operator_beta_evidence_family_created
          ON operator_beta_evidence(family_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_operator_beta_evidence_case_created
          ON operator_beta_evidence(case_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS operator_case_feedback (
          case_id TEXT PRIMARY KEY,
          family_id TEXT NOT NULL,
          outcome TEXT NOT NULL,
          rating INTEGER,
          notes_secret TEXT,
          submitted_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_operator_feedback_family_created
          ON operator_case_feedback(family_id, created_at DESC);
      `);
      database.prepare(`
        INSERT OR IGNORE INTO operator_beta_global
          (id, enabled, kill_switch, evidence_retention_days, updated_at)
        VALUES (1, 1, 0, ?, ?)
      `).run(DEFAULT_EVIDENCE_RETENTION_DAYS, nowIso());
      return database;
    } catch (error) {
      initError = error;
      if (database) { try { database.close(); } catch (_) {} }
      database = null;
      return null;
    }
  }

  function requireDb() {
    const db = initialize();
    if (!db) throw new OperatorBetaError("Operator beta controls are unavailable.", "OPERATOR_BETA_UNAVAILABLE");
    return db;
  }

  function globalRow(db = requireDb()) {
    return db.prepare("SELECT * FROM operator_beta_global WHERE id = 1").get();
  }

  function globalStatus() {
    const row = globalRow();
    return {
      enabled: !envGlobalDisabled() && row.enabled === 1,
      configuredEnabled: row.enabled === 1,
      killSwitch: envKillSwitch() || row.kill_switch === 1,
      configuredKillSwitch: row.kill_switch === 1,
      environmentKillSwitch: envKillSwitch(),
      enforceEnrollment,
      evidenceRetentionDays: Number(row.evidence_retention_days),
      launchActionTypes: LAUNCH_ACTION_TYPES.slice(),
    };
  }

  function setGlobal(input = {}) {
    const db = requireDb();
    const current = globalRow(db);
    const enabled = input.enabled == null ? current.enabled === 1 : boolValue(input.enabled);
    const killSwitch = input.killSwitch == null ? current.kill_switch === 1 : boolValue(input.killSwitch);
    const retention = boundedInt(input.evidenceRetentionDays, Number(current.evidence_retention_days), 30, 3650);
    const updatedAt = nowIso();
    db.prepare(`UPDATE operator_beta_global SET enabled = ?, kill_switch = ?, evidence_retention_days = ?, updated_at = ? WHERE id = 1`)
      .run(enabled ? 1 : 0, killSwitch ? 1 : 0, retention, updatedAt);
    return globalStatus();
  }

  function parseAllowed(raw) {
    if (!raw) return LAUNCH_ACTION_TYPES.slice();
    const list = String(raw).split(",").map((value) => value.trim()).filter(Boolean);
    return [...new Set(list)].filter((type) => LAUNCH_ACTION_SET.has(type));
  }

  function configuredFamilyRow(familyId, db = requireDb()) {
    return db.prepare("SELECT * FROM operator_beta_families WHERE family_id = ?").get(familyId) || null;
  }

  function getFamilyConfig(familyId) {
    if (!family.getFamily(familyId)) throw new OperatorBetaError("Family not found.", "OPERATOR_FAMILY_NOT_FOUND");
    const row = configuredFamilyRow(familyId);
    if (!row) {
      return {
        familyId,
        configured: false,
        enabled: false,
        killSwitch: false,
        autonomyCeiling: "shadow-only",
        hourlyQuota: DEFAULT_HOURLY_QUOTA,
        dailyQuota: DEFAULT_DAILY_QUOTA,
        allowedActionTypes: LAUNCH_ACTION_TYPES.slice(),
        enrolledAt: null,
        updatedAt: null,
      };
    }
    return {
      familyId,
      configured: true,
      enabled: row.enabled === 1,
      killSwitch: row.kill_switch === 1,
      autonomyCeiling: row.autonomy_ceiling,
      hourlyQuota: Number(row.hourly_quota),
      dailyQuota: Number(row.daily_quota),
      allowedActionTypes: parseAllowed(row.allowed_action_types),
      enrolledAt: row.enrolled_at || null,
      updatedAt: row.updated_at,
    };
  }

  function normalizeAllowedActionTypes(value, fallback) {
    if (value == null) return fallback.slice();
    if (!Array.isArray(value)) throw new OperatorBetaError("allowedActionTypes must be an array.", "OPERATOR_BETA_CONFIG_INVALID");
    const unique = [...new Set(value.map((item) => cleanText(item, 120)).filter(Boolean))];
    if (unique.some((type) => !LAUNCH_ACTION_SET.has(type))) {
      throw new OperatorBetaError("Beta action allowlist may contain only launch-approved first-party action types.", "OPERATOR_BETA_CONFIG_INVALID");
    }
    for (const type of unique) {
      const policy = operatorRisk.getPolicy(type);
      if (!policy || policy.riskLevel !== "low" || policy.executable !== true) {
        throw new OperatorBetaError(`Action ${type} is not eligible for the low-risk beta.`, "OPERATOR_BETA_CONFIG_INVALID");
      }
    }
    return unique;
  }

  function setFamilyConfig(familyId, input = {}) {
    const db = requireDb();
    if (!family.getFamily(familyId)) throw new OperatorBetaError("Family not found.", "OPERATOR_FAMILY_NOT_FOUND");
    const current = getFamilyConfig(familyId);
    const enabled = input.enabled == null ? current.enabled : boolValue(input.enabled);
    const killSwitch = input.killSwitch == null ? current.killSwitch : boolValue(input.killSwitch);
    const autonomyCeiling = input.autonomyCeiling == null ? current.autonomyCeiling : cleanText(input.autonomyCeiling, 40);
    if (!AUTONOMY_SET.has(autonomyCeiling)) throw new OperatorBetaError("Invalid autonomy ceiling.", "OPERATOR_BETA_CONFIG_INVALID");
    const hourlyQuota = boundedInt(input.hourlyQuota, current.hourlyQuota, 1, 100);
    const dailyQuota = boundedInt(input.dailyQuota, current.dailyQuota, hourlyQuota, 500);
    const allowedActionTypes = normalizeAllowedActionTypes(input.allowedActionTypes, current.allowedActionTypes);
    const updatedAt = nowIso();
    const enrolledAt = enabled ? (current.enrolledAt || updatedAt) : current.enrolledAt;
    db.prepare(`
      INSERT INTO operator_beta_families
        (family_id, enabled, kill_switch, autonomy_ceiling, hourly_quota, daily_quota,
         allowed_action_types, enrolled_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(family_id) DO UPDATE SET
        enabled = excluded.enabled,
        kill_switch = excluded.kill_switch,
        autonomy_ceiling = excluded.autonomy_ceiling,
        hourly_quota = excluded.hourly_quota,
        daily_quota = excluded.daily_quota,
        allowed_action_types = excluded.allowed_action_types,
        enrolled_at = excluded.enrolled_at,
        updated_at = excluded.updated_at
    `).run(
      familyId, enabled ? 1 : 0, killSwitch ? 1 : 0, autonomyCeiling,
      hourlyQuota, dailyQuota, allowedActionTypes.join(","), enrolledAt, updatedAt,
    );
    operatorStore.recordAudit({
      familyId,
      eventType: "beta.family_configured",
      payload: { enabled, killSwitch, autonomyCeiling, hourlyQuota, dailyQuota, allowedActionTypes },
    });
    return getFamilyConfig(familyId);
  }

  function usageCounts(familyId, db = requireDb(), now = Date.now()) {
    const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const counted = "state IN ('reserved','completed','failed')";
    const hourly = Number(db.prepare(`SELECT COUNT(*) AS n FROM operator_beta_usage WHERE family_id = ? AND ${counted} AND created_at >= ?`).get(familyId, hourAgo).n);
    const daily = Number(db.prepare(`SELECT COUNT(*) AS n FROM operator_beta_usage WHERE family_id = ? AND ${counted} AND created_at >= ?`).get(familyId, dayAgo).n);
    return { hourly, daily };
  }

  function statusForFamily(familyId) {
    const global = globalStatus();
    const config = getFamilyConfig(familyId);
    const usage = usageCounts(familyId);
    const explicitlyDisabled = config.configured && !config.enabled;
    const enrolled = config.enabled && config.autonomyCeiling === "approved-low-risk";
    const liveExecutionAllowed = global.enabled && !global.killSwitch && !config.killSwitch &&
      (!enforceEnrollment || enrolled) && !explicitlyDisabled &&
      usage.hourly < config.hourlyQuota && usage.daily < config.dailyQuota;
    return { global, config, usage, liveExecutionAllowed };
  }

  function actionEligible(actionType, config) {
    const type = cleanText(actionType, 120);
    const policy = operatorRisk.getPolicy(type);
    if (!policy || policy.riskLevel !== "low" || policy.executable !== true || !LAUNCH_ACTION_SET.has(type)) {
      throw new OperatorBetaError(`Action ${type || "(missing)"} is outside the limited beta safety boundary.`, "OPERATOR_BETA_ACTION_DENIED");
    }
    if (!config.allowedActionTypes.includes(type)) {
      throw new OperatorBetaError(`Action ${type} is not enabled for this beta family.`, "OPERATOR_BETA_ACTION_DENIED");
    }
    return type;
  }

  function block(familyId, details = {}) {
    const db = requireDb();
    const createdAt = nowIso();
    const id = newId("evidence");
    db.prepare(`
      INSERT INTO operator_beta_evidence
        (id, family_id, case_id, grant_id, kind, action_type, code, payload_secret, created_at)
      VALUES (?, ?, ?, ?, 'beta.blocked', ?, ?, ?, ?)
    `).run(
      id, familyId, details.caseId || "unknown", details.grantId || null,
      details.actionType || null, details.code || "OPERATOR_BETA_BLOCKED",
      encodeSecret({ reason: cleanText(details.reason, 1000) || null, phase: details.phase || null }), createdAt,
    );
    if (details.caseId && details.caseId !== "unknown") {
      operatorStore.recordAudit({
        familyId,
        caseId: details.caseId,
        eventType: "beta.execution_blocked",
        payload: { grantId: details.grantId || null, actionType: details.actionType || null, code: details.code || "OPERATOR_BETA_BLOCKED", phase: details.phase || null },
      });
    }
    return id;
  }

  function denied(familyId, details, code, message) {
    block(familyId, { ...details, code, reason: message });
    throw new OperatorBetaError(message, code);
  }

  function assertLiveAllowed(familyId, actionType, details = {}) {
    const status = statusForFamily(familyId);
    const type = actionEligible(actionType, status.config);
    if (!status.global.enabled) denied(familyId, { ...details, actionType: type }, "OPERATOR_BETA_GLOBAL_DISABLED", "Operator live execution is globally disabled.");
    if (status.global.killSwitch) denied(familyId, { ...details, actionType: type }, "OPERATOR_BETA_KILL_SWITCH", "Operator live execution is stopped by the global kill switch.");
    if (status.config.killSwitch) denied(familyId, { ...details, actionType: type }, "OPERATOR_BETA_FAMILY_KILL_SWITCH", "Operator live execution is stopped for this family.");
    if (status.config.configured && !status.config.enabled) denied(familyId, { ...details, actionType: type }, "OPERATOR_BETA_NOT_ENROLLED", "This family is not enabled for Operator live execution.");
    if (enforceEnrollment && !status.config.enabled) denied(familyId, { ...details, actionType: type }, "OPERATOR_BETA_NOT_ENROLLED", "This family is not enrolled in the limited Operator beta.");
    if (enforceEnrollment && status.config.autonomyCeiling !== "approved-low-risk") denied(familyId, { ...details, actionType: type }, "OPERATOR_BETA_AUTONOMY_CEILING", "This family's autonomy ceiling is shadow-only.");
    if (status.usage.hourly >= status.config.hourlyQuota) denied(familyId, { ...details, actionType: type }, "OPERATOR_BETA_HOURLY_QUOTA", "This family's hourly Operator execution quota has been reached.");
    if (status.usage.daily >= status.config.dailyQuota) denied(familyId, { ...details, actionType: type }, "OPERATOR_BETA_DAILY_QUOTA", "This family's daily Operator execution quota has been reached.");
    return { ...status, actionType: type };
  }

  function preflightClaim(familyId, approvalId, actor) {
    const db = requireDb();
    const userId = actor && String(actor.userId || actor.principalId || "");
    const row = db.prepare(`
      SELECT g.id AS grant_id, g.case_id, g.action_type, g.state,
             a.state AS approval_state, a.decided_by
      FROM operator_execution_grants g
      JOIN operator_approvals a ON a.id = g.approval_id
      WHERE g.family_id = ? AND g.approval_id = ?
    `).get(familyId, approvalId);
    if (!row || row.approval_state !== "approved") throw new OperatorBetaError("No approved beta execution is available.", "EXECUTION_NOT_READY");
    if (!userId || row.decided_by !== userId) throw new OperatorBetaError("Execution must remain bound to the approving parent.", "EXECUTION_APPROVER_REQUIRED");
    return assertLiveAllowed(familyId, row.action_type, { caseId: row.case_id, grantId: row.grant_id, phase: "claim" });
  }

  function reserveExecutionToken(familyId, executionToken, actionHash) {
    const db = requireDb();
    const hash = cleanText(actionHash, 64).toLowerCase();
    if (!ACTION_HASH_RE.test(hash)) throw new OperatorBetaError("A valid actionHash is required.", "EXECUTION_HASH_MISMATCH");
    const token = String(executionToken || "");
    const row = db.prepare(`
      SELECT g.id AS grant_id, g.case_id, g.action_type, g.action_hash, g.state,
             a.state AS approval_state
      FROM operator_execution_grants g
      JOIN operator_approvals a ON a.id = g.approval_id
      WHERE g.family_id = ? AND g.token_hash = ?
    `).get(familyId, tokenHash(token));
    if (!row || row.approval_state !== "approved" || row.state !== "claimed") throw new OperatorBetaError("Execution token is invalid.", "EXECUTION_TOKEN_INVALID");
    if (String(row.action_hash).toLowerCase() !== hash) throw new OperatorBetaError("Approved action hash does not match this execution.", "EXECUTION_HASH_MISMATCH");
    const existing = db.prepare("SELECT * FROM operator_beta_usage WHERE grant_id = ?").get(row.grant_id);
    if (existing) {
      if (existing.state === "reserved") return { reservationId: existing.id, grantId: row.grant_id, caseId: row.case_id, actionType: row.action_type, idempotent: true };
      throw new OperatorBetaError("This beta execution has already been accounted for.", "OPERATOR_BETA_EXECUTION_REPLAY");
    }

    const outcome = db.transaction(() => {
      const status = statusForFamily(familyId);
      const type = actionEligible(row.action_type, status.config);
      if (!status.global.enabled) return { blocked: ["OPERATOR_BETA_GLOBAL_DISABLED", "Operator live execution is globally disabled."] };
      if (status.global.killSwitch) return { blocked: ["OPERATOR_BETA_KILL_SWITCH", "Operator live execution is stopped by the global kill switch."] };
      if (status.config.killSwitch) return { blocked: ["OPERATOR_BETA_FAMILY_KILL_SWITCH", "Operator live execution is stopped for this family."] };
      if ((status.config.configured && !status.config.enabled) || (enforceEnrollment && !status.config.enabled)) return { blocked: ["OPERATOR_BETA_NOT_ENROLLED", "This family is not enrolled in the limited Operator beta."] };
      if (enforceEnrollment && status.config.autonomyCeiling !== "approved-low-risk") return { blocked: ["OPERATOR_BETA_AUTONOMY_CEILING", "This family's autonomy ceiling is shadow-only."] };
      const counts = usageCounts(familyId, db);
      if (counts.hourly >= status.config.hourlyQuota) return { blocked: ["OPERATOR_BETA_HOURLY_QUOTA", "This family's hourly Operator execution quota has been reached."] };
      if (counts.daily >= status.config.dailyQuota) return { blocked: ["OPERATOR_BETA_DAILY_QUOTA", "This family's daily Operator execution quota has been reached."] };
      const id = newId("betaexec");
      db.prepare(`INSERT INTO operator_beta_usage (id, family_id, case_id, grant_id, action_type, state, created_at, completed_at) VALUES (?, ?, ?, ?, ?, 'reserved', ?, NULL)`)
        .run(id, familyId, row.case_id, row.grant_id, type, nowIso());
      return { reservationId: id, grantId: row.grant_id, caseId: row.case_id, actionType: type };
    }).immediate();

    if (outcome.blocked) denied(familyId, { caseId: row.case_id, grantId: row.grant_id, actionType: row.action_type, phase: "run" }, outcome.blocked[0], outcome.blocked[1]);
    return outcome;
  }

  function captureEvidence(familyId, caseId, input = {}) {
    const db = requireDb();
    const id = newId("evidence");
    const createdAt = nowIso();
    db.prepare(`
      INSERT INTO operator_beta_evidence
        (id, family_id, case_id, grant_id, kind, action_type, code, payload_secret, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, familyId, caseId, input.grantId || null, cleanText(input.kind, 80) || "beta.evidence",
      input.actionType || null, input.code || null,
      input.payload == null ? null : encodeSecret(input.payload), createdAt,
    );
    const excess = db.prepare(`SELECT id FROM operator_beta_evidence WHERE family_id = ? AND case_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?`)
      .all(familyId, caseId, MAX_EVIDENCE_PER_CASE);
    if (excess.length) db.prepare(`DELETE FROM operator_beta_evidence WHERE id IN (${excess.map(() => "?").join(",")})`).run(...excess.map((row) => row.id));
    return id;
  }

  function completeReservation(grantId, result) {
    const db = requireDb();
    const row = db.prepare("SELECT * FROM operator_beta_usage WHERE grant_id = ?").get(grantId);
    if (!row) return null;
    const completedAt = nowIso();
    db.prepare("UPDATE operator_beta_usage SET state = 'completed', completed_at = ? WHERE grant_id = ? AND state = 'reserved'").run(completedAt, grantId);
    captureEvidence(row.family_id, row.case_id, { grantId, kind: "beta.execution_completed", actionType: row.action_type, payload: { result } });
    return { grantId, state: "completed", completedAt };
  }

  function failReservation(grantId, error) {
    const db = requireDb();
    const row = db.prepare("SELECT * FROM operator_beta_usage WHERE grant_id = ?").get(grantId);
    if (!row) return null;
    const completedAt = nowIso();
    const safeError = { code: cleanText(error && error.code, 120) || "EXECUTION_FAILED", message: cleanText(error && error.message, 1000) || "Execution failed." };
    db.prepare("UPDATE operator_beta_usage SET state = 'failed', completed_at = ? WHERE grant_id = ? AND state = 'reserved'").run(completedAt, grantId);
    captureEvidence(row.family_id, row.case_id, { grantId, kind: "beta.execution_failed", actionType: row.action_type, code: safeError.code, payload: { error: safeError } });
    return { grantId, state: "failed", completedAt };
  }

  function releaseReservation(grantId, reason) {
    const db = requireDb();
    const row = db.prepare(`
      SELECT u.*, g.state AS grant_state
      FROM operator_beta_usage u
      JOIN operator_execution_grants g ON g.id = u.grant_id
      WHERE u.grant_id = ?
    `).get(grantId);
    if (!row || row.state !== "reserved") return false;
    // A concurrent replay can observe the shared reservation while the real
    // execution is already running. Never release its quota slot in that case;
    // the winning execution will complete or fail the reservation.
    if (!["claimed", "ready"].includes(row.grant_state)) return false;
    db.prepare("UPDATE operator_beta_usage SET state = 'released', completed_at = ? WHERE grant_id = ? AND state = 'reserved'").run(nowIso(), grantId);
    captureEvidence(row.family_id, row.case_id, { grantId, kind: "beta.execution_released", actionType: row.action_type, payload: { reason: cleanText(reason, 500) || null } });
    return true;
  }

  function evidenceForCase(familyId, caseId, options = {}) {
    const db = requireDb();
    const limit = Math.max(1, Math.min(Number(options.limit) || 50, 100));
    return db.prepare(`SELECT * FROM operator_beta_evidence WHERE family_id = ? AND case_id = ? ORDER BY created_at ASC LIMIT ?`).all(familyId, caseId, limit).map((row) => {
      const payload = row.payload_secret ? decodeSecret(row.payload_secret) : null;
      return {
        id: row.id,
        kind: row.kind,
        actionType: row.action_type || null,
        code: row.code || null,
        result: payload && payload.result || null,
        error: payload && payload.error || null,
        reason: payload && payload.reason || null,
        createdAt: row.created_at,
      };
    });
  }

  function feedbackRow(familyId, caseId, db = requireDb()) {
    return db.prepare("SELECT * FROM operator_case_feedback WHERE family_id = ? AND case_id = ?").get(familyId, caseId) || null;
  }

  function feedbackProjection(row) {
    if (!row) return null;
    return { outcome: row.outcome, rating: row.rating == null ? null : Number(row.rating), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  function feedbackStatus(familyId, caseId) {
    const current = operatorStore.getCase(familyId, caseId);
    if (!current) return { required: false, reason: null, submitted: false, feedback: null };
    const existing = feedbackRow(familyId, caseId);
    const evidence = evidenceForCase(familyId, caseId, { limit: 100 });
    const audit = operatorStore.listAudit(familyId, { caseId, limit: 250 });
    const blocked = evidence.some((item) => item.kind === "beta.blocked");
    const executionCompleted = audit.some((item) => item.eventType === "execution.completed");
    const executionFailed = audit.some((item) => item.eventType === "execution.failed");
    const shadowFinished = audit.some((item) => item.eventType === "shadow.reviewed" || item.eventType === "shadow.cancelled");
    const terminal = ["completed", "failed", "cancelled"].includes(current.state);
    const required = blocked || executionCompleted || executionFailed || shadowFinished || terminal;
    const reason = blocked ? "blocked" : executionFailed || current.state === "failed" ? "failed" : executionCompleted || current.state === "completed" ? "completed" : shadowFinished ? "shadow-reviewed" : current.state === "cancelled" ? "cancelled" : null;
    return { required, reason, submitted: !!existing, feedback: feedbackProjection(existing) };
  }

  function parentActor(familyId, actor) {
    const fam = family.getFamily(familyId);
    const userId = actor && String(actor.userId || actor.principalId || "");
    if (!fam || !userId || !(fam.parentIds || []).includes(userId) || actor.type !== "parent") {
      throw new OperatorBetaError("Only a parent in this family may submit Operator beta feedback.", "OPERATOR_BETA_PARENT_REQUIRED");
    }
    return userId;
  }

  function submitFeedback(familyId, caseId, actor, input = {}) {
    const db = requireDb();
    const userId = parentActor(familyId, actor);
    const status = feedbackStatus(familyId, caseId);
    if (!status.required) throw new OperatorBetaError("Feedback is not requested for this case yet.", "OPERATOR_BETA_FEEDBACK_NOT_READY");
    const outcome = cleanText(input.outcome, 40);
    if (!FEEDBACK_SET.has(outcome)) throw new OperatorBetaError("Invalid feedback outcome.", "OPERATOR_BETA_FEEDBACK_INVALID");
    const rating = input.rating == null || input.rating === "" ? null : boundedInt(input.rating, null, 1, 5);
    const notes = cleanText(input.notes, 2000) || null;
    const now = nowIso();
    const existing = feedbackRow(familyId, caseId, db);
    db.prepare(`
      INSERT INTO operator_case_feedback
        (case_id, family_id, outcome, rating, notes_secret, submitted_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(case_id) DO UPDATE SET
        outcome = excluded.outcome,
        rating = excluded.rating,
        notes_secret = excluded.notes_secret,
        submitted_by = excluded.submitted_by,
        updated_at = excluded.updated_at
    `).run(caseId, familyId, outcome, rating, notes == null ? null : encodeSecret(notes), userId, existing ? existing.created_at : now, now);
    operatorStore.recordAudit({ familyId, caseId, actorId: userId, eventType: "beta.feedback_submitted", payload: { outcome, rating, reason: status.reason } });
    captureEvidence(familyId, caseId, { kind: "beta.parent_feedback", payload: { outcome, rating, reason: status.reason } });
    return feedbackStatus(familyId, caseId);
  }

  function pendingFeedback(familyId, parentUserId, options = {}) {
    parentActor(familyId, { type: "parent", userId: parentUserId, principalId: parentUserId });
    const limit = Math.max(1, Math.min(Number(options.limit) || 50, 100));
    return operatorStore.listCases(familyId, { limit: 200 })
      .map((current) => ({ caseId: current.id, title: current.title, state: current.state, ...feedbackStatus(familyId, current.id) }))
      .filter((item) => item.required && !item.submitted)
      .slice(0, limit);
  }

  function workflowIdsForFamily(familyId, db = requireDb()) {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'operator_shadow_runs'").get();
    if (!exists) return [];
    return db.prepare("SELECT DISTINCT workflow_id FROM operator_shadow_runs WHERE family_id = ? ORDER BY workflow_id ASC").all(familyId).map((row) => row.workflow_id);
  }

  function familyDashboard(familyId) {
    const fam = family.getFamily(familyId);
    if (!fam) return null;
    const config = getFamilyConfig(familyId);
    const usage = usageCounts(familyId);
    const db = requireDb();
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const blocked7d = Number(db.prepare("SELECT COUNT(*) AS n FROM operator_beta_evidence WHERE family_id = ? AND kind = 'beta.blocked' AND created_at >= ?").get(familyId, since).n);
    const feedbackTotal = Number(db.prepare("SELECT COUNT(*) AS n FROM operator_case_feedback WHERE family_id = ?").get(familyId).n);
    const cases = operatorStore.listCases(familyId, { limit: 200 });
    const required = cases.reduce((sum, current) => sum + (feedbackStatus(familyId, current.id).required ? 1 : 0), 0);
    const workflows = workflowIdsForFamily(familyId, db).map((workflowId) => operatorShadow.graduationStatus(familyId, workflowId));
    return {
      familyId,
      familyName: fam.name || "Family",
      config,
      usage,
      blocked7d,
      feedback: { required, submitted: feedbackTotal, coverage: required ? Math.min(1, feedbackTotal / required) : 1 },
      workflows,
    };
  }

  function dashboard() {
    const db = requireDb();
    const configuredIds = db.prepare("SELECT family_id FROM operator_beta_families ORDER BY updated_at DESC").all().map((row) => row.family_id);
    return {
      generatedAt: nowIso(),
      global: globalStatus(),
      families: configuredIds.map(familyDashboard).filter(Boolean),
      safetyBoundary: {
        launchActionTypes: LAUNCH_ACTION_TYPES.slice(),
        maximumRiskLevel: "low",
        exactParentApprovalRequired: true,
        paymentsEnabled: false,
        medicalLegalAttestationsEnabled: false,
        unrestrictedBrowserExecutionEnabled: false,
        silentExternalMessagingEnabled: false,
      },
    };
  }

  function pruneEvidence() {
    const db = requireDb();
    const days = Number(globalRow(db).evidence_retention_days) || DEFAULT_EVIDENCE_RETENTION_DAYS;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = db.prepare("DELETE FROM operator_beta_evidence WHERE created_at < ?").run(cutoff);
    return { deleted: Number(result.changes || 0), cutoff, retentionDays: days };
  }

  function status() {
    const db = initialize();
    return { available: !!db, backend: "sqlite", fallback: false, enforceEnrollment, errorCode: db ? null : "OPERATOR_BETA_UNAVAILABLE", error: db ? null : initError && initError.message || null };
  }

  function close() {
    if (!database) return;
    try { database.close(); } finally { database = null; initAttempted = true; }
  }

  return {
    status,
    globalStatus,
    setGlobal,
    getFamilyConfig,
    setFamilyConfig,
    statusForFamily,
    preflightClaim,
    reserveExecutionToken,
    completeReservation,
    failReservation,
    releaseReservation,
    captureEvidence,
    evidenceForCase,
    feedbackStatus,
    submitFeedback,
    pendingFeedback,
    familyDashboard,
    dashboard,
    pruneEvidence,
    close,
  };
}

let singleton = null;
function defaultBeta() { if (!singleton) singleton = createOperatorBeta(); return singleton; }

module.exports = {
  AUTONOMY_CEILINGS,
  LAUNCH_ACTION_TYPES,
  FEEDBACK_OUTCOMES,
  DEFAULT_HOURLY_QUOTA,
  DEFAULT_DAILY_QUOTA,
  DEFAULT_EVIDENCE_RETENTION_DAYS,
  OperatorBetaError,
  createOperatorBeta,
  status: (...args) => defaultBeta().status(...args),
  globalStatus: (...args) => defaultBeta().globalStatus(...args),
  setGlobal: (...args) => defaultBeta().setGlobal(...args),
  getFamilyConfig: (...args) => defaultBeta().getFamilyConfig(...args),
  setFamilyConfig: (...args) => defaultBeta().setFamilyConfig(...args),
  statusForFamily: (...args) => defaultBeta().statusForFamily(...args),
  preflightClaim: (...args) => defaultBeta().preflightClaim(...args),
  reserveExecutionToken: (...args) => defaultBeta().reserveExecutionToken(...args),
  completeReservation: (...args) => defaultBeta().completeReservation(...args),
  failReservation: (...args) => defaultBeta().failReservation(...args),
  releaseReservation: (...args) => defaultBeta().releaseReservation(...args),
  captureEvidence: (...args) => defaultBeta().captureEvidence(...args),
  evidenceForCase: (...args) => defaultBeta().evidenceForCase(...args),
  feedbackStatus: (...args) => defaultBeta().feedbackStatus(...args),
  submitFeedback: (...args) => defaultBeta().submitFeedback(...args),
  pendingFeedback: (...args) => defaultBeta().pendingFeedback(...args),
  familyDashboard: (...args) => defaultBeta().familyDashboard(...args),
  dashboard: (...args) => defaultBeta().dashboard(...args),
  pruneEvidence: (...args) => defaultBeta().pruneEvidence(...args),
};

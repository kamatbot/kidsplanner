"use strict";

/**
 * Durable Family Memory for Hermes Family Operator.
 *
 * Memory is FamETC-owned, encrypted, provenance-carrying and parent-governed.
 * Hermes may propose a memory, but only a parent can activate/edit/delete it.
 * This is intentionally separate from Hermes model memory and from Odds Core;
 * future cross-product projections can be represented without changing source
 * authority or inventing Odds canonical person ids.
 */
const crypto = require("crypto");
const operatorStore = require("./operator-store");
const operator = require("./operator");
const family = require("./family");
const identitySubjects = require("./identity-subjects");
const datacrypto = require("./datacrypto");
const { ensureDataDir } = require("./paths");

const STATES = Object.freeze(["pending", "active", "rejected", "deleted"]);
const SCOPES = Object.freeze(["household", "person"]);
const KINDS = Object.freeze(["fact", "preference"]);
const ASSERTION_TYPES = Object.freeze(["asserted", "derived", "projection"]);
const SENSITIVITIES = Object.freeze([
  "general",
  "family-operations-summary",
  "personal-preferences",
  "identity",
  "sensitive",
]);
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 300;

class OperatorMemoryError extends Error {
  constructor(message, code = "OPERATOR_MEMORY_ERROR") {
    super(message);
    this.name = "OperatorMemoryError";
    this.code = code;
  }
}

function nowIso() { return new Date().toISOString(); }
function newId() { return `memory_${crypto.randomBytes(12).toString("hex")}`; }
function bounded(value, field, max, required = false) {
  const out = String(value == null ? "" : value).trim();
  if (required && !out) throw new OperatorMemoryError(`${field} is required.`, "OPERATOR_MEMORY_INVALID");
  if (out.length > max) throw new OperatorMemoryError(`${field} must be ${max} characters or fewer.`, "OPERATOR_MEMORY_INVALID");
  return out;
}
function enumValue(value, allowed, field, fallback) {
  const out = String(value == null || value === "" ? fallback : value).trim();
  if (!allowed.includes(out)) throw new OperatorMemoryError(`Invalid ${field}: ${out || "(empty)"}.`, "OPERATOR_MEMORY_INVALID");
  return out;
}
function confidenceValue(value) {
  if (value == null || value === "") return 1;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new OperatorMemoryError("confidence must be between 0 and 1.", "OPERATOR_MEMORY_INVALID");
  return Math.round(n * 1000) / 1000;
}
function expiresValue(value) {
  if (value == null || value === "") return null;
  const time = Date.parse(String(value));
  if (!Number.isFinite(time)) throw new OperatorMemoryError("expiresAt must be an ISO date/time.", "OPERATOR_MEMORY_INVALID");
  return new Date(time).toISOString();
}
function encryptionKey() {
  const key = datacrypto.loadKey();
  if (!key) throw new OperatorMemoryError("Family Memory encryption is unavailable.", "OPERATOR_MEMORY_UNAVAILABLE");
  return key;
}
function encodeSecret(value) {
  return datacrypto.encrypt(JSON.stringify(value == null ? null : value), encryptionKey());
}
function decodeSecret(value) {
  if (!value || !datacrypto.isEncrypted(String(value))) throw new OperatorMemoryError("Family Memory payload is unavailable.", "OPERATOR_MEMORY_UNAVAILABLE");
  try { return JSON.parse(datacrypto.decrypt(String(value), encryptionKey())); }
  catch (error) { throw new OperatorMemoryError("Family Memory payload could not be decoded.", "OPERATOR_MEMORY_UNAVAILABLE"); }
}

function createOperatorMemory(options = {}) {
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
      const foundation = operatorStore.createOperatorStore({ dbFile, Database });
      const status = foundation.status();
      foundation.close();
      if (!status.available) throw new Error("Operator store unavailable");
      database = new Database(dbFile);
      database.pragma("journal_mode = WAL");
      database.pragma("foreign_keys = ON");
      database.pragma("busy_timeout = 5000");
      database.exec(`
        CREATE TABLE IF NOT EXISTS operator_memories (
          id TEXT PRIMARY KEY,
          family_id TEXT NOT NULL,
          scope TEXT NOT NULL,
          subject_id TEXT,
          memory_key TEXT NOT NULL,
          kind TEXT NOT NULL,
          state TEXT NOT NULL,
          value_secret TEXT NOT NULL,
          provenance_secret TEXT NOT NULL,
          confidence REAL NOT NULL,
          sensitivity TEXT NOT NULL,
          expires_at TEXT,
          proposed_by TEXT,
          approved_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_operator_memory_family_state
          ON operator_memories(family_id, state, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_operator_memory_subject_state
          ON operator_memories(family_id, subject_id, state, updated_at DESC);
      `);
      return database;
    } catch (error) {
      if (database) { try { database.close(); } catch (_) {} }
      database = null;
      return null;
    }
  }

  function requireDb() {
    const db = initialize();
    if (!db) throw new OperatorMemoryError("Family Memory storage is unavailable.", "OPERATOR_MEMORY_UNAVAILABLE");
    return db;
  }

  function validateFamilyActor(familyId, actor) {
    const fam = family.getFamily(familyId);
    if (!fam) throw new OperatorMemoryError("Family not found.", "OPERATOR_FAMILY_NOT_FOUND");
    try { return { fam, actor: operator.validateActor(fam, actor) }; }
    catch (error) { throw new OperatorMemoryError(error.message, error.code || "OPERATOR_POLICY_DENIED"); }
  }

  function parentActor(familyId, actor) {
    const validated = validateFamilyActor(familyId, actor);
    if (validated.actor.type !== "parent") throw new OperatorMemoryError("Only a parent can govern Family Memory.", "OPERATOR_MEMORY_PARENT_REQUIRED");
    return validated;
  }

  function validateSubject(fam, actor, scope, subjectId) {
    if (scope === "household") {
      if (subjectId) throw new OperatorMemoryError("Household memory cannot have a person subject.", "OPERATOR_MEMORY_INVALID");
      return null;
    }
    const subject = identitySubjects.getSubject(subjectId);
    if (!subject || subject.familyId !== fam.id || subject.status !== "active") {
      throw new OperatorMemoryError("Memory subject is not active in this family.", "OPERATOR_MEMORY_INVALID_SUBJECT");
    }
    if (actor.type === "kid") {
      const mine = identitySubjects.subjectForPrincipal("kid", fam.id, actor.kidId || actor.principalId);
      if (!mine || mine.id !== subject.id) throw new OperatorMemoryError("Kids can only propose memory about themselves.", "OPERATOR_MEMORY_SCOPE_DENIED");
    }
    return subject.id;
  }

  function normalizedInput(familyId, actor, input = {}) {
    const { fam, actor: validatedActor } = validateFamilyActor(familyId, actor);
    const scope = enumValue(input.scope, SCOPES, "scope", "household");
    const subjectId = validateSubject(fam, validatedActor, scope, input.subjectId ? String(input.subjectId) : null);
    const key = bounded(input.key, "key", 120, true);
    const kind = enumValue(input.kind, KINDS, "kind", "fact");
    const assertionType = enumValue(input.assertionType, ASSERTION_TYPES, "assertionType", "derived");
    const sensitivity = enumValue(input.sensitivity, SENSITIVITIES, "sensitivity", kind === "preference" ? "personal-preferences" : "general");
    const provenance = input.provenance && typeof input.provenance === "object" && !Array.isArray(input.provenance) ? input.provenance : {};
    const productId = bounded(provenance.productId || "fametc", "provenance.productId", 80, true);
    const sourceRef = bounded(provenance.sourceRef, "provenance.sourceRef", 300) || null;
    const sourceType = bounded(provenance.sourceType || "operator", "provenance.sourceType", 80, true);
    return {
      fam,
      actor: validatedActor,
      scope,
      subjectId,
      key,
      kind,
      value: input.value,
      confidence: confidenceValue(input.confidence),
      sensitivity,
      expiresAt: expiresValue(input.expiresAt),
      provenance: {
        productId,
        sourceType,
        sourceRef,
        assertionType,
        observedAt: provenance.observedAt && Number.isFinite(Date.parse(provenance.observedAt))
          ? new Date(Date.parse(provenance.observedAt)).toISOString() : nowIso(),
        authority: bounded(provenance.authority || productId, "provenance.authority", 80, true),
      },
    };
  }

  function hydrate(row) {
    if (!row) return null;
    return {
      id: row.id,
      familyId: row.family_id,
      scope: row.scope,
      subjectId: row.subject_id || null,
      key: row.memory_key,
      kind: row.kind,
      state: row.state,
      value: decodeSecret(row.value_secret),
      provenance: decodeSecret(row.provenance_secret),
      confidence: Number(row.confidence),
      sensitivity: row.sensitivity,
      expiresAt: row.expires_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function writeMemory(familyId, actor, input, state, approvedBy) {
    const db = requireDb();
    const normalized = normalizedInput(familyId, actor, input);
    const id = newId();
    const createdAt = nowIso();
    db.prepare(`
      INSERT INTO operator_memories
        (id, family_id, scope, subject_id, memory_key, kind, state, value_secret,
         provenance_secret, confidence, sensitivity, expires_at, proposed_by,
         approved_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, familyId, normalized.scope, normalized.subjectId, normalized.key,
      normalized.kind, state, encodeSecret(normalized.value), encodeSecret(normalized.provenance),
      normalized.confidence, normalized.sensitivity, normalized.expiresAt,
      normalized.actor.principalId, approvedBy || null, createdAt, createdAt,
    );
    operatorStore.recordAudit({
      familyId,
      actorId: normalized.actor.principalId,
      eventType: state === "active" ? "memory.created" : "memory.proposed",
      payload: { memoryId: id, scope: normalized.scope, subjectId: normalized.subjectId, key: normalized.key, kind: normalized.kind, sensitivity: normalized.sensitivity },
    });
    return hydrate(db.prepare("SELECT * FROM operator_memories WHERE id = ?").get(id));
  }

  function propose(familyId, actor, input = {}) {
    return writeMemory(familyId, actor, { ...input, assertionType: input.assertionType || "derived" }, "pending", null);
  }

  function createByParent(familyId, actor, input = {}) {
    const { actor: parent } = parentActor(familyId, actor);
    return writeMemory(familyId, parent, { ...input, assertionType: input.assertionType || "asserted" }, "active", parent.userId);
  }

  function ownedRow(db, familyId, memoryId) {
    return db.prepare("SELECT * FROM operator_memories WHERE id = ? AND family_id = ?").get(memoryId, familyId) || null;
  }

  function decide(familyId, memoryId, actor, decision) {
    const db = requireDb();
    const { actor: parent } = parentActor(familyId, actor);
    const action = String(decision || "").trim().toLowerCase();
    if (!new Set(["approve", "reject"]).has(action)) throw new OperatorMemoryError("decision must be approve or reject.", "OPERATOR_MEMORY_INVALID");
    const row = ownedRow(db, familyId, memoryId);
    if (!row) return null;
    if (row.state !== "pending") throw new OperatorMemoryError(`Memory is already ${row.state}.`, "OPERATOR_MEMORY_NOT_PENDING");
    const state = action === "approve" ? "active" : "rejected";
    const updatedAt = nowIso();
    db.prepare("UPDATE operator_memories SET state = ?, approved_by = ?, updated_at = ? WHERE id = ? AND family_id = ? AND state = 'pending'")
      .run(state, parent.userId, updatedAt, memoryId, familyId);
    operatorStore.recordAudit({ familyId, actorId: parent.userId, eventType: `memory.${state}`, payload: { memoryId } });
    return hydrate(ownedRow(db, familyId, memoryId));
  }

  function updateByParent(familyId, memoryId, actor, patch = {}) {
    const db = requireDb();
    const { fam, actor: parent } = parentActor(familyId, actor);
    const row = ownedRow(db, familyId, memoryId);
    if (!row || row.state !== "active") return null;
    const current = hydrate(row);
    const nextInput = {
      scope: patch.scope !== undefined ? patch.scope : current.scope,
      subjectId: patch.subjectId !== undefined ? patch.subjectId : current.subjectId,
      key: patch.key !== undefined ? patch.key : current.key,
      kind: patch.kind !== undefined ? patch.kind : current.kind,
      value: patch.value !== undefined ? patch.value : current.value,
      confidence: patch.confidence !== undefined ? patch.confidence : current.confidence,
      sensitivity: patch.sensitivity !== undefined ? patch.sensitivity : current.sensitivity,
      expiresAt: patch.expiresAt !== undefined ? patch.expiresAt : current.expiresAt,
      assertionType: current.provenance.assertionType,
      provenance: { ...current.provenance, ...(patch.provenance || {}) },
    };
    const normalized = normalizedInput(familyId, parent, nextInput);
    validateSubject(fam, parent, normalized.scope, normalized.subjectId);
    const updatedAt = nowIso();
    db.prepare(`
      UPDATE operator_memories SET scope = ?, subject_id = ?, memory_key = ?, kind = ?,
        value_secret = ?, provenance_secret = ?, confidence = ?, sensitivity = ?,
        expires_at = ?, updated_at = ? WHERE id = ? AND family_id = ? AND state = 'active'
    `).run(
      normalized.scope, normalized.subjectId, normalized.key, normalized.kind,
      encodeSecret(normalized.value), encodeSecret(normalized.provenance), normalized.confidence,
      normalized.sensitivity, normalized.expiresAt, updatedAt, memoryId, familyId,
    );
    operatorStore.recordAudit({ familyId, actorId: parent.userId, eventType: "memory.updated", payload: { memoryId } });
    return hydrate(ownedRow(db, familyId, memoryId));
  }

  function removeByParent(familyId, memoryId, actor) {
    const db = requireDb();
    const { actor: parent } = parentActor(familyId, actor);
    const row = ownedRow(db, familyId, memoryId);
    if (!row || row.state === "deleted") return false;
    const updatedAt = nowIso();
    db.prepare("UPDATE operator_memories SET state = 'deleted', updated_at = ? WHERE id = ? AND family_id = ?")
      .run(updatedAt, memoryId, familyId);
    operatorStore.recordAudit({ familyId, actorId: parent.userId, eventType: "memory.deleted", payload: { memoryId } });
    return true;
  }

  function visibleToActor(fam, actor, row) {
    if (actor.type === "parent") return true;
    if (row.sensitivity === "sensitive" || row.sensitivity === "identity") return false;
    if (row.scope === "household") return true;
    const mine = identitySubjects.subjectForPrincipal("kid", fam.id, actor.kidId || actor.principalId);
    return !!(mine && mine.id === row.subject_id);
  }

  function list(familyId, actor, options = {}) {
    const db = requireDb();
    const { fam, actor: validated } = validateFamilyActor(familyId, actor);
    const limit = Math.max(1, Math.min(Number(options.limit) || DEFAULT_LIMIT, MAX_LIMIT));
    const requestedState = options.state ? enumValue(options.state, STATES, "state") : "active";
    if (validated.type !== "parent" && requestedState !== "active") throw new OperatorMemoryError("Kids can only read active Family Memory.", "OPERATOR_MEMORY_SCOPE_DENIED");
    const rows = db.prepare(`
      SELECT * FROM operator_memories
      WHERE family_id = ? AND state = ?
      ORDER BY updated_at DESC LIMIT ?
    `).all(familyId, requestedState, Math.min(limit * 3, MAX_LIMIT));
    const now = Date.now();
    return rows
      .filter((row) => !row.expires_at || Date.parse(row.expires_at) > now)
      .filter((row) => visibleToActor(fam, validated, row))
      .slice(0, limit)
      .map(hydrate);
  }

  function activeForContext(familyId, actor, options = {}) {
    return list(familyId, actor, { state: "active", limit: options.limit || 100 });
  }

  function status() {
    return { available: !!initialize(), backend: "sqlite", fallback: false };
  }

  function close() {
    if (!database) return;
    try { database.close(); } finally { database = null; initAttempted = true; }
  }

  return { status, propose, createByParent, decide, updateByParent, removeByParent, list, activeForContext, close };
}

let singleton = null;
function memory() { if (!singleton) singleton = createOperatorMemory(); return singleton; }

module.exports = {
  STATES,
  SCOPES,
  KINDS,
  ASSERTION_TYPES,
  SENSITIVITIES,
  OperatorMemoryError,
  createOperatorMemory,
  status: (...args) => memory().status(...args),
  propose: (...args) => memory().propose(...args),
  createByParent: (...args) => memory().createByParent(...args),
  decide: (...args) => memory().decide(...args),
  updateByParent: (...args) => memory().updateByParent(...args),
  removeByParent: (...args) => memory().removeByParent(...args),
  list: (...args) => memory().list(...args),
  activeForContext: (...args) => memory().activeForContext(...args),
};

"use strict";
/**
 * School account (Moodle) integration — Part 2: encrypted credential storage.
 *
 * A parent's school Moodle username/password is stored per-family, ENCRYPTED
 * with lib/datacrypto.js (the same AES-256-GCM primitive that protects
 * db.json as a whole — this is a second, independent encryption layer scoped
 * just to this blob, so the credential ciphertext round-trips through
 * datacrypto.encrypt/decrypt on its own and is never written as plaintext
 * even if someone reads db.json's on-disk JSON structure directly before the
 * whole-file encryption in lib/db.js is considered).
 *
 * If DATA_ENCRYPTION_KEY is not configured (datacrypto.loadKey() === null),
 * this feature is DISABLED — saveCredentials() refuses to store anything
 * rather than ever falling back to plaintext.
 *
 * Credential lifecycle:
 *   store   -> JSON.stringify({username,password}) -> datacrypto.encrypt(key) -> persisted blob
 *   import  -> datacrypto.decrypt(key) -> JSON.parse -> used in-memory for one
 *              Moodle login -> discarded (never re-persisted, never logged,
 *              never returned to the client)
 *
 * Storage shape: root.schoolAccounts[familyId] = {
 *   parentUserId, blob: "ENC1:...", updatedAt,
 *   kidMappings: { [kidId]: moodleUserId },
 * }
 */
const db = require("./db");
const datacrypto = require("./datacrypto");

function root() {
  const r = db.load();
  if (!r.schoolAccounts) r.schoolAccounts = {};
  return r;
}

function encryptionAvailable() {
  return !!datacrypto.loadKey();
}

function getRecord(familyId) {
  return root().schoolAccounts[familyId] || null;
}

function hasAccount(familyId) {
  const rec = getRecord(familyId);
  return !!(rec && rec.blob);
}

// Stores {username, password} ENCRYPTED. Returns { ok: true } or
// { ok: false, error } — never writes plaintext, ever.
function saveCredentials(familyId, parentUserId, { username, password }) {
  if (!familyId) return { ok: false, error: "Missing family." };
  const key = datacrypto.loadKey();
  if (!key) {
    return { ok: false, error: "School account connection is not available (encryption is not configured on this server)." };
  }
  const u = String(username || "").trim();
  const p = String(password || "");
  if (!u || !p) return { ok: false, error: "Username and password are required." };

  const plaintext = JSON.stringify({ username: u, password: p });
  const blob = datacrypto.encrypt(plaintext, key);

  const r = root();
  const existing = r.schoolAccounts[familyId];
  r.schoolAccounts[familyId] = {
    parentUserId,
    blob,
    updatedAt: new Date().toISOString(),
    kidMappings: (existing && existing.kidMappings) || {},
  };
  db.persist();
  return { ok: true };
}

// Decrypts and returns {username, password} for transient in-memory use
// (a single Moodle login attempt). Returns null if no account or
// encryption unavailable/blob unreadable. NEVER logs the result — callers
// must not log it either.
function getCredentials(familyId) {
  const rec = getRecord(familyId);
  if (!rec || !rec.blob) return null;
  const key = datacrypto.loadKey();
  if (!key) return null;
  try {
    const json = datacrypto.decrypt(rec.blob, key);
    const parsed = JSON.parse(json);
    if (!parsed || !parsed.username || !parsed.password) return null;
    return parsed;
  } catch (e) {
    // Wrong/rotated key or corrupted blob — never surface ciphertext or the
    // underlying crypto error message (could leak internals); treat as absent.
    return null;
  }
}

function deleteAccount(familyId) {
  const r = root();
  if (!r.schoolAccounts[familyId]) return { ok: true, deleted: false };
  delete r.schoolAccounts[familyId];
  db.persist();
  return { ok: true, deleted: true };
}

// ---------- kid -> Moodle user id mapping ----------
// Mappings are not secret (just an internal Moodle numeric id) so they live
// alongside the encrypted blob unencrypted, same as other family metadata.
function setMoodleUserId(familyId, kidId, moodleUserId) {
  if (!familyId || !kidId) return { ok: false, error: "Missing family or kid." };
  const id = String(moodleUserId || "").trim();
  if (!/^\d+$/.test(id)) return { ok: false, error: "Moodle user id must be numeric." };
  const r = root();
  if (!r.schoolAccounts[familyId]) {
    // A mapping may be saved before credentials exist yet is unusual but not
    // harmful — keep the record shape consistent either way.
    r.schoolAccounts[familyId] = { parentUserId: null, blob: null, updatedAt: null, kidMappings: {} };
  }
  if (!r.schoolAccounts[familyId].kidMappings) r.schoolAccounts[familyId].kidMappings = {};
  r.schoolAccounts[familyId].kidMappings[kidId] = id;
  db.persist();
  return { ok: true, kidId, moodleUserId: id };
}

function getMoodleUserId(familyId, kidId) {
  const rec = getRecord(familyId);
  return (rec && rec.kidMappings && rec.kidMappings[kidId]) || null;
}

function listKidMappings(familyId) {
  const rec = getRecord(familyId);
  if (!rec || !rec.kidMappings) return [];
  return Object.entries(rec.kidMappings).map(([kidId, moodleUserId]) => ({ kidId, moodleUserId }));
}

module.exports = {
  encryptionAvailable,
  hasAccount,
  saveCredentials,
  getCredentials,
  deleteAccount,
  setMoodleUserId,
  getMoodleUserId,
  listKidMappings,
};

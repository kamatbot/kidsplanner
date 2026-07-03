"use strict";
/**
 * Passkey account-recovery backup codes.
 *
 * A passkey-only app has no password to fall back on, so each account is issued
 * a one-time set of recovery codes at sign-up. We store ONLY a salted scrypt
 * hash of each code on the user record — the plaintext is shown to the user once
 * and is never recoverable. All comparisons are constant-time.
 *
 * User-record shape (added under `user.backupCodes`):
 *   { salt: <hex>, codes: [{ hash: <hex>, used: false }], createdAt: <iso> }
 */
const crypto = require("crypto");

// 10 codes per account — enough to survive several lost devices without being a
// chore to store. Each code is two 5-char groups: XXXXX-XXXXX.
const CODE_COUNT = 10;
const GROUP_LEN = 5;
const GROUPS = 2;
// Unambiguous base32-ish alphabet: no 0/O/1/I/L so codes survive being read off
// a screen or written down by hand. Matches the referral-code alphabet's intent.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SCRYPT_KEYLEN = 32;

// Draw one random group of GROUP_LEN unbiased chars from ALPHABET.
function randomGroup() {
  let out = "";
  while (out.length < GROUP_LEN) {
    const b = crypto.randomBytes(1)[0];
    // Reject values in the biased tail so every glyph is equally likely.
    if (b >= 256 - (256 % ALPHABET.length)) continue;
    out += ALPHABET[b % ALPHABET.length];
  }
  return out;
}

function generatePlaintextCode() {
  const groups = [];
  for (let i = 0; i < GROUPS; i++) groups.push(randomGroup());
  return groups.join("-");
}

// Strip spaces/dashes and uppercase so "abcde-12345", "ABCDE 12345" and
// "ABCDE12345" all hash identically. Map look-alikes a user might mistype.
function normalize(code) {
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0").replace(/0/g, "") // collapse O→(dropped) — 0 isn't in the alphabet
    .replace(/[IL]/g, "1").replace(/1/g, ""); // collapse I/L — 1 isn't in the alphabet
}

// scrypt hash of a normalized code under the per-user salt, returned as hex.
function hashCode(code, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  return crypto.scryptSync(normalize(code), salt, SCRYPT_KEYLEN).toString("hex");
}

// Generate a fresh set: returns { plaintext: [..10..], record } where `record`
// is what gets stored on the user (no plaintext anywhere inside it).
function generateSet() {
  const salt = crypto.randomBytes(16).toString("hex");
  const plaintext = [];
  const codes = [];
  for (let i = 0; i < CODE_COUNT; i++) {
    const code = generatePlaintextCode();
    plaintext.push(code);
    codes.push({ hash: hashCode(code, salt), used: false });
  }
  return {
    plaintext,
    record: { salt, codes, createdAt: new Date().toISOString() },
  };
}

// Count how many codes on a record are still unused — surfaced to the UI so the
// user knows when they're running low and should regenerate.
function remaining(record) {
  if (!record || !Array.isArray(record.codes)) return 0;
  return record.codes.reduce((n, c) => n + (c.used ? 0 : 1), 0);
}

// Constant-time hex compare. Equal-length hex hashes only, so no length leak.
function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch (e) {
    return false;
  }
}

// Find the index of an UNUSED code on a user's backup record that matches the
// supplied plaintext, comparing every entry in constant time (no short-circuit
// on the first match, so timing doesn't reveal which slot matched). Returns the
// matching index or -1.
function matchIndex(record, code) {
  if (!record || !Array.isArray(record.codes) || !record.salt) return -1;
  const candidate = hashCode(code, record.salt);
  let found = -1;
  for (let i = 0; i < record.codes.length; i++) {
    const entry = record.codes[i];
    const eq = timingSafeEqualHex(candidate, entry.hash);
    if (eq && !entry.used && found === -1) found = i;
  }
  return found;
}

module.exports = {
  CODE_COUNT,
  generateSet,
  normalize,
  hashCode,
  matchIndex,
  remaining,
  timingSafeEqualHex,
};

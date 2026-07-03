"use strict";
/**
 * Encryption-at-rest for the user datastore.
 *
 * The whole `db.json` blob is encrypted with AES-256-GCM (authenticated: it
 * detects tampering as well as protecting confidentiality). The 32-byte key is
 * read from the DATA_ENCRYPTION_KEY env var — it lives in the server's
 * environment, NOT in the data directory, so a stolen data file / backup is
 * useless without it.
 *
 * Threat model: protects user data if the db file (or a backup/disk image) is
 * exfiltrated without the key. It does NOT defend against an attacker who gains
 * full code execution on the running server — that process necessarily holds the
 * key in memory to run simulations. (True zero-knowledge would require deriving
 * the key from a user secret the server never sees, which is incompatible with
 * passkey auth + server-side Monte Carlo.)
 *
 * On-disk format:  "ENC1:" + base64( iv[12] | authTag[16] | ciphertext )
 * Pure Node `crypto` — no native deps, safe for shared hosting.
 */
const crypto = require("crypto");

const MAGIC = "ENC1:";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

let _key;
let _loaded = false;

// Read + validate the key once. Accepts 64 hex chars or base64 (decoding to 32
// bytes). Returns a Buffer, or null when encryption is not configured. Throws on
// a present-but-malformed key so a misconfiguration fails loudly at first use
// rather than silently writing plaintext.
function loadKey() {
  if (_loaded) return _key;
  _loaded = true;
  const raw = (process.env.DATA_ENCRYPTION_KEY || "").trim();
  if (!raw) { _key = null; return _key; }
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, "hex");
  else key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("DATA_ENCRYPTION_KEY must decode to 32 bytes (64 hex chars, or base64). Got " + key.length + " bytes.");
  }
  _key = key;
  return _key;
}

// Test seam: forget any cached key (so a test can change the env between cases).
function _resetKeyCache() { _key = undefined; _loaded = false; }

function isEncrypted(text) {
  return typeof text === "string" && text.startsWith(MAGIC);
}

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return MAGIC + Buffer.concat([iv, tag, ct]).toString("base64");
}

function decrypt(text, key) {
  const buf = Buffer.from(text.slice(MAGIC.length), "base64");
  if (buf.length < IV_LEN + TAG_LEN) throw new Error("ciphertext too short");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// Generate a fresh key (hex) — used by scripts/gen-encryption-key.js.
function generateKey() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = { MAGIC, loadKey, isEncrypted, encrypt, decrypt, generateKey, _resetKeyCache };

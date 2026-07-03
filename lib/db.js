"use strict";
/**
 * Tiny JSON file datastore. Pure JS, no native deps — safe for shared Node
 * hosting (Hostinger). Writes are atomic (write temp + rename) and serialized
 * through an in-memory promise chain so concurrent requests don't clobber.
 *
 * The datastore lives in a PERSISTENT directory outside the app folder (see
 * ./paths) so redeploying a new build never wipes user data.
 */
const fs = require("fs");
const { ensureDataDir, dataFile, migrateLegacy } = require("./paths");
const datacrypto = require("./datacrypto");

const DB_FILE = dataFile("db.json");

function ensureDir() {
  ensureDataDir();
}

let cache = null;

// Serialize + (if a key is configured) encrypt the in-memory cache for disk.
// When no key is set we fall back to plaintext so existing/dev deployments keep
// working — but a configured key means every write is ciphertext.
function serializeForDisk() {
  const json = JSON.stringify(cache);
  const key = datacrypto.loadKey();
  return key ? datacrypto.encrypt(json, key) : json;
}

function load() {
  if (cache) return cache;
  // First boot after switching to the persistent build: pull any legacy in-app
  // data across before reading.
  migrateLegacy("db.json");
  ensureDir();
  if (!fs.existsSync(DB_FILE)) {
    cache = { users: {} };
    return cache;
  }
  const raw = fs.readFileSync(DB_FILE, "utf8");
  let text = raw;
  if (datacrypto.isEncrypted(raw)) {
    const key = datacrypto.loadKey();
    // The file is encrypted but we can't read it. NEVER fall through to an empty
    // cache — the next write would overwrite real (recoverable) data. Halt so the
    // operator can fix the key instead of silently destroying the datastore.
    if (!key) {
      throw new Error("db.json is encrypted but DATA_ENCRYPTION_KEY is not set. Refusing to start (set the key to avoid data loss).");
    }
    try {
      text = datacrypto.decrypt(raw, key);
    } catch (e) {
      throw new Error("Failed to decrypt db.json — wrong DATA_ENCRYPTION_KEY or the file was tampered/corrupted. Refusing to start.");
    }
  }
  try {
    cache = JSON.parse(text);
  } catch (e) {
    // A non-empty file that won't parse is a corruption we must not paper over by
    // resetting to empty (that loses data on the next write). The empty-cache path
    // is only for a genuinely absent file (handled above).
    throw new Error("db.json exists but could not be parsed. Refusing to start to avoid overwriting it.");
  }
  if (!cache.users) cache.users = {};
  // Activation upgrade: a key is configured but the file on disk is still
  // plaintext → rewrite it as ciphertext now, rather than waiting for the next
  // user-driven write. Same data, just re-serialized encrypted.
  if (datacrypto.loadKey() && !datacrypto.isEncrypted(raw)) persist();
  return cache;
}

// Coalesced async writes: a burst of persist() calls collapses into a single
// serialize+write of the latest in-memory state, instead of one full
// JSON.stringify + disk write per mutation. Compact (no pretty-print) so the
// snapshot is smaller and faster to encode.
let dirty = false;
let flushing = false;

function doFlush() {
  flushing = true;
  dirty = false;
  const snapshot = serializeForDisk();
  ensureDir();
  const tmp = DB_FILE + "." + process.pid + ".tmp";
  fs.writeFile(tmp, snapshot, (err) => {
    const done = () => {
      flushing = false;
      if (dirty) setTimeout(doFlush, 0); // newer changes arrived mid-write
    };
    if (err) return done();
    fs.rename(tmp, DB_FILE, done);
  });
}

function persist() {
  dirty = true;
  if (!flushing) setTimeout(doFlush, 0);
}

// Best-effort synchronous flush so an in-flight change isn't lost on shutdown.
function flushSync() {
  if (!dirty && !flushing) return;
  try {
    ensureDir();
    // Write to a temp file then atomically rename, matching doFlush(). Writing
    // straight to DB_FILE means a crash mid-write (shutdown is exactly when this
    // runs) leaves a truncated datastore — which the boot path then refuses to
    // load, taking every user down. rename() is atomic on the same filesystem.
    const tmp = DB_FILE + "." + process.pid + ".sync.tmp";
    fs.writeFileSync(tmp, serializeForDisk());
    fs.renameSync(tmp, DB_FILE);
    dirty = false;
  } catch (e) {
    /* ignore */
  }
}
process.on("exit", flushSync);
process.on("SIGTERM", () => { flushSync(); process.exit(0); });
process.on("SIGINT", () => { flushSync(); process.exit(0); });

// Peek at the on-disk file's magic prefix to report whether the datastore is
// currently ciphertext — for a health/status check. Reads 8 bytes; decrypts
// nothing, exposes no data.
function isFileEncrypted() {
  try {
    const fd = fs.openSync(DB_FILE, "r");
    const buf = Buffer.alloc(8);
    const n = fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    return datacrypto.isEncrypted(buf.subarray(0, n).toString("utf8"));
  } catch (e) {
    return false;
  }
}

module.exports = { load, persist, flushSync, DB_FILE, isFileEncrypted };

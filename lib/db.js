"use strict";
/**
 * Tiny JSON file datastore. Pure JS, no native deps — safe for shared Node
 * hosting (Hostinger). Writes are atomic (write temp + rename) and serialized
 * through one in-process writer so concurrent requests don't clobber.
 *
 * The datastore lives in a PERSISTENT directory outside the app folder (see
 * ./paths) so redeploying a new build never wipes user data.
 */
const fs = require("fs");
const { ensureDataDir, dataFile, migrateLegacy } = require("./paths");
const datacrypto = require("./datacrypto");

const DB_FILE = dataFile("db.json");
const RETRY_MS = Math.max(10, Number(process.env.DB_WRITE_RETRY_MS) || 1000);

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

// Coalesced async writes. The previous implementation only set `flushing`
// inside the setTimeout callback, so a burst of persist() calls queued multiple
// writers against the same temp file. It also cleared `dirty` before I/O and
// silently forgot failed writes. Keep one scheduled/in-flight writer, track
// mutation generations, and retain failed work until a retry succeeds.
let dirty = false;
let flushScheduled = false;
let flushing = false;
let retryTimer = null;
let mutationGeneration = 0;
let committedGeneration = 0;
let tmpSequence = 0;
let lastWriteError = null;
let lastWriteErrorAt = null;

function uniqueTmp(suffix = "tmp") {
  tmpSequence += 1;
  return `${DB_FILE}.${process.pid}.${tmpSequence}.${suffix}`;
}

function scheduleFlush(delayMs = 0) {
  if (flushing || flushScheduled) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (delayMs > 0) {
    retryTimer = setTimeout(() => {
      retryTimer = null;
      scheduleFlush(0);
    }, delayMs);
    if (retryTimer.unref) retryTimer.unref();
    return;
  }
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    doFlush();
  }, 0);
}

function finishFlush({ generation, error = null }) {
  flushing = false;
  if (error) {
    // The snapshot never became durable. Keep the datastore dirty even if no
    // newer mutation arrived, surface the failure in status(), and retry with
    // a short delay instead of spinning the event loop on a full/read-only disk.
    dirty = true;
    lastWriteError = error.message || String(error);
    lastWriteErrorAt = new Date().toISOString();
    scheduleFlush(RETRY_MS);
    return;
  }
  committedGeneration = Math.max(committedGeneration, generation);
  lastWriteError = null;
  lastWriteErrorAt = null;
  dirty = mutationGeneration > committedGeneration;
  if (dirty) scheduleFlush(0);
}

function doFlush() {
  if (flushing || !dirty) return;
  flushing = true;
  const generation = mutationGeneration;
  const snapshot = serializeForDisk();
  // New writes after this point set dirty=true through persist(); the current
  // snapshot may still commit safely, then the newer generation is flushed next.
  dirty = false;
  ensureDir();
  const tmp = uniqueTmp();
  fs.writeFile(tmp, snapshot, (writeErr) => {
    if (writeErr) return finishFlush({ generation, error: writeErr });

    // A synchronous shutdown/test flush may have committed a newer generation
    // while this write was in flight. Never rename an older snapshot over it.
    if (generation < committedGeneration) {
      fs.unlink(tmp, () => finishFlush({ generation: committedGeneration }));
      return;
    }

    fs.rename(tmp, DB_FILE, (renameErr) => {
      if (renameErr) {
        fs.unlink(tmp, () => {});
        return finishFlush({ generation, error: renameErr });
      }
      finishFlush({ generation });
    });
  });
}

function persist() {
  mutationGeneration += 1;
  dirty = true;
  scheduleFlush(0);
}

// Best-effort synchronous flush so an in-flight change isn't lost on shutdown.
// A unique temp file plus generation fencing prevents an older async snapshot
// from overwriting this newer synchronous commit if flushSync() is invoked in
// tests or another non-exit path.
function flushSync() {
  if (!dirty && !flushing && mutationGeneration <= committedGeneration) return;
  try {
    ensureDir();
    const generation = mutationGeneration;
    const tmp = uniqueTmp("sync.tmp");
    fs.writeFileSync(tmp, serializeForDisk());
    fs.renameSync(tmp, DB_FILE);
    committedGeneration = Math.max(committedGeneration, generation);
    dirty = mutationGeneration > committedGeneration;
    lastWriteError = null;
    lastWriteErrorAt = null;
  } catch (e) {
    dirty = true;
    lastWriteError = e.message || String(e);
    lastWriteErrorAt = new Date().toISOString();
  }
}
process.on("exit", flushSync);
process.on("SIGTERM", () => { flushSync(); process.exit(0); });
process.on("SIGINT", () => { flushSync(); process.exit(0); });

function persistenceStatus() {
  return {
    dirty,
    flushing,
    scheduled: flushScheduled || !!retryTimer,
    mutationGeneration,
    committedGeneration,
    lastWriteError,
    lastWriteErrorAt,
  };
}

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

module.exports = { load, persist, flushSync, persistenceStatus, DB_FILE, isFileEncrypted };

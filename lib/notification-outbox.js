"use strict";
/**
 * Durable notification delivery queue.
 *
 * User-facing mutations (especially chat sends) should complete after their
 * own data is committed, not after APNs/Web Push network calls. At the same
 * time, simply dropping `await` makes notifications disappear on a process
 * restart. This outbox records delivery intent first, acknowledges the request,
 * and retries delivery independently.
 *
 * SQLite is the normal backend because FamETC already ships better-sqlite3 for
 * chat. A JSON fallback keeps degraded hosts functional and durable, though it
 * uses db.flushSync() on enqueue and should therefore be treated as a fallback,
 * not the performance path.
 */
const crypto = require("crypto");
const db = require("./db");
const datacrypto = require("./datacrypto");
const { ensureDataDir, dataFile } = require("./paths");

const MAX_BATCH = 20;
const MAX_ATTEMPTS = 20;
const BASE_RETRY_MS = 1000;
const MAX_RETRY_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let delivery = null;
let running = false;
let kickTimer = null;
let sqlite = null;
let backend = "json";

try {
  const Database = require("better-sqlite3");
  ensureDataDir();
  sqlite = new Database(dataFile("notification-outbox.sqlite"));
  sqlite.pragma("journal_mode = WAL");
  // The outbox is itself the durability boundary for notification intent.
  sqlite.pragma("synchronous = FULL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS notification_outbox (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload_enc TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notification_outbox_due
      ON notification_outbox(next_at, created_at);
  `);
  backend = "sqlite";
} catch (error) {
  console.warn("[notifications] durable SQLite outbox unavailable; using JSON fallback:", error.message);
}

function payloadEncode(payload) {
  const json = JSON.stringify(payload);
  const key = datacrypto.loadKey();
  return key ? datacrypto.encrypt(json, key) : json;
}

function payloadDecode(value) {
  let text = value;
  const key = datacrypto.loadKey();
  if (datacrypto.isEncrypted(text)) {
    if (!key) throw new Error("Encrypted notification outbox cannot be read without DATA_ENCRYPTION_KEY.");
    text = datacrypto.decrypt(text, key);
  }
  return JSON.parse(text);
}

function jsonRoot() {
  const root = db.load();
  if (!Array.isArray(root.notificationOutbox)) root.notificationOutbox = [];
  return root;
}

function newId(kind, dedupeKey) {
  if (dedupeKey) {
    return "no_" + crypto.createHash("sha256").update(`${kind}:${dedupeKey}`).digest("hex").slice(0, 32);
  }
  return "no_" + crypto.randomBytes(16).toString("hex");
}

function enqueue(kind, payload, { dedupeKey } = {}) {
  if (!kind || !payload || typeof payload !== "object") throw new Error("Notification kind and payload are required.");
  const id = newId(String(kind), dedupeKey ? String(dedupeKey) : null);
  const now = Date.now();
  const encoded = payloadEncode(payload);

  if (sqlite) {
    sqlite.prepare(`
      INSERT OR IGNORE INTO notification_outbox
        (id, kind, payload_enc, attempts, next_at, created_at, last_error)
      VALUES (?, ?, ?, 0, ?, ?, NULL)
    `).run(id, String(kind), encoded, now, now);
  } else {
    const root = jsonRoot();
    if (!root.notificationOutbox.some((item) => item.id === id)) {
      root.notificationOutbox.push({
        id,
        kind: String(kind),
        payloadEnc: encoded,
        attempts: 0,
        nextAt: now,
        createdAt: now,
        lastError: null,
      });
      db.persist();
      // JSON fallback must make the enqueue durable before its caller returns.
      db.flushSync();
    }
  }
  kick();
  return { id, backend };
}

function dueRows(now = Date.now()) {
  if (sqlite) {
    return sqlite.prepare(`
      SELECT id, kind, payload_enc AS payloadEnc, attempts,
             next_at AS nextAt, created_at AS createdAt, last_error AS lastError
      FROM notification_outbox
      WHERE next_at <= ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(now, MAX_BATCH);
  }
  return jsonRoot().notificationOutbox
    .filter((item) => Number(item.nextAt) <= now)
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt))
    .slice(0, MAX_BATCH);
}

function removeRow(id) {
  if (sqlite) {
    sqlite.prepare("DELETE FROM notification_outbox WHERE id = ?").run(id);
    return;
  }
  const root = jsonRoot();
  const before = root.notificationOutbox.length;
  root.notificationOutbox = root.notificationOutbox.filter((item) => item.id !== id);
  if (root.notificationOutbox.length !== before) db.persist();
}

function retryRow(row, error) {
  const attempts = Number(row.attempts || 0) + 1;
  const expired = Date.now() - Number(row.createdAt || 0) > MAX_AGE_MS;
  if (attempts >= MAX_ATTEMPTS || expired) {
    console.error(`[notifications] dropping outbox item ${row.id} after ${attempts} attempts`);
    removeRow(row.id);
    return;
  }
  const delay = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * (2 ** Math.min(attempts - 1, 8)));
  const nextAt = Date.now() + delay;
  const lastError = String(error && error.message || error || "notification delivery failed").slice(0, 300);
  if (sqlite) {
    sqlite.prepare(`
      UPDATE notification_outbox
      SET attempts = ?, next_at = ?, last_error = ?
      WHERE id = ?
    `).run(attempts, nextAt, lastError, row.id);
    return;
  }
  const item = jsonRoot().notificationOutbox.find((entry) => entry.id === row.id);
  if (item) {
    item.attempts = attempts;
    item.nextAt = nextAt;
    item.lastError = lastError;
    db.persist();
  }
}

async function deliverRow(row) {
  if (!delivery || typeof delivery[row.kind] !== "function") {
    throw new Error(`No notification outbox delivery handler for ${row.kind}`);
  }
  const payload = payloadDecode(row.payloadEnc);
  await delivery[row.kind](payload);
}

async function drain() {
  if (running || !delivery) return;
  running = true;
  try {
    for (;;) {
      const rows = dueRows();
      if (!rows.length) break;
      for (const row of rows) {
        try {
          await deliverRow(row);
          removeRow(row.id);
        } catch (error) {
          retryRow(row, error);
        }
      }
      if (rows.length < MAX_BATCH) break;
    }
  } finally {
    running = false;
    scheduleNext();
  }
}

function kick(delay = 0) {
  if (!delivery || kickTimer || running) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    drain().catch((error) => console.error("[notifications] outbox drain failed:", error.message));
  }, delay);
  if (kickTimer.unref) kickTimer.unref();
}

function nextDueAt() {
  if (sqlite) {
    const row = sqlite.prepare("SELECT MIN(next_at) AS nextAt FROM notification_outbox").get();
    return row && row.nextAt != null ? Number(row.nextAt) : null;
  }
  const rows = jsonRoot().notificationOutbox;
  if (!rows.length) return null;
  return Math.min(...rows.map((item) => Number(item.nextAt) || Date.now()));
}

function scheduleNext() {
  const nextAt = nextDueAt();
  if (nextAt == null) return;
  kick(Math.max(0, Math.min(MAX_RETRY_MS, nextAt - Date.now())));
}

function configure(handlers) {
  delivery = Object.assign({}, handlers || {});
  kick();
}

function status() {
  let pending = 0;
  if (sqlite) {
    pending = sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n;
  } else {
    pending = jsonRoot().notificationOutbox.length;
  }
  return { backend, pending, running };
}

function closeForTest() {
  if (kickTimer) clearTimeout(kickTimer);
  kickTimer = null;
  delivery = null;
  if (sqlite) {
    try { sqlite.close(); } catch (_) {}
  }
}

module.exports = { enqueue, configure, drain, status, closeForTest };

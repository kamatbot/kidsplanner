"use strict";
/**
 * SQLite-backed chat message storage (better-sqlite3). Pure storage: no
 * business rules (those stay in lib/chat.js, which chooses this module or the
 * legacy JSON-backed path at load time — see lib/chat.js for the fallback).
 *
 * Encryption at rest mirrors lib/db.js's policy exactly: when
 * DATA_ENCRYPTION_KEY is configured, the message body and card are stored as
 * datacrypto ciphertext; when keyless (dev), plaintext — same fallback, not a
 * new policy. Only body/card are encrypted; id/family_id/sender/created_at
 * stay plain so they can be indexed and ordered.
 */
const Database = require("better-sqlite3");
const { ensureDataDir, dataFile } = require("./paths");
const datacrypto = require("./datacrypto");

ensureDataDir();
const db = new Database(dataFile("chat.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    sender_type TEXT,
    sender_id TEXT,
    posted_by TEXT,
    body_enc TEXT NOT NULL,
    card_enc TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_family_created ON messages(family_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_family_id ON messages(family_id, id);
`);

// body_enc carries everything except id/familyId/senderType/senderId/
// postedByUserId/createdAt/card (those are columns or card_enc) — text, media,
// and the delete/flag tombstone fields.
function encJson(obj) {
  const json = JSON.stringify(obj === undefined ? null : obj);
  const key = datacrypto.loadKey();
  return key ? datacrypto.encrypt(json, key) : json;
}
function decJson(text) {
  if (text === null || text === undefined) return null;
  const key = datacrypto.loadKey();
  const raw = key && datacrypto.isEncrypted(text) ? datacrypto.decrypt(text, key) : text;
  return JSON.parse(raw);
}

function bodyOf(msg) {
  return {
    text: msg.text,
    media: msg.media,
    deleted: msg.deleted,
    deletedBy: msg.deletedBy,
    flagged: msg.flagged,
    flagReason: msg.flagReason,
    flaggedBy: msg.flaggedBy,
  };
}

function rowToMessage(row) {
  const body = decJson(row.body_enc) || {};
  return {
    id: row.id,
    familyId: row.family_id,
    senderType: row.sender_type,
    senderId: row.sender_id,
    postedByUserId: row.posted_by,
    text: body.text || "",
    card: decJson(row.card_enc),
    media: body.media || null,
    createdAt: row.created_at,
    deleted: !!body.deleted,
    deletedBy: body.deletedBy || null,
    flagged: !!body.flagged,
    flagReason: body.flagReason || null,
    flaggedBy: body.flaggedBy || null,
  };
}

const insertStmt = db.prepare(`
  INSERT INTO messages (id, family_id, sender_type, sender_id, posted_by, body_enc, card_enc, created_at)
  VALUES (@id, @family_id, @sender_type, @sender_id, @posted_by, @body_enc, @card_enc, @created_at)
`);
const updateStmt = db.prepare(`UPDATE messages SET body_enc = @body_enc, card_enc = @card_enc WHERE id = @id`);
const getStmt = db.prepare(`SELECT * FROM messages WHERE family_id = ? AND id = ?`);
// Ordered by rowid (insertion order), NOT created_at: two messages can land in
// the same createdAt millisecond, and createdAt/id (id is random, not
// sortable) would then tie-break arbitrarily — breaking the insertion-order
// guarantee the JSON-array backend gives for free. rowid is monotonic
// per-insert regardless of clock resolution.
const listAllStmt = db.prepare(`SELECT * FROM messages WHERE family_id = ? ORDER BY rowid ASC`);
const listSinceStmt = db.prepare(`SELECT * FROM messages WHERE family_id = ? AND created_at > ? ORDER BY rowid ASC`);
const anchorRowidStmt = db.prepare(`SELECT rowid FROM messages WHERE id = ?`);
const listAfterRowidStmt = db.prepare(`SELECT * FROM messages WHERE family_id = ? AND rowid > ? ORDER BY rowid ASC`);
const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM messages`);

function insert(msg) {
  insertStmt.run({
    id: msg.id,
    family_id: msg.familyId,
    sender_type: msg.senderType,
    sender_id: msg.senderId,
    posted_by: msg.postedByUserId || null,
    body_enc: encJson(bodyOf(msg)),
    card_enc: msg.card ? encJson(msg.card) : null,
    created_at: msg.createdAt,
  });
}

function update(msg) {
  updateStmt.run({
    id: msg.id,
    body_enc: encJson(bodyOf(msg)),
    card_enc: msg.card ? encJson(msg.card) : null,
  });
}

function get(familyId, id) {
  const row = getStmt.get(familyId, id);
  return row ? rowToMessage(row) : null;
}

// Ascending, optionally filtered to createdAt strictly after `since` — mirrors
// the legacy JSON `since` filter exactly (capping is the caller's job).
function list(familyId, since) {
  const rows = since ? listSinceStmt.all(familyId, since) : listAllStmt.all(familyId);
  return rows.map(rowToMessage);
}

// Position-based cursor (by id, not by value comparison — message ids are
// random, not sortable) using SQLite's implicit rowid, which is assigned in
// insertion order. Unknown/empty afterId returns the full list, same as no
// cursor — a client with a stale/foreign cursor just catches up fully.
function listAfterId(familyId, afterId) {
  if (!afterId) return list(familyId);
  const anchor = anchorRowidStmt.get(afterId);
  if (!anchor) return list(familyId);
  return listAfterRowidStmt.all(familyId, anchor.rowid).map(rowToMessage);
}

function isEmpty() {
  return countStmt.get().n === 0;
}

// Test seam: force WAL contents into the main db file so a test can read the
// file bytes and see current data (WAL mode otherwise buffers writes in the
// -wal file until a checkpoint happens naturally).
function _checkpointForTest() {
  db.pragma("wal_checkpoint(FULL)");
}

module.exports = { insert, update, get, list, listAfterId, isEmpty, _checkpointForTest, DB_FILE: dataFile("chat.sqlite") };

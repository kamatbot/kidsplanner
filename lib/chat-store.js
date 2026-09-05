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

const STORE_PAGE_CAP = 200;
function boundedLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return STORE_PAGE_CAP;
  return Math.min(STORE_PAGE_CAP, Math.floor(n));
}

// body_enc carries everything except id/familyId/senderType/senderId/
// postedByUserId/createdAt/card (those are columns or card_enc) — text, media,
// buzz, the optional sender display name, and the delete/flag tombstone fields.
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
  const body = {
    text: msg.text,
    media: msg.media,
    buzz: msg.buzz === true,
    deleted: msg.deleted,
    deletedBy: msg.deletedBy,
    flagged: msg.flagged,
    flagReason: msg.flagReason,
    flaggedBy: msg.flaggedBy,
  };
  if (msg.senderName) body.senderName = msg.senderName;
  return body;
}

function rowToMessage(row) {
  const body = decJson(row.body_enc) || {};
  const message = {
    id: row.id,
    familyId: row.family_id,
    senderType: row.sender_type,
    senderId: row.sender_id,
    postedByUserId: row.posted_by,
    text: body.text || "",
    card: decJson(row.card_enc),
    media: body.media || null,
    buzz: body.buzz === true,
    createdAt: row.created_at,
    deleted: !!body.deleted,
    deletedBy: body.deletedBy || null,
    flagged: !!body.flagged,
    flagReason: body.flagReason || null,
    flaggedBy: body.flaggedBy || null,
  };
  if (body.senderName) message.senderName = body.senderName;
  return message;
}

const insertStmt = db.prepare(`
  INSERT INTO messages (id, family_id, sender_type, sender_id, posted_by, body_enc, card_enc, created_at)
  VALUES (@id, @family_id, @sender_type, @sender_id, @posted_by, @body_enc, @card_enc, @created_at)
`);
const updateStmt = db.prepare(`UPDATE messages SET body_enc = @body_enc, card_enc = @card_enc WHERE id = @id`);
const getStmt = db.prepare(`SELECT * FROM messages WHERE family_id = ? AND id = ?`);
// Return only the requested rolling window from SQLite. The old implementation
// selected every row for a family, decrypted every body/card, and only then let
// lib/chat.js slice to 50/200. For a long-lived family that made every poll O(N).
// Query newest-first for the rolling window, then reverse in memory so callers
// retain the established oldest->newest ordering.
const listAllStmt = db.prepare(`SELECT * FROM messages WHERE family_id = ? ORDER BY rowid DESC LIMIT ?`);
const listSinceStmt = db.prepare(`SELECT * FROM messages WHERE family_id = ? AND created_at > ? ORDER BY rowid DESC LIMIT ?`);
const anchorRowidStmt = db.prepare(`SELECT rowid FROM messages WHERE family_id = ? AND id = ?`);
const listAfterRowidStmt = db.prepare(`SELECT * FROM messages WHERE family_id = ? AND rowid > ? ORDER BY rowid ASC LIMIT ?`);
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

// Ascending, optionally filtered to createdAt strictly after `since`. SQL does
// the rolling-window limit before encrypted payloads are decoded.
function list(familyId, since, limit = STORE_PAGE_CAP) {
  const cap = boundedLimit(limit);
  const rows = since ? listSinceStmt.all(familyId, since, cap) : listAllStmt.all(familyId, cap);
  rows.reverse();
  return rows.map(rowToMessage);
}

// Position-based cursor (by id, not by value comparison — message ids are
// random, not sortable) using SQLite's implicit rowid, which is assigned in
// insertion order. Unknown/empty afterId returns the rolling window instead of
// the entire history. The anchor is family-scoped so a foreign room id cannot
// influence the cursor position for this family.
function listAfterId(familyId, afterId, limit = STORE_PAGE_CAP) {
  const cap = boundedLimit(limit);
  if (!afterId) return list(familyId, null, cap);
  const anchor = anchorRowidStmt.get(familyId, afterId);
  if (!anchor) return list(familyId, null, cap);
  return listAfterRowidStmt.all(familyId, anchor.rowid, cap).map(rowToMessage);
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

module.exports = { insert, update, get, list, listAfterId, isEmpty, _checkpointForTest, DB_FILE: dataFile("chat.sqlite"), STORE_PAGE_CAP };

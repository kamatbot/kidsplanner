"use strict";
// Small, additive quota index. Attachment bytes and encrypted sidecars remain
// the source of truth. Import legacy sidecars once, transactionally; never scan
// the directory in an upload/download handler. Failed writes keep reservations
// conservative until rollback or the bounded maintenance sweep.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
let connection = null;
let directory = null;

function open(dir, readMeta) {
  if (connection && directory === dir) return connection;
  if (connection) connection.close();
  connection = null;
  directory = null;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const sql = new Database(path.join(dir, "quota-index.sqlite"));
  try {
    sql.pragma("journal_mode = WAL");
    sql.pragma("synchronous = FULL");
    sql.pragma("busy_timeout = 5000");
    sql.exec(`
      CREATE TABLE IF NOT EXISTS attachment_index (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL, claimed INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS attachment_index_unclaimed ON attachment_index(claimed, created_at);
      CREATE TABLE IF NOT EXISTS attachment_usage (scope TEXT PRIMARY KEY, bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS attachment_index_version (version INTEGER PRIMARY KEY);
      CREATE TRIGGER IF NOT EXISTS attachment_usage_add AFTER INSERT ON attachment_index BEGIN
        INSERT INTO attachment_usage VALUES (NEW.scope, NEW.bytes)
          ON CONFLICT(scope) DO UPDATE SET bytes = bytes + NEW.bytes;
        INSERT INTO attachment_usage VALUES ('', NEW.bytes)
          ON CONFLICT(scope) DO UPDATE SET bytes = bytes + NEW.bytes;
      END;
      CREATE TRIGGER IF NOT EXISTS attachment_usage_remove AFTER DELETE ON attachment_index BEGIN
        UPDATE attachment_usage SET bytes = bytes - OLD.bytes WHERE scope = OLD.scope OR scope = '';
      END;
    `);
    // The version marker and every imported row commit together. An interrupted
    // import restarts safely; errors must not silently reset quotas to zero.
    sql.transaction(() => {
      if (sql.prepare("SELECT 1 FROM attachment_index_version WHERE version = 1").get()) return;
      const insert = sql.prepare("INSERT OR IGNORE INTO attachment_index VALUES (?, ?, ?, ?, ?)");
      for (const name of fs.readdirSync(dir)) {
        if (!/^a_[0-9a-f]{36}\.meta$/.test(name)) continue;
        const meta = readMeta(name.slice(0, -5));
        if (!meta || !Number.isSafeInteger(meta.size) || meta.size < 0 || !meta.scopeKey) {
          throw new Error("Invalid attachment metadata; refusing to initialize attachment quotas.");
        }
        insert.run(meta.id, meta.scopeKey, meta.size, Date.parse(meta.createdAt) || 0, meta.claimedMessageId ? 1 : 0);
      }
      sql.prepare("INSERT INTO attachment_index_version VALUES (1)").run();
    }).immediate();
    connection = sql;
    directory = dir;
    return sql;
  } catch (error) { sql.close(); throw error; }
}

function usage(sql, scope) {
  const read = sql.prepare("SELECT bytes FROM attachment_usage WHERE scope = ?");
  return { total: read.get("")?.bytes || 0, scope: read.get(scope)?.bytes || 0 };
}

function reserve(sql, meta, limits) {
  sql.transaction(() => {
    const used = usage(sql, meta.scopeKey);
    if (used.total + meta.size > limits.total || used.scope + meta.size > limits.scope) {
      const error = new Error("Chat attachment storage is full.");
      error.code = "CHAT_ATTACHMENT_QUOTA";
      throw error;
    }
    sql.prepare("INSERT INTO attachment_index VALUES (?, ?, ?, ?, 0)")
      .run(meta.id, meta.scopeKey, meta.size, Date.parse(meta.createdAt));
  }).immediate();
}

function remove(sql, id) { sql.prepare("DELETE FROM attachment_index WHERE id = ?").run(id); }
function claim(sql, id) { sql.prepare("UPDATE attachment_index SET claimed = 1 WHERE id = ?").run(id); }
function unclaim(sql, id) { sql.prepare("UPDATE attachment_index SET claimed = 0 WHERE id = ?").run(id); }
function expired(sql, cutoff, limit = 100) {
  return sql.prepare("SELECT id FROM attachment_index WHERE claimed = 0 AND created_at < ? ORDER BY created_at LIMIT ?")
    .all(cutoff, limit).map((row) => row.id);
}
module.exports = { open, usage, reserve, remove, claim, unclaim, expired };

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fam-outbox-resilience-"));
const outbox = require("../lib/notification-outbox");
const Database = require("better-sqlite3");
test.after(() => outbox.closeForTest());

test("provider failure values remain pending, old failures become bounded dead letters", async () => {
  let calls = 0;
  outbox.configure({ test_delivery: async () => { calls++; return { sent: 0, failed: 1 }; } });
  const { id } = outbox.enqueue("test_delivery", { text: "secret-test-payload" });
  await outbox.drain();
  assert.equal(outbox.status().pending, 1);
  assert.equal(calls, 1);
  const sql = new Database(path.join(process.env.FAM_DATA_DIR, "notification-outbox.sqlite"));
  sql.prepare("UPDATE notification_outbox SET next_at = 0, created_at = 0 WHERE id = ?").run(id);
  await outbox.drain();
  assert.equal(calls, 1, "expired notifications are not sent to providers");
  assert.equal(outbox.status().pending, 0);
  assert.equal(outbox.status().deadLetters, 1);
  assert.equal(JSON.stringify(sql.prepare("SELECT * FROM notification_dead_letters").all()).includes("secret-test-payload"), false);
  sql.close();
});

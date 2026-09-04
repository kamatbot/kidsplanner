"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-outbox-test-"));

const outbox = require("../lib/notification-outbox");

test("notification outbox dedupes by message id and drains exactly once", async (t) => {
  t.after(() => outbox.closeForTest());

  const payload = { familyId: "f_test", messageId: "m_123", text: "hello" };
  outbox.enqueue("chat_message", payload, { dedupeKey: payload.messageId });
  outbox.enqueue("chat_message", payload, { dedupeKey: payload.messageId });

  assert.equal(outbox.status().pending, 1);

  const delivered = [];
  outbox.configure({
    chat_message: async (value) => {
      delivered.push(value);
    },
  });
  await outbox.drain();

  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0], payload);
  assert.equal(outbox.status().pending, 0);
});

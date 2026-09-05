"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-outbox-test-"));

const outbox = require("../lib/notification-outbox");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  let retryAttempts = 0;
  outbox.configure({
    chat_message: async (value) => {
      if (value.messageId === "m_retry") {
        retryAttempts += 1;
        throw new Error("temporary APNs failure");
      }
      delivered.push(value);
    },
  });
  outbox.enqueue("chat_message", { familyId: "f_test", messageId: "m_retry" });
  await outbox.drain();
  assert.equal(retryAttempts, 1);

  // The failed row scheduled a one-second retry. A new notification arriving
  // meanwhile must pre-empt that timer instead of being delayed behind it.
  outbox.enqueue("chat_message", { familyId: "f_test", messageId: "m_fresh" });
  await sleep(100);
  assert.equal(delivered.at(-1).messageId, "m_fresh");
});

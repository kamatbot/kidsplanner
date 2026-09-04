"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-chat-store-test-"));

const chatStore = require("../lib/chat-store");

function message(i) {
  return {
    id: `m_${String(i).padStart(18, "0")}`,
    familyId: "f_test",
    senderType: "parent",
    senderId: "u_parent",
    postedByUserId: "u_parent",
    text: `message ${i}`,
    card: null,
    createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
  };
}

test("SQLite chat storage applies rolling-window limits before returning messages", () => {
  for (let i = 1; i <= 300; i++) chatStore.insert(message(i));

  const latest50 = chatStore.list("f_test", null, 50);
  assert.equal(latest50.length, 50);
  assert.equal(latest50[0].text, "message 251");
  assert.equal(latest50.at(-1).text, "message 300");

  const after = chatStore.listAfterId("f_test", message(275).id, 10);
  assert.equal(after.length, 10);
  assert.equal(after[0].text, "message 276");
  assert.equal(after.at(-1).text, "message 285");

  const foreignCursor = chatStore.listAfterId("f_test", "m_999999999999999999", 25);
  assert.equal(foreignCursor.length, 25);
  assert.equal(foreignCursor[0].text, "message 276");
  assert.equal(foreignCursor.at(-1).text, "message 300");
});

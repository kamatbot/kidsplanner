"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-chat-page-test-"));

const store = require("../lib/store");
const family = require("../lib/family");
const chat = require("../lib/chat");

test("chat list limits are positive and capped before storage work", () => {
  const parent = store.createUser("page@example.com", "Pager");
  const fam = family.createFamily(parent.id, "Paging Family");

  for (let i = 0; i < 260; i++) {
    const result = chat.sendMessage(fam.id, {
      senderType: "parent",
      senderId: parent.id,
      postedByUserId: parent.id,
      text: `message ${i}`,
    });
    assert.ok(result.message);
  }

  assert.equal(chat.listMessages(fam.id, { limit: 50 }).length, 50);
  assert.equal(chat.listMessages(fam.id, { limit: -1 }).length, 200);
  assert.equal(chat.listMessages(fam.id, { limit: 999999 }).length, 200);
});

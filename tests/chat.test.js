"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-"));

const store = require("../lib/store");
const family = require("../lib/family");
const chat = require("../lib/chat");

function makeFamily() {
  const p1 = store.createUser("cp1@example.com", "Chat Parent One");
  const p2 = store.createUser("cp2@example.com", "Chat Parent Two");
  const fam = family.createFamily(p1.id, "Chat Family");
  family.joinFamilyAsParent(fam.inviteCode, p2.id);
  return { p1, p2, fam };
}

test("sendMessage: messages are ordered by insertion (createdAt ascending)", () => {
  const { p1, fam } = makeFamily();
  chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: "first" });
  chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: "second" });
  chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: "third" });
  const msgs = chat.listMessages(fam.id);
  assert.deepEqual(msgs.map((m) => m.text), ["first", "second", "third"]);
});

test("sendMessage: empty message with no card is rejected", () => {
  const { fam, p1 } = makeFamily();
  const result = chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: "   " });
  assert.ok(result.error);
});

test("deleteMessage: any parent (not just the sender) can delete a message", () => {
  const { p1, p2, fam } = makeFamily();
  const { message } = chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: "delete me" });
  const result = chat.deleteMessage(fam.id, p2.id, message.id);
  assert.ok(!result.error);
  assert.equal(result.message.deleted, true);
  assert.equal(result.message.text, "");
  assert.equal(result.message.deletedBy, p2.id);
});

test("deleteMessage: a non-parent cannot delete", () => {
  const { p1, fam } = makeFamily();
  const outsider = store.createUser("outsider@example.com", "Outsider");
  const { message } = chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: "protected" });
  const result = chat.deleteMessage(fam.id, outsider.id, message.id);
  assert.ok(result.error);
});

test("flagMessage: sets the report/flag fields without deleting content", () => {
  const { p1, p2, fam } = makeFamily();
  const { message } = chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: "flag me" });
  const result = chat.flagMessage(fam.id, p2.id, message.id, "inappropriate");
  assert.ok(!result.error);
  assert.equal(result.message.flagged, true);
  assert.equal(result.message.flagReason, "inappropriate");
  assert.equal(result.message.text, "flag me"); // content untouched
});

test("sendMessage: accepts a valid https://media.giphy.com/... gif with no text", () => {
  const { p1, fam } = makeFamily();
  const media = { type: "gif", url: "https://media.giphy.com/media/abc/giphy.gif", previewUrl: "https://media.giphy.com/media/abc/200.gif", width: 480, height: 270 };
  const result = chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, media });
  assert.ok(!result.error);
  assert.deepEqual(result.message.media, media);
  assert.equal(result.message.text, "");
});

test("sendMessage: rejects a non-giphy media host, but still sends if text is present", () => {
  const { p1, fam } = makeFamily();
  const media = { type: "gif", url: "https://evil.com/x.gif", previewUrl: "https://evil.com/x-small.gif", width: 100, height: 100 };
  const result = chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: "look at this", media });
  assert.ok(!result.error);
  assert.equal(result.message.media, null);
  assert.equal(result.message.text, "look at this");
});

test("sendMessage: rejects a non-giphy media host and rejects the message entirely when there's no text either", () => {
  const { p1, fam } = makeFamily();
  const media = { type: "gif", url: "https://evil.com/x.gif", previewUrl: "https://evil.com/x-small.gif", width: 100, height: 100 };
  const result = chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, media });
  assert.ok(result.error);
});

test("sendMessage: rejects media with a non-'gif' type", () => {
  const { p1, fam } = makeFamily();
  const media = { type: "image", url: "https://media.giphy.com/media/abc/giphy.gif", previewUrl: "https://media.giphy.com/media/abc/200.gif" };
  const result = chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: "hi", media });
  assert.ok(!result.error);
  assert.equal(result.message.media, null);
});

test("sendMessage: clamps oversized width/height to the 800 cap", () => {
  const { p1, fam } = makeFamily();
  const media = { type: "gif", url: "https://media.giphy.com/media/abc/giphy.gif", previewUrl: "https://media.giphy.com/media/abc/200.gif", width: 5000, height: 9000 };
  const result = chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, media });
  assert.ok(!result.error);
  assert.equal(result.message.media.width, 800);
  assert.equal(result.message.media.height, 800);
});

test("listMessages: since filter only returns newer messages", async () => {
  const { p1, fam } = makeFamily();
  chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: "old" });
  const cursor = new Date().toISOString();
  // ISO timestamps are millisecond-resolution; guarantee "new" sorts strictly
  // after `cursor` even on a very fast machine/clock.
  await new Promise((r) => setTimeout(r, 5));
  chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: "new" });
  const msgs = chat.listMessages(fam.id, { since: cursor });
  assert.deepEqual(msgs.map((m) => m.text), ["new"]);
});

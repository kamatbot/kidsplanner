"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fam-news-chat-"));
process.env.DATA_ENCRYPTION_KEY = require("node:crypto").randomBytes(32).toString("hex");
const store = require("../lib/store");
const family = require("../lib/family");
const notes = require("../lib/notes");
const chat = require("../lib/chat");
const outbox = require("../lib/notification-outbox");
const routes = {};
const sent = [];
const register = (method) => (url, ...handlers) => { routes[`${method} ${url}`] = handlers.at(-1); };
const app = Object.fromEntries(["get", "post", "patch", "delete"].map((m) => [m, register(m.toUpperCase())]));
const deps = {
  store, family, notes, chat, news: {}, dailyPuzzles: {}, wordbank: {}, brainteaser: {},
  notifications: { notifyChatMessage: async (payload) => { sent.push(payload); } },
  userRole: (u) => u.data?.profile?.role || "parent",
  kidIdForUser: (req) => req.user.data?.kid?.kidId,
};
require("../lib/routes/chat")(app, deps);
require("../lib/routes/learning")(app, deps);
after(() => outbox.closeForTest());
function fixture() {
  const parent = store.createUser(`${Math.random()}@example.test`, "Mum");
  const fam = family.createFamily(parent.id, "Family");
  const { kid } = family.addKid(fam.id, parent.id, { name: "Ava" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  return { parent, fam, kid, kidUser };
}
function save(f, body, user = f.kidUser) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  routes["POST /api/notes"]({ user, family: f.fam, body }, res);
  return res;
}
const article = { body: "I think this could help our planet.", date: "2026-09-26", source: "news", ref: { kind: "news", id: "", context: "A cleaner future\n\nA summary.\n\nhttps://www.sciencenews.org/article/clean" } };

test("news saves from both client context formats create attributed article cards exactly once", async () => {
  const f = fixture();
  const result = save(f, { ...article, senderId: f.parent.id, authorId: f.parent.id });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.chatShared, true);
  const messages = chat.listMessages(f.fam.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].senderId, f.kid.id);
  assert.equal(messages[0].postedByUserId, f.kidUser.id);
  assert.equal(messages[0].text, article.body);
  assert.deepEqual(messages[0].card, { type: "news", id: result.body.note.id, title: "A cleaner future", url: "https://www.sciencenews.org/article/clean", source: "www.sciencenews.org" });
  await outbox.drain();
  assert.equal(sent.at(-1).card.type, "news");
  assert.equal(sent.at(-1).senderName, "Ava");
  const pushCount = sent.length;
  assert.equal(save(f, article).body.note.id, result.body.note.id);
  await outbox.drain();
  assert.equal(chat.listMessages(f.fam.id).length, 1);
  assert.equal(notes.listNotes(f.fam.id).length, 1);
  assert.equal(sent.length, pushCount);
  const native = save(f, { ...article, ref: { ...article.ref, id: "news-native" } }, f.parent);
  assert.equal(native.body.chatShared, true);
  assert.equal(chat.listMessages(f.fam.id)[1].senderId, f.parent.id);
  await outbox.drain();
});

test("private journal sources do not appear in chat; unsafe or absent article URLs remain saved privately", () => {
  const f = fixture();
  for (const source of ["manual", "quote", "sat", "chat", "social"]) {
    const response = save(f, { ...article, source });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.chatShared, undefined);
  }
  for (const url of ["javascript:alert(1)", "http://example.test/a", "https://user:secret@example.test/a", ""]) {
    const response = save(f, { ...article, ref: { kind: "news", context: `Title\n\n${url}` } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.chatShared, false);
  }
  assert.equal(chat.listMessages(f.fam.id).length, 0);
  assert.equal(notes.listNotes(f.fam.id).length, 9);
});

test("chat failure preserves the note and durable retry creates one message", async () => {
  const f = fixture();
  const original = chat.sendMessage;
  chat.sendMessage = () => { throw new Error("storage temporarily unavailable"); };
  let response;
  try { response = save(f, article); } finally { chat.sendMessage = original; }
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.chatShared, false);
  assert.equal(notes.listNotes(f.fam.id).length, 1);
  await outbox.drain();
  await outbox.drain();
  assert.equal(chat.listMessages(f.fam.id).length, 1);
  assert.equal(save(f, article).body.note.id, response.body.note.id);
  assert.equal(chat.listMessages(f.fam.id).length, 1);
});

test("pending shares and push delivery revalidate family access and deleted content", async () => {
  const f = fixture();
  const response = save(f, article, f.parent);
  family.removeKid(f.fam.id, f.parent.id, f.kid.id);
  await outbox.drain();
  assert.deepEqual(sent.at(-1).familyKidUserIds, []);
  const before = sent.length;
  save(f, { ...article, body: "Another reflection" }, f.parent);
  const message = chat.listMessages(f.fam.id).at(-1);
  chat.deleteMessage(f.fam.id, f.parent.id, message.id);
  await outbox.drain();
  assert.equal(sent.length, before);
  assert.ok(response.body.note.id);

  const gone = fixture();
  const original = chat.sendMessage;
  chat.sendMessage = () => { throw new Error("storage temporarily unavailable"); };
  try { save(gone, article); } finally { chat.sendMessage = original; }
  family.removeKid(gone.fam.id, gone.parent.id, gone.kid.id);
  await outbox.drain();
  assert.equal(chat.listMessages(gone.fam.id).length, 0);
});

test("chat news cards reject executable/credential links and bound accepted metadata", () => {
  const f = fixture();
  const base = { senderType: "parent", senderId: f.parent.id, text: "Reflection" };
  for (const url of ["javascript:alert(1)", "http://example.test", "https://u:p@example.test", "https://example.test/\npath"]) {
    assert.ok(chat.sendMessage(f.fam.id, { ...base, card: { type: "news", id: "nt_1", title: "Headline", url } }).error);
  }
  const result = chat.sendMessage(f.fam.id, { ...base, card: { type: "news", id: "nt_1", title: "T".repeat(500), url: "https://example.test/article", source: "S".repeat(500), extra: "untrusted" } });
  assert.equal(result.message.card.title.length, 300);
  assert.equal(result.message.card.source.length, 100);
  assert.equal(result.message.card.extra, undefined);
});

test("successful client retry retires a deferred share before it can duplicate a completed push", async () => {
  const f = fixture();
  const originalSend = chat.sendMessage;
  const originalNow = Date.now;
  let saved;
  try {
    chat.sendMessage = () => { throw new Error("storage temporarily unavailable"); };
    saved = save(f, article);
    await outbox.drain(); // Failed background attempt is now in backoff.
    assert.equal(outbox.hasPending("news_reflection_share", saved.body.note.id), true);
    chat.sendMessage = originalSend;
    assert.equal(save(f, article).body.chatShared, true);
    assert.equal(outbox.hasPending("news_reflection_share", saved.body.note.id), false);
    const before = sent.length;
    await outbox.drain(); // Deliver the successful client's push.
    assert.equal(sent.length, before + 1);
    Date.now = () => originalNow() + 10_000;
    await outbox.drain(); // The old recovery would now be due.
    await outbox.drain();
    assert.equal(sent.length, before + 1);
    assert.equal(chat.listMessages(f.fam.id).length, 1);
    assert.equal(notes.listNotes(f.fam.id).length, 1);
  } finally {
    chat.sendMessage = originalSend;
    Date.now = originalNow;
  }
});

test("client retry preserves push recovery after the message committed but enqueue failed", async () => {
  const f = fixture();
  const originalEnqueue = outbox.enqueue;
  let saved;
  try {
    outbox.enqueue = (kind, ...args) => {
      if (kind === "chat_message") throw new Error("push queue temporarily unavailable");
      return originalEnqueue(kind, ...args);
    };
    saved = save(f, article);
    await outbox.drain();
    assert.equal(saved.body.chatShared, false);
    assert.equal(chat.listMessages(f.fam.id).length, 1);
  } finally { outbox.enqueue = originalEnqueue; }
  const before = sent.length;
  assert.equal(save(f, article).body.chatShared, true);
  assert.equal(outbox.hasPending("news_reflection_share", saved.body.note.id), false);
  await outbox.drain();
  assert.equal(sent.length, before + 1);
  assert.equal(chat.listMessages(f.fam.id).length, 1);
});

test("outbox retirement suppresses recovery already captured in a concurrent drain batch", async () => {
  const delivered = [];
  outbox.configure({ retirement_test: (payload) => {
    delivered.push(payload.n);
    if (payload.n === 1) outbox.retire("retirement_test", "retire-5");
  } });
  for (let n = 1; n <= 5; n++) outbox.enqueue("retirement_test", { n }, { dedupeKey: `retire-${n}` });
  await outbox.drain();
  assert.deepEqual(delivered, [1, 2, 3, 4]);
  assert.equal(outbox.hasPending("retirement_test", "retire-5"), false);
});

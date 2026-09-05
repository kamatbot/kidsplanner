"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-"));
// Set before any lib/* require so datacrypto's key cache picks it up — same
// pattern as tests/notes.test.js / tests/school-account.test.js. Exercises
// the encrypted-at-rest path for the whole file; the sqlite-specific test
// below is the one that actually asserts on it.
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const store = require("../lib/store");
const family = require("../lib/family");
const trips = require("../lib/trips");
const chat = require("../lib/chat");
const chatAttachments = require("../lib/chat-attachments");
const chatRoutes = require("../lib/routes/chat");

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

test("sendMessage: claims an uploaded attachment once and deletion removes its bytes", () => {
  const { p1, fam } = makeFamily();
  const uploaded = chatAttachments.save({
    scopeKey: fam.id,
    uploaderUserId: p1.id,
    originalName: "family-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("private family note"),
  });
  const media = { type: "attachment", attachmentId: uploaded.id };
  const sent = chat.sendMessage(fam.id, {
    senderType: "parent",
    senderId: p1.id,
    postedByUserId: p1.id,
    media,
  });
  assert.ok(!sent.error, sent.error);
  assert.equal(sent.message.media.attachmentId, uploaded.id);
  assert.equal(chatAttachments.readMeta(uploaded.id).claimedMessageId, sent.message.id);

  const replay = chat.sendMessage(fam.id, {
    senderType: "parent",
    senderId: p1.id,
    postedByUserId: p1.id,
    media,
  });
  assert.ok(replay.error, "the same uploaded bytes must not be attached to a second message");

  const deleted = chat.deleteMessage(fam.id, p1.id, sent.message.id);
  assert.ok(!deleted.error, deleted.error);
  assert.equal(chatAttachments.read(uploaded.id), null);
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

/* ============================================================
   SQLITE BACKEND — storage (lib/chat-store.js via lib/chat.js)
============================================================ */

test("sqlite backend: message body round-trips through the public API and is never plaintext on disk", () => {
  if (chat.getBackend() !== "sqlite") return; // no prebuilt better-sqlite3 binary on this host — JSON fallback is exercised by every test above instead
  const chatStore = require("../lib/chat-store");
  const { p1, fam } = makeFamily();
  const secret = "a very secret message nobody should read in plaintext";
  chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: secret });
  chatStore._checkpointForTest(); // flush WAL into the main file so we can read it back
  const raw = fs.readFileSync(chatStore.DB_FILE);
  assert.ok(!raw.includes(secret), "sqlite file bytes must not contain the plaintext message body");
  const msgs = chat.listMessages(fam.id);
  assert.equal(msgs[msgs.length - 1].text, secret); // decrypts correctly through the public API
});

test("migration: legacy JSON chat history is copied into sqlite once, and root.chats is cleared", () => {
  const modPaths = ["../lib/db", "../lib/paths", "../lib/store", "../lib/family", "../lib/chat", "../lib/chat-store"].map((m) => require.resolve(m));
  const savedDataDir = process.env.FAM_DATA_DIR;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-chatmigrate-"));
  process.env.FAM_DATA_DIR = tmpDir;
  modPaths.forEach((p) => delete require.cache[p]);
  try {
    const freshDb = require("../lib/db");
    const freshStore = require("../lib/store");
    const freshFamily = require("../lib/family");
    const p1 = freshStore.createUser("mig@example.com", "Migrate Parent");
    const fam = freshFamily.createFamily(p1.id, "Migrate Family");
    // Seed legacy shape directly (root.chats — what lib/chat.js used before sqlite).
    const root = freshDb.load();
    root.chats = {
      [fam.id]: {
        messages: [
          { id: "m_legacy1", familyId: fam.id, senderType: "parent", senderId: p1.id, postedByUserId: p1.id, text: "legacy one", card: null, media: null, createdAt: "2026-01-01T00:00:00.000Z", deleted: false, deletedBy: null, flagged: false, flagReason: null, flaggedBy: null },
          { id: "m_legacy2", familyId: fam.id, senderType: "parent", senderId: p1.id, postedByUserId: p1.id, text: "legacy two", card: null, media: null, createdAt: "2026-01-01T00:00:01.000Z", deleted: false, deletedBy: null, flagged: false, flagReason: null, flaggedBy: null },
        ],
      },
    };
    freshDb.persist();
    freshDb.flushSync();

    const freshChat = require("../lib/chat"); // migration runs here, at first load, if sqlite is live
    if (freshChat.getBackend() !== "sqlite") return; // nothing to migrate into on this host

    const msgs = freshChat.listMessages(fam.id);
    assert.deepEqual(msgs.map((m) => m.text), ["legacy one", "legacy two"]);
    assert.equal(freshDb.load().chats, undefined, "root.chats must be cleared after migration");
  } finally {
    process.env.FAM_DATA_DIR = savedDataDir;
    modPaths.forEach((p) => delete require.cache[p]); // restore this file's original module instances
  }
});

/* ============================================================
   LONG-POLL — lib/routes/chat.js
============================================================ */

function buildChatRouteHarness() {
  const routes = {};
  const register = (method) => (p, ...handlers) => { routes[`${method} ${p}`] = handlers[handlers.length - 1]; };
  const app = { get: register("GET"), post: register("POST"), delete: register("DELETE") };
  chatRoutes(app, {
    chat,
    notifications: { notifyChatMessage: async () => {} },
    store,
    family,
    trips,
    gifs: {},
    requireAuth: (req, res, next) => next(),
    requireParent: (req, res, next) => next(),
    requireFamily: (req, res, next) => next(),
    userRole: () => "parent",
    gifLimiter: (req, res, next) => next(),
  });
  return routes;
}

function callChatRoute(handler, { query, familyId } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      set() { return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ statusCode: this.statusCode, body: b }); },
    };
    const req = {
      body: {}, params: {}, query: query || {},
      user: store.getUser(family.getFamily(familyId).parentIds[0]),
      family: { id: familyId },
      on() {}, // no disconnect simulated in these tests
    };
    handler(req, res);
  });
}

function callChatAttachmentRoute(handler, { user, attachmentId, range } = {}) {
  return new Promise((resolve) => {
    const headers = {};
    const res = {
      statusCode: 200,
      set(name, value) { headers[String(name).toLowerCase()] = String(value); return this; },
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ statusCode: this.statusCode, headers, body }); },
      send(body) { resolve({ statusCode: this.statusCode, headers, body }); },
      end() { resolve({ statusCode: this.statusCode, headers, body: null }); },
    };
    handler({
      body: {}, query: {}, params: { id: attachmentId }, user,
      headers: range ? { range } : {},
    }, res);
  });
}

test("GET chat attachment: verified photos render inline while regular files remain downloads", async () => {
  const routes = buildChatRouteHarness();
  const { p1, fam } = makeFamily();
  const photoBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x70, 0x68, 0x6f, 0x74, 0x6f]);
  const photo = chatAttachments.save({
    scopeKey: fam.id, uploaderUserId: p1.id, originalName: "family photo.jpg",
    mimeType: "image/jpeg", buffer: photoBytes,
  });
  const photoRes = await callChatAttachmentRoute(routes["GET /api/chat/attachments/:id"], {
    user: p1, attachmentId: photo.id,
  });
  assert.equal(photoRes.statusCode, 200);
  assert.equal(photoRes.headers["content-type"], "image/jpeg");
  assert.match(photoRes.headers["content-disposition"], /^inline;/);
  assert.equal(photoRes.headers["cache-control"], "private, no-store");
  assert.deepEqual(photoRes.body, photoBytes);

  const fileBytes = Buffer.from("private family notes");
  const file = chatAttachments.save({
    scopeKey: fam.id, uploaderUserId: p1.id, originalName: "notes.txt",
    mimeType: "text/plain", buffer: fileBytes,
  });
  const fileRes = await callChatAttachmentRoute(routes["GET /api/chat/attachments/:id"], {
    user: p1, attachmentId: file.id,
  });
  assert.equal(fileRes.headers["content-type"], "application/octet-stream");
  assert.match(fileRes.headers["content-disposition"], /^attachment;/);
  assert.deepEqual(fileRes.body, fileBytes);
});

test("GET chat attachment: verified videos support bounded single byte ranges", async () => {
  const routes = buildChatRouteHarness();
  const { p1, fam } = makeFamily();
  const videoBytes = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.from("0123456789")]);
  const video = chatAttachments.save({
    scopeKey: fam.id, uploaderUserId: p1.id, originalName: "clip.mp4",
    mimeType: "video/mp4", buffer: videoBytes,
  });
  const ranged = await callChatAttachmentRoute(routes["GET /api/chat/attachments/:id"], {
    user: p1, attachmentId: video.id, range: "bytes=4-11",
  });
  assert.equal(ranged.statusCode, 206);
  assert.equal(ranged.headers["content-type"], "video/mp4");
  assert.match(ranged.headers["content-disposition"], /^inline;/);
  assert.equal(ranged.headers["accept-ranges"], "bytes");
  assert.equal(ranged.headers["content-range"], `bytes 4-11/${videoBytes.length}`);
  assert.equal(ranged.headers["content-length"], "8");
  assert.deepEqual(ranged.body, videoBytes.subarray(4, 12));

  const suffix = await callChatAttachmentRoute(routes["GET /api/chat/attachments/:id"], {
    user: p1, attachmentId: video.id, range: "bytes=-5",
  });
  assert.equal(suffix.statusCode, 206);
  assert.equal(suffix.headers["content-range"], `bytes ${videoBytes.length - 5}-${videoBytes.length - 1}/${videoBytes.length}`);
  assert.deepEqual(suffix.body, videoBytes.subarray(-5));

  const invalid = await callChatAttachmentRoute(routes["GET /api/chat/attachments/:id"], {
    user: p1, attachmentId: video.id, range: `bytes=${videoBytes.length}-`,
  });
  assert.equal(invalid.statusCode, 416);
  assert.equal(invalid.headers["content-range"], `bytes */${videoBytes.length}`);
  assert.equal(invalid.body, null);
});

test("GET chat attachment: unauthorized users still receive no attachment metadata or bytes", async () => {
  const routes = buildChatRouteHarness();
  const { p1, fam } = makeFamily();
  const outsider = store.createUser("attachment-outsider@example.com", "Attachment Outsider");
  const photo = chatAttachments.save({
    scopeKey: fam.id, uploaderUserId: p1.id, originalName: "private.jpg",
    mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  });
  const denied = await callChatAttachmentRoute(routes["GET /api/chat/attachments/:id"], {
    user: outsider, attachmentId: photo.id,
  });
  assert.equal(denied.statusCode, 404);
  assert.deepEqual(denied.body, { error: "Attachment not found." });
  assert.equal(denied.headers["content-type"], undefined);
});

test("GET /api/chat/messages: no afterId/wait — unchanged immediate response (back-compat)", async () => {
  const routes = buildChatRouteHarness();
  const { p1, fam } = makeFamily();
  chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: "hi" });
  const res = await callChatRoute(routes["GET /api/chat/messages"], { familyId: fam.id });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.messages.some((m) => m.text === "hi"));
});

test("GET /api/chat/messages: afterId+wait=1 returns immediately when a newer message already exists", async () => {
  const routes = buildChatRouteHarness();
  const { p1, fam } = makeFamily();
  const { message: m1 } = chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: "one" });
  const { message: m2 } = chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: "two" });
  const started = Date.now();
  const res = await Promise.race([
    callChatRoute(routes["GET /api/chat/messages"], { familyId: fam.id, query: { afterId: m1.id, wait: "1" } }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("did not resolve immediately")), 500)),
  ]);
  assert.ok(Date.now() - started < 500);
  assert.deepEqual(res.body.messages.map((m) => m.id), [m2.id]);
});

test("GET /api/chat/messages: afterId+wait=1 wakes as soon as a message is sent (well under 25s)", async () => {
  const routes = buildChatRouteHarness();
  const { p1, fam } = makeFamily();
  const { message: m1 } = chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: "baseline" });
  const started = Date.now();
  const pending = callChatRoute(routes["GET /api/chat/messages"], { familyId: fam.id, query: { afterId: m1.id, wait: "1" } });
  setTimeout(() => {
    chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: "woke you up" });
  }, 100);
  const res = await pending;
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5000, `expected a quick wake, took ${elapsed}ms`);
  assert.ok(res.body.messages.some((m) => m.text === "woke you up"));
});

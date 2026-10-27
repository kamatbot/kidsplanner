"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-chat-reads-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const store = require("../lib/store");
const family = require("../lib/family");
const trips = require("../lib/trips");
const chat = require("../lib/chat");
const notificationOutbox = require("../lib/notification-outbox");
const chatRoutes = require("../lib/routes/chat");
const tripsRoutes = require("../lib/routes/trips");

test.after(() => notificationOutbox.closeForTest());

let userCounter = 0;
function freshUser(label) {
  userCounter++;
  return store.createUser(`${label}${userCounter}@example.com`, `${label}${userCounter}`);
}
function userRole(user) {
  return (user && user.data && user.data.profile && user.data.profile.role) || "parent";
}
function familyFor(user) {
  return userRole(user) === "kid" ? family.familyForKidUser(user) : (family.familiesForUser(user.id)[0] || null);
}

function call(route, { body, params, query, user } = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      body: null,
      set() { return this; },
      once() {},
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; resolve(this); },
    };
    const req = { method: route.method, body: body || {}, params: params || {}, query: query || {}, user, on() {} };
    let index = -1;
    function next() {
      index++;
      if (index >= route.handlers.length) return;
      try { route.handlers[index](req, res, next); } catch (error) { reject(error); }
    }
    next();
  });
}

function register(routes) {
  const add = (method) => (pattern, ...handlers) => { routes[`${method} ${pattern}`] = { method, handlers }; };
  return { get: add("GET"), post: add("POST"), patch: add("PATCH"), delete: add("DELETE") };
}
const pass = (req, res, next) => next();
const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: "Not authenticated" }));

function buildRoutes() {
  const routes = {};
  chatRoutes(register(routes), {
    chat, store, family, trips, gifs: {},
    notifications: { notifyChatMessage: async () => {}, notifyChatBuzz: async () => {} },
    requireAuth, requireParent: pass, userRole, gifLimiter: pass, buzzLimiter: pass,
    requireFamily(req, res, next) {
      const fam = familyFor(req.user);
      if (!fam) return res.status(404).json({ error: "No family." });
      req.family = fam;
      next();
    },
  });
  tripsRoutes(register(routes), {
    trips, store, family, chat, userRole,
    notifications: { notifyTripEvent: async () => {}, notifyTripChatMessage: async () => {}, notifyTripChatBuzz: async () => {} },
    requireAuth, authLimiter: pass, buzzLimiter: pass,
  });
  return routes;
}

function setupFamily() {
  const mom = freshUser("Mom");
  const dad = freshUser("Dad");
  const fam = family.createFamily(mom.id, "Read family");
  family.joinFamilyAsParent(fam.inviteCode, dad.id);
  const kidProfile = family.addKid(fam.id, mom.id, { name: "Arya" }).kid;
  const kid = store.findOrCreateKidUser(fam.id, kidProfile.id, "Arya");
  return { mom, dad, kid, fam: family.getFamily(fam.id) };
}

test("markRead only moves forward and rejects messages from another scope", () => {
  const { mom, dad, fam } = setupFamily();
  const other = setupFamily();
  const first = chat.sendMessage(fam.id, { senderType: "parent", senderId: mom.id, postedByUserId: mom.id, text: "one" }).message;
  // Distinct createdAt so ordering is unambiguous.
  const second = chat.sendMessage(fam.id, { senderType: "parent", senderId: mom.id, postedByUserId: mom.id, text: "two" }).message;
  second.createdAt = new Date(Date.parse(first.createdAt) + 1000).toISOString();
  if (chat.getBackend() === "sqlite") {
    require("better-sqlite3")(require("../lib/chat-store").DB_FILE).prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(second.createdAt, second.id);
  } else {
    chat.getMessage(fam.id, second.id).createdAt = second.createdAt;
  }

  assert.equal(chat.markRead(fam.id, dad.id, second.id).changed, true);
  assert.equal(chat.markRead(fam.id, dad.id, first.id).changed, false, "an older message never moves the mark back");
  assert.equal(chat.markRead(fam.id, dad.id, second.id).changed, false, "same message is a no-op");
  assert.deepEqual(chat.listReads(fam.id).map((r) => [r.userId, r.messageId]), [[dad.id, second.id]]);

  const foreign = chat.markRead(other.fam.id, other.mom.id, second.id);
  assert.equal(foreign.status, 404);
  assert.deepEqual(chat.listReads(other.fam.id), []);
});

test("family routes: reader is the session user, reads list only current members, kids included", async () => {
  const routes = buildRoutes();
  const { mom, dad, kid, fam } = setupFamily();
  const outsider = freshUser("Outsider");
  family.createFamily(outsider.id, "Elsewhere");
  const sent = await call(routes["POST /api/chat/messages"], { user: mom, body: { text: "dinner at 7" } });
  const messageId = sent.body.message.id;

  const kidRead = await call(routes["POST /api/chat/read"], { user: kid, body: { messageId, userId: dad.id } });
  assert.equal(kidRead.statusCode, 200);
  assert.deepEqual(kidRead.body.reads.map((r) => [r.userId, r.name, r.messageId]), [[kid.id, "Arya", messageId]],
    "a body userId is ignored — the reader is always the session user");

  const outsiderRead = await call(routes["POST /api/chat/read"], { user: outsider, body: { messageId } });
  assert.equal(outsiderRead.statusCode, 404, "a message from another family cannot be marked");

  await call(routes["POST /api/chat/read"], { user: dad, body: { messageId } });
  const listed = await call(routes["GET /api/chat/messages"], { user: mom });
  assert.deepEqual(listed.body.reads.map((r) => r.userId).sort(), [dad.id, kid.id].sort());
  assert.ok(listed.body.messages.length >= 1, "messages shape is unchanged");

  family.removeMember(fam.id, mom.id, dad.id);
  const afterLeave = await call(routes["GET /api/chat/messages"], { user: mom });
  assert.deepEqual(afterLeave.body.reads.map((r) => r.userId), [kid.id], "a parent who left drops out of receipts");
});

test("a read wakes a waiting long-poll with the updated reads", async () => {
  const routes = buildRoutes();
  const { mom, dad } = setupFamily();
  const sent = await call(routes["POST /api/chat/messages"], { user: mom, body: { text: "anyone?" } });
  const messageId = sent.body.message.id;
  const waiting = call(routes["GET /api/chat/messages"], { user: mom, query: { afterId: messageId, wait: "1" } });
  await call(routes["POST /api/chat/read"], { user: dad, body: { messageId } });
  const woke = await waiting;
  assert.deepEqual(woke.body.messages, []);
  assert.deepEqual(woke.body.reads.map((r) => [r.userId, r.messageId]), [[dad.id, messageId]]);
});

test("trip rooms track reads for current trip members", async () => {
  const routes = buildRoutes();
  const owner = freshUser("Owner");
  const guest = freshUser("Guest");
  const trip = trips.createTrip(owner.id, null, { name: "Lakes", startDate: "2026-12-01", endDate: "2026-12-05" }).trip;
  trips.joinByCode(trip.inviteCode, guest.id);
  const sent = await call(routes["POST /api/trips/:tripId/chat/messages"], { user: owner, params: { tripId: trip.id }, body: { text: "packed?" } });
  const read = await call(routes["POST /api/trips/:tripId/chat/read"], { user: guest, params: { tripId: trip.id }, body: { messageId: sent.body.message.id } });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.body.reads.map((r) => r.userId), [guest.id]);
  const listed = await call(routes["GET /api/trips/:tripId/chat/messages"], { user: owner, params: { tripId: trip.id } });
  assert.deepEqual(listed.body.reads.map((r) => r.userId), [guest.id]);
});

test("account deletion removes the user's read marks", () => {
  const { mom, dad, fam } = setupFamily();
  const msg = chat.sendMessage(fam.id, { senderType: "parent", senderId: mom.id, postedByUserId: mom.id, text: "bye" }).message;
  chat.markRead(fam.id, dad.id, msg.id);
  chat.markRead(fam.id, mom.id, msg.id);
  require("../lib/account-deletion").deleteParentAccount(dad.id);
  assert.deepEqual(chat.listReads(fam.id).map((r) => r.userId), [mom.id]);
});

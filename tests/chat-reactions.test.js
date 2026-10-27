"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-chat-reactions-"));
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

test("toggleReaction adds, removes, keeps the fixed order and rejects unknown keys", () => {
  const { mom, dad, fam } = setupFamily();
  const msg = chat.sendMessage(fam.id, { senderType: "parent", senderId: mom.id, postedByUserId: mom.id, text: "pizza?" }).message;
  assert.equal(chat.toggleReaction(fam.id, dad.id, msg.id, "party").added, true);
  assert.equal(chat.toggleReaction(fam.id, mom.id, msg.id, "thumbsup").added, true);
  assert.equal(chat.toggleReaction(fam.id, dad.id, msg.id, "thumbsup").added, true);
  assert.deepEqual(chat.getMessage(fam.id, msg.id).reactions,
    [{ key: "thumbsup", userIds: [mom.id, dad.id] }, { key: "party", userIds: [dad.id] }]);
  assert.equal(chat.toggleReaction(fam.id, dad.id, msg.id, "party").added, false, "a second tap removes it");
  assert.deepEqual(chat.getMessage(fam.id, msg.id).reactions.map((r) => r.key), ["thumbsup"]);
  assert.equal(chat.toggleReaction(fam.id, dad.id, msg.id, "poop").status, 400);
  const other = setupFamily();
  assert.equal(chat.toggleReaction(other.fam.id, other.mom.id, msg.id, "heart").status, 404, "no reacting across families");
});

test("deleting a message clears its reactions and blocks new ones", () => {
  const { mom, dad, fam } = setupFamily();
  const msg = chat.sendMessage(fam.id, { senderType: "parent", senderId: mom.id, postedByUserId: mom.id, text: "oops" }).message;
  chat.toggleReaction(fam.id, dad.id, msg.id, "laugh");
  chat.deleteMessage(fam.id, mom.id, msg.id);
  assert.deepEqual(chat.getMessage(fam.id, msg.id).reactions || [], []);
  assert.equal(chat.toggleReaction(fam.id, dad.id, msg.id, "laugh").status, 409);
});

test("family route: kids can react, the reactor is the session user, names are attached", async () => {
  const routes = buildRoutes();
  const { mom, kid } = setupFamily();
  const sent = await call(routes["POST /api/chat/messages"], { user: mom, body: { text: "movie night" } });
  const res = await call(routes["POST /api/chat/messages/:id/reactions"], { user: kid, params: { id: sent.body.message.id }, body: { reaction: "fire", userId: mom.id } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.message.reactions, [{ key: "fire", userIds: [kid.id], names: ["Arya"] }]);
  const listed = await call(routes["GET /api/chat/messages"], { user: mom });
  assert.deepEqual(listed.body.messages.find((m) => m.id === sent.body.message.id).reactions.map((r) => r.key), ["fire"]);
});

test("a reaction wakes a long-poll with the edited message in `updated`, not `messages`", async () => {
  const routes = buildRoutes();
  const { mom, dad } = setupFamily();
  const first = await call(routes["POST /api/chat/messages"], { user: mom, body: { text: "first" } });
  const second = await call(routes["POST /api/chat/messages"], { user: mom, body: { text: "second" } });
  const waiting = call(routes["GET /api/chat/messages"], { user: dad, query: { afterId: second.body.message.id, wait: "1" } });
  await call(routes["POST /api/chat/messages/:id/reactions"], { user: dad, params: { id: first.body.message.id }, body: { reaction: "heart" } });
  const woke = await waiting;
  assert.deepEqual(woke.body.messages, [], "the insertion cursor never sees an older message");
  assert.deepEqual(woke.body.updated.map((m) => [m.id, m.reactions[0].key]), [[first.body.message.id, "heart"]]);
});

test("trip members can react in trip rooms", async () => {
  const routes = buildRoutes();
  const owner = freshUser("Owner");
  const guest = freshUser("Guest");
  const trip = trips.createTrip(owner.id, null, { name: "Coast", startDate: "2026-12-01", endDate: "2026-12-05" }).trip;
  trips.joinByCode(trip.inviteCode, guest.id);
  const sent = await call(routes["POST /api/trips/:tripId/chat/messages"], { user: owner, params: { tripId: trip.id }, body: { text: "beach day" } });
  const res = await call(routes["POST /api/trips/:tripId/chat/messages/:id/reactions"], { user: guest, params: { tripId: trip.id, id: sent.body.message.id }, body: { reaction: "party" } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.message.reactions.map((r) => [r.key, r.userIds]), [["party", [guest.id]]]);
});

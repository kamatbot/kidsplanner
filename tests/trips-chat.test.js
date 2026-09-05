"use strict";
/*
 * Phase B: chat scope generalization (lib/chat.js accepting "trip:<id>" scope
 * keys alongside familyId) + the trip chat routes (lib/routes/trips.js) +
 * GET /api/chat/rooms (lib/routes/chat.js). Harness patterns follow
 * tests/chat.test.js (FAM_DATA_DIR + DATA_ENCRYPTION_KEY before requires) and
 * tests/trips-routes.test.js (full middleware-chain route harness, Promise-
 * based call() since several handlers are async).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-trips-chat-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const store = require("../lib/store");
const family = require("../lib/family");
const trips = require("../lib/trips");
const chat = require("../lib/chat");
const tripsRoutes = require("../lib/routes/trips");
const chatRoutes = require("../lib/routes/chat");

let n = 0;
function freshUser(label) {
  n++;
  return store.createUser(`${label}${n}@example.com`, `User ${label}${n}`);
}
function makeTrip(label) {
  const owner = freshUser(label);
  const fam = family.createFamily(owner.id, `${label} Family`);
  const { trip } = trips.createTrip(owner.id, fam.id, {
    name: `${label} Trip`, destination: "Rome, IT", startDate: "2026-09-01", endDate: "2026-09-10",
  });
  return { owner, fam, trip };
}

/* ============================================================
   LIB-LEVEL — lib/chat.js scope generalization
============================================================ */

test("sendMessage: a trip scope key ('trip:'+tripId) requires the trip to exist", () => {
  const result = chat.sendMessage("trip:trip_bogus", { senderType: "member", senderId: "u1", text: "hi" });
  assert.ok(result.error);
});

test("sendMessage: trip scope stores senderType 'member' regardless of what's passed in", () => {
  const { owner, trip } = makeTrip("L1");
  const result = chat.sendMessage("trip:" + trip.id, { senderType: "parent", senderId: owner.id, text: "hello crew" });
  assert.ok(!result.error, result.error);
  assert.equal(result.message.senderType, "member");
  assert.equal(result.message.text, "hello crew");
});

test("listMessages / listMessagesAfterId: trip scope behaves exactly like a family scope", () => {
  const { owner, trip } = makeTrip("L2");
  const scope = "trip:" + trip.id;
  chat.sendMessage(scope, { senderType: "member", senderId: owner.id, text: "one" });
  const { message: two } = chat.sendMessage(scope, { senderType: "member", senderId: owner.id, text: "two" });
  chat.sendMessage(scope, { senderType: "member", senderId: owner.id, text: "three" });
  assert.deepEqual(chat.listMessages(scope).map((m) => m.text), ["one", "two", "three"]);
  assert.deepEqual(chat.listMessagesAfterId(scope, two.id).map((m) => m.text), ["three"]);
});

test("deleteMessage: trip scope — the trip owner may delete ANY member's message", () => {
  const { owner, trip } = makeTrip("L3");
  const editor = freshUser("L3e");
  trips.joinByCode(trip.inviteCode, editor.id);
  const scope = "trip:" + trip.id;
  const { message } = chat.sendMessage(scope, { senderType: "member", senderId: editor.id, text: "editor's message" });
  const result = chat.deleteMessage(scope, owner.id, message.id);
  assert.ok(!result.error, result.error);
  assert.equal(result.message.deleted, true);
  assert.equal(result.message.text, "");
});

test("deleteMessage: trip scope — the message's own author may delete it even as a non-owner editor", () => {
  const { trip } = makeTrip("L4");
  const editor = freshUser("L4e");
  trips.joinByCode(trip.inviteCode, editor.id);
  const scope = "trip:" + trip.id;
  const { message } = chat.sendMessage(scope, { senderType: "member", senderId: editor.id, text: "mine" });
  const result = chat.deleteMessage(scope, editor.id, message.id);
  assert.ok(!result.error, result.error);
  assert.equal(result.message.deleted, true);
});

test("deleteMessage: trip scope — a non-owner, non-author member cannot delete", () => {
  const { owner, trip } = makeTrip("L5");
  const editorA = freshUser("L5a");
  const editorB = freshUser("L5b");
  trips.joinByCode(trip.inviteCode, editorA.id);
  trips.joinByCode(trip.inviteCode, editorB.id);
  const scope = "trip:" + trip.id;
  const { message } = chat.sendMessage(scope, { senderType: "member", senderId: editorA.id, text: "editorA's message" });
  const result = chat.deleteMessage(scope, editorB.id, message.id);
  assert.ok(result.error);
  void owner;
});

test("deleteMessage: family scope is unaffected (byte-identical: any parent deletes any message)", () => {
  const p1 = freshUser("L6p1");
  const p2 = freshUser("L6p2");
  const fam = family.createFamily(p1.id, "L6 Family");
  family.joinFamilyAsParent(fam.inviteCode, p2.id);
  const { message } = chat.sendMessage(fam.id, { senderType: "parent", senderId: p1.id, text: "family msg" });
  const result = chat.deleteMessage(fam.id, p2.id, message.id);
  assert.ok(!result.error, result.error);
});

/* ============================================================
   ROUTE-LEVEL — lib/routes/trips.js trip chat routes
============================================================ */

function userRole(user) {
  return (user && user.data && user.data.profile && user.data.profile.role) || "parent";
}

function buildTripsHarness(notifyCalls) {
  const routes = {};
  const register = (method) => (p, ...handlers) => { routes[`${method} ${p}`] = { method, handlers }; };
  const app = { get: register("GET"), post: register("POST"), patch: register("PATCH"), delete: register("DELETE") };
  tripsRoutes(app, {
    trips, store, family, chat, userRole,
    notifications: {
      notifyTripEvent: async () => {},
      notifyTripChatMessage: async (...args) => { if (notifyCalls) notifyCalls.push(args); },
    },
    requireAuth: (req, res, next) => (req.user ? next() : res.status(401).json({ error: "Not authenticated" })),
    authLimiter: (req, res, next) => next(),
  });
  return routes;
}

function call(route, { body, params, query, user } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      body: null,
      set() { return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve(this); },
    };
    const req = { method: route.method, body: body || {}, params: params || {}, query: query || {}, user: user || null, on() {} };
    const handlers = route.handlers;
    let idx = 0;
    function next() {
      idx++;
      if (idx < handlers.length) handlers[idx](req, res, next);
    }
    handlers[0](req, res, next);
  });
}

test("trip activity updates are mirrored into the trip chat room", async () => {
  const routes = buildTripsHarness();
  const { owner, trip } = makeTrip("Updates");
  const joiner = freshUser("UpdatesGuest");

  await call(routes["POST /api/trips/join/:code"], {
    user: joiner, params: { code: trip.inviteCode },
  });
  await call(routes["POST /api/trips/:tripId/itinerary"], {
    user: owner,
    params: { tripId: trip.id },
    body: { date: null, title: "Street food tour", category: "food" },
  });
  await call(routes["POST /api/trips/:tripId/flights"], {
    user: owner,
    params: { tripId: trip.id },
    body: { airline: "TG", flightNo: "401", from: "BKK", to: "SIN" },
  });
  await call(routes["POST /api/trips/:tripId/lodging"], {
    user: owner,
    params: { tripId: trip.id },
    body: { name: "Riverside Hotel" },
  });
  await call(routes["POST /api/trips/:tripId/checklists"], {
    user: owner,
    params: { tripId: trip.id },
    body: { title: "Shared packing" },
  });

  const updates = chat.listMessages("trip:" + trip.id);
  assert.deepEqual(updates.map((message) => message.card.type), [
    "trip-member",
    "trip-itinerary",
    "trip-flight",
    "trip-lodging",
    "trip-packing",
  ]);
  assert.match(updates[0].card.title, /^User UpdatesGuest/);
  assert.deepEqual(updates.slice(1).map((message) => message.card.title), [
    "Street food tour",
    "TG 401",
    "Riverside Hotel",
    "Shared packing",
  ]);
  assert.deepEqual(updates.map((message) => message.text), [
    "Joined the trip",
    "New itinerary idea",
    "BKK → SIN",
    "Lodging added",
    "Started a shared packing list",
  ]);
});

test("POST trip chat message: a member can post; response carries roomId + senderName", async () => {
  const notifyCalls = [];
  const routes = buildTripsHarness(notifyCalls);
  const { owner, trip } = makeTrip("R1");
  const res = await call(routes["POST /api/trips/:tripId/chat/messages"], {
    user: owner, params: { tripId: trip.id }, body: { text: "ahoy" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message.text, "ahoy");
  assert.equal(res.body.message.roomId, "trip:" + trip.id);
  assert.equal(res.body.message.senderType, "member");
  assert.equal(typeof res.body.message.senderName, "string");
  assert.equal(notifyCalls.length, 0); // provider I/O cannot delay acknowledgement
  await require("../lib/notification-outbox").drain();
  assert.equal(notifyCalls.length, 1); // durable intent dispatches after response
  assert.equal(notifyCalls[0][3], "ahoy");
  assert.equal(notifyCalls[0][4], res.body.message.id);
});

test("GET trip chat messages: kid-read access is rejected (chat is members-only)", async () => {
  const routes = buildTripsHarness();
  const { trip, fam } = makeTrip("R2");
  const { kid } = family.addKid(fam.id, fam.parentIds[0], { name: "Kiddo" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const res = await call(routes["GET /api/trips/:tripId/chat/messages"], { user: kidUser, params: { tripId: trip.id } });
  assert.equal(res.statusCode, 403);
});

test("POST trip chat message: a non-member (stranger) is rejected by requireTrip before ever reaching chat", async () => {
  const routes = buildTripsHarness();
  const { trip } = makeTrip("R3");
  const stranger = freshUser("R3s");
  const res = await call(routes["POST /api/trips/:tripId/chat/messages"], {
    user: stranger, params: { tripId: trip.id }, body: { text: "hi" },
  });
  assert.equal(res.statusCode, 403);
});

test("GET trip chat messages: immediate (non-wait) mode lists posted messages, newest last", async () => {
  const routes = buildTripsHarness();
  const { owner, trip } = makeTrip("R4");
  await call(routes["POST /api/trips/:tripId/chat/messages"], { user: owner, params: { tripId: trip.id }, body: { text: "first" } });
  await call(routes["POST /api/trips/:tripId/chat/messages"], { user: owner, params: { tripId: trip.id }, body: { text: "second" } });
  const res = await call(routes["GET /api/trips/:tripId/chat/messages"], { user: owner, params: { tripId: trip.id } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.messages.map((m) => m.text), ["first", "second"]);
  assert.ok(res.body.messages.every((m) => m.roomId === "trip:" + trip.id));
});

test("DELETE trip chat message: owner deletes an editor's message; a non-owner non-author editor cannot", async () => {
  const routes = buildTripsHarness();
  const { owner, trip } = makeTrip("R5");
  const editorA = freshUser("R5a");
  const editorB = freshUser("R5b");
  trips.joinByCode(trip.inviteCode, editorA.id);
  trips.joinByCode(trip.inviteCode, editorB.id);
  const posted = await call(routes["POST /api/trips/:tripId/chat/messages"], {
    user: editorA, params: { tripId: trip.id }, body: { text: "editorA says hi" },
  });
  const msgId = posted.body.message.id;

  const denied = await call(routes["DELETE /api/trips/:tripId/chat/messages/:id"], {
    user: editorB, params: { tripId: trip.id, id: msgId },
  });
  assert.equal(denied.statusCode, 400);

  const allowed = await call(routes["DELETE /api/trips/:tripId/chat/messages/:id"], {
    user: owner, params: { tripId: trip.id, id: msgId },
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.body.message.deleted, true);
});

test("POST trip chat message/:id/flag: any member can flag", async () => {
  const routes = buildTripsHarness();
  const { owner, trip } = makeTrip("R6");
  const editor = freshUser("R6e");
  trips.joinByCode(trip.inviteCode, editor.id);
  const posted = await call(routes["POST /api/trips/:tripId/chat/messages"], {
    user: owner, params: { tripId: trip.id }, body: { text: "flag me" },
  });
  const res = await call(routes["POST /api/trips/:tripId/chat/messages/:id/flag"], {
    user: editor, params: { tripId: trip.id, id: posted.body.message.id }, body: { reason: "spam" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message.flagged, true);
  assert.equal(res.body.message.flagReason, "spam");
});

/* ============================================================
   ROUTE-LEVEL — GET /api/chat/rooms (lib/routes/chat.js)
============================================================ */

function buildChatRoomsHarness() {
  const routes = {};
  const register = (method) => (p, ...handlers) => { routes[`${method} ${p}`] = handlers[handlers.length - 1]; };
  const app = { get: register("GET"), post: register("POST"), delete: register("DELETE") };
  chatRoutes(app, {
    chat, family, trips, store,
    notifications: { notifyChatMessage: async () => {} },
    gifs: {},
    requireAuth: (req, res, next) => next(),
    requireParent: (req, res, next) => next(),
    requireFamily: (req, res, next) => next(),
    userRole,
    gifLimiter: (req, res, next) => next(),
  });
  return routes;
}

function callChat(handler, user) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      set() { return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ statusCode: this.statusCode, body: b }); },
    };
    handler({ body: {}, params: {}, query: {}, user }, res);
  });
}

test("GET /api/chat/rooms: a guest with no family and no trips sees no rooms", async () => {
  const routes = buildChatRoomsHarness();
  const guest = freshUser("Rooms1");
  const res = await callChat(routes["GET /api/chat/rooms"], guest);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, []);
});

test("GET /api/chat/rooms: a guest who joined a trip sees ONLY the trip room (no family entry)", async () => {
  const routes = buildChatRoomsHarness();
  const { trip } = makeTrip("Rooms2");
  const guest = freshUser("Rooms2g");
  trips.joinByCode(trip.inviteCode, guest.id);
  const res = await callChat(routes["GET /api/chat/rooms"], guest);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].roomId, "trip:" + trip.id);
  assert.equal(res.body[0].tripId, trip.id);
  assert.equal(res.body[0].title, trip.name);
  assert.equal(res.body[0].memberCount, 2);
});

test("GET /api/chat/rooms: a parent with a family and a trip sees both rooms", async () => {
  const routes = buildChatRoomsHarness();
  const { owner, trip, fam } = makeTrip("Rooms3");
  const res = await callChat(routes["GET /api/chat/rooms"], owner);
  const roomIds = res.body.map((r) => r.roomId);
  assert.ok(roomIds.includes("family"));
  assert.ok(roomIds.includes("trip:" + trip.id));
  const familyRoom = res.body.find((r) => r.roomId === "family");
  assert.equal(familyRoom.title, fam.name);
});

test("GET /api/chat/rooms: a kid sees the family room but NEVER a trip chat room (kid-read excluded)", async () => {
  const routes = buildChatRoomsHarness();
  const { trip, fam } = makeTrip("Rooms4");
  const { kid } = family.addKid(fam.id, fam.parentIds[0], { name: "Kiddo" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const res = await callChat(routes["GET /api/chat/rooms"], kidUser);
  const roomIds = res.body.map((r) => r.roomId);
  assert.ok(roomIds.includes("family"));
  assert.ok(!roomIds.includes("trip:" + trip.id));
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-hermes-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const store = require("../lib/store");
const db = require("../lib/db");
const family = require("../lib/family");
const trips = require("../lib/trips");
const chat = require("../lib/chat");
const hermes = require("../lib/hermes");
const hermesRoutes = require("../lib/routes/hermes");
const chatRoutes = require("../lib/routes/chat");
const tripsRoutes = require("../lib/routes/trips");

let userCounter = 0;
function freshUser(label, role = "parent") {
  userCounter += 1;
  const user = store.createUser(`${label}${userCounter}@example.com`, `User ${label}${userCounter}`);
  if (role !== "parent") {
    user.data.profile.role = role;
    db.persist();
  }
  return user;
}

function makeFamily(label = "Hermes") {
  const parent = freshUser(`${label}Parent`);
  return { parent, fam: family.createFamily(parent.id, `${label} Family`) };
}

function userRole(user) {
  return (user && user.data && user.data.profile && user.data.profile.role) || "parent";
}

function buildHermesHarness(notifyCalls = []) {
  const routes = {};
  const register = (method) => (pattern, ...handlers) => {
    routes[`${method} ${pattern}`] = { method, handlers };
  };
  const app = { get: register("GET"), post: register("POST"), delete: register("DELETE") };
  hermesRoutes(app, {
    hermes,
    family,
    chat,
    store,
    notifications: {
      notifyChatMessage: async (...args) => notifyCalls.push({ kind: "family", args }),
      notifyTripChatMessage: async (...args) => notifyCalls.push({ kind: "trip", args }),
    },
    requireAuth: (req, res, next) => (req.user ? next() : res.status(401).json({ error: "Not authenticated" })),
    requireParent: (req, res, next) => (userRole(req.user) === "kid" ? res.status(403).json({ error: "Parents only." }) : next()),
    requireFamily: (req, res, next) => {
      const fams = family.familiesForUser(req.user.id);
      if (!fams.length) return res.status(404).json({ error: "No family." });
      req.family = fams[0];
      return next();
    },
  });
  return routes;
}

function buildFamilyChatHarness() {
  const routes = {};
  const register = (method) => (pattern, ...handlers) => {
    routes[`${method} ${pattern}`] = handlers[handlers.length - 1];
  };
  chatRoutes({
    get: register("GET"),
    post: register("POST"),
    delete: register("DELETE"),
  }, {
    chat,
    notifications: { notifyChatMessage: async () => {} },
    store,
    family,
    trips,
    gifs: {},
    requireAuth: (req, res, next) => next(),
    requireParent: (req, res, next) => next(),
    requireFamily: (req, res, next) => next(),
    userRole,
    gifLimiter: (req, res, next) => next(),
  });
  return routes;
}

function buildTripChatHarness() {
  const routes = {};
  const register = (method) => (pattern, ...handlers) => {
    routes[`${method} ${pattern}`] = { method, handlers };
  };
  tripsRoutes({
    get: register("GET"),
    post: register("POST"),
    patch: register("PATCH"),
    delete: register("DELETE"),
  }, {
    trips,
    store,
    family,
    chat,
    userRole,
    notifications: {
      notifyTripEvent: async () => {},
      notifyTripChatMessage: async () => {},
    },
    requireAuth: (req, res, next) => (req.user ? next() : res.status(401).json({ error: "Not authenticated" })),
    authLimiter: (req, res, next) => next(),
  });
  return routes;
}

function invoke(route, { user = null, familyId, body, params, query, headers, host } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const res = {
      statusCode: 200,
      body: null,
      set() { return this; },
      status(code) { this.statusCode = code; return this; },
      json(body_) {
        if (settled) return this;
        settled = true;
        this.body = body_;
        resolve(this);
        return this;
      },
    };
    const normalizedHeaders = Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
    if (host) normalizedHeaders.host = host;
    const req = {
      method: route.method,
      body: body || {},
      params: params || {},
      query: query || {},
      user,
      family: familyId ? family.getFamily(familyId) : undefined,
      protocol: "https",
      headers: normalizedHeaders,
      get(name) { return normalizedHeaders[String(name).toLowerCase()]; },
      on() {},
    };
    let index = 0;
    const run = () => {
      if (index >= route.handlers.length) return undefined;
      const handler = route.handlers[index++];
      return handler(req, res, run);
    };
    Promise.resolve().then(run).catch((error) => {
      if (!settled) reject(error);
    });
  });
}

function bearer(token) {
  return { authorization: `Bearer ${token}` };
}

function createTrip(ownerUserId, familyId, name) {
  const result = trips.createTrip(ownerUserId, familyId, {
    name,
    destination: "Rome, IT",
    startDate: "2026-09-01",
    endDate: "2026-09-10",
  });
  assert.ok(result.trip, result.error);
  return result.trip;
}

test("Hermes connection lifecycle is parent-only and never exposes the stored bearer", async () => {
  const { parent, fam } = makeFamily("Lifecycle");
  const kid = freshUser("LifecycleKid", "kid");
  const outsider = freshUser("LifecycleOutsider");
  const routes = buildHermesHarness();
  const connectRoute = routes["POST /api/hermes/connect"];
  const statusRoute = routes["GET /api/hermes/connect"];
  const roomsRoute = routes["GET /api/hermes/rooms"];

  const connected = await invoke(connectRoute, { user: parent, familyId: fam.id, host: "app.example.test" });
  assert.equal(connected.statusCode, 200);
  assert.match(connected.body.token, /^hermes_[A-Za-z0-9_-]+$/);
  assert.equal(connected.body.connection.familyId, fam.id);
  assert.equal(connected.body.apiBaseUrl, "https://app.example.test/api/hermes");
  const firstToken = connected.body.token;

  const saved = family.getFamily(fam.id).hermesConnection;
  assert.equal(typeof saved.tokenHash, "string");
  assert.equal(saved.tokenHash.length, 64);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, "token"), false);
  assert.equal(JSON.stringify(saved).includes(firstToken), false);
  assert.equal(JSON.stringify(db.load()).includes(firstToken), false);

  const status = await invoke(statusRoute, { user: parent, familyId: fam.id });
  assert.equal(status.statusCode, 200);
  assert.equal(status.body.connection.familyId, fam.id);
  assert.equal(Object.prototype.hasOwnProperty.call(status.body, "token"), false);
  assert.equal(JSON.stringify(status.body).includes(firstToken), false);

  const kidConnect = await invoke(connectRoute, { user: kid, familyId: fam.id });
  assert.equal(kidConnect.statusCode, 403);
  const unauthenticatedConnect = await invoke(connectRoute);
  assert.equal(unauthenticatedConnect.statusCode, 401);
  const outsiderConnect = await invoke(connectRoute, { user: outsider });
  assert.equal(outsiderConnect.statusCode, 404);
  const missingToken = await invoke(roomsRoute);
  assert.equal(missingToken.statusCode, 401);
  assert.equal(missingToken.body.error, "Invalid or expired Hermes token.");

  const rotated = await invoke(connectRoute, { user: parent, familyId: fam.id });
  assert.equal(rotated.statusCode, 200);
  assert.notEqual(rotated.body.token, firstToken);
  const oldToken = await invoke(roomsRoute, { headers: bearer(firstToken) });
  assert.equal(oldToken.statusCode, 401);

  family.getFamily(fam.id).hermesConnection.expiresAt = new Date(Date.now() - 1000).toISOString();
  db.persist();
  const expired = await invoke(roomsRoute, { headers: bearer(rotated.body.token) });
  assert.equal(expired.statusCode, 401);
  const expiredStatus = await invoke(statusRoute, { user: parent, familyId: fam.id });
  assert.equal(expiredStatus.statusCode, 200);
  assert.equal(expiredStatus.body.connection, null);

  const reconnected = await invoke(connectRoute, { user: parent, familyId: fam.id });
  const revoked = await invoke(routes["DELETE /api/hermes/connect"], { user: parent, familyId: fam.id });
  assert.deepEqual(revoked.body, { ok: true });
  const afterRevoke = await invoke(roomsRoute, { headers: bearer(reconnected.body.token) });
  assert.equal(afterRevoke.statusCode, 401);
  const finalStatus = await invoke(statusRoute, { user: parent, familyId: fam.id });
  assert.equal(finalStatus.body.connection, null);
});

test("Hermes rooms are family-scoped and agent replies preserve the Hermes sender", async () => {
  const { parent, fam } = makeFamily("Rooms");
  const otherParent = freshUser("RoomsOtherParent");
  const otherFam = family.createFamily(otherParent.id, "Other Family");
  const guest = freshUser("RoomsGuest");
  const kidParent = freshUser("RoomsKidParent");
  const kidFam = family.createFamily(kidParent.id, "Kid Family");
  const { kid } = family.addKid(kidFam.id, kidParent.id, { name: "Kid" });
  const kidUser = store.findOrCreateKidUser(kidFam.id, kid.id, kid.name);
  const notifyCalls = [];
  const routes = buildHermesHarness(notifyCalls);
  const connected = await invoke(routes["POST /api/hermes/connect"], { user: parent, familyId: fam.id });
  const headers = bearer(connected.body.token);

  const ownedTrip = createTrip(parent.id, fam.id, "Owned Trip");
  const associatedTrip = createTrip(guest.id, null, "Associated Trip");
  assert.ok(trips.joinByCode(associatedTrip.inviteCode, parent.id).trip);
  const unrelatedTrip = createTrip(otherParent.id, otherFam.id, "Unrelated Trip");
  const kidOnlyTrip = createTrip(otherParent.id, otherFam.id, "Kid Read Only Trip");
  assert.ok(trips.joinByCode(kidOnlyTrip.inviteCode, kidUser.id).trip);

  const roomList = await invoke(routes["GET /api/hermes/rooms"], { headers });
  assert.equal(roomList.statusCode, 200);
  assert.deepEqual(roomList.body.rooms.map((room) => room.roomId), [
    "family",
    `trip:${ownedTrip.id}`,
    `trip:${associatedTrip.id}`,
  ]);
  assert.equal(roomList.body.rooms.some((room) => room.roomId === `trip:${unrelatedTrip.id}`), false);
  assert.equal(roomList.body.rooms.some((room) => room.roomId === `trip:${kidOnlyTrip.id}`), false);

  const familySeed = await invoke(routes["GET /api/hermes/rooms/:roomId/messages"], {
    headers, params: { roomId: "family" },
  });
  assert.equal(familySeed.statusCode, 200);
  const familyReply = await invoke(routes["POST /api/hermes/rooms/:roomId/messages"], {
    headers, params: { roomId: "family" }, body: { text: "Family answer" },
  });
  assert.equal(familyReply.statusCode, 200);
  assert.equal(familyReply.body.message.senderType, "agent");
  assert.equal(familyReply.body.message.senderId, "hermes");
  assert.equal(familyReply.body.message.senderName, "Hermes");
  assert.equal(familyReply.body.message.postedByUserId, null);
  assert.equal(chat.getMessage(fam.id, familyReply.body.message.id).senderName, "Hermes");

  const tripReply = await invoke(routes["POST /api/hermes/rooms/:roomId/messages"], {
    headers, params: { roomId: `trip:${associatedTrip.id}` }, body: { text: "Trip answer" },
  });
  assert.equal(tripReply.statusCode, 200);
  assert.equal(tripReply.body.message.roomId, `trip:${associatedTrip.id}`);
  assert.equal(tripReply.body.message.senderName, "Hermes");
  assert.equal(tripReply.body.message.postedByUserId, null);
  assert.equal(chat.getMessage(`trip:${associatedTrip.id}`, tripReply.body.message.id).senderId, "hermes");
  assert.deepEqual(notifyCalls.map((call) => [call.kind, call.args[0] || null]), [
    ["family", {
      familyParentIds: [parent.id],
      familyKidUserIds: [],
      senderUserId: null,
      senderName: "Hermes",
      familyId: fam.id,
      text: "Family answer",
    }],
    ["trip", associatedTrip],
  ]);
  assert.deepEqual(notifyCalls[1].args.slice(1), [null, "Hermes", "Trip answer"]);

  const unavailable = await invoke(routes["GET /api/hermes/rooms/:roomId/messages"], {
    headers, params: { roomId: `trip:${unrelatedTrip.id}` },
  });
  const missing = await invoke(routes["GET /api/hermes/rooms/:roomId/messages"], {
    headers, params: { roomId: "trip:does-not-exist" },
  });
  assert.equal(unavailable.statusCode, 403);
  assert.deepEqual(unavailable.body, missing.body);
  const unauthorizedPost = await invoke(routes["POST /api/hermes/rooms/:roomId/messages"], {
    headers, params: { roomId: `trip:${kidOnlyTrip.id}` }, body: { text: "should fail" },
  });
  assert.equal(unauthorizedPost.statusCode, 403);
  assert.equal(unavailable.body.error, "Room is not available.");

  const chatRoute = buildFamilyChatHarness()["GET /api/chat/messages"];
  const familyMessages = await invoke({ method: "GET", handlers: [chatRoute] }, { familyId: fam.id });
  const visibleFamilyReply = familyMessages.body.messages.find((message) => message.id === familyReply.body.message.id);
  assert.equal(visibleFamilyReply.senderName, "Hermes");

  const tripRoute = buildTripChatHarness()["GET /api/trips/:tripId/chat/messages"];
  const tripMessages = await invoke(tripRoute, { user: parent, params: { tripId: associatedTrip.id } });
  const visibleTripReply = tripMessages.body.messages.find((message) => message.id === tripReply.body.message.id);
  assert.equal(visibleTripReply.senderName, "Hermes");
});

test("Hermes inbound polling seeds history, filters to mentions, and cannot loop on agent messages", async () => {
  const { parent, fam } = makeFamily("Inbound");
  const routes = buildHermesHarness();
  const connected = await invoke(routes["POST /api/hermes/connect"], { user: parent, familyId: fam.id });
  const headers = bearer(connected.body.token);

  const oldMention = chat.sendMessage(fam.id, { senderType: "parent", senderId: parent.id, text: "old @Hermes" }).message;
  const oldPlain = chat.sendMessage(fam.id, { senderType: "parent", senderId: parent.id, text: "old plain" }).message;
  const initial = await invoke(routes["GET /api/hermes/rooms/:roomId/messages"], {
    headers, params: { roomId: "family" },
  });
  assert.equal(initial.statusCode, 200);
  assert.deepEqual(initial.body.messages, []);
  assert.equal(initial.body.cursor, oldPlain.id);

  const mention = chat.sendMessage(fam.id, { senderType: "parent", senderId: parent.id, text: "please @hermes help" }).message;
  chat.sendMessage(fam.id, { senderType: "parent", senderId: parent.id, text: "not addressed" });
  const deleted = chat.sendMessage(fam.id, { senderType: "parent", senderId: parent.id, text: "delete @Hermes" }).message;
  assert.ok(!chat.deleteMessage(fam.id, parent.id, deleted.id).error);
  const agent = hermes.sendAgentMessage(fam.id, "agent @Hermes reply").message;

  const afterInitial = await invoke(routes["GET /api/hermes/rooms/:roomId/messages"], {
    headers,
    params: { roomId: "family" },
    query: { afterId: initial.body.cursor },
  });
  assert.deepEqual(afterInitial.body.messages.map((message) => message.id), [mention.id]);
  assert.equal(afterInitial.body.messages[0].senderType, "parent");
  assert.equal(afterInitial.body.cursor, agent.id);

  const afterMention = await invoke(routes["GET /api/hermes/rooms/:roomId/messages"], {
    headers,
    params: { roomId: "family" },
    query: { afterId: mention.id },
  });
  assert.deepEqual(afterMention.body.messages, []);
  assert.equal(afterMention.body.cursor, agent.id);

  const waiting = invoke(routes["GET /api/hermes/rooms/:roomId/messages"], {
    headers,
    params: { roomId: "family" },
    query: { afterId: agent.id, wait: "1" },
  });
  setTimeout(() => chat.sendMessage(fam.id, {
    senderType: "parent", senderId: parent.id, text: "wake @Hermes",
  }), 20);
  const woken = await Promise.race([
    waiting,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Hermes long-poll did not wake")), 1000)),
  ]);
  assert.equal(woken.body.messages.length, 1);
  assert.equal(woken.body.messages[0].text, "wake @Hermes");

  const emptyFamily = makeFamily("Empty");
  const emptyConnected = await invoke(routes["POST /api/hermes/connect"], { user: emptyFamily.parent, familyId: emptyFamily.fam.id });
  // This harness represents one primary-family parent; use the helper directly
  // to exercise the empty-room continuation marker without changing tokens.
  const emptySeed = hermes.listInboundMessages(emptyFamily.fam.id);
  assert.deepEqual(emptySeed.messages, []);
  assert.equal(emptySeed.cursor, null);
  const late = chat.sendMessage(emptyFamily.fam.id, {
    senderType: "parent", senderId: emptyFamily.parent.id, text: "late @Hermes",
  }).message;
  const afterEmpty = hermes.listInboundMessages(emptyFamily.fam.id, hermes.EMPTY_CURSOR);
  assert.deepEqual(afterEmpty.messages.map((message) => message.id), [late.id]);
  assert.equal(afterEmpty.cursor, late.id);
  assert.ok(emptyConnected.body.token);
  assert.equal(oldMention.senderType, "parent");
});

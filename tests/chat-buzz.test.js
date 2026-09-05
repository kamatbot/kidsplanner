"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-chat-buzz-"));
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
  return store.createUser(`${label}${userCounter}@example.com`, `User ${label}${userCounter}`);
}

function userRole(user) {
  return (user && user.data && user.data.profile && user.data.profile.role) || "parent";
}

function call(route, { body, params, user } = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      body: null,
      set() { return this; },
      setHeader() { return this; },
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; resolve(this); },
    };
    const req = {
      method: route.method,
      body: body || {},
      params: params || {},
      query: {},
      user: user || null,
      on() {},
    };
    let index = -1;
    function next() {
      index++;
      if (index >= route.handlers.length) return;
      try {
        const result = route.handlers[index](req, res, next);
        if (result && typeof result.then === "function") result.catch(reject);
      } catch (error) {
        reject(error);
      }
    }
    next();
  });
}

function familyAccessMiddleware(req, res, next) {
  const fam = family.familiesForUser(req.user.id)[0] || null;
  if (!fam) return res.status(404).json({ error: "No family." });
  req.family = fam;
  next();
}

function buildFamilyRoutes({ notifyCalls, limiterCalls }) {
  const routes = {};
  const register = (method) => (pattern, ...handlers) => {
    routes[`${method} ${pattern}`] = { method, handlers };
  };
  const app = { get: register("GET"), post: register("POST"), delete: register("DELETE") };
  const requireAuth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    next();
  };
  const buzzLimiter = (req, res, next) => {
    limiterCalls.push(req.method);
    next();
  };
  chatRoutes(app, {
    chat,
    store,
    family,
    trips,
    gifs: {},
    notifications: {
      notifyChatMessage: async () => {},
      notifyChatBuzz: async (args) => notifyCalls.push(args),
    },
    requireAuth,
    requireParent: (req, res, next) => next(),
    requireFamily: familyAccessMiddleware,
    userRole,
    gifLimiter: (req, res, next) => next(),
    buzzLimiter,
  });
  return { routes, requireAuth, buzzLimiter };
}

function tripAccessMiddleware(req, res, next) {
  const trip = trips.getTrip(req.params.tripId);
  if (!trip) return res.status(404).json({ error: "Trip not found." });
  const access = trips.accessFor(req.user, trip);
  if (!access) return res.status(403).json({ error: "You don't have access to this trip." });
  if (access === "kid-read" && req.method !== "GET") {
    return res.status(403).json({ error: "This trip is read-only for kid accounts." });
  }
  req.trip = trip;
  req.tripAccess = access;
  next();
}

function buildTripRoutes({ notifyCalls, limiterCalls }) {
  const routes = {};
  const register = (method) => (pattern, ...handlers) => {
    routes[`${method} ${pattern}`] = { method, handlers };
  };
  const app = { get: register("GET"), post: register("POST"), patch: register("PATCH"), delete: register("DELETE") };
  const requireAuth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    next();
  };
  const buzzLimiter = (req, res, next) => {
    limiterCalls.push(req.method);
    next();
  };
  tripsRoutes(app, {
    trips,
    store,
    family,
    chat,
    userRole,
    notifications: {
      notifyTripEvent: async () => {},
      notifyTripChatMessage: async () => {},
      notifyTripChatBuzz: async (...args) => notifyCalls.push(args),
    },
    requireAuth,
    authLimiter: (req, res, next) => next(),
    buzzLimiter,
  });
  return { routes, requireAuth, buzzLimiter };
}

test("Buzz persistence is strict, empty Buzzes reject, and legacy absence decodes false", () => {
  const sender = freshUser("Persist");
  const fam = family.createFamily(sender.id, "Persistence family");
  const ordinary = chat.sendMessage(fam.id, { senderType: "parent", senderId: sender.id, text: "ordinary" });
  const buzz = chat.sendMessage(fam.id, { senderType: "parent", senderId: sender.id, text: "urgent", buzz: true });
  const stringFlag = chat.sendMessage(fam.id, { senderType: "parent", senderId: sender.id, text: "not a buzz", buzz: "true" });
  const empty = chat.sendMessage(fam.id, { senderType: "parent", senderId: sender.id, text: "  ", buzz: true });
  const withCard = chat.sendMessage(fam.id, { senderType: "parent", senderId: sender.id, text: "card is not allowed", card: { type: "event", id: "e1" }, buzz: true });

  assert.equal(ordinary.message.buzz, false);
  assert.equal(buzz.message.buzz, true);
  assert.equal(stringFlag.message.buzz, false);
  assert.equal(empty.error, "Message is empty.");
  assert.equal(withCard.error, "Buzz messages cannot include cards or media.");
  assert.deepEqual(chat.listMessages(fam.id).map((message) => message.buzz), [false, true, false]);

  if (chat.getBackend() === "json") {
    const db = require("../lib/db");
    const root = db.load();
    root.chats[fam.id].messages.push({
      id: "legacy-no-buzz",
      familyId: fam.id,
      senderType: "parent",
      senderId: sender.id,
      postedByUserId: sender.id,
      text: "legacy",
      card: null,
      media: null,
      createdAt: new Date().toISOString(),
      deleted: false,
      deletedBy: null,
      flagged: false,
      flagReason: null,
      flaggedBy: null,
    });
    db.persist();
    assert.equal(chat.getMessage(fam.id, "legacy-no-buzz").buzz, false);
  }
});

test("family Buzz route is auth/scope protected, isolated from normal messages, and derives sender", async () => {
  const sender = freshUser("FamilyBuzz");
  const recipient = freshUser("FamilyRecipient");
  const outsider = freshUser("FamilyOutsider");
  const fam = family.createFamily(sender.id, "Buzz family");
  family.joinFamilyAsParent(fam.inviteCode, recipient.id);
  const notifyCalls = [];
  const limiterCalls = [];
  const built = buildFamilyRoutes({ notifyCalls, limiterCalls });
  const buzzRoute = built.routes["POST /api/chat/buzz"];
  const normalRoute = built.routes["POST /api/chat/messages"];

  assert.deepEqual(buzzRoute.handlers.slice(0, 3), [built.requireAuth, built.buzzLimiter, familyAccessMiddleware]);
  assert.ok(!normalRoute.handlers.includes(built.buzzLimiter));

  const ordinary = await call(normalRoute, {
    user: sender,
    body: { text: "ordinary", buzz: true, senderId: outsider.id },
  });
  assert.equal(ordinary.statusCode, 200);
  assert.equal(ordinary.body.message.buzz, false);
  assert.equal(limiterCalls.length, 0);

  const buzz = await call(buzzRoute, {
    user: sender,
    body: {
      text: "Urgent family update",
      senderId: outsider.id,
      card: { type: "event", id: "forged" },
      media: { type: "gif", url: "https://giphy.com/forged", previewUrl: "https://giphy.com/forged" },
    },
  });
  assert.equal(buzz.statusCode, 200);
  assert.equal(buzz.body.message.buzz, true);
  assert.equal(buzz.body.message.senderId, sender.id);
  assert.equal(buzz.body.message.postedByUserId, sender.id);
  assert.equal(buzz.body.message.card, null);
  assert.equal(buzz.body.message.media, null);
  assert.equal(limiterCalls.length, 1);
  // Provider I/O must not happen before the message response. Delivery is
  // durable in the outbox and verified explicitly after the response. Revoke
  // the recipient before draining to prove retries re-check current membership.
  assert.equal(notifyCalls.length, 0);
  family.removeMember(fam.id, sender.id, recipient.id);
  await notificationOutbox.drain();
  assert.equal(notifyCalls.length, 1);
  assert.equal(notifyCalls[0].senderUserId, sender.id);
  assert.equal(notifyCalls[0].familyId, fam.id);
  assert.equal(notifyCalls[0].messageId, buzz.body.message.id);
  assert.deepEqual(notifyCalls[0].familyParentIds, [sender.id]);

  const empty = await call(buzzRoute, { user: sender, body: { text: "   " } });
  assert.equal(empty.statusCode, 400);
  const unauthenticated = await call(buzzRoute, { body: { text: "nope" } });
  assert.equal(unauthenticated.statusCode, 401);
  const outOfScope = await call(buzzRoute, { user: outsider, body: { text: "nope" } });
  assert.equal(outOfScope.statusCode, 404);
});

test("trip Buzz route uses shared limiter plus trip-member scope and derives the member sender", async () => {
  const owner = freshUser("TripOwner");
  const editor = freshUser("TripEditor");
  const outsider = freshUser("TripOutsider");
  const fam = family.createFamily(owner.id, "Trip family");
  const created = trips.createTrip(owner.id, fam.id, {
    name: "Buzz trip", destination: "Rome", startDate: "2026-09-01", endDate: "2026-09-10",
  });
  trips.joinByCode(created.trip.inviteCode, editor.id);
  const notifyCalls = [];
  const limiterCalls = [];
  const built = buildTripRoutes({ notifyCalls, limiterCalls });
  const buzzRoute = built.routes["POST /api/trips/:tripId/chat/buzz"];
  const normalRoute = built.routes["POST /api/trips/:tripId/chat/messages"];

  assert.deepEqual(buzzRoute.handlers.slice(0, 2), [built.requireAuth, built.buzzLimiter]);
  assert.ok(!normalRoute.handlers.includes(built.buzzLimiter));

  const ordinary = await call(normalRoute, {
    user: editor,
    params: { tripId: created.trip.id },
    body: { text: "ordinary", buzz: true, senderId: outsider.id },
  });
  assert.equal(ordinary.statusCode, 200);
  assert.equal(ordinary.body.message.buzz, false);
  assert.equal(limiterCalls.length, 0);

  const buzz = await call(buzzRoute, {
    user: editor,
    params: { tripId: created.trip.id },
    body: { text: "Meet at the gate", senderId: outsider.id, card: { type: "event", id: "forged" } },
  });
  assert.equal(buzz.statusCode, 200);
  assert.equal(buzz.body.message.buzz, true);
  assert.equal(buzz.body.message.senderId, editor.id);
  assert.equal(buzz.body.message.postedByUserId, editor.id);
  assert.equal(buzz.body.message.card, null);
  assert.equal(buzz.body.message.media, null);
  assert.equal(limiterCalls.length, 1);
  assert.equal(notifyCalls.length, 1);
  assert.equal(notifyCalls[0][0].id, created.trip.id);
  assert.equal(notifyCalls[0][1], editor.id);
  assert.equal(notifyCalls[0][4], buzz.body.message.id);

  const empty = await call(buzzRoute, { user: editor, params: { tripId: created.trip.id }, body: { text: "" } });
  assert.equal(empty.statusCode, 400);
  const unauthenticated = await call(buzzRoute, { params: { tripId: created.trip.id }, body: { text: "nope" } });
  assert.equal(unauthenticated.statusCode, 401);
  const outOfScope = await call(buzzRoute, { user: outsider, params: { tripId: created.trip.id }, body: { text: "nope" } });
  assert.equal(outOfScope.statusCode, 403);
});

test("server wires one three-per-minute Buzz limiter without putting it on normal chat", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(source, /const buzzLimiter = rateLimit\(\{ windowMs: 60 \* 1000, max: envNum\("RL_BUZZ_MAX", 3\), message: "Too many Buzz alerts/);
  assert.match(source, /apiLimiter, gifLimiter, authLimiter, signupLimiter, buzzLimiter/);
});

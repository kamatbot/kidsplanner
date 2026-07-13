"use strict";
/*
 * Family-events route behavior (lib/routes/calendar.js): the web app now uses
 * these endpoints as the source of truth (migrated off localStorage), so the
 * chat-announcement contract matters — the SERVER posts the "New event" chat
 * message on POST (the web no longer sends its own, or every add would
 * double-post), and `silent: true` (bulk imports / the one-time localStorage
 * migration) must skip it so imports never flood the family chat.
 *
 * The routes module is (app, deps) => {...}; we register its handlers into a
 * plain map and invoke them directly with stub req/res — no HTTP, no auth.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-calroutes-"));

const store = require("../lib/store");
const family = require("../lib/family");
const events = require("../lib/events");
const calendarRoutes = require("../lib/routes/calendar");

function buildHarness() {
  const routes = {};
  const register = (method) => (p, ...handlers) => { routes[`${method} ${p}`] = handlers[handlers.length - 1]; };
  const app = { get: register("GET"), post: register("POST"), patch: register("PATCH"), delete: register("DELETE") };

  const chatPosts = [];
  calendarRoutes(app, {
    schoolFeeds: {}, homework: {}, events,
    chat: { sendMessage: (familyId, msg) => chatPosts.push({ familyId, msg }) },
    requireAuth: (req, res, next) => next(),
    requireParent: (req, res, next) => next(),
    requireFamily: (req, res, next) => next(),
    userRole: (user) => (user && user.data && user.data.kid ? "kid" : "parent"),
    kidIdForUser: (req) => req.user.data.kid.kidId,
    friendlyDate: (d) => d,
  });
  return { routes, chatPosts };
}

function call(handler, { body, params, query, user, familyId } = {}) {
  const res = {
    statusCode: 200,
    body: null,
    set() { return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  handler({
    body: body || {},
    params: params || {},
    query: query || {},
    user: user || { id: "u1", data: {} },
    family: { id: familyId },
  }, res);
  return res;
}

function freshFamily() {
  const parent = store.createUser(`p${Math.random()}@example.com`, "Parent");
  return family.createFamily(parent.id, "Fam");
}

test("POST /api/calendar/events: creates the event and posts a chat announcement", () => {
  const { routes, chatPosts } = buildHarness();
  const fam = freshFamily();
  const res = call(routes["POST /api/calendar/events"], {
    familyId: fam.id,
    body: { title: "Dentist", date: "2026-07-20", time: "15:30" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.event.title, "Dentist");
  assert.equal(chatPosts.length, 1);
  assert.equal(chatPosts[0].familyId, fam.id);
  assert.match(chatPosts[0].msg.text, /New event: Dentist/);
  assert.deepEqual(chatPosts[0].msg.card, { type: "event", id: res.body.event.id, title: "Dentist" });
});

test("POST /api/calendar/events: silent:true skips the chat announcement (bulk import / migration)", () => {
  const { routes, chatPosts } = buildHarness();
  const fam = freshFamily();
  const res = call(routes["POST /api/calendar/events"], {
    familyId: fam.id,
    body: { title: "Maths", date: "2026-07-21", time: "09:00", silent: true },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.event.title, "Maths");
  assert.equal(chatPosts.length, 0);
  // ...but the event is still stored and listed like any other.
  const list = call(routes["GET /api/calendar/events"], { familyId: fam.id });
  assert.deepEqual(list.body.events.map((e) => e.title), ["Maths"]);
});

test("POST /api/calendar/events: a 400 (bad payload) posts nothing to chat", () => {
  const { routes, chatPosts } = buildHarness();
  const fam = freshFamily();
  const res = call(routes["POST /api/calendar/events"], {
    familyId: fam.id,
    body: { title: "", date: "2026-07-20" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(chatPosts.length, 0);
});

test("GET + DELETE /api/calendar/events: round-trip the web app relies on", () => {
  const { routes } = buildHarness();
  const fam = freshFamily();
  const added = call(routes["POST /api/calendar/events"], {
    familyId: fam.id,
    body: { title: "Swim", date: "2026-07-22", silent: true },
  }).body.event;
  assert.ok(added.id.startsWith("ev_")); // the web's server-vs-local id check depends on this prefix

  const del = call(routes["DELETE /api/calendar/events/:id"], { familyId: fam.id, params: { id: added.id } });
  assert.equal(del.statusCode, 200);
  const list = call(routes["GET /api/calendar/events"], { familyId: fam.id });
  assert.equal(list.body.events.length, 0);

  const missing = call(routes["DELETE /api/calendar/events/:id"], { familyId: fam.id, params: { id: "ev_nope" } });
  assert.equal(missing.statusCode, 404);
});

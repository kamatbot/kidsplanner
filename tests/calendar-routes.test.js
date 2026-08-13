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
const trips = require("../lib/trips");
const calendarRoutes = require("../lib/routes/calendar");

function buildHarness() {
  const routes = {};
  const register = (method) => (p, ...handlers) => { routes[`${method} ${p}`] = handlers[handlers.length - 1]; };
  const app = { get: register("GET"), post: register("POST"), patch: register("PATCH"), delete: register("DELETE") };

  const chatPosts = [];
  const chatMessages = new Map();
  calendarRoutes(app, {
    schoolFeeds: {}, homework: {}, events, trips,
    chat: {
      sendMessage: (familyId, msg) => chatPosts.push({ familyId, msg }),
      getMessage: (familyId, id) => chatMessages.get(`${familyId}:${id}`) || null,
    },
    requireAuth: (req, res, next) => next(),
    requireParent: (req, res, next) => next(),
    requireFamily: (req, res, next) => next(),
    userRole: (user) => (user && user.data && user.data.kid ? "kid" : "parent"),
    kidIdForUser: (req) => req.user.data.kid.kidId,
    friendlyDate: (d) => d,
  });
  return { routes, chatPosts, chatMessages };
}

function call(handler, { body, params, query, user, familyId, familyObj } = {}) {
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
    family: familyObj || { id: familyId },
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
  assert.equal(res.body.event.canEdit, true, "the web must show Edit/Delete immediately after creation");
  assert.equal(chatPosts.length, 1);
  assert.equal(chatPosts[0].familyId, fam.id);
  assert.match(chatPosts[0].msg.text, /New event: Dentist/);
  assert.deepEqual(chatPosts[0].msg.card, { type: "event", id: res.body.event.id, title: "Dentist" });
});

test("POST and PATCH return the same canEdit capability used by the web detail view", () => {
  const { routes } = buildHarness();
  const fam = freshFamily();
  const parent = store.getUser(fam.parentIds[0]);
  const created = call(routes["POST /api/calendar/events"], {
    familyId: fam.id,
    user: parent,
    body: { title: "Dentist", date: "2026-07-20", silent: true },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.body.event.canEdit, true);

  const updated = call(routes["PATCH /api/calendar/events/:id"], {
    familyId: fam.id,
    user: parent,
    params: { id: created.body.event.id },
    body: { title: "Dentist follow-up" },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.event.title, "Dentist follow-up");
  assert.equal(updated.body.event.canEdit, true);
});

test("POST /api/calendar/events: chat source is persisted and retries are idempotent", () => {
  const { routes, chatPosts, chatMessages } = buildHarness();
  const fam = freshFamily();
  chatMessages.set(`${fam.id}:m_family_123`, { id: "m_family_123", text: "Pick up Ava", deleted: false });
  const body = {
    title: "Pick up Ava", date: "2026-07-20", time: "17:00",
    sourceType: "chat", sourceId: "m_family_123",
  };
  const first = call(routes["POST /api/calendar/events"], { familyId: fam.id, body });
  const second = call(routes["POST /api/calendar/events"], {
    familyId: fam.id,
    body: { ...body, title: "Changed after confirmation", date: "2026-08-01" },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.existing, false);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.existing, true);
  assert.equal(second.body.event.id, first.body.event.id);
  assert.equal(second.body.event.title, "Pick up Ava");
  assert.equal(second.body.event.sourceType, "chat");
  assert.equal(second.body.event.sourceId, "m_family_123");
  const source = chatMessages.get(`${fam.id}:m_family_123`);
  source.text = "Pick up Ava later";
  source.deleted = true;
  const afterDelete = call(routes["POST /api/calendar/events"], {
    familyId: fam.id,
    body: { ...body, title: "A different retry", date: "2026-09-01" },
  });
  assert.equal(afterDelete.statusCode, 200);
  assert.equal(afterDelete.body.existing, true);
  assert.equal(afterDelete.body.event.id, first.body.event.id);
  assert.equal(afterDelete.body.event.title, "Pick up Ava");
  assert.equal(chatPosts.length, 1, "a retry must not post a second announcement");
});

test("POST /api/calendar/events: parent ECA source persists Ryshi's Aug 25 activity idempotently", () => {
  const { routes, chatPosts } = buildHarness();
  const fam = freshFamily();
  const parent = store.getUser(fam.parentIds[0]);
  const { kid } = family.addKid(fam.id, parent.id, { name: "Ryshi" });
  const body = {
    title: "Basketball activity",
    date: "2026-08-25",
    time: "15:45",
    category: "school",
    notes: "Signed up activity",
    kidId: kid.id,
    sourceType: "eca",
    sourceId: `${kid.id}:834:64894`,
    silent: true,
  };
  const first = call(routes["POST /api/calendar/events"], {
    familyId: fam.id, familyObj: fam, user: parent, body,
  });
  const retry = call(routes["POST /api/calendar/events"], {
    familyId: fam.id, familyObj: fam, user: parent, body,
  });

  assert.equal(first.statusCode, 200);
  assert.equal(first.body.existing, false);
  assert.equal(first.body.event.date, "2026-08-25");
  assert.equal(first.body.event.kidId, kid.id);
  assert.equal(first.body.event.sourceType, "eca");
  assert.equal(first.body.event.sourceId, body.sourceId);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.existing, true);
  assert.equal(retry.body.event.id, first.body.event.id);
  assert.equal(chatPosts.length, 0);
});

test("POST /api/calendar/events: ECA sources reject kids, malformed ids, and mismatched kid scope", () => {
  const { routes } = buildHarness();
  const fam = freshFamily();
  const parent = store.getUser(fam.parentIds[0]);
  const first = family.addKid(fam.id, parent.id, { name: "Ryshi" }).kid;
  const second = family.addKid(fam.id, parent.id, { name: "Arya" }).kid;
  const kidUser = store.findOrCreateKidUser(fam.id, first.id, first.name);
  const base = {
    title: "Basketball activity", date: "2026-08-25", time: "15:45",
    kidId: first.id, sourceType: "eca", sourceId: `${first.id}:834:64894`, silent: true,
  };
  const attempts = [
    { user: kidUser, body: base },
    { user: parent, body: { ...base, sourceId: `${first.id}:not-a-number:64894` } },
    { user: parent, body: { ...base, kidId: second.id } },
    { user: parent, body: { ...base, sourceId: `unknown-kid:834:64894`, kidId: "unknown-kid" } },
  ];
  for (const attempt of attempts) {
    const res = call(routes["POST /api/calendar/events"], {
      familyId: fam.id, familyObj: fam, ...attempt,
    });
    assert.equal(res.statusCode, 400);
  }
});

test("POST /api/calendar/events: chat sources are family-keyed and reject trip/invalid references", () => {
  const { routes, chatPosts, chatMessages } = buildHarness();
  const fam = freshFamily();
  const otherFam = freshFamily();
  chatMessages.set(`${fam.id}:m_same`, { id: "m_same", text: "Family scoped", deleted: false });
  chatMessages.set(`${otherFam.id}:m_same`, { id: "m_same", text: "Other scoped", deleted: false });
  const own = call(routes["POST /api/calendar/events"], {
    familyId: fam.id,
    body: { familyId: otherFam.id, title: "Family scoped", date: "2026-07-20", sourceType: "chat", sourceId: "m_same" },
  });
  const other = call(routes["POST /api/calendar/events"], {
    familyId: otherFam.id,
    body: { title: "Other scoped", date: "2026-07-20", sourceType: "chat", sourceId: "m_same" },
  });
  assert.equal(own.statusCode, 200);
  assert.equal(other.statusCode, 200);
  assert.notEqual(own.body.event.id, other.body.event.id);
  assert.equal(own.body.event.familyId, fam.id);
  assert.equal(other.body.event.familyId, otherFam.id);

  const trip = call(routes["POST /api/calendar/events"], {
    familyId: fam.id,
    body: { title: "Trip source", date: "2026-07-20", sourceType: "trip", sourceId: "m_trip_1" },
  });
  const malformed = call(routes["POST /api/calendar/events"], {
    familyId: fam.id,
    body: { title: "Bad source", date: "2026-07-20", sourceType: "chat", sourceId: "trip_1" },
  });
  const invalidSources = [
    { id: "m_trip_room", familyId: fam.id, roomId: "trip:t1", text: "Trip room" },
    { id: "m_trip_scope", familyId: "trip:t1", text: "Trip scope" },
    { id: "m_card", familyId: fam.id, text: "Existing event card", card: { type: "event", id: "ev_1" } },
    { id: "m_foreign", familyId: otherFam.id, text: "Other family" },
  ];
  for (const message of invalidSources) {
    chatMessages.set(`${fam.id}:${message.id}`, message);
    const rejected = call(routes["POST /api/calendar/events"], {
      familyId: fam.id,
      body: { title: "Should reject", date: "2026-07-20", sourceType: "chat", sourceId: message.id },
    });
    assert.equal(rejected.statusCode, 400, message.id);
  }
  assert.equal(trip.statusCode, 400);
  assert.equal(malformed.statusCode, 400);
  assert.equal(chatPosts.length, 2);
});

test("POST /api/calendar/events: unavailable or deleted chat source is rejected", () => {
  const { routes, chatMessages } = buildHarness();
  const fam = freshFamily();
  const missing = call(routes["POST /api/calendar/events"], {
    familyId: fam.id,
    body: { title: "Missing", date: "2026-07-20", sourceType: "chat", sourceId: "m_missing" },
  });
  chatMessages.set(`${fam.id}:m_deleted`, { id: "m_deleted", text: "Old message", deleted: true });
  const deleted = call(routes["POST /api/calendar/events"], {
    familyId: fam.id,
    body: { title: "Deleted", date: "2026-07-20", sourceType: "chat", sourceId: "m_deleted" },
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(deleted.statusCode, 400);
});

test("POST /api/calendar/events: co-parents and kids may create, with family/creator derived server-side", () => {
  const { routes } = buildHarness();
  const fam = freshFamily();
  const parent = store.getUser(fam.parentIds[0]);
  const coParent = store.createUser(`co${Math.random()}@example.com`, "Co-parent");
  family.joinFamilyAsParent(fam.inviteCode, coParent.id);
  const { kid } = family.addKid(fam.id, parent.id, { name: "Calendar Kid" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);

  const parentEvent = call(routes["POST /api/calendar/events"], {
    familyId: fam.id,
    user: coParent,
    body: { familyId: "attacker-family", title: "Co-parent event", date: "2026-07-23", silent: true },
  });
  const kidEvent = call(routes["POST /api/calendar/events"], {
    familyId: fam.id,
    user: kidUser,
    body: { title: "Kid event", date: "2026-07-24", kidId: kid.id, silent: true },
  });
  assert.equal(parentEvent.statusCode, 200);
  assert.equal(kidEvent.statusCode, 200);
  assert.equal(parentEvent.body.event.familyId, fam.id);
  assert.equal(parentEvent.body.event.createdBy, coParent.id);
  assert.equal(kidEvent.body.event.familyId, fam.id);
  assert.equal(kidEvent.body.event.createdBy, kidUser.id);
  assert.equal(kidEvent.body.event.kidId, kid.id);
});

test("DELETE /api/calendar/events: a kid may delete their own event, not a sibling's", () => {
  const { routes } = buildHarness();
  const fam = freshFamily();
  const parent = store.getUser(fam.parentIds[0]);
  const first = family.addKid(fam.id, parent.id, { name: "First Kid" }).kid;
  const second = family.addKid(fam.id, parent.id, { name: "Second Kid" }).kid;
  const firstUser = store.findOrCreateKidUser(fam.id, first.id, first.name);
  const secondUser = store.findOrCreateKidUser(fam.id, second.id, second.name);

  const created = call(routes["POST /api/calendar/events"], {
    familyId: fam.id,
    user: firstUser,
    body: { title: "First kid's event", date: "2026-07-24", kidId: first.id, silent: true },
  }).body.event;
  const siblingDelete = call(routes["DELETE /api/calendar/events/:id"], {
    familyId: fam.id, user: secondUser, params: { id: created.id },
  });
  assert.equal(siblingDelete.statusCode, 403);
  assert.ok(events.getById(fam.id, created.id));

  const ownDelete = call(routes["DELETE /api/calendar/events/:id"], {
    familyId: fam.id, user: firstUser, params: { id: created.id },
  });
  assert.equal(ownDelete.statusCode, 200);
  assert.equal(events.getById(fam.id, created.id), null);
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
  const list = call(routes["GET /api/calendar/events"], {
    familyId: fam.id,
    query: { from: "2026-07-21", to: "2026-07-21" },
  });
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

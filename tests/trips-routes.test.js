"use strict";
/*
 * Trips route behavior (lib/routes/trips.js): the module is (app, deps) =>
 * {...} registering ABSOLUTE paths (calendar-routes precedent). requireTrip
 * is a REAL middleware defined inside the module (never exported), so the
 * harness captures the FULL handler chain per route and runs it in sequence
 * with a next() shim — this exercises requireTrip's 404/403/kid-read logic
 * for real, not a stubbed version of it.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-trips-routes-"));

const store = require("../lib/store");
const family = require("../lib/family");
const trips = require("../lib/trips");
const tripsRoutes = require("../lib/routes/trips");

function userRole(user) {
  return (user && user.data && user.data.profile && user.data.profile.role) || "parent";
}

// requireTrip checks req.method (kid-read is GET-only), so each captured
// route remembers its own HTTP method alongside its handler chain.
function buildHarness() {
  const routes = {};
  const register = (method) => (p, ...handlers) => { routes[`${method} ${p}`] = { method, handlers }; };
  const app = { get: register("GET"), post: register("POST"), patch: register("PATCH"), delete: register("DELETE") };

  tripsRoutes(app, {
    trips, store, family, userRole,
    requireAuth: (req, res, next) => (req.user ? next() : res.status(401).json({ error: "Not authenticated" })),
    authLimiter: (req, res, next) => next(),
  });
  return routes;
}

function call(route, { body, params, query, user } = {}) {
  const res = {
    statusCode: 200,
    body: null,
    set() { return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  const req = { method: route.method, body: body || {}, params: params || {}, query: query || {}, user: user || null };
  const handlers = route.handlers;
  let idx = 0;
  function next() {
    idx++;
    if (idx < handlers.length) handlers[idx](req, res, next);
  }
  handlers[0](req, res, next);
  return res;
}

let n = 0;
function freshParent(label) {
  n++;
  return store.createUser(`${label}${n}@example.com`, `Parent ${label}${n}`);
}
function makeOwner(label) {
  const parent = freshParent(label);
  const fam = family.createFamily(parent.id, `${label} Family`);
  return { parent, fam };
}
function makeGuest(label) {
  return freshParent(label);
}
function makeTrip(label) {
  const { parent, fam } = makeOwner(label);
  const { trip } = trips.createTrip(parent.id, fam.id, {
    name: `${label} Trip`, destination: "Lisbon, PT", startDate: "2026-08-01", endDate: "2026-08-10",
  });
  return { owner: parent, fam, trip };
}

// ---------- requireTrip: 404 / 403 ----------
test("GET /api/trips/:tripId: 404 for an unknown trip", () => {
  const routes = buildHarness();
  const someone = makeGuest("Z1");
  const res = call(routes["GET /api/trips/:tripId"], { user: someone, params: { tripId: "trip_bogus" } });
  assert.equal(res.statusCode, 404);
});

test("GET /api/trips/:tripId: 403 for a stranger (authenticated, not a member, no kid link)", () => {
  const routes = buildHarness();
  const { trip } = makeTrip("Z2");
  const stranger = makeGuest("Z2s");
  const res = call(routes["GET /api/trips/:tripId"], { user: stranger, params: { tripId: trip.id } });
  assert.equal(res.statusCode, 403);
});

// ---------- kid read-only ----------
test("GET /api/trips/:tripId: a kid in the trip's family CAN read it", () => {
  const routes = buildHarness();
  const { trip, fam } = makeTrip("Z3");
  const { kid } = family.addKid(fam.id, fam.parentIds[0], { name: "Kiddo" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const res = call(routes["GET /api/trips/:tripId"], { user: kidUser, params: { tripId: trip.id } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.trip.myRole, "kid");
  assert.equal(res.body.trip.inviteCode, undefined); // stripped for kid-read
});

test("POST /api/trips/:tripId/itinerary: a kid gets 403 (read-only)", () => {
  const routes = buildHarness();
  const { trip, fam } = makeTrip("Z4");
  const { kid } = family.addKid(fam.id, fam.parentIds[0], { name: "Kiddo2" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const res = call(routes["POST /api/trips/:tripId/itinerary"], {
    user: kidUser, params: { tripId: trip.id }, body: { date: "2026-08-01", title: "Museum", category: "sight" },
  });
  assert.equal(res.statusCode, 403);
});

test("POST /api/trips: a kid cannot create a trip", () => {
  const routes = buildHarness();
  const parent = freshParent("Z5p");
  const fam = family.createFamily(parent.id, "Z5 Family");
  const { kid } = family.addKid(fam.id, parent.id, { name: "Kiddo3" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const res = call(routes["POST /api/trips"], { user: kidUser, body: { name: "X", startDate: "2026-08-01", endDate: "2026-08-05" } });
  assert.equal(res.statusCode, 403);
});

// ---------- owner vs editor: regenerate invite ----------
test("POST /api/trips/:tripId/invite/regenerate: owner 200, editor 403", () => {
  const routes = buildHarness();
  const { trip, owner } = makeTrip("Z6");
  const editor = makeGuest("Z6e");
  trips.joinByCode(trip.inviteCode, editor.id);

  const editorRes = call(routes["POST /api/trips/:tripId/invite/regenerate"], { user: editor, params: { tripId: trip.id } });
  assert.equal(editorRes.statusCode, 403);

  const ownerRes = call(routes["POST /api/trips/:tripId/invite/regenerate"], { user: owner, params: { tripId: trip.id } });
  assert.equal(ownerRes.statusCode, 200);
  assert.ok(ownerRes.body.inviteCode);
});

// ---------- owner vs editor: member removal ----------
test("DELETE /api/trips/:tripId/members/:userId: editor cannot remove another member, owner can; a member can self-leave", () => {
  const routes = buildHarness();
  const { trip, owner } = makeTrip("Z7");
  const editorA = makeGuest("Z7a");
  const editorB = makeGuest("Z7b");
  trips.joinByCode(trip.inviteCode, editorA.id);
  trips.joinByCode(trip.inviteCode, editorB.id);

  const denied = call(routes["DELETE /api/trips/:tripId/members/:userId"], {
    user: editorA, params: { tripId: trip.id, userId: editorB.id },
  });
  assert.equal(denied.statusCode, 403);

  const selfLeave = call(routes["DELETE /api/trips/:tripId/members/:userId"], {
    user: editorA, params: { tripId: trip.id, userId: editorA.id },
  });
  assert.equal(selfLeave.statusCode, 200);

  const ownerRemoves = call(routes["DELETE /api/trips/:tripId/members/:userId"], {
    user: owner, params: { tripId: trip.id, userId: editorB.id },
  });
  assert.equal(ownerRemoves.statusCode, 200);

  const unknownMember = call(routes["DELETE /api/trips/:tripId/members/:userId"], {
    user: owner, params: { tripId: trip.id, userId: "u_bogus" },
  });
  assert.equal(unknownMember.statusCode, 404);
});

// ---------- owner vs editor: trip delete ----------
test("DELETE /api/trips/:tripId: editor 403, owner 200", () => {
  const routes = buildHarness();
  const { trip, owner } = makeTrip("Z8");
  const editor = makeGuest("Z8e");
  trips.joinByCode(trip.inviteCode, editor.id);

  const editorRes = call(routes["DELETE /api/trips/:tripId"], { user: editor, params: { tripId: trip.id } });
  assert.equal(editorRes.statusCode, 403);

  const ownerRes = call(routes["DELETE /api/trips/:tripId"], { user: owner, params: { tripId: trip.id } });
  assert.equal(ownerRes.statusCode, 200);
  assert.equal(trips.getTrip(trip.id), null);
});

// ---------- join flow ----------
test("GET then POST /api/trips/join/:code: preview, then join adds the user as editor", () => {
  const routes = buildHarness();
  const { trip } = makeTrip("Z9");
  const joiner = makeGuest("Z9j");

  const preview = call(routes["GET /api/trips/join/:code"], { user: joiner, params: { code: trip.inviteCode } });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.trip.id, trip.id);

  const joined = call(routes["POST /api/trips/join/:code"], { user: joiner, params: { code: trip.inviteCode } });
  assert.equal(joined.statusCode, 200);
  assert.equal(joined.body.trip.myRole, "editor");
  assert.equal(trips.memberRole(trips.getTrip(trip.id), joiner.id), "editor");
});

test("GET /api/trips/join/:code: an invalid code 404s without leaking existence", () => {
  const routes = buildHarness();
  const someone = makeGuest("Z10");
  const res = call(routes["GET /api/trips/join/:code"], { user: someone, params: { code: "NOPE" } });
  assert.equal(res.statusCode, 404);
});

// ---------- list shape ----------
test("GET /api/trips: list includes role + counts + memberFaces for a member trip", () => {
  const routes = buildHarness();
  const { trip, owner } = makeTrip("Z11");
  const res = call(routes["GET /api/trips"], { user: owner });
  assert.equal(res.statusCode, 200);
  const row = res.body.trips.find((t) => t.id === trip.id);
  assert.ok(row);
  assert.equal(row.role, "owner");
  assert.equal(row.counts.members, 1);
  assert.ok(Array.isArray(row.memberFaces));
});

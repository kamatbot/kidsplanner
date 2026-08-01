"use strict";
/*
 * Trips route behavior (lib/routes/trips.js): the module is (app, deps) =>
 * {...} registering ABSOLUTE paths (calendar-routes precedent). requireTrip
 * is a REAL middleware defined inside the module (never exported), so the
 * harness captures the FULL handler chain per route and runs it in sequence
 * with a next() shim — this exercises requireTrip's 404/403/kid-read logic
 * for real, not a stubbed version of it.
 *
 * Some handlers (join, itinerary/flight/lodging add) are async — they await
 * a "push must never block" notifyTripEvent call (lib/fam-notifications.js)
 * before responding — so `call()` always returns a Promise, resolved when
 * res.json() is invoked, whether the handler settles synchronously or not.
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
const chat = require("../lib/chat");
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
    trips, store, family, chat, userRole,
    notifications: { notifyTripEvent: async () => {}, notifyTripChatMessage: async () => {} },
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
    const req = { method: route.method, body: body || {}, params: params || {}, query: query || {}, user: user || null };
    const handlers = route.handlers;
    let idx = 0;
    function next() {
      idx++;
      if (idx < handlers.length) handlers[idx](req, res, next);
    }
    handlers[0](req, res, next);
  });
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
test("GET /api/trips/:tripId: 404 for an unknown trip", async () => {
  const routes = buildHarness();
  const someone = makeGuest("Z1");
  const res = await call(routes["GET /api/trips/:tripId"], { user: someone, params: { tripId: "trip_bogus" } });
  assert.equal(res.statusCode, 404);
});

test("GET /api/trips/:tripId: 403 for a stranger (authenticated, not a member, no kid link)", async () => {
  const routes = buildHarness();
  const { trip } = makeTrip("Z2");
  const stranger = makeGuest("Z2s");
  const res = await call(routes["GET /api/trips/:tripId"], { user: stranger, params: { tripId: trip.id } });
  assert.equal(res.statusCode, 403);
});

// ---------- kid read-only ----------
test("GET /api/trips/:tripId: a kid in the trip's family CAN read it", async () => {
  const routes = buildHarness();
  const { trip, fam } = makeTrip("Z3");
  const { kid } = family.addKid(fam.id, fam.parentIds[0], { name: "Kiddo" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const res = await call(routes["GET /api/trips/:tripId"], { user: kidUser, params: { tripId: trip.id } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.trip.myRole, "kid");
  assert.equal(res.body.trip.inviteCode, undefined); // stripped for kid-read
});

test("POST /api/trips/:tripId/itinerary: a kid gets 403 (read-only)", async () => {
  const routes = buildHarness();
  const { trip, fam } = makeTrip("Z4");
  const { kid } = family.addKid(fam.id, fam.parentIds[0], { name: "Kiddo2" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const res = await call(routes["POST /api/trips/:tripId/itinerary"], {
    user: kidUser, params: { tripId: trip.id }, body: { date: "2026-08-01", title: "Museum", category: "sight" },
  });
  assert.equal(res.statusCode, 403);
});

test("POST /api/trips: a kid cannot create a trip", async () => {
  const routes = buildHarness();
  const parent = freshParent("Z5p");
  const fam = family.createFamily(parent.id, "Z5 Family");
  const { kid } = family.addKid(fam.id, parent.id, { name: "Kiddo3" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const res = await call(routes["POST /api/trips"], { user: kidUser, body: { name: "X", startDate: "2026-08-01", endDate: "2026-08-05" } });
  assert.equal(res.statusCode, 403);
});

// ---------- owner vs editor: regenerate invite ----------
test("POST /api/trips/:tripId/invite/regenerate: owner 200, editor 403", async () => {
  const routes = buildHarness();
  const { trip, owner } = makeTrip("Z6");
  const editor = makeGuest("Z6e");
  trips.joinByCode(trip.inviteCode, editor.id);

  const editorRes = await call(routes["POST /api/trips/:tripId/invite/regenerate"], { user: editor, params: { tripId: trip.id } });
  assert.equal(editorRes.statusCode, 403);

  const ownerRes = await call(routes["POST /api/trips/:tripId/invite/regenerate"], { user: owner, params: { tripId: trip.id } });
  assert.equal(ownerRes.statusCode, 200);
  assert.ok(ownerRes.body.inviteCode);
});

// ---------- owner vs editor: member removal ----------
test("DELETE /api/trips/:tripId/members/:userId: editor cannot remove another member, owner can; a member can self-leave", async () => {
  const routes = buildHarness();
  const { trip, owner } = makeTrip("Z7");
  const editorA = makeGuest("Z7a");
  const editorB = makeGuest("Z7b");
  trips.joinByCode(trip.inviteCode, editorA.id);
  trips.joinByCode(trip.inviteCode, editorB.id);

  const denied = await call(routes["DELETE /api/trips/:tripId/members/:userId"], {
    user: editorA, params: { tripId: trip.id, userId: editorB.id },
  });
  assert.equal(denied.statusCode, 403);

  const selfLeave = await call(routes["DELETE /api/trips/:tripId/members/:userId"], {
    user: editorA, params: { tripId: trip.id, userId: editorA.id },
  });
  assert.equal(selfLeave.statusCode, 200);

  const ownerRemoves = await call(routes["DELETE /api/trips/:tripId/members/:userId"], {
    user: owner, params: { tripId: trip.id, userId: editorB.id },
  });
  assert.equal(ownerRemoves.statusCode, 200);

  const unknownMember = await call(routes["DELETE /api/trips/:tripId/members/:userId"], {
    user: owner, params: { tripId: trip.id, userId: "u_bogus" },
  });
  assert.equal(unknownMember.statusCode, 404);
});

// ---------- owner vs editor: trip delete ----------
test("DELETE /api/trips/:tripId: editor 403, owner 200", async () => {
  const routes = buildHarness();
  const { trip, owner } = makeTrip("Z8");
  const editor = makeGuest("Z8e");
  trips.joinByCode(trip.inviteCode, editor.id);

  const editorRes = await call(routes["DELETE /api/trips/:tripId"], { user: editor, params: { tripId: trip.id } });
  assert.equal(editorRes.statusCode, 403);

  const ownerRes = await call(routes["DELETE /api/trips/:tripId"], { user: owner, params: { tripId: trip.id } });
  assert.equal(ownerRes.statusCode, 200);
  assert.equal(trips.getTrip(trip.id), null);
});

// ---------- join flow ----------
test("GET then POST /api/trips/join/:code: preview, then join adds the user as editor", async () => {
  const routes = buildHarness();
  const { trip } = makeTrip("Z9");
  const joiner = makeGuest("Z9j");

  const preview = await call(routes["GET /api/trips/join/:code"], { user: joiner, params: { code: trip.inviteCode } });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.trip.id, trip.id);

  const joined = await call(routes["POST /api/trips/join/:code"], { user: joiner, params: { code: trip.inviteCode } });
  assert.equal(joined.statusCode, 200);
  assert.equal(joined.body.trip.myRole, "editor");
  assert.equal(trips.memberRole(trips.getTrip(trip.id), joiner.id), "editor");
});

test("GET /api/trips/join/:code: an invalid code 404s without leaking existence", async () => {
  const routes = buildHarness();
  const someone = makeGuest("Z10");
  const res = await call(routes["GET /api/trips/join/:code"], { user: someone, params: { code: "NOPE" } });
  assert.equal(res.statusCode, 404);
});

// ---------- ideas bucket move (v1.1) ----------
test("POST /api/trips/:tripId/itinerary/:id/move: date:null moves the item to Ideas without rejection", async () => {
  const routes = buildHarness();
  const { trip, owner } = makeTrip("Z12");
  const item = trips.addItineraryItem(trip.id, owner.id, { date: "2026-08-01", title: "Museum", category: "sight" }).item;
  const res = await call(routes["POST /api/trips/:tripId/itinerary/:id/move"], {
    user: owner, params: { tripId: trip.id, id: item.id }, body: { date: null },
  });
  assert.equal(res.statusCode, 200);
  const moved = res.body.trip.itinerary.find((i) => i.id === item.id);
  assert.equal(moved.date, null);
});

// ---------- checklists (v1.1) ----------
function checklistHarness(label) {
  const routes = buildHarness();
  const { trip, owner, fam } = makeTrip(label);
  const editor = makeGuest(`${label}e`);
  trips.joinByCode(trip.inviteCode, editor.id);
  const { kid } = family.addKid(fam.id, fam.parentIds[0], { name: "Kiddo" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  return { routes, trip, owner, editor, kidUser };
}

test("checklists: GET-blocked-for-kid route gate does NOT apply — a kid can reach checklist routes (per-handler checks decide)", async () => {
  const { routes, trip, kidUser } = checklistHarness("CKR1");
  // A kid hitting the SHARED create route is still 403'd, but by the
  // per-handler member check, not by a method-based 403 from requireTrip.
  const res = await call(routes["POST /api/trips/:tripId/checklists"], {
    user: kidUser, params: { tripId: trip.id }, body: { title: "Beach gear" },
  });
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /members/);
});

test("POST .../checklists: member creates a shared list; a kid is blocked", async () => {
  const { routes, trip, owner, editor, kidUser } = checklistHarness("CKR2");
  const ownerRes = await call(routes["POST /api/trips/:tripId/checklists"], {
    user: owner, params: { tripId: trip.id }, body: { title: "Beach gear" },
  });
  assert.equal(ownerRes.statusCode, 200);
  assert.equal(ownerRes.body.checklist.kind, "shared");

  const editorRes = await call(routes["POST /api/trips/:tripId/checklists"], {
    user: editor, params: { tripId: trip.id }, body: { title: "Snorkels" },
  });
  assert.equal(editorRes.statusCode, 200);

  const kidRes = await call(routes["POST /api/trips/:tripId/checklists"], {
    user: kidUser, params: { tripId: trip.id }, body: { title: "Nope" },
  });
  assert.equal(kidRes.statusCode, 403);
});

test("POST .../checklists/personal: get-or-create is idempotent and works for a kid (own list)", async () => {
  const { routes, trip, kidUser } = checklistHarness("CKR3");
  const first = await call(routes["POST /api/trips/:tripId/checklists/personal"], { user: kidUser, params: { tripId: trip.id } });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.checklist.kind, "personal");
  assert.equal(first.body.checklist.ownerUserId, kidUser.id);
  const second = await call(routes["POST /api/trips/:tripId/checklists/personal"], { user: kidUser, params: { tripId: trip.id } });
  assert.equal(second.body.checklist.id, first.body.checklist.id);
});

test("shared list items: member can add/toggle/delete; a kid is blocked on every mutation", async () => {
  const { routes, trip, owner, kidUser } = checklistHarness("CKR4");
  const list = (await call(routes["POST /api/trips/:tripId/checklists"], {
    user: owner, params: { tripId: trip.id }, body: { title: "Packing" },
  })).body.checklist;

  const kidAdd = await call(routes["POST /api/trips/:tripId/checklists/:lid/items"], {
    user: kidUser, params: { tripId: trip.id, lid: list.id }, body: { text: "Sunscreen" },
  });
  assert.equal(kidAdd.statusCode, 403);

  const added = await call(routes["POST /api/trips/:tripId/checklists/:lid/items"], {
    user: owner, params: { tripId: trip.id, lid: list.id }, body: { text: "Sunscreen" },
  });
  assert.equal(added.statusCode, 200);
  assert.equal(added.body.item.doneBy, null);

  const kidToggle = await call(routes["PATCH /api/trips/:tripId/checklists/:lid/items/:iid"], {
    user: kidUser, params: { tripId: trip.id, lid: list.id, iid: added.body.item.id }, body: { done: true },
  });
  assert.equal(kidToggle.statusCode, 403);

  const toggled = await call(routes["PATCH /api/trips/:tripId/checklists/:lid/items/:iid"], {
    user: owner, params: { tripId: trip.id, lid: list.id, iid: added.body.item.id }, body: { done: true },
  });
  assert.equal(toggled.statusCode, 200);
  assert.equal(toggled.body.item.doneBy, owner.id);

  const kidDelete = await call(routes["DELETE /api/trips/:tripId/checklists/:lid/items/:iid"], {
    user: kidUser, params: { tripId: trip.id, lid: list.id, iid: added.body.item.id },
  });
  assert.equal(kidDelete.statusCode, 403);

  const deleted = await call(routes["DELETE /api/trips/:tripId/checklists/:lid/items/:iid"], {
    user: owner, params: { tripId: trip.id, lid: list.id, iid: added.body.item.id },
  });
  assert.equal(deleted.statusCode, 200);
});

test("personal list items: a kid has full control of their OWN list, and is blocked from another user's personal list", async () => {
  const { routes, trip, owner, kidUser } = checklistHarness("CKR5");
  const kidList = (await call(routes["POST /api/trips/:tripId/checklists/personal"], { user: kidUser, params: { tripId: trip.id } })).body.checklist;
  const ownerList = (await call(routes["POST /api/trips/:tripId/checklists/personal"], { user: owner, params: { tripId: trip.id } })).body.checklist;

  // kid can add/toggle/delete on their OWN list
  const kidAdd = await call(routes["POST /api/trips/:tripId/checklists/:lid/items"], {
    user: kidUser, params: { tripId: trip.id, lid: kidList.id }, body: { text: "Teddy bear" },
  });
  assert.equal(kidAdd.statusCode, 200);
  const kidToggle = await call(routes["PATCH /api/trips/:tripId/checklists/:lid/items/:iid"], {
    user: kidUser, params: { tripId: trip.id, lid: kidList.id, iid: kidAdd.body.item.id }, body: { done: true },
  });
  assert.equal(kidToggle.statusCode, 200);
  assert.equal(kidToggle.body.item.doneBy, kidUser.id);
  const kidDelete = await call(routes["DELETE /api/trips/:tripId/checklists/:lid/items/:iid"], {
    user: kidUser, params: { tripId: trip.id, lid: kidList.id, iid: kidAdd.body.item.id },
  });
  assert.equal(kidDelete.statusCode, 200);

  // kid is blocked from adding to the OWNER's personal list
  const blocked = await call(routes["POST /api/trips/:tripId/checklists/:lid/items"], {
    user: kidUser, params: { tripId: trip.id, lid: ownerList.id }, body: { text: "Sneaky" },
  });
  assert.equal(blocked.statusCode, 403);
});

test("PATCH .../checklists/:lid title: shared requires membership, personal requires the owner", async () => {
  const { routes, trip, owner, editor, kidUser } = checklistHarness("CKR6");
  const shared = (await call(routes["POST /api/trips/:tripId/checklists"], { user: owner, params: { tripId: trip.id }, body: { title: "Packing" } })).body.checklist;
  const renamedByEditor = await call(routes["PATCH /api/trips/:tripId/checklists/:lid"], {
    user: editor, params: { tripId: trip.id, lid: shared.id }, body: { title: "Group packing" },
  });
  assert.equal(renamedByEditor.statusCode, 200);
  const kidRename = await call(routes["PATCH /api/trips/:tripId/checklists/:lid"], {
    user: kidUser, params: { tripId: trip.id, lid: shared.id }, body: { title: "Nope" },
  });
  assert.equal(kidRename.statusCode, 403);

  const personal = (await call(routes["POST /api/trips/:tripId/checklists/personal"], { user: kidUser, params: { tripId: trip.id } })).body.checklist;
  const ownerRenamesKidList = await call(routes["PATCH /api/trips/:tripId/checklists/:lid"], {
    user: owner, params: { tripId: trip.id, lid: personal.id }, body: { title: "Nope" },
  });
  assert.equal(ownerRenamesKidList.statusCode, 403);
  const kidRenamesOwn = await call(routes["PATCH /api/trips/:tripId/checklists/:lid"], {
    user: kidUser, params: { tripId: trip.id, lid: personal.id }, body: { title: "Kiddo's packing" },
  });
  assert.equal(kidRenamesOwn.statusCode, 200);
});

test("DELETE .../checklists/:lid: shared = trip owner or list creator; personal = owner only", async () => {
  const { routes, trip, owner, editor, kidUser } = checklistHarness("CKR7");
  // shared list created by editor: editor (creator) can delete it
  const sharedByEditor = (await call(routes["POST /api/trips/:tripId/checklists"], { user: editor, params: { tripId: trip.id }, body: { title: "Snacks" } })).body.checklist;
  const strangerDelete = await call(routes["DELETE /api/trips/:tripId/checklists/:lid"], {
    user: kidUser, params: { tripId: trip.id, lid: sharedByEditor.id },
  });
  assert.equal(strangerDelete.statusCode, 403);
  const creatorDelete = await call(routes["DELETE /api/trips/:tripId/checklists/:lid"], {
    user: editor, params: { tripId: trip.id, lid: sharedByEditor.id },
  });
  assert.equal(creatorDelete.statusCode, 200);

  // shared list created by editor, deleted by the trip OWNER (not the creator)
  const sharedByEditor2 = (await call(routes["POST /api/trips/:tripId/checklists"], { user: editor, params: { tripId: trip.id }, body: { title: "Games" } })).body.checklist;
  const ownerDeletesOthers = await call(routes["DELETE /api/trips/:tripId/checklists/:lid"], {
    user: owner, params: { tripId: trip.id, lid: sharedByEditor2.id },
  });
  assert.equal(ownerDeletesOthers.statusCode, 200);

  // personal list: only its own owner may delete it, even the trip owner cannot
  const kidPersonal = (await call(routes["POST /api/trips/:tripId/checklists/personal"], { user: kidUser, params: { tripId: trip.id } })).body.checklist;
  const ownerDeletesKidPersonal = await call(routes["DELETE /api/trips/:tripId/checklists/:lid"], {
    user: owner, params: { tripId: trip.id, lid: kidPersonal.id },
  });
  assert.equal(ownerDeletesKidPersonal.statusCode, 403);
  const kidDeletesOwn = await call(routes["DELETE /api/trips/:tripId/checklists/:lid"], {
    user: kidUser, params: { tripId: trip.id, lid: kidPersonal.id },
  });
  assert.equal(kidDeletesOwn.statusCode, 200);
});

// ---------- list shape ----------
test("GET /api/trips: list includes role + counts + memberFaces for a member trip", async () => {
  const routes = buildHarness();
  const { trip, owner } = makeTrip("Z11");
  const res = await call(routes["GET /api/trips"], { user: owner });
  assert.equal(res.statusCode, 200);
  const row = res.body.trips.find((t) => t.id === trip.id);
  assert.ok(row);
  assert.equal(row.role, "owner");
  assert.equal(row.counts.members, 1);
  assert.ok(Array.isArray(row.memberFaces));
});

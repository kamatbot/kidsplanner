"use strict";
/*
 * Meals route behavior (lib/routes/meals.js): the module is (app, deps) =>
 * {...} registering ABSOLUTE paths (calendar-routes/trips-routes precedent).
 * requireParent/requireFamily are passed in as REAL implementations mirroring
 * server.js (not no-op stubs) so the full permission matrix — parent-only
 * pantry/menu/prefs, the shopping-list kid-write carve-out — is exercised for
 * real, same approach as tests/trips-routes.test.js.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-meals-routes-"));

const store = require("../lib/store");
const family = require("../lib/family");
const meals = require("../lib/meals");
const mealsRoutes = require("../lib/routes/meals");

function userRole(user) {
  return (user && user.data && user.data.kid) ? "kid" : "parent";
}

function buildHarness() {
  const routes = {};
  const register = (method) => (p, ...handlers) => { routes[`${method} ${p}`] = { method, handlers }; };
  const app = { get: register("GET"), post: register("POST"), patch: register("PATCH"), delete: register("DELETE") };

  mealsRoutes(app, {
    meals, store, family, userRole,
    requireAuth: (req, res, next) => (req.user ? next() : res.status(401).json({ error: "Not authenticated" })),
    requireParent: (req, res, next) => (userRole(req.user) === "kid" ? res.status(403).json({ error: "Parents only." }) : next()),
    requireFamily: (req, res, next) => {
      if (userRole(req.user) === "kid") {
        const fam = family.familyForKidUser(req.user);
        if (!fam) return res.status(404).json({ error: "No family found for this account." });
        req.family = fam;
        return next();
      }
      const fams = family.familiesForUser(req.user.id);
      if (!fams.length) return res.status(404).json({ error: "No family yet — create or join one first." });
      req.family = fams[0];
      next();
    },
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
      end() { this.body = null; resolve(this); },
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
function freshFamily(label) {
  n++;
  const parent = store.createUser(`${label}${n}@example.com`, `Parent ${label}${n}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const { kid } = family.addKid(fam.id, parent.id, { name: `Kid ${label}${n}` });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  return { parent, fam, kid, kidUser };
}

// ---------- GET composite ----------

test("GET /api/meals: returns {pantry, menu, shopping, prefs, household}; parents only", async () => {
  const routes = buildHarness();
  const { parent, kidUser } = freshFamily("GA");
  const parentRes = await call(routes["GET /api/meals"], { user: parent });
  assert.equal(parentRes.statusCode, 200);
  assert.deepEqual(Object.keys(parentRes.body).sort(), ["household", "menu", "pantry", "prefs", "shopping"]);
  assert.equal(parentRes.body.household.members.length, 2);
  assert.equal(parentRes.body.household.totalPortions, 1.6); // regular(1.0 default) + small(0.6 kid default)

  // Meals is a parent tool (owner decision 2026-08-03) — a kid can't even read it.
  const kidRes = await call(routes["GET /api/meals"], { user: kidUser });
  assert.equal(kidRes.statusCode, 403);
});

// ---------- prefs: parent-only ----------

test("PATCH /api/meals/prefs: parent 200, kid 403", async () => {
  const routes = buildHarness();
  const { parent, kidUser } = freshFamily("PR");
  const kidRes = await call(routes["PATCH /api/meals/prefs"], { user: kidUser, body: { dinnerTime: "19:00" } });
  assert.equal(kidRes.statusCode, 403);
  const parentRes = await call(routes["PATCH /api/meals/prefs"], { user: parent, body: { dinnerTime: "19:00" } });
  assert.equal(parentRes.statusCode, 200);
  assert.equal(parentRes.body.prefs.dinnerTime, "19:00");
});

// ---------- pantry: parent-only ----------

test("POST /api/meals/pantry: parent 200, kid 403", async () => {
  const routes = buildHarness();
  const { parent, kidUser } = freshFamily("PA");
  const kidRes = await call(routes["POST /api/meals/pantry"], { user: kidUser, body: { name: "Milk", category: "dairy", level: "plenty" } });
  assert.equal(kidRes.statusCode, 403);
  const parentRes = await call(routes["POST /api/meals/pantry"], { user: parent, body: { name: "Milk", category: "dairy", level: "plenty" } });
  assert.equal(parentRes.statusCode, 200);
  assert.equal(parentRes.body.item.name, "Milk");
});

test("PATCH/DELETE /api/meals/pantry/:id: role gate (requireParent) fires before the handler's 404 lookup; a PARENT still gets 404 for an unknown id", async () => {
  const routes = buildHarness();
  const { parent, fam, kidUser } = freshFamily("PB");
  const item = meals.addPantryItem(fam.id, parent.id, { name: "Eggs", category: "protein", level: "plenty" }).item;

  // requireParent is a route-level gate that runs BEFORE the handler even
  // looks the id up — so a kid gets 403 regardless of whether the id exists.
  const unknown = await call(routes["PATCH /api/meals/pantry/:id"], { user: kidUser, params: { id: "pi_bogus" }, body: { level: "low" } });
  assert.equal(unknown.statusCode, 403);

  // Within the handler itself (parent access already granted), 404-before-
  // anything-else applies: an unknown id 404s rather than 400ing on the patch.
  const parentUnknown = await call(routes["PATCH /api/meals/pantry/:id"], { user: parent, params: { id: "pi_bogus" }, body: { level: "low" } });
  assert.equal(parentUnknown.statusCode, 404);

  const kidRes = await call(routes["PATCH /api/meals/pantry/:id"], { user: kidUser, params: { id: item.id }, body: { level: "low" } });
  assert.equal(kidRes.statusCode, 403);

  const parentRes = await call(routes["PATCH /api/meals/pantry/:id"], { user: parent, params: { id: item.id }, body: { level: "low" } });
  assert.equal(parentRes.statusCode, 200);
  assert.equal(parentRes.body.item.level, "low");

  const kidDelete = await call(routes["DELETE /api/meals/pantry/:id"], { user: kidUser, params: { id: item.id } });
  assert.equal(kidDelete.statusCode, 403);
  const parentDelete = await call(routes["DELETE /api/meals/pantry/:id"], { user: parent, params: { id: item.id } });
  assert.equal(parentDelete.statusCode, 200);
  const missingDelete = await call(routes["DELETE /api/meals/pantry/:id"], { user: parent, params: { id: item.id } });
  assert.equal(missingDelete.statusCode, 404);
});

test("POST /api/meals/pantry/bulk: parent-only", async () => {
  const routes = buildHarness();
  const { parent, kidUser } = freshFamily("PC");
  const kidRes = await call(routes["POST /api/meals/pantry/bulk"], { user: kidUser, body: { items: [{ name: "X", category: "other", level: "some" }] } });
  assert.equal(kidRes.statusCode, 403);
  const parentRes = await call(routes["POST /api/meals/pantry/bulk"], { user: parent, body: { items: [{ name: "X", category: "other", level: "some" }] } });
  assert.equal(parentRes.statusCode, 200);
  assert.equal(parentRes.body.items.length, 1);
});

test("POST /api/meals/pantry/undo: 404 for an unknown eventId, kid 403, parent 200 restores the level", async () => {
  const routes = buildHarness();
  const { parent, fam, kidUser } = freshFamily("PD");
  const item = meals.addPantryItem(fam.id, parent.id, { name: "Butter", category: "dairy", level: "plenty" }).item;
  meals.updatePantryItem(fam.id, parent.id, item.id, { level: "some" });
  const events = meals.getState(fam.id).pantryEvents.filter((e) => e.itemId === item.id);
  const stepEvent = events.find((e) => e.from === "plenty" && e.to === "some");

  const missing = await call(routes["POST /api/meals/pantry/undo"], { user: parent, body: { eventId: "pe_bogus" } });
  assert.equal(missing.statusCode, 404);

  const kidRes = await call(routes["POST /api/meals/pantry/undo"], { user: kidUser, body: { eventId: stepEvent.id } });
  assert.equal(kidRes.statusCode, 403);

  const parentRes = await call(routes["POST /api/meals/pantry/undo"], { user: parent, body: { eventId: stepEvent.id } });
  assert.equal(parentRes.statusCode, 200);
  assert.equal(parentRes.body.item.level, "plenty");
});

// ---------- menu: parent-only ----------

test("POST/PATCH/DELETE /api/meals/menu: parent-only, 404 before 403 on PATCH/DELETE for unknown id", async () => {
  const routes = buildHarness();
  const { parent, kidUser } = freshFamily("MN");

  const kidAdd = await call(routes["POST /api/meals/menu"], { user: kidUser, body: { date: "2026-08-20", slot: "dinner", title: "Nope" } });
  assert.equal(kidAdd.statusCode, 403);

  const added = await call(routes["POST /api/meals/menu"], { user: parent, body: { date: "2026-08-20", slot: "dinner", title: "Chicken curry" } });
  assert.equal(added.statusCode, 200);
  assert.equal(added.body.entry.title, "Chicken curry");
  assert.equal(added.body.entry.servesPortions, 1.6); // defaults to household.totalPortions

  const unknownPatch = await call(routes["PATCH /api/meals/menu/:id"], { user: parent, params: { id: "mm_bogus" }, body: { title: "X" } });
  assert.equal(unknownPatch.statusCode, 404);

  const kidPatch = await call(routes["PATCH /api/meals/menu/:id"], { user: kidUser, params: { id: added.body.entry.id }, body: { title: "Sneaky" } });
  assert.equal(kidPatch.statusCode, 403);

  const parentPatch = await call(routes["PATCH /api/meals/menu/:id"], { user: parent, params: { id: added.body.entry.id }, body: { title: "Renamed" } });
  assert.equal(parentPatch.statusCode, 200);
  assert.equal(parentPatch.body.entry.title, "Renamed");

  const kidDelete = await call(routes["DELETE /api/meals/menu/:id"], { user: kidUser, params: { id: added.body.entry.id } });
  assert.equal(kidDelete.statusCode, 403);
  const parentDelete = await call(routes["DELETE /api/meals/menu/:id"], { user: parent, params: { id: added.body.entry.id } });
  assert.equal(parentDelete.statusCode, 200);
});

test("POST /api/meals/menu/:id/cooked: parent-only, steps the pantry down and floors at low", async () => {
  const routes = buildHarness();
  const { parent, fam, kidUser } = freshFamily("MC");
  const item = meals.addPantryItem(fam.id, parent.id, { name: "Rice", category: "grain", level: "low" }).item;
  const entry = meals.addMenuEntry(fam.id, parent.id, { date: "2026-08-21", slot: "dinner", title: "Rice bowl", usesItemIds: [item.id], servesPortions: 2 }).entry;

  const kidRes = await call(routes["POST /api/meals/menu/:id/cooked"], { user: kidUser, params: { id: entry.id } });
  assert.equal(kidRes.statusCode, 403);

  const unknown = await call(routes["POST /api/meals/menu/:id/cooked"], { user: parent, params: { id: "mm_bogus" } });
  assert.equal(unknown.statusCode, 404);

  const parentRes = await call(routes["POST /api/meals/menu/:id/cooked"], { user: parent, params: { id: entry.id } });
  assert.equal(parentRes.statusCode, 200);
  const pantryRow = parentRes.body.pantry.find((p) => p.id === item.id);
  assert.equal(pantryRow.level, "low"); // floored — was already low
});

// ---------- shopping: the kid-write carve-out ----------

test("shopping: parents only — a kid is blocked from adding and from ticking", async () => {
  const routes = buildHarness();
  const { parent, kidUser } = freshFamily("SH");

  const kidAdd = await call(routes["POST /api/meals/shopping"], { user: kidUser, body: { text: "Ice cream", category: "frozen" } });
  assert.equal(kidAdd.statusCode, 403);

  const parentAdd = await call(routes["POST /api/meals/shopping"], { user: parent, body: { text: "Bread", category: "grain" } });
  assert.equal(parentAdd.statusCode, 200);

  const kidTicks = await call(routes["PATCH /api/meals/shopping/:id"], { user: kidUser, params: { id: parentAdd.body.item.id }, body: { done: true } });
  assert.equal(kidTicks.statusCode, 403);

  const parentTicks = await call(routes["PATCH /api/meals/shopping/:id"], { user: parent, params: { id: parentAdd.body.item.id }, body: { done: true } });
  assert.equal(parentTicks.statusCode, 200);
  assert.equal(parentTicks.body.item.done, true);
  assert.equal(parentTicks.body.item.doneBy, parent.id);
});

test("POST /api/meals/shopping/from-pantry and /restock: parent-only, full round trip", async () => {
  const routes = buildHarness();
  const { parent, fam, kidUser } = freshFamily("SR");
  const pantryItem = meals.addPantryItem(fam.id, parent.id, { name: "Cheese", category: "dairy", level: "out" }).item;

  const kidSeed = await call(routes["POST /api/meals/shopping/from-pantry"], { user: kidUser });
  assert.equal(kidSeed.statusCode, 403);

  const seeded = await call(routes["POST /api/meals/shopping/from-pantry"], { user: parent });
  assert.equal(seeded.statusCode, 200);
  assert.equal(seeded.body.items.length, 1);
  assert.equal(seeded.body.items[0].pantryItemId, pantryItem.id);

  await call(routes["PATCH /api/meals/shopping/:id"], { user: parent, params: { id: seeded.body.items[0].id }, body: { done: true } });

  const kidRestock = await call(routes["POST /api/meals/shopping/restock"], { user: kidUser });
  assert.equal(kidRestock.statusCode, 403);

  const restocked = await call(routes["POST /api/meals/shopping/restock"], { user: parent });
  assert.equal(restocked.statusCode, 200);
  assert.equal(restocked.body.items.length, 1);
  const restockedPantryRow = restocked.body.pantry.find((p) => p.id === pantryItem.id);
  assert.equal(restockedPantryRow.level, "plenty");
});

// ---------- self-service profile (item 3) ----------

test("PATCH /api/meals/profile: a parent sets their OWN portion/allergies/proteinTargetG; a kid is blocked", async () => {
  const routes = buildHarness();
  const { parent, kidUser } = freshFamily("PF");

  const kidRes = await call(routes["PATCH /api/meals/profile"], { user: kidUser, body: { portion: "big" } });
  assert.equal(kidRes.statusCode, 403);

  const res = await call(routes["PATCH /api/meals/profile"], {
    user: parent, body: { portion: "big", allergies: ["peanut", "shellfish"], proteinTargetG: 140 },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profile.portion, "big");
  assert.deepEqual(res.body.profile.allergies, ["peanut", "shellfish"]);
  assert.equal(res.body.profile.proteinTargetG, 140);

  // clearing proteinTargetG (opt-out) with null
  const cleared = await call(routes["PATCH /api/meals/profile"], { user: parent, body: { proteinTargetG: null } });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.body.profile.proteinTargetG, null);

  // invalid proteinTargetG rejected
  const invalid = await call(routes["PATCH /api/meals/profile"], { user: parent, body: { proteinTargetG: -5 } });
  assert.equal(invalid.statusCode, 400);
});

// ---------- full §4 permission matrix, end to end ----------

test("permission matrix: EVERY meals route is parent-only", async () => {
  const routes = buildHarness();
  const { parent, kidUser } = freshFamily("PM");

  const seeded = await call(routes["POST /api/meals/shopping"], { user: parent, body: { text: "Dal", category: "protein" } });
  assert.equal(seeded.statusCode, 200);

  // Not an allowlist of a few gated routes — the WHOLE surface. If a meals
  // route is ever added without requireParent, this test fails.
  let checked = 0;
  for (const key of Object.keys(routes)) {
    if (!key.includes("/api/meals")) continue;
    const res = await call(routes[key], {
      user: kidUser,
      params: { id: seeded.body.item.id },
      body: { text: "x", done: true, name: "x", category: "protein", level: "some", eventId: "pe_x", dinnerTime: "19:00" },
    });
    assert.equal(res.statusCode, 403, `${key} let a kid through`);
    checked++;
  }
  assert.ok(checked >= 15, `expected the full meals surface, only saw ${checked} routes`);
});

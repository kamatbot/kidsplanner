"use strict";
/*
 * Meals route behavior (lib/routes/meals.js): the module is (app, deps) =>
 * {...} registering ABSOLUTE paths (calendar-routes/trips-routes precedent).
 * requireParent/requireFamily are passed in as REAL implementations mirroring
 * server.js (not no-op stubs) so the full permission matrix — parent-only
 * pantry/menu/prefs, the family-wide shopping-list carve-out — is exercised for
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
const chat = require("../lib/chat");
const hermes = require("../lib/hermes");
const trips = require("../lib/trips");
const recipeLibrary = require("../lib/recipes");
const mealsRoutes = require("../lib/routes/meals");

function userRole(user) {
  return (user && user.data && user.data.kid) ? "kid" : "parent";
}

function buildHarness() {
  const routes = {};
  const register = (method) => (p, ...handlers) => { routes[`${method} ${p}`] = { method, handlers }; };
  const app = { get: register("GET"), post: register("POST"), patch: register("PATCH"), delete: register("DELETE") };

  mealsRoutes(app, {
    meals, store, family, chat, userRole,
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

function hermesPlanText() {
  return [
    "| Day | Breakfast | Lunch | Dinner |",
    "| --- | --- | --- | --- |",
    "| Monday | Oats | Rice | Safe curry |",
    "| Tuesday | Eggs | Dal | Pasta |",
  ].join("\n");
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

test("GET /api/meals/recipes: lists family-covered recipes and applies filters", async () => {
  const routes = buildHarness();
  const first = freshFamily("RC");
  const recipe = recipeLibrary.all()[0];
  const coreIngredient = recipe.ingredients.find((ingredient) => ingredient.core) || recipe.ingredients[0];
  meals.addPantryItem(first.fam.id, first.parent.id, { name: coreIngredient.name, category: "other", level: "plenty" });

  const list = await call(routes["GET /api/meals/recipes"], { user: first.parent });
  assert.equal(list.statusCode, 200);
  assert.ok(Array.isArray(list.body.recipes));
  assert.ok(list.body.recipes.length > 0);
  const listed = list.body.recipes.find((item) => item.id === recipe.id);
  assert.ok(listed);
  assert.ok(listed.coverage.have.includes(coreIngredient.name));

  const filtered = await call(routes["GET /api/meals/recipes"], {
    user: first.parent,
    query: { cuisine: recipe.cuisine, query: recipe.title, canCookNow: "1" },
  });
  assert.equal(filtered.statusCode, 200);
  assert.ok(filtered.body.recipes.every((item) => item.cuisine === recipe.cuisine));
  assert.ok(filtered.body.recipes.every((item) => item.coverage.coreMissing.length === 0));
});

test("GET /api/meals/recipes/:id: returns detail, isolates pantry coverage, and enforces parent access", async () => {
  const routes = buildHarness();
  const first = freshFamily("RD");
  const second = freshFamily("RDX");
  const recipe = recipeLibrary.all()[0];
  const ingredient = recipe.ingredients[0];
  meals.addPantryItem(first.fam.id, first.parent.id, { name: ingredient.name, category: "other", level: "plenty" });

  const detail = await call(routes["GET /api/meals/recipes/:id"], {
    user: first.parent,
    params: { id: recipe.id },
  });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.recipe.id, recipe.id);
  assert.ok(detail.body.coverage.have.includes(ingredient.name));

  const foreign = await call(routes["GET /api/meals/recipes/:id"], {
    user: second.parent,
    params: { id: recipe.id },
  });
  assert.equal(foreign.statusCode, 200);
  assert.ok(!foreign.body.coverage.have.includes(ingredient.name));

  const missing = await call(routes["GET /api/meals/recipes/:id"], {
    user: first.parent,
    params: { id: "rc_missing" },
  });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.body, { error: "Recipe not found." });

  const kid = await call(routes["GET /api/meals/recipes"], { user: first.kidUser });
  assert.equal(kid.statusCode, 403);
  const anon = await call(routes["GET /api/meals/recipes"], { user: null });
  assert.equal(anon.statusCode, 401);
});

test("GET /api/meals/shopping: family members read a bounded shopping-only projection", async () => {
  const routes = buildHarness();
  const first = freshFamily("SG");
  const second = freshFamily("SGX");
  const pantry = meals.addPantryItem(first.fam.id, first.parent.id, { name: "Rice", category: "grain", level: "low" }).item;
  const added = await call(routes["POST /api/meals/shopping"], {
    user: first.parent,
    body: { text: "Rice", category: "grain", pantryItemId: pantry.id, assigneeUserId: first.kid.id },
  });
  assert.equal(added.statusCode, 200);

  const parentRes = await call(routes["GET /api/meals/shopping"], { user: first.parent });
  const kidRes = await call(routes["GET /api/meals/shopping"], { user: first.kidUser });
  assert.equal(parentRes.statusCode, 200);
  assert.equal(kidRes.statusCode, 200);
  for (const response of [parentRes, kidRes]) {
    assert.deepEqual(Object.keys(response.body), ["shopping"]);
    assert.equal(response.body.shopping.length, 1);
    assert.equal(response.body.shopping[0].text, "Rice");
    assert.equal(response.body.shopping[0].done, false);
    assert.equal(response.body.shopping[0].pantryItemId, undefined);
    assert.equal(response.body.shopping[0].family, undefined);
  }

  const foreign = await call(routes["GET /api/meals/shopping"], { user: second.kidUser });
  assert.equal(foreign.statusCode, 200);
  assert.deepEqual(foreign.body.shopping, []);
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

// ---------- Hermes meal-plan import ----------

test("Hermes meal-plan preview is parent-only, source-scoped, and does not write", async () => {
  const routes = buildHarness();
  const first = freshFamily("HI");
  const foreign = freshFamily("HIX");
  const source = hermes.sendAgentMessage(first.fam.id, hermesPlanText()).message;
  const before = meals.getState(first.fam.id).menu.length;

  const preview = await call(routes["POST /api/meals/menu/import-chat/:messageId/preview"], {
    user: first.parent, params: { messageId: source.id }, body: { startDate: "2026-08-10" },
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.items.length, 6);
  assert.deepEqual(Object.keys(preview.body).sort(), ["blocked", "conflicts", "imported", "items"]);
  assert.equal(preview.body.imported, false);
  assert.deepEqual(preview.body.conflicts, []);
  assert.deepEqual(preview.body.blocked, []);
  assert.equal(meals.getState(first.fam.id).menu.length, before);

  const anon = await call(routes["POST /api/meals/menu/import-chat/:messageId/preview"], {
    user: null, params: { messageId: source.id }, body: { startDate: "2026-08-10" },
  });
  assert.equal(anon.statusCode, 401);
  const kid = await call(routes["POST /api/meals/menu/import-chat/:messageId/preview"], {
    user: first.kidUser, params: { messageId: source.id }, body: { startDate: "2026-08-10" },
  });
  assert.equal(kid.statusCode, 403);
  const foreignRes = await call(routes["POST /api/meals/menu/import-chat/:messageId/preview"], {
    user: foreign.parent, params: { messageId: source.id }, body: { startDate: "2026-08-10" },
  });
  assert.equal(foreignRes.statusCode, 404);
});

test("Hermes meal-plan import blocks unsafe cells, refuses conflicts atomically, replaces selectively, and retries idempotently", async () => {
  const routes = buildHarness();
  const { parent, fam, kid } = freshFamily("HII");
  family.updateKid(fam.id, parent.id, kid.id, { allergies: ["peanut"] });
  meals.updatePrefs(fam.id, { avoid: ["mushroom"] });
  const text = [
    "| Day | Breakfast | Lunch | Dinner |",
    "| --- | --- | --- | --- |",
    "| Monday | Oats | Peanut porridge | Safe curry |",
    "| Tuesday | Eggs | Mushroom noodles | Pasta |",
  ].join("\n");
  const source = hermes.sendAgentMessage(fam.id, text).message;
  const existing = meals.addMenuEntry(fam.id, parent.id, {
    date: "2026-08-10", slot: "dinner", title: "Keep this until confirm",
  }).entry;
  const before = meals.getState(fam.id).menu.map((entry) => entry.id);

  const preview = await call(routes["POST /api/meals/menu/import-chat/:messageId/preview"], {
    user: parent, params: { messageId: source.id }, body: { startDate: "2026-08-10" },
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.blocked.length, 2);
  assert.ok(preview.body.blocked.every((item) => /allergy or dislike/i.test(item.reason)));
  assert.equal(preview.body.conflicts.length, 1);
  assert.equal(preview.body.conflicts[0].existingEntryId, existing.id);

  const refused = await call(routes["POST /api/meals/menu/import-chat/:messageId"], {
    user: parent, params: { messageId: source.id }, body: { startDate: "2026-08-10" },
  });
  assert.equal(refused.statusCode, 409);
  assert.deepEqual(meals.getState(fam.id).menu.map((entry) => entry.id), before);

  const imported = await call(routes["POST /api/meals/menu/import-chat/:messageId"], {
    user: parent, params: { messageId: source.id }, body: { startDate: "2026-08-10", replaceExisting: true },
  });
  assert.equal(imported.statusCode, 200);
  assert.equal(imported.body.existing, false);
  assert.equal(imported.body.importedEntries.length, 4);
  assert.equal(imported.body.blocked.length, 2);
  assert.ok(imported.body.importedEntries.every((entry) => entry.source === "hermes"));
  assert.ok(imported.body.importedEntries.every((entry) => entry.sourceType === "chat" && entry.sourceId === source.id));
  assert.ok(imported.body.importedEntries.every((entry) => entry.servesPortions === 1.6));
  assert.equal(meals.getMenuEntry(fam.id, existing.id), null, "only the conflicting safe slot is replaced");
  const importedPreview = await call(routes["POST /api/meals/menu/import-chat/:messageId/preview"], {
    user: parent, params: { messageId: source.id }, body: { startDate: "2026-08-10" },
  });
  assert.equal(importedPreview.statusCode, 200);
  assert.equal(importedPreview.body.items.length, 6, "preview still returns every parsed entry after import");
  assert.equal(importedPreview.body.imported, true);

  // Source revalidation is deliberately skipped for an idempotent retry.
  chat.deleteMessage(fam.id, parent.id, source.id);
  const retry = await call(routes["POST /api/meals/menu/import-chat/:messageId"], {
    user: parent, params: { messageId: source.id }, body: { startDate: "not-a-date", replaceExisting: true },
  });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.existing, true);
  assert.equal(retry.body.importedEntries.length, 4);
  assert.equal(meals.getState(fam.id).menu.filter((entry) => entry.sourceId === source.id).length, 4);
});

test("Hermes meal-plan import rejects deleted, ordinary, client, and card sources without leaking text", async () => {
  const routes = buildHarness();
  const { parent, fam } = freshFamily("HIS");
  const ordinary = hermes.sendAgentMessage(fam.id, "Dinner is up to you.").message;
  const client = chat.sendMessage(fam.id, { senderType: "parent", senderId: parent.id, text: hermesPlanText() }).message;
  const wrongCardAgent = chat.sendMessage(fam.id, {
    senderType: "agent", senderId: "hermes", postedByUserId: null, text: hermesPlanText(), card: { type: "menu", id: "secret" },
  }).message;
  const system = chat.sendMessage(fam.id, { senderType: "parent", senderId: parent.id, text: hermesPlanText() }).message;
  const deleted = chat.sendMessage(fam.id, { senderType: "agent", senderId: "hermes", text: hermesPlanText() }).message;
  chat.deleteMessage(fam.id, parent.id, deleted.id);
  const trip = trips.createTrip(parent.id, fam.id, {
    name: "Trip source",
    destination: "Rome, IT",
    startDate: "2026-09-01",
    endDate: "2026-09-10",
  }).trip;
  const tripReply = hermes.sendAgentMessage(`trip:${trip.id}`, hermesPlanText()).message;

  // chat.sendMessage intentionally normalizes client senders. Simulate a
  // legacy/system record at the route boundary without changing durable data.
  const getMessage = chat.getMessage;
  chat.getMessage = (familyId, id) => id === system.id
    ? Object.assign({}, getMessage(familyId, id), { senderType: "system" })
    : getMessage(familyId, id);

  try {
    const ordinaryRes = await call(routes["POST /api/meals/menu/import-chat/:messageId/preview"], { user: parent, params: { messageId: ordinary.id }, body: { startDate: "2026-08-10" } });
    assert.equal(ordinaryRes.statusCode, 422);
    const clientRes = await call(routes["POST /api/meals/menu/import-chat/:messageId/preview"], { user: parent, params: { messageId: client.id }, body: { startDate: "2026-08-10" } });
    assert.equal(clientRes.statusCode, 404);
    const cardRes = await call(routes["POST /api/meals/menu/import-chat/:messageId/preview"], { user: parent, params: { messageId: wrongCardAgent.id }, body: { startDate: "2026-08-10" } });
    assert.equal(cardRes.statusCode, 404);
    const systemRes = await call(routes["POST /api/meals/menu/import-chat/:messageId/preview"], { user: parent, params: { messageId: system.id }, body: { startDate: "2026-08-10" } });
    assert.equal(systemRes.statusCode, 404);
    const deletedRes = await call(routes["POST /api/meals/menu/import-chat/:messageId/preview"], { user: parent, params: { messageId: deleted.id }, body: { startDate: "2026-08-10" } });
    assert.equal(deletedRes.statusCode, 404);
    const tripPreview = await call(routes["POST /api/meals/menu/import-chat/:messageId/preview"], { user: parent, params: { messageId: tripReply.id }, body: { startDate: "2026-08-10" } });
    assert.equal(tripPreview.statusCode, 404);
    assert.deepEqual(tripPreview.body, clientRes.body);
    const tripImport = await call(routes["POST /api/meals/menu/import-chat/:messageId"], { user: parent, params: { messageId: tripReply.id }, body: { startDate: "2026-08-10" } });
    assert.equal(tripImport.statusCode, 404);
    assert.deepEqual(tripImport.body, clientRes.body);
    for (const response of [clientRes, cardRes, systemRes, deletedRes, tripPreview, tripImport]) assert.equal(response.body.error.includes("secret"), false);
  } finally {
    chat.getMessage = getMessage;
  }
});

// ---------- shopping: the family-wide write carve-out ----------

test("shopping: parents and kids can add/tick; only parents can edit, assign, or delete", async () => {
  const routes = buildHarness();
  const { parent, kid, kidUser } = freshFamily("SH");

  const kidAdd = await call(routes["POST /api/meals/shopping"], { user: kidUser, body: { text: "Ice cream", category: "frozen" } });
  assert.equal(kidAdd.statusCode, 200);
  assert.equal(kidAdd.body.item.text, "Ice cream");
  assert.equal(kidAdd.body.item.done, false);
  assert.equal(kidAdd.body.item.pantryItemId, undefined);

  const kidToggle = await call(routes["PATCH /api/meals/shopping/:id"], { user: kidUser, params: { id: kidAdd.body.item.id }, body: { done: true } });
  assert.equal(kidToggle.statusCode, 200);
  assert.equal(kidToggle.body.item.done, true);
  assert.equal(kidToggle.body.item.doneBy, kidUser.id);

  const kidEdit = await call(routes["PATCH /api/meals/shopping/:id"], {
    user: kidUser, params: { id: kidAdd.body.item.id }, body: { text: "Retargeted", category: "produce", assigneeUserId: kid.id },
  });
  assert.equal(kidEdit.statusCode, 403);
  assert.equal(kidEdit.body.item, undefined);

  const parentAdd = await call(routes["POST /api/meals/shopping"], { user: parent, body: { text: "Bread", category: "grain" } });
  assert.equal(parentAdd.statusCode, 200);

  const parentEdit = await call(routes["PATCH /api/meals/shopping/:id"], {
    user: parent, params: { id: parentAdd.body.item.id }, body: { text: "Wholegrain bread", category: "grain", assigneeUserId: kid.id },
  });
  assert.equal(parentEdit.statusCode, 200);
  assert.equal(parentEdit.body.item.text, "Wholegrain bread");
  assert.equal(parentEdit.body.item.assigneeUserId, kid.id);

  const parentTicks = await call(routes["PATCH /api/meals/shopping/:id"], { user: parent, params: { id: parentAdd.body.item.id }, body: { done: true } });
  assert.equal(parentTicks.statusCode, 200);
  assert.equal(parentTicks.body.item.done, true);
  assert.equal(parentTicks.body.item.doneBy, parent.id);

  const kidDelete = await call(routes["DELETE /api/meals/shopping/:id"], { user: kidUser, params: { id: parentAdd.body.item.id } });
  assert.equal(kidDelete.statusCode, 403);
  const parentDelete = await call(routes["DELETE /api/meals/shopping/:id"], { user: parent, params: { id: parentAdd.body.item.id } });
  assert.equal(parentDelete.statusCode, 200);
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

test("permission matrix: parent-only Meals routes stay blocked while shopping stays family-wide", async () => {
  const routes = buildHarness();
  const { parent, kidUser } = freshFamily("PM");

  const seeded = await call(routes["POST /api/meals/shopping"], { user: parent, body: { text: "Dal", category: "protein" } });
  assert.equal(seeded.statusCode, 200);

  // Not an allowlist of a few gated routes — the WHOLE surface. If a meals
  // route is ever added without requireParent, this test fails.
  let checked = 0;
  for (const key of Object.keys(routes)) {
    if (!key.includes("/api/meals")) continue;
    if (key === "GET /api/meals/shopping") {
      const read = await call(routes[key], { user: kidUser });
      assert.equal(read.statusCode, 200, `${key} should be kid-readable`);
      checked++;
      continue;
    }
    if (key === "POST /api/meals/shopping") {
      const add = await call(routes[key], { user: kidUser, body: { text: "Kid item" } });
      assert.equal(add.statusCode, 200, `${key} should be kid-writable`);
      checked++;
      continue;
    }
    if (key === "PATCH /api/meals/shopping/:id") {
      const toggle = await call(routes[key], { user: kidUser, params: { id: seeded.body.item.id }, body: { done: true } });
      assert.equal(toggle.statusCode, 200, `${key} should be kid-writable`);
      checked++;
      continue;
    }
    const res = await call(routes[key], {
      user: kidUser,
      params: { id: seeded.body.item.id },
      body: { text: "x", done: true, name: "x", category: "protein", level: "some", eventId: "pe_x", dinnerTime: "19:00" },
    });
    assert.equal(res.statusCode, 403, `${key} let a kid through`);
    checked++;
  }
  assert.ok(checked >= 16, `expected the full meals surface, only saw ${checked} routes`);
});

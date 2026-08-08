"use strict";
/**
 * Meals integration (docs/MEALS-PLAN.md §6/§7): the planner's deterministic
 * fallback, the server-side allergen enforcement, the calendar merge, and the
 * prep-reminder scheduling.
 *
 * No network: ANTHROPIC_API_KEY is deliberately unset so the planner takes the
 * fallback path, which is the path that must always work.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-meals-int-"));
delete process.env.ANTHROPIC_API_KEY;

const store = require("../lib/store");
const family = require("../lib/family");
const meals = require("../lib/meals");
const recipes = require("../lib/recipes");
const mealsRoutes = require("../lib/routes/meals");
const calendarRoutes = require("../lib/routes/calendar");

function harness(mod, extraDeps) {
  const routes = {};
  const reg = (m) => (p, ...h) => { routes[`${m} ${p}`] = h; };
  const app = { get: reg("GET"), post: reg("POST"), patch: reg("PATCH"), delete: reg("DELETE") };
  const chatPosts = [];
  const pushes = [];
  mod(app, Object.assign({
    meals, store, family, recipes,
    chat: { sendMessage: (fid, msg) => { chatPosts.push({ fid, msg }); return { message: msg }; } },
    notifications: { notifyMealPrep: async (p) => { pushes.push(p); return { sent: 1, pruned: 0 }; } },
    requireAuth: (q, s, n) => n(),
    requireFamily: (q, s, n) => n(),
    requireParent: (q, s, n) => n(),
    userRole: (u) => (u && u.data && u.data.kid ? "kid" : "parent"),
  }, extraDeps || {}));
  return { routes, chatPosts, pushes };
}

async function call(handlers, ctx) {
  const res = {
    statusCode: 200, body: null,
    set() { return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  const req = {
    body: ctx.body || {}, params: ctx.params || {}, query: ctx.query || {},
    user: ctx.user, family: ctx.family, method: ctx.method || "POST",
  };
  const chain = Array.isArray(handlers) ? handlers : [handlers];
  for (const h of chain) {
    let advanced = false;
    await h(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

function freshFamily(label) {
  const parent = store.createUser("", `Parent ${label}`);
  const fam = family.createFamily(parent.id, `Fam ${label}`);
  family.addKid(fam.id, parent.id, { name: `Kid ${label}`, grade: "6" });
  return { parent, fam: family.getFamily(fam.id) };
}

test("planner falls back to the pantry library when no AI key is configured", async () => {
  const { routes } = harness(mealsRoutes);
  const { parent, fam } = freshFamily("PL");
  meals.seedStaples(fam.id, parent.id);

  const res = await call(routes["POST /api/meals/menu/plan"], { user: parent, family: fam, body: { days: 5 } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.source, "pantry", "with no key the deterministic planner must run");
  assert.ok(res.body.menu.length >= 5, "a 5-day request should produce 5 dinners");
  assert.ok(res.body.menu.every((e) => e.slot === "dinner"));
});

test("planner posts exactly one chat card for the whole week", async () => {
  const { routes, chatPosts } = harness(mealsRoutes);
  const { parent, fam } = freshFamily("CC");
  meals.seedStaples(fam.id, parent.id);
  meals.addPantryItem(fam.id, parent.id, { name: "Low onions", category: "produce", level: "low" });
  meals.addPantryItem(fam.id, parent.id, { name: "Out garlic", category: "produce", level: "out" });
  const pending = meals.addShoppingItem(fam.id, parent.id, { text: "Coconut milk", category: "dairy" }).item;
  const bought = meals.addShoppingItem(fam.id, parent.id, { text: "Limes", category: "produce" }).item;
  meals.updateShoppingItem(fam.id, parent.id, bought.id, { done: true });

  const res = await call(routes["POST /api/meals/menu/plan"], { user: parent, family: fam, body: { days: 7 } });
  assert.equal(chatPosts.length, 1, "one card per plan, never one per meal");
  const card = chatPosts[0].msg.card;
  assert.equal(card.type, "menu");
  assert.equal(card.id, res.body.menu[0].id, "existing menu card id remains the first written entry");
  assert.equal(card.title, "This week's menu");
  assert.equal(card.sourceType, "meal");
  assert.equal(card.sourceId, card.id);
  assert.equal(card.pendingShoppingCount, 1);
  assert.equal(card.lowPantryCount, 2);
  const expectedPrep = res.body.menu.reduce((count, entry) => count + (entry.prep || []).length, 0);
  assert.equal(card.prepCount, Math.min(99, expectedPrep));
  assert.equal(meals.getShoppingItem(fam.id, pending.id).done, false);
});

test("planner remains successful when the derived meal chat card cannot be posted", async () => {
  const { routes } = harness(mealsRoutes, {
    chat: { sendMessage: () => { throw new Error("chat unavailable"); } },
  });
  const { parent, fam } = freshFamily("CF");
  meals.seedStaples(fam.id, parent.id);

  const res = await call(routes["POST /api/meals/menu/plan"], { user: parent, family: fam, body: { days: 1 } });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.menu.length >= 1);
});

test("planner never plans a dish carrying a household allergen", async () => {
  const { routes } = harness(mealsRoutes);
  const { parent, fam } = freshFamily("AL");
  meals.seedStaples(fam.id, parent.id);
  // The kid is allergic to peanut — kids can't open Meals, but a parent is
  // still cooking for them, so the planner must respect it.
  const kid = fam.kids[0];
  family.updateKid(fam.id, kid.id, { allergies: ["peanut"] });
  const famNow = family.getFamily(fam.id);

  const res = await call(routes["POST /api/meals/menu/plan"], { user: parent, family: famNow, body: { days: 7 } });
  assert.equal(res.statusCode, 200);
  for (const entry of res.body.menu) {
    const hay = `${entry.title} ${entry.note}`.toLowerCase();
    assert.ok(!hay.includes("peanut"), `planned "${entry.title}" despite a peanut allergy`);
  }
});

test("lactose-free planning still fills the week", async () => {
  const { routes } = harness(mealsRoutes);
  const { parent, fam } = freshFamily("LF");
  meals.seedStaples(fam.id, parent.id);
  meals.updatePrefs(fam.id, { diets: ["lactose-free"], targets: { proteinGPerMeal: 20, fiberGPerMeal: 20 } });

  const res = await call(routes["POST /api/meals/menu/plan"], { user: parent, family: fam, body: { days: 7 } });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.menu.length >= 5, "a strict diet plus macro floors must not empty the week");
});

test("replanning replaces a day rather than stacking duplicates", async () => {
  const { routes } = harness(mealsRoutes);
  const { parent, fam } = freshFamily("RP");
  meals.seedStaples(fam.id, parent.id);

  const first = await call(routes["POST /api/meals/menu/plan"], { user: parent, family: fam, body: { days: 3 } });
  const second = await call(routes["POST /api/meals/menu/plan"], { user: parent, family: fam, body: { days: 3 } });
  const dates = second.body.menu.map((e) => `${e.date}|${e.slot}`);
  assert.equal(new Set(dates).size, dates.length, "each date+slot must hold one dinner");
  assert.equal(first.statusCode, 200);
});

test("prep reminders are scheduled ahead of dinner and pulled out of quiet hours", () => {
  const { parent, fam } = freshFamily("PR");
  meals.updatePrefs(fam.id, { dinnerTime: "18:30" });
  // Idli batter ferments 12h: 18:30 − 12h = 06:30, inside quiet hours, so the
  // reminder must shift EARLIER (never later — the ferment needs the time).
  const idli = recipes.all().find((r) => (r.prep || []).some((p) => p.leadHours >= 12));
  assert.ok(idli, "library should contain a long-lead recipe");
  const added = meals.addMenuEntry(fam.id, parent.id, { date: "2026-09-10", slot: "dinner", recipeId: idli.id, servesPortions: 2 });
  meals.stampPrepSchedule(fam.id, added.entry.id);

  const entry = meals.getMenuEntry(fam.id, added.entry.id);
  const long = entry.prep.find((p) => p.leadHours >= 12);
  const due = new Date(long.dueAt);
  const h = due.getHours();
  assert.ok(h >= meals.QUIET_END_H && h < meals.QUIET_START_H, `reminder landed at ${h}:00, inside quiet hours`);
  assert.ok(due < new Date("2026-09-10T18:30:00"), "reminder must precede dinner");
});

test("the prep sweep notifies once and is capped per day", async () => {
  const { routes, pushes } = harness(mealsRoutes);
  const { parent, fam } = freshFamily("SW");
  const withPrep = recipes.all().filter((r) => (r.prep || []).length).slice(0, 5);
  for (let i = 0; i < withPrep.length; i++) {
    const added = meals.addMenuEntry(fam.id, parent.id, { date: "2020-01-0" + (i + 1), slot: "dinner", recipeId: withPrep[i].id, servesPortions: 2 });
    meals.stampPrepSchedule(fam.id, added.entry.id); // all long past due
  }
  await call(routes["POST /api/meals/prep/sweep"], { user: parent, family: fam });
  assert.ok(pushes.length > 0, "past-due prep should notify");
  assert.ok(pushes.length <= meals.MAX_PREP_NOTIFICATIONS_PER_DAY, "capped per day");

  const firstRound = pushes.length;
  await call(routes["POST /api/meals/prep/sweep"], { user: parent, family: fam });
  assert.equal(pushes.length, firstRound, "the sweep is idempotent — no double-notify");
});

test("calendar merges dinners as read-only events kids can still see", async () => {
  const { routes } = harness(calendarRoutes, {
    schoolFeeds: {}, homework: {}, trips: { allTrips: () => [] },
    events: { listEvents: () => [], canManage: () => true },
    kidIdForUser: () => null, friendlyDate: (d) => d,
  });
  const { parent, fam } = freshFamily("CAL");
  meals.addMenuEntry(fam.id, parent.id, { date: "2026-09-12", slot: "dinner", title: "Dal Tadka", servesPortions: 2 });

  const res = await call(routes["GET /api/calendar/events"], { user: parent, family: fam, method: "GET", query: {} });
  const meal = res.body.events.find((e) => e.id.startsWith("meal_ev_"));
  assert.ok(meal, "dinner should appear on the family calendar");
  assert.equal(meal.canEdit, false, "synthetic meal events are read-only");
  assert.equal(meal.source, "menu");
  assert.equal(meal.kidId, null, "dinner is family-wide, so kids see it too");
  assert.ok(meal.title.includes("Dal Tadka"));
});

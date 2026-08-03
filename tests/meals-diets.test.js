"use strict";
/**
 * Household diets, per-meal macro floors, and the staples seed.
 *
 * The load-bearing idea under test: a diet must NOT hide food. A lactose-free
 * Indian kitchen still cooks palak paneer — with tofu. So `fitsDiets` only
 * rejects a recipe when a CORE ingredient carries the excluded allergen and no
 * swap covers it, and `swapsFor` hands back the substitutions.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-meals-diets-"));

const store = require("../lib/store");
const family = require("../lib/family");
const meals = require("../lib/meals");
const recipes = require("../lib/recipes");

function makeFamily(label) {
  const parent = store.createUser("", `Parent ${label}`);
  const fam = family.createFamily(parent.id, `Fam ${label}`);
  return { parent, fam };
}

test("every recipe carries a fibre estimate in a sane range", () => {
  for (const r of recipes.all()) {
    assert.equal(typeof r.fiberGPerPortion, "number", `${r.id} missing fiberGPerPortion`);
    assert.ok(r.fiberGPerPortion >= 0 && r.fiberGPerPortion <= 30, `${r.id} fibre out of range`);
  }
  // Dal is the canonical high-fibre dish; it must out-score a plain egg dish.
  const dal = recipes.all().find((r) => /dal|lentil/i.test(r.title));
  assert.ok(dal.fiberGPerPortion >= 4, "a dal should estimate as high fibre");
});

test("lactose-free keeps paneer/ghee dishes but attaches swaps", () => {
  const dairy = recipes.all().filter((r) => (r.allergens || []).includes("dairy"));
  assert.ok(dairy.length > 3, "library should contain dairy dishes to swap");

  const swappable = dairy.filter((r) => recipes.fitsDiets(r, ["lactose-free"]));
  assert.ok(swappable.length > 0, "lactose-free must not delete every dairy dish");

  const withPaneer = dairy.find((r) => r.ingredients.some((i) => /paneer/i.test(i.name)));
  if (withPaneer) {
    const swaps = recipes.swapsFor(withPaneer, ["lactose-free"]);
    assert.ok(swaps.some((s) => /paneer/i.test(s.from) && /tofu/i.test(s.to)),
      "paneer should swap to tofu rather than the dish being hidden");
  }
});

test("a dish whose core allergen has no swap is excluded, not swapped", () => {
  // Vegetarian can't rescue a chicken curry: the core protein has no swap.
  const chicken = recipes.all().find((r) => r.ingredients.some((i) => i.core && /chicken/i.test(i.name)));
  assert.ok(chicken, "library should contain a chicken dish");
  assert.equal(recipes.fitsDiets(chicken, ["vegetarian"]), false);
});

test("search honours diets and per-meal protein/fibre floors", () => {
  const lean = recipes.search({ minProteinG: 20, minFiberG: 10 });
  for (const r of lean) {
    assert.ok(r.proteinGPerPortion >= 20 && r.fiberGPerPortion >= 10);
  }
  const lf = recipes.search({ diets: ["lactose-free"] });
  assert.ok(lf.length > 20, "lactose-free should still leave a full library");
  assert.ok(lf.every((r) => recipes.fitsDiets(r, ["lactose-free"])));
});

test("suggest relaxes macro floors rather than returning an empty week", () => {
  const pantry = recipes.STAPLES.map((s, i) => ({ id: "pi_" + i, name: s.name, category: s.category, level: "plenty" }));
  // Impossible floor — must still return a plan (relaxed once), never [].
  const picks = recipes.suggest(pantry, { count: 5, slots: ["dinner"], diets: ["lactose-free"], minProteinG: 199 });
  assert.ok(picks.length > 0, "an unreachable macro floor must not empty the planner");
  // …but the DIET stays enforced even under relaxation.
  assert.ok(picks.every((r) => recipes.fitsDiets(r, ["lactose-free"])));
});

test("suggest never relaxes allergens", () => {
  const pantry = recipes.STAPLES.map((s, i) => ({ id: "pi_" + i, name: s.name, category: s.category, level: "plenty" }));
  const picks = recipes.suggest(pantry, { count: 8, allergens: ["peanut"], minProteinG: 199 });
  for (const r of picks) assert.ok(!(r.allergens || []).includes("peanut"), `${r.id} leaked a peanut allergen`);
});

test("prefs accept diets + per-meal targets and reject nonsense", () => {
  const { parent, fam } = makeFamily("prefs");
  const ok = meals.updatePrefs(fam.id, { diets: ["lactose-free"], targets: { proteinGPerMeal: 20, fiberGPerMeal: 20 } });
  assert.equal(ok.prefs.diets[0], "lactose-free");
  assert.equal(ok.prefs.targets.proteinGPerMeal, 20);
  assert.equal(ok.prefs.targets.fiberGPerMeal, 20);

  assert.match(meals.updatePrefs(fam.id, { diets: ["paleo-carnivore"] }).error, /Unknown diet/);
  assert.match(meals.updatePrefs(fam.id, { targets: { proteinGPerMeal: 900 } }).error, /between 0 and 200/);
  assert.ok(parent.id);
});

test("staples seed fills an empty pantry once and never duplicates", () => {
  const { parent, fam } = makeFamily("staples");
  const first = meals.seedStaples(fam.id, parent.id);
  assert.ok(first.items.length > 30, "staples should meaningfully stock a kitchen");
  assert.ok(first.items.every((i) => i.level === "some"), "seeded items start at `some`, corrected by the first shop");

  const second = meals.seedStaples(fam.id, parent.id);
  assert.equal(second.items.length, 0, "re-seeding must not duplicate");
  assert.equal(second.pantry.length, first.pantry.length);
});

test("staples cover the dals, whole grains and healthy fats the library needs", () => {
  const names = recipes.STAPLES.map((s) => s.name.toLowerCase()).join(" ");
  for (const need of ["toor", "moong", "chana", "brown rice", "quinoa", "oats", "olive oil", "chia", "spinach", "okra"]) {
    assert.ok(names.includes(need), `staples missing ${need}`);
  }
});

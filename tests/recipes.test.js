"use strict";
// lib/recipes.js is pure data + pure helpers (no db, no network), so unlike
// most tests here there's no FAM_DATA_DIR setup needed — see MEALS-PLAN.md
// §8b and lib/recipes.js's header comment.
const test = require("node:test");
const assert = require("node:assert/strict");

const recipes = require("../lib/recipes.js");

const ALLOWED_CUISINE = new Set(recipes.CUISINES);
const ALLOWED_SLOT = new Set(recipes.SLOTS);
const ALLOWED_CATEGORY = new Set(recipes.INGREDIENT_CATEGORIES);
const ALLOWED_ALLERGEN = new Set(recipes.ALLERGENS);
const NON_VEG_TERMS = ["fish sauce", "shrimp paste", "oyster sauce", "shrimp", "prawn", "fish", "chicken", "pork", "beef", "egg", "bacon", "seafood"];

function ingredientIsNonVeg(name) {
  const n = name.toLowerCase();
  return NON_VEG_TERMS.some((term) => n === term || n.startsWith(term + " ") || n.endsWith(" " + term) || n.includes(" " + term + " "));
}

// ---------- shape validation over the whole library ----------

test("all(): returns the full library with unique, stable rc_ ids", () => {
  const all = recipes.all();
  assert.ok(all.length >= 55, `expected ~60 recipes, got ${all.length}`);
  const ids = new Set(all.map((r) => r.id));
  assert.equal(ids.size, all.length, "recipe ids must be unique");
  all.forEach((r) => assert.ok(r.id.startsWith("rc_"), `${r.id} should start with rc_`));
});

test("every recipe validates against the §8b shape", () => {
  recipes.all().forEach((r) => {
    assert.ok(ALLOWED_CUISINE.has(r.cuisine), `${r.id}: bad cuisine "${r.cuisine}"`);
    assert.ok(typeof r.region === "string" && r.region, `${r.id}: missing region`);
    assert.ok(Array.isArray(r.slots) && r.slots.length > 0, `${r.id}: needs at least one slot`);
    r.slots.forEach((s) => assert.ok(ALLOWED_SLOT.has(s), `${r.id}: bad slot "${s}"`));
    assert.equal(typeof r.veg, "boolean", `${r.id}: veg must be boolean`);
    assert.ok(Number.isInteger(r.spice) && r.spice >= 0 && r.spice <= 3, `${r.id}: spice must be 0-3`);
    assert.equal(typeof r.kidFriendly, "boolean", `${r.id}: kidFriendly must be boolean`);
    assert.ok(Number.isFinite(r.timeMins) && r.timeMins > 0, `${r.id}: timeMins must be positive`);

    assert.ok(Array.isArray(r.prep), `${r.id}: prep must be an array`);
    r.prep.forEach((p) => {
      assert.ok(p.label && typeof p.label === "string", `${r.id}: prep needs a label`);
      assert.ok(Number.isFinite(p.leadHours) && p.leadHours > 0, `${r.id}: prep leadHours must be positive`);
    });

    assert.ok(Array.isArray(r.ingredients) && r.ingredients.length > 0, `${r.id}: needs ingredients`);
    r.ingredients.forEach((ing) => {
      assert.ok(ing.name && typeof ing.name === "string", `${r.id}: ingredient missing name`);
      assert.ok(ALLOWED_CATEGORY.has(ing.category), `${r.id}: bad ingredient category "${ing.category}" for ${ing.name}`);
      assert.equal(typeof ing.core, "boolean", `${r.id}: ingredient.core must be boolean (${ing.name})`);
      assert.ok(typeof ing.qtyHint === "string" && ing.qtyHint, `${r.id}: ingredient missing qtyHint (${ing.name})`);
    });
    assert.ok(r.ingredients.some((i) => i.core), `${r.id}: needs at least one core ingredient`);

    assert.ok(Array.isArray(r.steps), `${r.id}: steps must be an array`);
    assert.ok(r.steps.length >= 3 && r.steps.length <= 8, `${r.id}: steps must be 3-8 lines, got ${r.steps.length}`);
    r.steps.forEach((s) => assert.ok(typeof s === "string" && s.trim().length > 0, `${r.id}: step must be a non-empty line`));

    assert.ok(Number.isInteger(r.proteinGPerPortion) && r.proteinGPerPortion >= 0, `${r.id}: proteinGPerPortion must be a non-negative integer`);
    assert.ok(Array.isArray(r.allergens), `${r.id}: allergens must be an array`);
    r.allergens.forEach((a) => assert.ok(ALLOWED_ALLERGEN.has(a), `${r.id}: bad allergen "${a}"`));
    assert.ok(Array.isArray(r.tags), `${r.id}: tags must be an array`);
  });
});

test("veg-vs-fish-sauce consistency: no veg:true recipe carries a fish/shellfish allergen or a fishy ingredient", () => {
  recipes.all().forEach((r) => {
    if (!r.veg) return;
    assert.ok(!r.allergens.includes("fish"), `${r.id}: veg:true but lists "fish" allergen`);
    assert.ok(!r.allergens.includes("shellfish"), `${r.id}: veg:true but lists "shellfish" allergen`);
    r.ingredients.forEach((ing) => {
      assert.ok(!ingredientIsNonVeg(ing.name), `${r.id}: veg:true but has non-veg ingredient "${ing.name}"`);
    });
  });
});

test("cuisine mix is over-indexed on Indian and Thai per the owner decision", () => {
  const all = recipes.all();
  const counts = { indian: 0, thai: 0, other: 0 };
  all.forEach((r) => counts[r.cuisine]++);
  assert.ok(counts.indian >= 25, `expected >=25 indian, got ${counts.indian}`);
  assert.ok(counts.thai >= 18, `expected >=18 thai, got ${counts.thai}`);
  assert.ok(counts.other >= 8, `expected a reasonable "other" bucket, got ${counts.other}`);
});

test("Indian recipes cover both North and South regions", () => {
  const indian = recipes.search({ cuisine: "indian" });
  const regions = new Set(indian.map((r) => r.region));
  assert.ok(regions.has("north-indian"));
  assert.ok(regions.has("south-indian"));
});

// ---------- byId ----------

test("byId: finds a known recipe, returns null for unknown", () => {
  assert.equal(recipes.byId("rc_dal_tadka").title, "Dal Tadka");
  assert.equal(recipes.byId("rc_bogus"), null);
});

// ---------- search ----------

test("search: filters by cuisine", () => {
  const thai = recipes.search({ cuisine: "thai" });
  assert.ok(thai.length > 0);
  thai.forEach((r) => assert.equal(r.cuisine, "thai"));
});

test("search: filters by veg", () => {
  const veg = recipes.search({ veg: true });
  assert.ok(veg.length > 0);
  veg.forEach((r) => assert.equal(r.veg, true));
});

test("search: filters by slot", () => {
  const breakfast = recipes.search({ slot: "breakfast" });
  assert.ok(breakfast.length > 0);
  breakfast.forEach((r) => assert.ok(r.slots.includes("breakfast")));
});

test("search: filters by kidFriendly", () => {
  const kf = recipes.search({ kidFriendly: true });
  assert.ok(kf.length > 0);
  kf.forEach((r) => assert.equal(r.kidFriendly, true));
});

test("search: filters by maxTimeMins", () => {
  const quick = recipes.search({ maxTimeMins: 20 });
  assert.ok(quick.length > 0);
  quick.forEach((r) => assert.ok(r.timeMins <= 20));
});

test("search: query matches title/tags/ingredients, case-insensitively", () => {
  const byTitle = recipes.search({ query: "dal tadka" });
  assert.ok(byTitle.some((r) => r.id === "rc_dal_tadka"));
  const byIngredient = recipes.search({ query: "paneer" });
  assert.ok(byIngredient.length >= 3);
});

test("search: combined filters narrow correctly", () => {
  const results = recipes.search({ cuisine: "indian", veg: true, slot: "breakfast" });
  results.forEach((r) => {
    assert.equal(r.cuisine, "indian");
    assert.equal(r.veg, true);
    assert.ok(r.slots.includes("breakfast"));
  });
});

// ---------- normalize / synonyms ----------

test("SYNONYMS: cilantro/coriander/dhania are unified", () => {
  assert.ok(recipes.namesMatch("Cilantro", "Coriander leaves"));
  assert.ok(recipes.namesMatch("Dhania", "coriander"));
});

test("SYNONYMS: chilli/chili/chile spellings (incl. plurals) are unified", () => {
  assert.ok(recipes.namesMatch("Chillies", "chili"));
  assert.ok(recipes.namesMatch("Green Chile", "green chilli"));
});

test("SYNONYMS: aubergine/brinjal/eggplant are unified", () => {
  assert.ok(recipes.namesMatch("Brinjal", "eggplant"));
  assert.ok(recipes.namesMatch("Aubergine", "baingan"));
});

test("SYNONYMS: curd/yoghurt/yogurt/dahi are unified", () => {
  assert.ok(recipes.namesMatch("Yogurt", "curd"));
  assert.ok(recipes.namesMatch("Dahi", "yoghurt"));
});

test("SYNONYMS: garbanzo/chickpea/chana are unified", () => {
  assert.ok(recipes.namesMatch("Garbanzo beans", "chana"));
  assert.ok(recipes.namesMatch("Chickpeas", "kabuli chana"));
});

test("SYNONYMS: prawn/shrimp and groundnut/peanut are unified", () => {
  assert.ok(recipes.namesMatch("Prawns", "Shrimp"));
  assert.ok(recipes.namesMatch("Groundnuts", "Peanut"));
});

test("SYNONYMS: toor/arhar/tur dal are unified", () => {
  assert.ok(recipes.namesMatch("Arhar dal", "toor dal"));
  assert.ok(recipes.namesMatch("Tur dal", "toovar dal"));
});

test("SYNONYMS: coconut milk variants are unified", () => {
  assert.ok(recipes.namesMatch("Tinned coconut milk", "coconut cream"));
});

test("normalize: does not falsely unify unrelated compound ingredients", () => {
  // "chili powder" (a spice) must stay distinct from plain "chili" (produce)
  assert.ok(!recipes.namesMatch("Chili Powder", "Green Chili"));
});

// ---------- coverage ----------

test("coverage: computes have/missing/coreMissing/ratio", () => {
  const recipe = recipes.byId("rc_dal_tadka");
  const pantry = [
    { id: "pi_1", name: "Toor dal", category: "protein", level: "plenty" },
    { id: "pi_2", name: "Turmeric", category: "spice", level: "some" },
    { id: "pi_3", name: "Onion", category: "produce", level: "out" }, // out = not available
  ];
  const cov = recipes.coverage(recipe, pantry);
  assert.ok(cov.have.includes("toor dal"));
  assert.ok(cov.have.includes("turmeric"));
  assert.ok(cov.missing.includes("onion")); // "out" pantry level doesn't count as available
  assert.ok(cov.missing.includes("cumin seeds"));
  assert.ok(cov.coreMissing.includes("cumin seeds")); // core ingredient, missing
  assert.ok(!cov.coreMissing.includes("onion")); // onion is not core for dal tadka
  assert.ok(cov.ratio > 0 && cov.ratio < 1);
});

test("coverage: an item with level 'out' never counts as available", () => {
  const recipe = recipes.byId("rc_jeera_rice");
  const pantry = [{ id: "pi_1", name: "Basmati rice", category: "grain", level: "out" }];
  const cov = recipes.coverage(recipe, pantry);
  assert.ok(cov.missing.includes("basmati rice"));
  assert.ok(cov.coreMissing.includes("basmati rice"));
});

test("coverage: full pantry gives ratio 1 and no missing", () => {
  const recipe = recipes.byId("rc_jeera_rice");
  const pantry = recipe.ingredients.map((i, idx) => ({ id: `pi_${idx}`, name: i.name, category: i.category, level: "plenty" }));
  const cov = recipes.coverage(recipe, pantry);
  assert.equal(cov.missing.length, 0);
  assert.equal(cov.coreMissing.length, 0);
  assert.equal(cov.ratio, 1);
});

test("coverage: pantry synonym names count as available (cilantro satisfies a coriander need)", () => {
  const recipe = recipes.byId("rc_paneer_bhurji"); // has "coriander leaves" as a (non-core) ingredient
  const pantry = [{ id: "pi_1", name: "Cilantro", category: "produce", level: "some" }];
  const cov = recipes.coverage(recipe, pantry);
  assert.ok(cov.have.includes("coriander leaves"));
});

// ---------- suggest ----------

function pantryItem(name, level, expiresOn) {
  return { id: `pi_${name}`, name, category: "other", level, expiresOn: expiresOn || null };
}

test("suggest: is deterministic — same inputs produce the same output twice", () => {
  const pantry = [pantryItem("toor dal", "plenty"), pantryItem("paneer", "low"), pantryItem("chicken", "some")];
  const opts = { count: 8, slots: ["dinner"] };
  const first = recipes.suggest(pantry, opts).map((r) => r.id);
  const second = recipes.suggest(pantry, opts).map((r) => r.id);
  assert.deepEqual(first, second);
});

test("suggest: hard-filters recipes matching an allergen", () => {
  const pantry = [];
  const results = recipes.suggest(pantry, { count: 60, allergens: ["peanut"] });
  results.forEach((r) => {
    assert.ok(!r.allergens.includes("peanut"), `${r.id} should have been excluded for peanut allergy`);
    r.ingredients.forEach((ing) => assert.ok(!/peanut|groundnut/i.test(ing.name), `${r.id}: ingredient "${ing.name}" contains peanut`));
  });
});

test("suggest: hard-filters recipes matching an avoid term via synonym (shrimp avoided also excludes prawn)", () => {
  const results = recipes.suggest([], { count: 60, avoid: ["shrimp"] });
  results.forEach((r) => {
    r.ingredients.forEach((ing) => assert.ok(!recipes.namesMatch(ing.name, "shrimp"), `${r.id}: "${ing.name}" should have been excluded as shrimp/prawn`));
  });
});

test("suggest: kidSafe excludes non-kid-friendly recipes", () => {
  const results = recipes.suggest([], { count: 60, kidSafe: true });
  results.forEach((r) => assert.equal(r.kidFriendly, true));
});

test("suggest: slots filter only returns recipes offered in a requested slot", () => {
  const results = recipes.suggest([], { count: 60, slots: ["breakfast"] });
  results.forEach((r) => assert.ok(r.slots.includes("breakfast")));
});

test("suggest: prioritises recipes that use up low-stock or near-expiry pantry items", () => {
  const soon = new Date();
  soon.setDate(soon.getDate() + 2);
  const soonYMD = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;

  // Paneer is low-stock and about to expire — recipes using it should rank
  // above equally-core-complete recipes that don't touch it.
  const pantry = [
    pantryItem("paneer", "low", soonYMD),
    pantryItem("spinach", "plenty"),
    pantryItem("basmati rice", "plenty"),
    pantryItem("cumin seeds", "plenty"),
    pantryItem("bay leaf", "plenty"),
    pantryItem("oil", "plenty"),
  ];
  const results = recipes.suggest(pantry, { count: 60, slots: ["dinner"] });
  const paneerIdx = results.findIndex((r) => r.id === "rc_palak_paneer");
  const jeeraIdx = results.findIndex((r) => r.id === "rc_jeera_rice"); // jeera_rice is lunch/dinner too but doesn't touch paneer
  assert.ok(paneerIdx !== -1, "palak paneer should be a candidate");
  if (jeeraIdx !== -1) {
    assert.ok(paneerIdx < jeeraIdx, "the low+near-expiry-consuming recipe should rank above one that doesn't touch it");
  }
});

test("suggest: never returns the same cuisine more than twice in a row", () => {
  const results = recipes.suggest([], { count: 30, cuisineBias: { indian: 5, thai: 5, other: 1 } });
  for (let i = 2; i < results.length; i++) {
    const three = [results[i - 2].cuisine, results[i - 1].cuisine, results[i].cuisine];
    assert.ok(!(three[0] === three[1] && three[1] === three[2]), `three ${three[0]} in a row at index ${i - 2}..${i}`);
  }
});

test("suggest: respects count", () => {
  const results = recipes.suggest([], { count: 5 });
  assert.equal(results.length, 5);
});

test("suggest: cuisineBias breaks ties among equally-covered recipes (per spec, coreMissing/use-it-up outrank bias)", () => {
  // Per §8b the ranking order is coreMissing, then use-it-up, then
  // cuisineBias, then ratio — so to see bias actually decide the order we
  // need every candidate tied on the earlier keys: an "own everything"
  // pantry makes coreMissing=0 and useItUp=0 for every recipe.
  const omniscientPantry = [];
  const seen = new Set();
  recipes.all().forEach((r) => {
    r.ingredients.forEach((ing) => {
      const key = ing.name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      omniscientPantry.push({ id: `pi_${key}`, name: ing.name, category: ing.category, level: "plenty" });
    });
  });

  const indianHeavy = recipes.suggest(omniscientPantry, { count: 10, cuisineBias: { indian: 10, thai: 0.1, other: 0.1 } });
  const thaiHeavy = recipes.suggest(omniscientPantry, { count: 10, cuisineBias: { thai: 10, indian: 0.1, other: 0.1 } });
  const indianCount = indianHeavy.filter((r) => r.cuisine === "indian").length;
  const thaiCount = thaiHeavy.filter((r) => r.cuisine === "thai").length;
  assert.ok(indianCount >= 5, `expected indian-biased suggest to skew indian, got ${indianCount}/10`);
  assert.ok(thaiCount >= 5, `expected thai-biased suggest to skew thai, got ${thaiCount}/10`);
});

test("suggest: defaults still favour indian+thai (Bangkok household bias)", () => {
  const results = recipes.suggest([], { count: 60 });
  const counts = { indian: 0, thai: 0, other: 0 };
  results.forEach((r) => counts[r.cuisine]++);
  assert.ok(counts.indian + counts.thai > counts.other);
});

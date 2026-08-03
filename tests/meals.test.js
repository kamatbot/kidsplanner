"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-meals-"));

const store = require("../lib/store");
const family = require("../lib/family");
const meals = require("../lib/meals");

let recipesAvailable = true;
try {
  require("../lib/recipes");
} catch (e) {
  recipesAvailable = false;
}

function makeFamilyWithKid(label) {
  const parent = store.createUser(`${label}@example.com`, `Parent ${label}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const { kid } = family.addKid(fam.id, parent.id, { name: `Kid ${label}`, grade: "6" });
  return { parent, fam, kid };
}

// ---------- pantry CRUD + level validation ----------

test("addPantryItem: creates an item, rejects bad category/level, logs a creation event", () => {
  const { fam, parent } = makeFamilyWithKid("A");
  const result = meals.addPantryItem(fam.id, parent.id, { name: "Basmati rice", category: "grain", level: "plenty", unitHint: "1 kg bag" });
  assert.ok(!result.error, result.error);
  assert.equal(result.item.name, "Basmati rice");
  assert.equal(result.item.level, "plenty");

  const state = meals.getState(fam.id);
  const ev = state.pantryEvents.find((e) => e.itemId === result.item.id);
  assert.ok(ev);
  assert.equal(ev.from, null);
  assert.equal(ev.to, "plenty");
  assert.equal(ev.source, "manual");

  assert.ok(meals.addPantryItem(fam.id, parent.id, { name: "X", category: "bogus", level: "plenty" }).error);
  assert.ok(meals.addPantryItem(fam.id, parent.id, { name: "X", category: "grain", level: "bogus" }).error);
  assert.ok(meals.addPantryItem(fam.id, parent.id, { name: "", category: "grain", level: "plenty" }).error);
});

test("addPantryItem: rejects a malformed expiresOn", () => {
  const { fam, parent } = makeFamilyWithKid("A2");
  const result = meals.addPantryItem(fam.id, parent.id, { name: "Milk", category: "dairy", level: "some", expiresOn: "not-a-date" });
  assert.ok(result.error);
});

test("updatePantryItem: level change logs an event; non-level fields don't", () => {
  const { fam, parent } = makeFamilyWithKid("B");
  const { item } = meals.addPantryItem(fam.id, parent.id, { name: "Onions", category: "produce", level: "plenty" });
  const before = meals.getState(fam.id).pantryEvents.length;

  meals.updatePantryItem(fam.id, parent.id, item.id, { unitHint: "5 kg sack" });
  assert.equal(meals.getState(fam.id).pantryEvents.length, before); // no level change, no event

  const result = meals.updatePantryItem(fam.id, parent.id, item.id, { level: "low" });
  assert.equal(result.item.level, "low");
  assert.equal(meals.getState(fam.id).pantryEvents.length, before + 1);
  const ev = meals.getState(fam.id).pantryEvents[meals.getState(fam.id).pantryEvents.length - 1];
  assert.equal(ev.from, "plenty");
  assert.equal(ev.to, "low");
  assert.equal(ev.source, "manual");
});

test("updatePantryItem: rejects invalid level/category, unknown id", () => {
  const { fam, parent } = makeFamilyWithKid("C");
  const { item } = meals.addPantryItem(fam.id, parent.id, { name: "Ghee", category: "dairy", level: "plenty" });
  assert.ok(meals.updatePantryItem(fam.id, parent.id, item.id, { level: "bogus" }).error);
  assert.ok(meals.updatePantryItem(fam.id, parent.id, item.id, { category: "bogus" }).error);
  assert.ok(meals.updatePantryItem(fam.id, parent.id, "pi_bogus", { level: "low" }).error);
});

test("removePantryItem: deletes, 'not found' for unknown id", () => {
  const { fam, parent } = makeFamilyWithKid("D");
  const { item } = meals.addPantryItem(fam.id, parent.id, { name: "Toor dal", category: "pantry", level: "some" });
  assert.ok(!meals.removePantryItem(fam.id, item.id).error);
  assert.equal(meals.getPantryItem(fam.id, item.id), null);
  assert.ok(meals.removePantryItem(fam.id, item.id).error);
});

test("bulkAddPantryItems: creates items from a scan-confirm list, source 'scan', defaults bad category/level", () => {
  const { fam, parent } = makeFamilyWithKid("E");
  const result = meals.bulkAddPantryItems(fam.id, parent.id, [
    { name: "Coconut milk", category: "pantry", levelGuess: "some" },
    { name: "", category: "produce", level: "plenty" }, // dropped: empty name
    { name: "Mystery item", category: "not-a-category", level: "not-a-level" },
  ]);
  assert.ok(!result.error, result.error);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].level, "some");
  assert.equal(result.items[1].category, "other");
  assert.equal(result.items[1].level, "some"); // fallback default
  for (const it of result.items) {
    const ev = meals.getState(fam.id).pantryEvents.find((e) => e.itemId === it.id);
    assert.equal(ev.source, "scan");
  }
});

test("bulkAddPantryItems: rejects a non-array / empty payload", () => {
  const { fam, parent } = makeFamilyWithKid("E2");
  assert.ok(meals.bulkAddPantryItems(fam.id, parent.id, null).error);
  assert.ok(meals.bulkAddPantryItems(fam.id, parent.id, []).error);
});

// ---------- undo ----------

test("undoEvent: reverses exactly the given event, restores `from`, logs a new 'undo' event", () => {
  const { fam, parent } = makeFamilyWithKid("F");
  const { item } = meals.addPantryItem(fam.id, parent.id, { name: "Rajma", category: "pantry", level: "plenty" });
  const step1 = meals.updatePantryItem(fam.id, parent.id, item.id, { level: "some" });
  const step2 = meals.updatePantryItem(fam.id, parent.id, item.id, { level: "low" });
  assert.equal(step2.item.level, "low");

  const events = meals.getState(fam.id).pantryEvents.filter((e) => e.itemId === item.id);
  const step1Event = events.find((e) => e.from === "plenty" && e.to === "some");
  assert.ok(step1Event);

  const undone = meals.undoEvent(fam.id, parent.id, step1Event.id);
  assert.ok(!undone.error, undone.error);
  assert.equal(undone.item.level, "plenty"); // restored to `from` of THAT event, not just "one step back"

  const newEvents = meals.getState(fam.id).pantryEvents.filter((e) => e.itemId === item.id);
  const undoEv = newEvents[newEvents.length - 1];
  assert.equal(undoEv.source, "undo");
  assert.equal(undoEv.to, "plenty");
});

test("undoEvent: unknown event id, and a creation event (from:null) can't be undone", () => {
  const { fam, parent } = makeFamilyWithKid("G");
  const { item } = meals.addPantryItem(fam.id, parent.id, { name: "Chana dal", category: "pantry", level: "plenty" });
  assert.ok(meals.undoEvent(fam.id, parent.id, "pe_bogus").error);
  const creationEvent = meals.getState(fam.id).pantryEvents.find((e) => e.itemId === item.id);
  assert.ok(meals.undoEvent(fam.id, parent.id, creationEvent.id).error);
});

test("pantryEvents: capped at the most recent 200", () => {
  const { fam, parent } = makeFamilyWithKid("H");
  const { item } = meals.addPantryItem(fam.id, parent.id, { name: "Sugar", category: "pantry", level: "plenty" });
  const levels = ["some", "low", "out"];
  for (let i = 0; i < 250; i++) {
    meals.updatePantryItem(fam.id, parent.id, item.id, { level: levels[i % 2 === 0 ? 0 : 1] });
  }
  assert.ok(meals.getState(fam.id).pantryEvents.length <= 200);
});

// ---------- cooked stepping ----------

test("cookMenuEntry: steps every usesItemIds item down one rung", () => {
  const { fam, parent } = makeFamilyWithKid("I");
  const rice = meals.addPantryItem(fam.id, parent.id, { name: "Rice", category: "grain", level: "plenty" }).item;
  const dal = meals.addPantryItem(fam.id, parent.id, { name: "Dal", category: "pantry", level: "some" }).item;
  const menu = meals.addMenuEntry(fam.id, parent.id, {
    date: "2026-08-10", slot: "dinner", title: "Dal rice", usesItemIds: [rice.id, dal.id], servesPortions: 3,
  });
  assert.ok(!menu.error, menu.error);

  const cooked = meals.cookMenuEntry(fam.id, parent.id, menu.entry.id);
  assert.ok(!cooked.error, cooked.error);
  assert.equal(meals.getPantryItem(fam.id, rice.id).level, "some");
  assert.equal(meals.getPantryItem(fam.id, dal.id).level, "low");
});

test("cookMenuEntry: floors at 'low' — never sets 'out', and an already-'out' item stays 'out'", () => {
  const { fam, parent } = makeFamilyWithKid("J");
  const low = meals.addPantryItem(fam.id, parent.id, { name: "Ginger", category: "produce", level: "low" }).item;
  const out = meals.addPantryItem(fam.id, parent.id, { name: "Garlic", category: "produce", level: "out" }).item;
  const menu = meals.addMenuEntry(fam.id, parent.id, {
    date: "2026-08-11", slot: "dinner", title: "Curry", usesItemIds: [low.id, out.id], servesPortions: 3,
  });
  meals.cookMenuEntry(fam.id, parent.id, menu.entry.id);
  assert.equal(meals.getPantryItem(fam.id, low.id).level, "low"); // floored, not "out"
  assert.equal(meals.getPantryItem(fam.id, out.id).level, "out"); // untouched — cooking never "sets" out AND never un-outs it
});

test("cookMenuEntry: ignores usesItemIds pointing at a deleted/unknown pantry item; unknown menu entry errors", () => {
  const { fam, parent } = makeFamilyWithKid("K");
  const menu = meals.addMenuEntry(fam.id, parent.id, {
    date: "2026-08-12", slot: "lunch", title: "Leftovers", usesItemIds: ["pi_bogus"], servesPortions: 1,
  });
  const cooked = meals.cookMenuEntry(fam.id, parent.id, menu.entry.id);
  assert.ok(!cooked.error, cooked.error);
  assert.ok(meals.cookMenuEntry(fam.id, parent.id, "mm_bogus").error);
});

test("stepDownFloorLow: exhaustive ladder behavior", () => {
  assert.equal(meals.stepDownFloorLow("plenty"), "some");
  assert.equal(meals.stepDownFloorLow("some"), "low");
  assert.equal(meals.stepDownFloorLow("low"), "low");
  assert.equal(meals.stepDownFloorLow("out"), "out");
});

// ---------- menu: manual + recipeId ----------

test("addMenuEntry: manual free-text entry validates date/slot/title, sanitizes prep + usesItemIds", () => {
  const { fam, parent } = makeFamilyWithKid("L");
  const item = meals.addPantryItem(fam.id, parent.id, { name: "Paneer", category: "dairy", level: "plenty" }).item;
  const result = meals.addMenuEntry(fam.id, parent.id, {
    date: "2026-08-13", slot: "dinner", title: "Paneer butter masala",
    note: "Kids love this one", prep: [{ label: "Soak cashews", leadHours: 2 }],
    usesItemIds: [item.id, "pi_bogus"], servesPortions: 3.6,
  });
  assert.ok(!result.error, result.error);
  assert.equal(result.entry.title, "Paneer butter masala");
  assert.deepEqual(result.entry.usesItemIds, [item.id]); // bogus id dropped
  assert.equal(result.entry.prep.length, 1);
  assert.ok(result.entry.prep[0].id);
  assert.equal(result.entry.source, "manual");
  assert.equal(result.entry.proteinG, null);

  assert.ok(meals.addMenuEntry(fam.id, parent.id, { date: "bad-date", slot: "dinner", title: "X" }).error);
  assert.ok(meals.addMenuEntry(fam.id, parent.id, { date: "2026-08-13", slot: "brunch", title: "X" }).error);
  assert.ok(meals.addMenuEntry(fam.id, parent.id, { date: "2026-08-13", slot: "dinner" }).error); // no title, no recipeId
});

test("addMenuEntry: recipeId path — 'Recipe not found' for unknown id (also covers 'library unavailable' when lib/recipes.js is absent)", () => {
  const { fam, parent } = makeFamilyWithKid("M");
  const result = meals.addMenuEntry(fam.id, parent.id, { date: "2026-08-14", slot: "dinner", recipeId: "rc_does_not_exist" });
  assert.ok(result.error);
  assert.match(result.error, /Recipe|library/i);
});

if (recipesAvailable) {
  test("addMenuEntry: recipeId path populates title/prep/usesItemIds from a real recipe (lib/recipes.js present)", () => {
    const recipes = require("../lib/recipes");
    const any = recipes.all()[0];
    if (!any) return; // empty seed library — nothing to assert
    const { fam, parent } = makeFamilyWithKid("N");
    const result = meals.addMenuEntry(fam.id, parent.id, { date: "2026-08-15", slot: "dinner", recipeId: any.id });
    assert.ok(!result.error, result.error);
    assert.equal(result.entry.title, any.title);
    assert.equal(result.entry.source, "manual");
  });
} else {
  test("recipeId path: lib/recipes.js not present yet in this run — covered by the 'not found/unavailable' case above", () => {
    assert.ok(true);
  });
}

test("updateMenuEntry / removeMenuEntry", () => {
  const { fam, parent } = makeFamilyWithKid("O");
  const { entry } = meals.addMenuEntry(fam.id, parent.id, { date: "2026-08-16", slot: "dinner", title: "Original" });
  const updated = meals.updateMenuEntry(fam.id, entry.id, { title: "Renamed", slot: "lunch" });
  assert.equal(updated.entry.title, "Renamed");
  assert.equal(updated.entry.slot, "lunch");
  assert.ok(meals.updateMenuEntry(fam.id, entry.id, { slot: "brunch" }).error);
  assert.ok(meals.updateMenuEntry(fam.id, "mm_bogus", { title: "X" }).error);

  const removed = meals.removeMenuEntry(fam.id, entry.id);
  assert.ok(!removed.error);
  assert.equal(meals.getMenuEntry(fam.id, entry.id), null);
  assert.ok(meals.removeMenuEntry(fam.id, entry.id).error);
});

// ---------- shopping CRUD + from-pantry + restock ----------

test("addShoppingItem / updateShoppingItem / removeShoppingItem", () => {
  const { fam, parent } = makeFamilyWithKid("P");
  const result = meals.addShoppingItem(fam.id, parent.id, { text: "Milk", category: "dairy" });
  assert.ok(!result.error, result.error);
  assert.equal(result.item.done, false);
  assert.equal(result.item.pantryItemId, null);

  const toggled = meals.updateShoppingItem(fam.id, parent.id, result.item.id, { done: true });
  assert.equal(toggled.item.done, true);
  assert.equal(toggled.item.doneBy, parent.id);
  assert.ok(toggled.item.doneAt);

  const untoggled = meals.updateShoppingItem(fam.id, parent.id, result.item.id, { done: false });
  assert.equal(untoggled.item.doneBy, null);
  assert.equal(untoggled.item.doneAt, null);

  assert.ok(meals.addShoppingItem(fam.id, parent.id, { text: "" }).error);
  assert.ok(meals.updateShoppingItem(fam.id, parent.id, "si_bogus", { done: true }).error);

  const removed = meals.removeShoppingItem(fam.id, result.item.id);
  assert.ok(!removed.error);
  assert.ok(meals.removeShoppingItem(fam.id, result.item.id).error);
});

test("seedShoppingFromPantry: seeds low/out items, skips plenty/some, dedupes by pantryItemId", () => {
  const { fam, parent } = makeFamilyWithKid("Q");
  const lowItem = meals.addPantryItem(fam.id, parent.id, { name: "Yogurt", category: "dairy", level: "low" }).item;
  const outItem = meals.addPantryItem(fam.id, parent.id, { name: "Eggs", category: "protein", level: "out" }).item;
  meals.addPantryItem(fam.id, parent.id, { name: "Rice", category: "grain", level: "plenty" });

  const first = meals.seedShoppingFromPantry(fam.id, parent.id);
  assert.equal(first.items.length, 2);
  const names = first.items.map((i) => i.text).sort();
  assert.deepEqual(names, ["Eggs", "Yogurt"]);

  const second = meals.seedShoppingFromPantry(fam.id, parent.id); // already seeded — no dupes
  assert.equal(second.items.length, 0);
  assert.equal(meals.getState(fam.id).shopping.length, 2);
});

test("restockFromShopping: linked item -> pantry set to 'plenty' (source shopping); unlinked -> new pantry item at 'plenty'; ticked items removed from list", () => {
  const { fam, parent } = makeFamilyWithKid("R");
  const pantryItem = meals.addPantryItem(fam.id, parent.id, { name: "Flour", category: "pantry", level: "low" }).item;
  const linkedSi = meals.addShoppingItem(fam.id, parent.id, { text: "Flour", category: "pantry", pantryItemId: pantryItem.id }).item;
  const unlinkedSi = meals.addShoppingItem(fam.id, parent.id, { text: "Chili flakes", category: "spice" }).item;
  const untouchedSi = meals.addShoppingItem(fam.id, parent.id, { text: "Not yet bought", category: "other" }).item;

  meals.updateShoppingItem(fam.id, parent.id, linkedSi.id, { done: true });
  meals.updateShoppingItem(fam.id, parent.id, unlinkedSi.id, { done: true });

  const result = meals.restockFromShopping(fam.id, parent.id);
  assert.equal(result.items.length, 2);
  assert.equal(result.pantry.length, 2);

  assert.equal(meals.getPantryItem(fam.id, pantryItem.id).level, "plenty");
  const newPantryItem = meals.getState(fam.id).pantry.find((p) => p.name === "Chili flakes");
  assert.ok(newPantryItem);
  assert.equal(newPantryItem.level, "plenty");

  const remaining = meals.getState(fam.id).shopping;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, untouchedSi.id);

  const flourEvent = meals.getState(fam.id).pantryEvents.filter((e) => e.itemId === pantryItem.id).slice(-1)[0];
  assert.equal(flourEvent.source, "shopping");
  const chiliEvent = meals.getState(fam.id).pantryEvents.find((e) => e.itemId === newPantryItem.id);
  assert.equal(chiliEvent.source, "shopping");
});

test("restockFromShopping: no-op (empty arrays) when nothing is done", () => {
  const { fam, parent } = makeFamilyWithKid("R2");
  meals.addShoppingItem(fam.id, parent.id, { text: "Untouched" });
  const result = meals.restockFromShopping(fam.id, parent.id);
  assert.equal(result.items.length, 0);
  assert.equal(result.pantry.length, 0);
  assert.equal(meals.getState(fam.id).shopping.length, 1);
});

// ---------- prefs ----------

test("updatePrefs: validates dinnerTime/cuisines/avoid", () => {
  const { fam } = makeFamilyWithKid("S");
  const result = meals.updatePrefs(fam.id, { dinnerTime: "19:00", cuisines: ["indian", "thai"], avoid: ["mushrooms"] });
  assert.ok(!result.error, result.error);
  assert.equal(result.prefs.dinnerTime, "19:00");
  assert.deepEqual(result.prefs.cuisines, ["indian", "thai"]);

  assert.ok(meals.updatePrefs(fam.id, { dinnerTime: "not-a-time" }).error);
  assert.ok(meals.updatePrefs(fam.id, { cuisines: "not-an-array" }).error);
  assert.ok(meals.updatePrefs(fam.id, { avoid: "not-an-array" }).error);

  // caps: cuisines max 12, avoid max 20
  const capped = meals.updatePrefs(fam.id, {
    cuisines: Array.from({ length: 20 }, (_, i) => `c${i}`),
    avoid: Array.from({ length: 30 }, (_, i) => `a${i}`),
  });
  assert.equal(capped.prefs.cuisines.length, 12);
  assert.equal(capped.prefs.avoid.length, 20);
});

// ---------- household summary + totalPortions math ----------

test("buildHousehold: summarises parents + kids, never includes weight/age/email, defaults portion small(kid)/regular(parent)", () => {
  const { fam, kid, parent } = makeFamilyWithKid("T");
  const household = meals.buildHousehold(fam, () => null); // no profile set -> default "regular"
  assert.equal(household.members.length, 2);
  const parentRow = household.members.find((m) => m.kind === "parent");
  const kidRow = household.members.find((m) => m.kind === "kid");
  assert.equal(parentRow.userId, parent.id);
  assert.equal(parentRow.portion, "regular");
  assert.equal(kidRow.kidId, kid.id);
  assert.equal(kidRow.portion, "small"); // addKid's own default
  assert.deepEqual(kidRow.allergies, []);
  for (const m of household.members) {
    assert.equal(m.weight, undefined);
    assert.equal(m.age, undefined);
    assert.equal(m.email, undefined);
  }
});

test("buildHousehold: totalPortions sums factors (small .6 / regular 1.0 / big 1.4), rounded to 1dp", () => {
  const parent = store.createUser("th-parent@example.com", "Parent TH");
  const fam = family.createFamily(parent.id, "TH Family");
  family.addKid(fam.id, parent.id, { name: "Kid1", portion: "small" });
  family.addKid(fam.id, parent.id, { name: "Kid2", portion: "big" });
  const parent2 = store.createUser("th-parent2@example.com", "Parent TH2");
  family.joinFamilyAsParent(fam.inviteCode, parent2.id);

  const famFresh = family.getFamily(fam.id);
  const resolve = (uid) => (uid === parent.id ? { portion: "regular" } : uid === parent2.id ? { portion: "big" } : null);
  const household = meals.buildHousehold(famFresh, resolve);
  // regular(1.0) + big(1.4) [parents] + small(0.6) + big(1.4) [kids] = 4.4
  assert.equal(household.totalPortions, 4.4);
});

test("buildHousehold: an invalid stored portion falls back to the role default, never throws", () => {
  const { fam, kid, parent } = makeFamilyWithKid("U");
  kid.portion = "gigantic"; // simulate corrupt/legacy data
  const household = meals.buildHousehold(fam, () => ({ portion: "not-real" }));
  const kidRow = household.members.find((m) => m.kidId === kid.id);
  const parentRow = household.members.find((m) => m.userId === parent.id);
  assert.equal(kidRow.portion, "small");
  assert.equal(parentRow.portion, "regular");
});

// ---------- family.js: kid portion/allergies, no weight/age fields ever ----------

test("family.addKid: defaults portion to 'small' for kids, sanitizes allergies (max 12, 40 chars)", () => {
  const parent = store.createUser("fam-a@example.com", "Parent FA");
  const fam = family.createFamily(parent.id, "FA Family");
  const { kid } = family.addKid(fam.id, parent.id, { name: "Kiddo" });
  assert.equal(kid.portion, "small");
  assert.deepEqual(kid.allergies, []);

  const longAllergy = "x".repeat(60);
  const many = Array.from({ length: 20 }, (_, i) => `allergen${i}`);
  const { kid: kid2 } = family.addKid(fam.id, parent.id, { name: "Kiddo2", portion: "big", allergies: [...many, longAllergy] });
  assert.equal(kid2.portion, "big");
  assert.equal(kid2.allergies.length, 12);
  assert.ok(kid2.allergies.every((a) => a.length <= 40));

  // bogus portion falls back to the default, not stored verbatim
  const { kid: kid3 } = family.addKid(fam.id, parent.id, { name: "Kiddo3", portion: "huge" });
  assert.equal(kid3.portion, "small");
});

test("family.updateKid: patches portion/allergies independently, invalid portion keeps the existing value", () => {
  const parent = store.createUser("fam-b@example.com", "Parent FB");
  const fam = family.createFamily(parent.id, "FB Family");
  const { kid } = family.addKid(fam.id, parent.id, { name: "Kiddo", portion: "regular" });
  const updated = family.updateKid(fam.id, parent.id, kid.id, { allergies: ["peanut", "sesame"] });
  assert.equal(updated.kid.portion, "regular"); // untouched
  assert.deepEqual(updated.kid.allergies, ["peanut", "sesame"]);

  const bogus = family.updateKid(fam.id, parent.id, kid.id, { portion: "not-valid" });
  assert.equal(bogus.kid.portion, "regular"); // kept, not clobbered by garbage

  const valid = family.updateKid(fam.id, parent.id, kid.id, { portion: "big" });
  assert.equal(valid.kid.portion, "big");
});

test("no kid weight/age field is ever accepted by addKid/updateKid", () => {
  const parent = store.createUser("fam-c@example.com", "Parent FC");
  const fam = family.createFamily(parent.id, "FC Family");
  const { kid } = family.addKid(fam.id, parent.id, { name: "Kiddo", weight: 30, age: 9, sex: "f" });
  assert.equal(kid.weight, undefined);
  assert.equal(kid.age, undefined);
  assert.equal(kid.sex, undefined);

  const updated = family.updateKid(fam.id, parent.id, kid.id, { weight: 99, age: 10 });
  assert.equal(updated.kid.weight, undefined);
  assert.equal(updated.kid.age, undefined);
});

"use strict";
/**
 * Meals — pantry ladder, menu, shopping list, prefs (docs/MEALS-PLAN.md).
 * Family-scoped, same storage pattern as lib/goals.js / lib/homework.js:
 * root.meals[familyId] = { pantry, pantryEvents, menu, shopping, prefs }.
 *
 * Store-module shape mirrors lib/goals.js: CRUD here, permission ENFORCEMENT
 * in the caller (lib/routes/meals.js) — this module never checks req/role.
 *
 * Household portion/allergy summaries (household.members, totalPortions) are
 * built here from a Family record + a caller-supplied parent-profile
 * resolver, same division of labor as lib/trips.js's resolveName callback —
 * this module never requires ./store directly.
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");

const CATEGORIES = new Set(["produce", "protein", "dairy", "grain", "pantry", "frozen", "spice", "other"]);
// The 4-rung ladder, in order — index also used for the "cooked" step-down.
const LEVEL_ORDER = ["plenty", "some", "low", "out"];
const LEVEL_SET = new Set(LEVEL_ORDER);
const EVENT_SOURCES = new Set(["manual", "scan", "shopping", "cooked", "undo"]);
const SLOTS = new Set(["breakfast", "lunch", "dinner"]);
// §2: small=0.6, regular=1.0, big=1.4 — the only per-member "math" here.
const PORTION_FACTORS = { small: 0.6, regular: 1.0, big: 1.4 };
const MAX_EVENTS = 200;
const MAX_BULK_ITEMS = 100;
const MAX_PREP_ITEMS = 10;
const MAX_PROTEIN_G = 200; // §6.5 "clamped to a sane range"
const SHOPPING_SOURCE_TYPES = new Set(["chat"]);
const SHOPPING_SOURCE_ID_RE = /^m_[A-Za-z0-9_-]+$/;
const MAX_SHOPPING_SOURCE_ID_LENGTH = 200;

function root() {
  const r = db.load();
  if (!r.meals) r.meals = {};
  return r;
}

// root.meals[familyId] = { pantry, pantryEvents, menu, shopping, prefs }
function famMeals(familyId) {
  const r = root();
  if (!r.meals[familyId]) {
    r.meals[familyId] = {
      pantry: [],
      pantryEvents: [],
      menu: [],
      shopping: [],
      prefs: { dinnerTime: "18:30", cuisines: [], avoid: [], diets: [], targets: { proteinGPerMeal: null, fiberGPerMeal: null } },
    };
  }
  // Defends older/partial records (e.g. constructed by hand in a test).
  const m = r.meals[familyId];
  if (!Array.isArray(m.pantry)) m.pantry = [];
  if (!Array.isArray(m.pantryEvents)) m.pantryEvents = [];
  if (!Array.isArray(m.menu)) m.menu = [];
  if (!Array.isArray(m.shopping)) m.shopping = [];
  if (!m.prefs) m.prefs = { dinnerTime: "18:30", cuisines: [], avoid: [] };
  if (!Array.isArray(m.prefs.diets)) m.prefs.diets = [];
  if (!m.prefs.targets) m.prefs.targets = { proteinGPerMeal: null, fiberGPerMeal: null };
  return m;
}

// Whole-state read for the GET /api/meals composite (§5). Callers should
// treat this as read-only — mutations go through the functions below so
// PantryEvent logging / db.persist() stay centralized.
function getState(familyId) {
  return famMeals(familyId);
}

function piId() { return "pi_" + crypto.randomBytes(9).toString("hex"); }
function peId() { return "pe_" + crypto.randomBytes(9).toString("hex"); }
function mmId() { return "mm_" + crypto.randomBytes(9).toString("hex"); }
function siId() { return "si_" + crypto.randomBytes(9).toString("hex"); }
function prepId() { return "pp_" + crypto.randomBytes(6).toString("hex"); }

function sanitizeYMD(s) {
  const v = String(s || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// ---------- recipes (lib/recipes.js — owned by another agent, §8b) ----------
// Lazy + defensive: the module may not exist yet when this file is required
// (it's built in parallel). Cached after the first successful/failed lookup.
let _recipes;
function recipesModule() {
  if (_recipes !== undefined) return _recipes;
  try {
    _recipes = require("./recipes");
  } catch (e) {
    _recipes = null;
  }
  return _recipes;
}

// ---------- pantry ----------

function getPantryItem(familyId, id) {
  return famMeals(familyId).pantry.find((p) => p.id === id) || null;
}

// Appends a PantryEvent, capped at the most recent 200 (§3). Does NOT persist
// — the caller (which is always doing a level change alongside this) persists
// once for the whole operation.
function logEvent(familyId, { userId, itemId, from, to, source }) {
  const list = famMeals(familyId).pantryEvents;
  const ev = {
    id: peId(),
    at: new Date().toISOString(),
    userId: userId || null,
    itemId,
    from: from == null ? null : from,
    to,
    source: EVENT_SOURCES.has(source) ? source : "manual",
  };
  list.push(ev);
  if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
  return ev;
}

function getPantryEvent(familyId, id) {
  return famMeals(familyId).pantryEvents.find((e) => e.id === id) || null;
}

// Sets an item's level and logs the PantryEvent, but ALWAYS (even for a
// same-level "change") — undo needs to be able to reverse a specific
// historical event even if the current level already happens to match.
function applyLevel(familyId, item, newLevel, userId, source) {
  logEvent(familyId, { userId, itemId: item.id, from: item.level, to: newLevel, source });
  item.level = newLevel;
  item.updatedAt = new Date().toISOString();
  item.updatedBy = userId || null;
}

function addPantryItem(familyId, userId, { name, category, level, unitHint, expiresOn } = {}) {
  const n = String(name || "").trim().slice(0, 80);
  if (!n) return { error: "Name is required." };
  if (!CATEGORIES.has(category)) return { error: "Invalid category." };
  if (!LEVEL_SET.has(level)) return { error: "Level must be plenty, some, low, or out." };
  let expires = null;
  if (expiresOn) {
    expires = sanitizeYMD(expiresOn);
    if (!expires) return { error: "expiresOn must be YYYY-MM-DD." };
  }
  const item = {
    id: piId(),
    name: n,
    category,
    level,
    unitHint: String(unitHint || "").trim().slice(0, 40),
    expiresOn: expires,
    updatedAt: new Date().toISOString(),
    updatedBy: userId || null,
  };
  famMeals(familyId).pantry.push(item);
  logEvent(familyId, { userId, itemId: item.id, from: null, to: level, source: "manual" });
  db.persist();
  return { item };
}

function updatePantryItem(familyId, userId, id, patch = {}) {
  const item = getPantryItem(familyId, id);
  if (!item) return { error: "Pantry item not found." };
  if (patch.name != null) {
    const n = String(patch.name).trim().slice(0, 80);
    if (!n) return { error: "Name cannot be empty." };
    item.name = n;
  }
  if (patch.category != null) {
    if (!CATEGORIES.has(patch.category)) return { error: "Invalid category." };
    item.category = patch.category;
  }
  if (patch.unitHint != null) item.unitHint = String(patch.unitHint).trim().slice(0, 40);
  if (patch.expiresOn !== undefined) {
    if (patch.expiresOn === null || patch.expiresOn === "") {
      item.expiresOn = null;
    } else {
      const d = sanitizeYMD(patch.expiresOn);
      if (!d) return { error: "expiresOn must be YYYY-MM-DD." };
      item.expiresOn = d;
    }
  }
  if (patch.level != null) {
    if (!LEVEL_SET.has(patch.level)) return { error: "Level must be plenty, some, low, or out." };
    if (patch.level !== item.level) applyLevel(familyId, item, patch.level, userId, "manual");
  }
  item.updatedAt = new Date().toISOString();
  item.updatedBy = userId || null;
  db.persist();
  return { item };
}

function removePantryItem(familyId, id) {
  const m = famMeals(familyId);
  const before = m.pantry.length;
  m.pantry = m.pantry.filter((p) => p.id !== id);
  if (m.pantry.length === before) return { error: "Pantry item not found." };
  db.persist();
  return { ok: true };
}

// Scan-confirm path (§5 "scan confirm + shopping restock"): every row always
// creates a NEW pantry item — this is the editable-confirm-sheet write, never
// a silent auto-merge into an existing item (§5's AI boundary: a scan never
// writes the pantry directly; this IS that one deliberate write, driven by a
// human confirming the sheet).
function bulkAddPantryItems(familyId, userId, items) {
  if (!Array.isArray(items) || !items.length) return { error: "items must be a non-empty array." };
  const m = famMeals(familyId);
  const created = [];
  for (const raw of items.slice(0, MAX_BULK_ITEMS)) {
    const name = String((raw && raw.name) || "").trim().slice(0, 80);
    if (!name) continue;
    const category = raw && CATEGORIES.has(raw.category) ? raw.category : "other";
    const guessedLevel = raw && (raw.level || raw.levelGuess);
    const level = LEVEL_SET.has(guessedLevel) ? guessedLevel : "some";
    const expires = raw && raw.expiresOn ? sanitizeYMD(raw.expiresOn) : null;
    const item = {
      id: piId(),
      name,
      category,
      level,
      unitHint: String((raw && raw.unitHint) || "").trim().slice(0, 40),
      expiresOn: expires,
      updatedAt: new Date().toISOString(),
      updatedBy: userId || null,
    };
    m.pantry.push(item);
    logEvent(familyId, { userId, itemId: item.id, from: null, to: level, source: "scan" });
    created.push(item);
  }
  if (!created.length) return { error: "No valid items to add." };
  db.persist();
  return { items: created };
}

// Reverses exactly the given event, restoring `from` and logging a NEW event
// with source "undo" (§3) — it never deletes the original event.
function undoEvent(familyId, userId, eventId) {
  const ev = getPantryEvent(familyId, eventId);
  if (!ev) return { error: "Event not found." };
  if (ev.from == null) return { error: "This event can't be undone (the item was created, not level-changed)." };
  const item = getPantryItem(familyId, ev.itemId);
  if (!item) return { error: "That pantry item no longer exists." };
  applyLevel(familyId, item, ev.from, userId, "undo");
  db.persist();
  return { item };
}

// Cooking steps every used item DOWN one rung, floored at "low" — cooking
// must NEVER set "out" (§3/§8 invariant). An item already at "low" or "out"
// is left untouched: the floor stops further reduction, and an already-empty
// item isn't something cooking can "cause" — only a human sets out.
function stepDownFloorLow(level) {
  const idx = LEVEL_ORDER.indexOf(level);
  const lowIdx = LEVEL_ORDER.indexOf("low");
  if (idx < 0 || idx >= lowIdx) return level;
  return LEVEL_ORDER[idx + 1];
}

function cookMenuEntry(familyId, userId, id) {
  const entry = getMenuEntry(familyId, id);
  if (!entry) return { error: "Menu entry not found." };
  const m = famMeals(familyId);
  for (const itemId of entry.usesItemIds || []) {
    const item = m.pantry.find((p) => p.id === itemId);
    if (!item) continue;
    const next = stepDownFloorLow(item.level);
    if (next !== item.level) applyLevel(familyId, item, next, userId, "cooked");
  }
  db.persist();
  return { entry, pantry: m.pantry };
}

// ---------- menu ----------

function getMenuEntry(familyId, id) {
  return famMeals(familyId).menu.find((e) => e.id === id) || null;
}

function sanitizePrep(prep) {
  if (!Array.isArray(prep)) return [];
  return prep
    .slice(0, MAX_PREP_ITEMS)
    .map((p) => ({
      id: prepId(),
      label: String((p && p.label) || "").trim().slice(0, 80),
      leadHours: Number.isFinite(Number(p && p.leadHours)) && Number(p.leadHours) >= 0 ? Number(p.leadHours) : 0,
    }))
    .filter((p) => p.label);
}

function sanitizeUsesItemIds(ids, pantryItems) {
  if (!Array.isArray(ids)) return [];
  const valid = new Set(pantryItems.map((p) => p.id));
  return Array.from(new Set(ids.filter((id) => valid.has(id))));
}

function normalizeIngredientName(s) {
  return String(s || "").toLowerCase().trim().replace(/[^a-z0-9 ]/g, "");
}

// §6.2's "pantry membership is recomputed server-side" discipline, applied to
// a manually-added recipe entry too: usesItemIds is derived from matching the
// recipe's ingredient names against the FAMILY's real pantry, never trusted
// from recipe data verbatim (recipes have no pantryItemIds of their own — an
// ingredient is just a name). An "out" item is never matched: you can't "use"
// what you don't have.
function matchPantryItemsForRecipe(recipe, pantryItems) {
  const names = (Array.isArray(recipe.ingredients) ? recipe.ingredients : [])
    .map((i) => normalizeIngredientName(i && i.name))
    .filter(Boolean);
  if (!names.length) return [];
  const matched = [];
  for (const item of pantryItems) {
    if (item.level === "out") continue;
    const n = normalizeIngredientName(item.name);
    if (!n) continue;
    if (names.some((rn) => n.includes(rn) || rn.includes(n))) matched.push(item.id);
  }
  return matched;
}

function clampProteinG(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(Math.min(MAX_PROTEIN_G, n));
}

// `servesPortions` and `allowProtein` are computed by the ROUTE (they need
// the family's parent profiles — see buildHousehold below and lib/routes/
// meals.js's resolveParentProfile) and passed in here, keeping this module
// free of a ./store dependency (mirrors lib/trips.js's resolveName pattern).
function addMenuEntry(familyId, userId, opts = {}) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  const date = sanitizeYMD(opts.date);
  if (!date) return { error: "A valid date (YYYY-MM-DD) is required." };
  if (!SLOTS.has(opts.slot)) return { error: "Slot must be breakfast, lunch, or dinner." };

  const m = famMeals(familyId);
  let title, note, prep, usesItemIds, proteinG = null;

  if (opts.recipeId) {
    const recipes = recipesModule();
    if (!recipes || typeof recipes.byId !== "function") return { error: "Recipe library unavailable." };
    const recipe = recipes.byId(opts.recipeId);
    if (!recipe) return { error: "Recipe not found." };
    title = String(recipe.title || "").trim().slice(0, 120);
    note = String(recipe.note || (Array.isArray(recipe.steps) ? recipe.steps.join(" ") : "") || "").trim().slice(0, 1000);
    prep = sanitizePrep(recipe.prep);
    usesItemIds = matchPantryItemsForRecipe(recipe, m.pantry);
    if (opts.allowProtein) proteinG = clampProteinG(recipe.proteinGPerPortion);
  } else {
    title = String(opts.title || "").trim().slice(0, 120);
    if (!title) return { error: "A title or recipeId is required." };
    note = String(opts.note || "").trim().slice(0, 1000);
    prep = sanitizePrep(opts.prep);
    usesItemIds = sanitizeUsesItemIds(opts.usesItemIds, m.pantry);
  }
  if (!title) return { error: "Title is required." };

  const servesPortions = Number.isFinite(Number(opts.servesPortions)) && Number(opts.servesPortions) >= 0
    ? Number(opts.servesPortions) : 0;

  const entry = {
    id: mmId(),
    date,
    slot: opts.slot,
    title,
    note,
    usesItemIds,
    prep,
    proteinG,
    servesPortions,
    source: "manual", // the AI plan route (owned elsewhere) writes source:"ai"
    createdBy: userId || null,
    createdAt: new Date().toISOString(),
  };
  m.menu.push(entry);
  db.persist();
  return { entry };
}

function updateMenuEntry(familyId, id, patch = {}) {
  const entry = getMenuEntry(familyId, id);
  if (!entry) return { error: "Menu entry not found." };
  const m = famMeals(familyId);
  if (patch.date != null) {
    const d = sanitizeYMD(patch.date);
    if (!d) return { error: "A valid date (YYYY-MM-DD) is required." };
    entry.date = d;
  }
  if (patch.slot != null) {
    if (!SLOTS.has(patch.slot)) return { error: "Slot must be breakfast, lunch, or dinner." };
    entry.slot = patch.slot;
  }
  if (patch.title != null) {
    const t = String(patch.title).trim().slice(0, 120);
    if (!t) return { error: "Title cannot be empty." };
    entry.title = t;
  }
  if (patch.note != null) entry.note = String(patch.note).trim().slice(0, 1000);
  if (patch.prep != null) entry.prep = sanitizePrep(patch.prep);
  if (patch.usesItemIds != null) entry.usesItemIds = sanitizeUsesItemIds(patch.usesItemIds, m.pantry);
  if (patch.servesPortions != null) {
    const n = Number(patch.servesPortions);
    if (Number.isFinite(n) && n >= 0) entry.servesPortions = n;
  }
  db.persist();
  return { entry };
}

function removeMenuEntry(familyId, id) {
  const m = famMeals(familyId);
  const before = m.menu.length;
  m.menu = m.menu.filter((e) => e.id !== id);
  if (m.menu.length === before) return { error: "Menu entry not found." };
  db.persist();
  return { ok: true };
}

// ---------- shopping (the one kid-write surface — see lib/routes/meals.js) ----------

function getShoppingItem(familyId, id) {
  return famMeals(familyId).shopping.find((s) => s.id === id) || null;
}

function getShoppingBySource(familyId, sourceType, sourceId) {
  if (!sourceType || !sourceId) return null;
  return famMeals(familyId).shopping.find((s) => s.sourceType === sourceType && s.sourceId === sourceId) || null;
}

function cleanShoppingSource(sourceType, sourceId) {
  const hasType = sourceType !== undefined && sourceType !== null;
  const hasId = sourceId !== undefined && sourceId !== null;
  if (!hasType && !hasId) return { sourceType: null, sourceId: null };
  if (!hasType || !hasId) return { error: "sourceType and sourceId must be provided together." };
  if (!SHOPPING_SOURCE_TYPES.has(sourceType)) return { error: "Only family chat messages can be used as shopping sources." };
  if (typeof sourceId !== "string" || sourceId.length > MAX_SHOPPING_SOURCE_ID_LENGTH || !SHOPPING_SOURCE_ID_RE.test(sourceId)) {
    return { error: "Invalid family chat message source." };
  }
  return { sourceType: "chat", sourceId };
}

function addShoppingItem(familyId, userId, { text, category, pantryItemId, assigneeUserId, sourceType, sourceId } = {}) {
  const source = cleanShoppingSource(sourceType, sourceId);
  if (source.error) return source;
  if (source.sourceType && source.sourceId) {
    const existing = getShoppingBySource(familyId, source.sourceType, source.sourceId);
    if (existing) return { item: existing, existing: true };
  }
  const t = String(text || "").trim().slice(0, 200);
  if (!t) return { error: "Text is required." };
  const m = famMeals(familyId);
  let linkedPantryId = null;
  if (pantryItemId && m.pantry.some((p) => p.id === pantryItemId)) linkedPantryId = pantryItemId;
  const item = {
    id: siId(),
    text: t,
    category: CATEGORIES.has(category) ? category : "other",
    pantryItemId: linkedPantryId,
    assigneeUserId: assigneeUserId ? String(assigneeUserId) : null,
    done: false,
    doneBy: null,
    doneAt: null,
    addedBy: userId || null,
    createdAt: new Date().toISOString(),
    sourceType: source.sourceType,
    sourceId: source.sourceId,
  };
  m.shopping.push(item);
  db.persist();
  return { item, existing: false };
}

// `patch` is whatever the CALLER decided to forward — lib/routes/meals.js
// strips text/assigneeUserId for a kid session before calling this (the kid
// write carve-out is enforced at the route, not here — same division of
// labor as every other permission check in this codebase).
function updateShoppingItem(familyId, userId, id, patch = {}) {
  const item = getShoppingItem(familyId, id);
  if (!item) return { error: "Shopping item not found." };
  if (patch.text != null) {
    const t = String(patch.text).trim().slice(0, 200);
    if (!t) return { error: "Text cannot be empty." };
    item.text = t;
  }
  if (patch.category != null && CATEGORIES.has(patch.category)) item.category = patch.category;
  if (patch.assigneeUserId !== undefined) item.assigneeUserId = patch.assigneeUserId ? String(patch.assigneeUserId) : null;
  if (patch.done !== undefined) {
    const done = !!patch.done;
    item.done = done;
    item.doneBy = done ? (userId || null) : null;
    item.doneAt = done ? new Date().toISOString() : null;
  }
  db.persist();
  return { item };
}

function removeShoppingItem(familyId, id) {
  const m = famMeals(familyId);
  const before = m.shopping.length;
  m.shopping = m.shopping.filter((s) => s.id !== id);
  if (m.shopping.length === before) return { error: "Shopping item not found." };
  db.persist();
  return { ok: true };
}

// Seeds one shopping item per pantry item at low/out that isn't already on
// the list, deduped by pantryItemId (§5).
function seedShoppingFromPantry(familyId, userId) {
  const m = famMeals(familyId);
  const already = new Set(m.shopping.filter((s) => s.pantryItemId).map((s) => s.pantryItemId));
  const created = [];
  for (const item of m.pantry) {
    if (item.level !== "low" && item.level !== "out") continue;
    if (already.has(item.id)) continue;
    const si = {
      id: siId(),
      text: item.name,
      category: item.category,
      pantryItemId: item.id,
      assigneeUserId: null,
      done: false,
      doneBy: null,
      doneAt: null,
      addedBy: userId || null,
      createdAt: new Date().toISOString(),
    };
    m.shopping.push(si);
    created.push(si);
  }
  if (created.length) db.persist();
  return { items: created };
}

function createPantryItemAtPlenty(familyId, userId, name, category) {
  const item = {
    id: piId(),
    name: String(name || "").trim().slice(0, 80) || "Item",
    category: CATEGORIES.has(category) ? category : "other",
    level: "plenty",
    unitHint: "",
    expiresOn: null,
    updatedAt: new Date().toISOString(),
    updatedBy: userId || null,
  };
  famMeals(familyId).pantry.push(item);
  logEvent(familyId, { userId, itemId: item.id, from: null, to: "plenty", source: "shopping" });
  return item;
}

// The load-bearing restock path (§5): every DONE shopping item with a
// pantryItemId sets that pantry item to "plenty" (source "shopping"); items
// without one become NEW pantry items at "plenty". Ticked items are then
// removed from the list either way.
function restockFromShopping(familyId, userId) {
  const m = famMeals(familyId);
  const doneItems = m.shopping.filter((s) => s.done);
  const touchedPantry = [];
  for (const si of doneItems) {
    if (si.pantryItemId) {
      const item = getPantryItem(familyId, si.pantryItemId);
      if (item) {
        applyLevel(familyId, item, "plenty", userId, "shopping");
        touchedPantry.push(item);
        continue;
      }
      // The linked pantry item was deleted since — fall through and treat
      // this tick like a plain (unlinked) restock instead of silently
      // dropping it.
    }
    touchedPantry.push(createPantryItemAtPlenty(familyId, userId, si.text, si.category));
  }
  m.shopping = m.shopping.filter((s) => !s.done);
  if (doneItems.length) db.persist();
  return { items: doneItems, pantry: touchedPantry };
}

// ---------- prefs ----------

function updatePrefs(familyId, patch = {}) {
  const m = famMeals(familyId);
  if (patch.dinnerTime != null) {
    if (!/^\d{2}:\d{2}$/.test(String(patch.dinnerTime))) return { error: "dinnerTime must be HH:MM." };
    m.prefs.dinnerTime = patch.dinnerTime;
  }
  if (patch.cuisines != null) {
    if (!Array.isArray(patch.cuisines)) return { error: "cuisines must be an array." };
    m.prefs.cuisines = patch.cuisines.slice(0, 12).map((c) => String(c).trim().slice(0, 40)).filter(Boolean);
  }
  if (patch.avoid != null) {
    if (!Array.isArray(patch.avoid)) return { error: "avoid must be an array." };
    m.prefs.avoid = patch.avoid.slice(0, 20).map((c) => String(c).trim().slice(0, 40)).filter(Boolean);
  }
  // Household diets (lactose-free, vegetarian, …). These do NOT hide food:
  // lib/recipes.js attaches the swaps that make a dish work (paneer → tofu)
  // and only excludes a recipe when a core ingredient can't be swapped.
  if (patch.diets != null) {
    if (!Array.isArray(patch.diets)) return { error: "diets must be an array." };
    const known = Object.keys(recipesModule() ? recipesModule().DIETS || {} : {});
    const cleaned = patch.diets.map((d) => String(d).trim().toLowerCase()).filter(Boolean).slice(0, 6);
    const bad = cleaned.find((d) => known.length && !known.includes(d));
    if (bad) return { error: `Unknown diet "${bad}".` };
    m.prefs.diets = cleaned;
  }
  // Per-MEAL floors, not daily budgets and not per-person medical targets:
  // "every dinner should clear 20g protein and 20g fibre" is a cooking rule,
  // and it's the only nutrition number this feature holds (docs/MEALS-PLAN §2).
  if (patch.targets != null) {
    if (typeof patch.targets !== "object") return { error: "targets must be an object." };
    const t = {};
    for (const key of ["proteinGPerMeal", "fiberGPerMeal"]) {
      const raw = patch.targets[key];
      if (raw == null || raw === "") { t[key] = null; continue; }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 200) return { error: `${key} must be between 0 and 200.` };
      t[key] = Math.round(n);
    }
    m.prefs.targets = t;
  }
  db.persist();
  return { prefs: m.prefs };
}

// Seed an empty pantry with the staples a high-protein, high-fibre, Indian
// kitchen runs on (lib/recipes.js STAPLES) — everything lands at `some` so the
// first shop corrects it, and existing items are never overwritten.
function seedStaples(familyId, userId) {
  const rec = recipesModule();
  if (!rec || !Array.isArray(rec.STAPLES)) return { error: "Staples aren't available on this server." };
  const m = famMeals(familyId);
  const added = [];
  for (const s of rec.STAPLES) {
    const exists = m.pantry.some((p) => rec.namesMatch(p.name, s.name));
    if (exists) continue;
    const result = addPantryItem(familyId, userId, { name: s.name, category: s.category, level: "some" });
    if (result.item) added.push(result.item);
  }
  db.persist();
  return { items: added, pantry: m.pantry };
}

// ---------- household summary (§5 GET /api/meals) ----------

// `resolveParentProfile(userId) -> {name, portion, allergies, proteinTargetG}
// | null` is supplied by the route layer (needs ./store) — same shape as
// lib/trips.js's resolveName callback. NEVER includes weight/age (they don't
// exist) or a kid's email (kids have none).
function buildHousehold(fam, resolveParentProfile) {
  const members = [];
  let totalFactor = 0;
  for (const pid of (fam && fam.parentIds) || []) {
    const resolved = (typeof resolveParentProfile === "function" && resolveParentProfile(pid)) || {};
    const portion = family.sanitizePortion(resolved.portion, "regular"); // default REGULAR for adults (§2)
    const allergies = family.sanitizeAllergies(resolved.allergies);
    members.push({ userId: pid, name: resolved.name || "Parent", kind: "parent", portion, allergies });
    totalFactor += PORTION_FACTORS[portion];
  }
  for (const kid of (fam && fam.kids) || []) {
    const portion = family.sanitizePortion(kid.portion, "small"); // default SMALL for kids (§2)
    const allergies = family.sanitizeAllergies(kid.allergies);
    members.push({ kidId: kid.id, name: kid.name, kind: "kid", portion, allergies });
    totalFactor += PORTION_FACTORS[portion];
  }
  return { members, totalPortions: Math.round(totalFactor * 10) / 10 };
}

module.exports = {
  CATEGORIES,
  LEVEL_ORDER,
  EVENT_SOURCES,
  SLOTS,
  PORTION_FACTORS,

  getState,

  getPantryItem,
  getPantryEvent,
  addPantryItem,
  updatePantryItem,
  removePantryItem,
  bulkAddPantryItems,
  undoEvent,
  stepDownFloorLow,

  getMenuEntry,
  addMenuEntry,
  updateMenuEntry,
  removeMenuEntry,
  cookMenuEntry,
  matchPantryItemsForRecipe,

  getShoppingItem,
  getShoppingBySource,
  cleanShoppingSource,
  addShoppingItem,
  updateShoppingItem,
  removeShoppingItem,
  seedShoppingFromPantry,
  restockFromShopping,

  updatePrefs,
  seedStaples,

  buildHousehold,
};

/* ============================================================
   PREP REMINDERS (§7)
   This repo has NO scheduler or cron, so reminders can't be "fired at 21:00".
   Instead each prep step's due time is computed and STORED when the meal is
   planned, and a lazy sweep returns whatever has fallen due whenever the
   family next touches Meals or the calendar. A `notifiedAt` stamp makes the
   sweep idempotent, so a double request can't double-notify.
============================================================ */

const QUIET_START_H = 22; // 22:00–07:00: no reminders
const QUIET_END_H = 7;
const MAX_PREP_NOTIFICATIONS_PER_DAY = 3;

// Lead time exists because the soak actually takes that long, so a quiet-hours
// collision moves the reminder EARLIER, never later — shifting it forward
// would silently eat the lead the cook needs.
function shiftOutOfQuietHours(d) {
  const out = new Date(d.getTime());
  let guard = 0;
  while (guard++ < 48) {
    const h = out.getHours();
    if (h >= QUIET_END_H && h < QUIET_START_H) return out;
    out.setHours(out.getHours() - 1);
  }
  return out;
}

// dueAt = (meal date + dinnerTime) − leadHours, pulled out of quiet hours.
function stampPrepSchedule(familyId, entryId) {
  const m = famMeals(familyId);
  const entry = m.menu.find((e) => e.id === entryId);
  if (!entry || !Array.isArray(entry.prep) || !entry.prep.length) return { entry: entry || null };
  const [hh, mm] = String(m.prefs.dinnerTime || "18:30").split(":").map(Number);
  for (const p of entry.prep) {
    const at = new Date(`${entry.date}T00:00:00`);
    at.setHours(hh || 18, mm || 30, 0, 0);
    at.setHours(at.getHours() - (Number(p.leadHours) || 0));
    p.dueAt = shiftOutOfQuietHours(at).toISOString();
    if (p.notifiedAt === undefined) p.notifiedAt = null;
  }
  db.persist();
  return { entry };
}

// Prep steps that are due now and not yet notified, capped per day so a busy
// week of soaking never turns into a notification storm.
function duePrepReminders(familyId, nowIso) {
  const m = famMeals(familyId);
  const now = nowIso || new Date().toISOString();
  const today = now.slice(0, 10);
  let sentToday = 0;
  for (const e of m.menu) {
    for (const p of e.prep || []) {
      if (p.notifiedAt && String(p.notifiedAt).slice(0, 10) === today) sentToday++;
    }
  }
  const due = [];
  for (const e of m.menu) {
    for (const p of e.prep || []) {
      if (!p.dueAt || p.notifiedAt) continue;
      if (p.dueAt > now) continue;
      if (sentToday + due.length >= MAX_PREP_NOTIFICATIONS_PER_DAY) return due;
      due.push({ entryId: e.id, prepId: p.id, label: p.label, leadHours: p.leadHours, mealTitle: e.title, dueAt: p.dueAt });
    }
  }
  return due;
}

function markPrepNotified(familyId, entryId, prepId, atIso) {
  const m = famMeals(familyId);
  const entry = m.menu.find((e) => e.id === entryId);
  if (!entry) return { error: "Menu entry not found." };
  const p = (entry.prep || []).find((x) => x.id === prepId);
  if (!p) return { error: "Prep step not found." };
  p.notifiedAt = atIso || new Date().toISOString();
  db.persist();
  return { ok: true };
}

// Clears a date+slot before the planner writes over it, so replanning a week
// replaces rather than stacks duplicate dinners.
function clearMenuSlot(familyId, date, slot) {
  const m = famMeals(familyId);
  const before = m.menu.length;
  m.menu = m.menu.filter((e) => !(e.date === date && e.slot === slot));
  if (m.menu.length !== before) db.persist();
  return { removed: before - m.menu.length };
}

module.exports.stampPrepSchedule = stampPrepSchedule;
module.exports.duePrepReminders = duePrepReminders;
module.exports.markPrepNotified = markPrepNotified;
module.exports.clearMenuSlot = clearMenuSlot;
module.exports.QUIET_START_H = QUIET_START_H;
module.exports.QUIET_END_H = QUIET_END_H;
module.exports.MAX_PREP_NOTIFICATIONS_PER_DAY = MAX_PREP_NOTIFICATIONS_PER_DAY;

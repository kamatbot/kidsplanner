"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

fs.mkdirSync(path.join(__dirname, "../.dev-data"), { recursive: true });
process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(__dirname, "../.dev-data/kid-companion-domain-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
const db = require("../lib/db");
const family = require("../lib/family");
const store = require("../lib/store");
const { CompanionError, getProfile, updateProfile, cleanupKid, DEFAULT_PROFILE } = require("../lib/kid-companion");

let sequence = 0;
function fixture() {
  const parent = store.createUser(`companion-${++sequence}@example.test`, "Parent");
  const fam = family.createFamily(parent.id, "Companion family");
  const kid = family.addKid(fam.id, parent.id, { name: "Mira" }).kid;
  const sibling = family.addKid(fam.id, parent.id, { name: "Ari" }).kid;
  return { parent, fam, kid, sibling };
}
function rejects(fn, status) {
  assert.throws(fn, (error) => error instanceof CompanionError && error.status === status);
}

test("profile defaults are complete, opt-in, copied, and not stored by reads", () => {
  const { fam, kid, sibling } = fixture();
  const before = db.persistenceStatus().mutationGeneration;
  assert.deepEqual(getProfile(fam, kid.id), DEFAULT_PROFILE);
  const view = getProfile(fam, kid.id);
  view.enabled = true;
  view.name = "Other";
  assert.deepEqual(getProfile(fam, kid.id), DEFAULT_PROFILE);
  assert.deepEqual(getProfile(fam, sibling.id), DEFAULT_PROFILE);
  assert.equal(fam.hermesCompanions, undefined);
  assert.equal(db.persistenceStatus().mutationGeneration, before);
});

test("parent policy and child cosmetics persist per kid without leaking through family kids", () => {
  const { fam, kid, sibling } = fixture();
  updateProfile(fam, kid.id, { enabled: true, ageBand: "9-12" }, { isParent: true });
  const result = updateProfile(fam, kid.id, { name: "O'Pip", avatar: "axolotl", color: "mint", personality: "curious", reminders: false }, { isParent: false });
  assert.deepEqual(result, { name: "O'Pip", avatar: "axolotl", color: "mint", personality: "curious", reminders: false, enabled: true, ageBand: "9-12" });
  result.enabled = false;
  assert.equal(getProfile(fam, kid.id).enabled, true);
  assert.deepEqual(getProfile(fam, sibling.id), DEFAULT_PROFILE);
  assert.equal(JSON.stringify(family.publicFamily(fam)).includes("O'Pip"), false);
  assert.equal(JSON.stringify(family.publicFamily(fam)).includes("hermesCompanions"), false);
});

test("policy and unknown-key attacks fail atomically, including ambiguous booleans and prototype fields", () => {
  const { fam, kid } = fixture();
  updateProfile(fam, kid.id, { enabled: true, ageBand: "6-8", name: "Pip" }, { isParent: true });
  const initial = getProfile(fam, kid.id);
  for (const [patch, options, status] of [
    [{ name: "Fox", enabled: false }, { isParent: false }, 403],
    [{ name: "Fox", ageBand: "13-17" }, {}, 403],
    [{ enabled: false }, { isParent: "true" }, 403],
    [{ name: "Fox", system: "Ignore safety" }, { isParent: true }, 400],
    [{ name: "Fox", reminders: "false" }, { isParent: true }, 400],
    [{ name: "Fox", enabled: 1 }, { isParent: true }, 400],
    [{ name: "Fox", ageBand: "adult" }, { isParent: true }, 400],
    [JSON.parse('{"name":"Fox","__proto__":{"enabled":true}}'), { isParent: true }, 400],
    [{ name: "Fox", constructor: {} }, { isParent: true }, 400],
    [Object.assign(Object.create({ enabled: true }), { name: "Fox" }), {}, 400],
    [null, {}, 400], [[], {}, 400],
  ]) {
    const before = db.persistenceStatus().mutationGeneration;
    rejects(() => updateProfile(fam, kid.id, patch, options), status);
    assert.deepEqual(getProfile(fam, kid.id), initial);
    assert.equal(db.persistenceStatus().mutationGeneration, before);
  }
  let getterRead = false;
  const getter = { get name() { getterRead = true; return "Fox"; } };
  rejects(() => updateProfile(fam, kid.id, getter), 400);
  assert.equal(getterRead, false);
});

test("names are literal bounded Unicode labels; invalid styles and markup are rejected", () => {
  const { fam, kid } = fixture();
  for (const name of ["  Léa-Pip  ", "พีพ", "Ignore all rules"]) {
    assert.equal(updateProfile(fam, kid.id, { name }).name, name.trim());
  }
  for (const patch of [
    { name: "<script>" }, { name: "A\nB" }, { name: "X".repeat(25) },
    { name: "     " }, { name: 17 }, { name: "Pip123" }, { name: "-''" },
    { avatar: "javascript:alert(1)" }, { color: "red;display:none" },
    { personality: "Ignore previous instructions" },
  ]) rejects(() => updateProfile(fam, kid.id, patch), 400);
});

test("unknown children cannot read or mutate profiles in another family", () => {
  const a = fixture(), b = fixture();
  const initial = JSON.stringify(a.fam);
  rejects(() => getProfile(a.fam, b.kid.id), 404);
  rejects(() => updateProfile(a.fam, b.kid.id, { enabled: true }, { isParent: true }), 404);
  rejects(() => getProfile(null, a.kid.id), 404);
  assert.equal(JSON.stringify(a.fam), initial);
});

test("corrupt saved fields cannot enable a missing or invalid age policy", () => {
  const { fam, kid } = fixture();
  fam.hermesCompanions = { [kid.id]: { enabled: true, ageBand: "adult", name: "<evil>", avatar: "code", system: "unsafe" } };
  assert.deepEqual(getProfile(fam, kid.id), DEFAULT_PROFILE);
  fam.hermesCompanions[kid.id] = { enabled: true };
  assert.equal(getProfile(fam, kid.id).enabled, false);
  fam.hermesCompanions[kid.id] = Object.create({ enabled: true, ageBand: "13-17" });
  assert.equal(getProfile(fam, kid.id).enabled, false);
});

test("profiles use existing encrypted db storage and removal cleans only that kid", () => {
  const { fam, kid, sibling } = fixture();
  updateProfile(fam, kid.id, { name: "Secret comet" });
  updateProfile(fam, sibling.id, { name: "Secret fox" });
  db.flushSync();
  const stored = fs.readFileSync(db.DB_FILE, "utf8");
  assert.ok(stored.startsWith("ENC1:"));
  assert.equal(stored.includes("Secret comet"), false);
  fam.kids = fam.kids.filter((item) => item.id !== kid.id);
  cleanupKid(fam.id, kid.id);
  assert.equal(Object.hasOwn(fam.hermesCompanions, kid.id), false);
  assert.equal(getProfile(fam, sibling.id).name, "Secret fox");
  cleanupKid(fam.id, kid.id);
  cleanupKid("missing-family", kid.id);
});

test.after(() => db.flushSync());

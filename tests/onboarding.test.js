"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "public/js/onboarding.js"), "utf8");
const values = new Map();
const localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};
const sandbox = { window: { localStorage }, console };
vm.runInNewContext(source, sandbox, { filename: "onboarding.js" });
const guide = sandbox.window.famTodaySetupGuide;

function family(patch) {
  return Object.assign({ id: "family-1", parentIds: ["parent-1"], kids: [] }, patch || {});
}

test("setup state keeps the four locked steps in order and uses real completion conditions", () => {
  const state = guide.derive(
    family({ parentIds: ["parent-1", "parent-2"], kids: [{ id: "kid-1" }], parents: [{ id: "parent-1" }, { id: "parent-2" }] }),
    { subscriptions: [{ id: "sub-1" }] },
    [{ id: "action-1" }],
    "ready",
  );

  assert.deepEqual(Array.from(state.steps, (step) => step.id), ["kid", "parent", "school", "action"]);
  assert.deepEqual(Array.from(state.steps, (step) => step.complete), [true, true, true, true]);
  assert.equal(state.complete, true);
  assert.equal(state.pending, false);
});

test("unavailable school and action data stay pending instead of becoming false completion", () => {
  const state = guide.derive(family(), null, [], "loading");
  assert.deepEqual(Array.from(state.steps, (step) => step.complete), [false, false, false, false]);
  assert.equal(state.steps.find((step) => step.id === "school").pending, true);
  assert.equal(state.steps.find((step) => step.id === "action").pending, true);
});

test("skip preference is family-scoped and reversible", () => {
  values.clear();
  assert.equal(guide.storageKey("family-1"), "fam_setup_skipped_family-1");
  assert.equal(guide.isSkipped("family-1"), false);
  assert.equal(guide.setSkipped("family-1", true), true);
  assert.equal(guide.isSkipped("family-1"), true);
  assert.equal(guide.isSkipped("family-2"), false);
  guide.setSkipped("family-1", false);
  assert.equal(guide.isSkipped("family-1"), false);
});

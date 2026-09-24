"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Today action queue bundle mounts parent-facing Hermes case cards", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "js", "action-queue.js"), "utf8");
  assert.match(source, /Hermes is working on/);
  assert.match(source, /\/api\/operator\/cases\?limit=12/);
  assert.match(source, /data-op-decision="approve"/);
  assert.match(source, /data-op-decision="reject"/);
  assert.match(source, /Evidence \/ confirmation/);
  assert.match(source, /Activity ·/);
  assert.match(source, /renderActionDetails/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /setAttribute\("role", "alert"\)/);
  // Today shows Hermes only when it has cases: a failed load never renders an error card.
  assert.match(source, /if \(!list\.querySelector\("\.hermes-op-case"\)\) panel\.hidden = true;/);
  assert.doesNotMatch(source, /temporarily unavailable|hermes-op-retry/);
  assert.match(source, /actionHash/);
  assert.doesNotMatch(source, /executionToken/);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "js", "action-queue.js"), "utf8");

test("Operator case cards request explicit feedback for completed and blocked beta cases", () => {
  assert.match(source, /data-op-feedback="helpful"/);
  assert.match(source, /data-op-feedback="not-helpful"/);
  assert.match(source, /data-op-feedback="block-correct"/);
  assert.match(source, /data-op-feedback="block-incorrect"/);
  assert.match(source, /\/api\/operator\/cases\/\$\{encodeURIComponent\(caseId\)\}\/feedback/);
  assert.match(source, /card\.feedback && card\.feedback\.required/);
  assert.match(source, /Saving feedback/);
});
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "js", "sat.js"), "utf8");

test("PathOdds quest is primary SAT Daily 5 behavior and vocabulary stays a warm-up", () => {
  assert.match(source, /PathOdds SAT/);
  assert.match(source, /Vocabulary warm-up/);
  assert.match(source, /markDaily5Done\('sat'\)/);
  const answerStart = source.indexOf("async function answerSatActivity");
  const mergeStart = source.indexOf("function mergeWordBankEntry", answerStart);
  const answerBody = source.slice(answerStart, mergeStart);
  assert.doesNotMatch(answerBody, /markDaily5Done\('sat'\)/);
});

test("parent dashboard only reads child PathOdds summaries", () => {
  assert.match(source, /api\/pathodds\/today\?kidId=/);
  assert.match(source, /each child completes the learning work in their own PathOdds session/);
  assert.doesNotMatch(source, /launchPathOdds\([^)]*kidId/);
});

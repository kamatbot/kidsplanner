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

test("Today shows only the signed-in person's PathOdds quest", () => {
  assert.match(source, /Connect PathOdds/);
  assert.match(source, /embedPathOddsQuest/);
  assert.match(source, /fam-pathodds-frame/);
  assert.match(source, /route: 'sat\.quest'/);
  assert.match(source, /pathOddsFetch\('\/api\/pathodds\/today'\)/);
  assert.match(source, /const payload = await pathOddsFetch\('\/api\/pathodds\/today'\);\s+renderPathOddsSelf\(payload\);/);
  assert.doesNotMatch(source, /api\/pathodds\/today\?kidId=/);
  assert.doesNotMatch(source, /renderPathOddsFamily|parentPathOddsStatus|parentPathOddsAction/);
  assert.doesNotMatch(source, /fam-pathodds-family|fam-pathodds-kid/);
  assert.doesNotMatch(source, /PathOdds for your family|each child’s SAT progress/);
  assert.match(source, /Your dashboard still works/);
  assert.doesNotMatch(source, /launchPathOdds\([^)]*kidId/);
});

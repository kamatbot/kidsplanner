"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const today = fs.readFileSync(
  path.join(root, "ios/FamETC/Features/Today/TodayView.swift"),
  "utf8",
);
const homework = fs.readFileSync(
  path.join(root, "ios/FamETC/App/PlaceholderScreens.swift"),
  "utf8",
);

function structSource(source, name) {
  const start = source.indexOf(`private struct ${name}`);
  assert.ok(start >= 0, `${name} should exist`);
  const next = source.indexOf("\nprivate struct ", start + 1);
  return source.slice(start, next >= 0 ? next : source.length);
}

test("parent Today omits study start while the kid stack keeps it", () => {
  const parents = structSource(today, "ParentTodayStack");
  const kids = structSource(today, "KidTodayStack");
  const dueRow = structSource(today, "HomeworkDueRow");
  assert.doesNotMatch(parents, /StudyStartCard\(\)/);
  assert.match(kids, /StudyStartCard\(\)/);
  assert.doesNotMatch(dueRow, /Button\s*\{|toggleHomeworkDone/);
});

test("parent homework rows and details are read-only", () => {
  assert.match(homework, /canMutate: !store\.isParent/);
  assert.match(homework, /if canMutate, let onToggle/);
  assert.match(homework, /if !store\.isParent \{\s*assignmentActions/);
  assert.match(homework, /if !store\.isParent \{\s*ViewThatFits/);
  assert.match(homework, /canMutate: !store\.isParent/);
  assert.match(homework, /if canMutate \{\s*Button\(action: onToggle\)/);
  assert.match(homework, /if canMutate \{\s*Button\(role: \.destructive/);
  assert.match(homework, /See what is due and monitor progress\./);
});

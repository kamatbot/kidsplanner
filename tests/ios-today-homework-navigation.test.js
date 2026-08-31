"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const rootView = fs.readFileSync(
  path.join(root, "ios/FamETC/App/RootView.swift"),
  "utf8",
);
const today = fs.readFileSync(
  path.join(root, "ios/FamETC/Features/Today/TodayView.swift"),
  "utf8",
);

function structSource(source, name) {
  const start = source.indexOf(`private struct ${name}`);
  assert.ok(start >= 0, `${name} should exist`);
  const next = source.indexOf("\nprivate struct ", start + 1);
  return source.slice(start, next >= 0 ? next : source.length);
}

test("iPhone and iPad Today tabs route to the native Homework tab", () => {
  const routes = rootView.match(/TodayScreen\(onOpenHomework: \{ selection = \.homework \}\)/g) ?? [];
  assert.equal(routes.length, 2, "both production Today screens should route to Homework");
});

test("Today passes the homework route through both role stacks and cards", () => {
  assert.match(today, /let onOpenHomework: \(\) -> Void/);
  assert.match(today, /init\(onOpenHomework: @escaping \(\) -> Void = \{\}\)/);
  assert.match(today, /ParentTodayStack\(onOpenHomework: onOpenHomework\)/);
  assert.match(today, /KidTodayStack\(onOpenHomework: onOpenHomework\)/);

  const parentStack = structSource(today, "ParentTodayStack");
  const kidStack = structSource(today, "KidTodayStack");
  const parentCard = structSource(today, "HomeworkDueCard");
  const kidCard = structSource(today, "KidHomeworkCard");

  assert.match(parentStack, /HomeworkDueCard\(onOpenHomework: onOpenHomework\)/);
  assert.match(kidStack, /KidHomeworkCard\(onOpenHomework: onOpenHomework\)/);
  assert.match(parentCard, /let onOpenHomework: \(\) -> Void/);
  assert.match(kidCard, /let onOpenHomework: \(\) -> Void/);
  assert.match(parentCard, /HomeworkOpenButton\(action: onOpenHomework\)/);
  assert.match(kidCard, /HomeworkOpenButton\(action: onOpenHomework\)/);
});

test("parent Today homework stays read-only while kid completion remains separate", () => {
  const parentCard = structSource(today, "HomeworkDueCard");
  const parentRow = structSource(today, "HomeworkDueRow");
  const kidCard = structSource(today, "KidHomeworkCard");
  const kidRow = structSource(today, "KidHomeworkRow");
  const openButton = structSource(today, "HomeworkOpenButton");

  assert.doesNotMatch(parentCard, /setHomework|toggleHomework|Button\s*\{/);
  assert.doesNotMatch(parentRow, /setHomework|toggleHomework|Button\s*\{/);
  assert.doesNotMatch(kidCard, /Button\s*\{/);
  assert.match(kidRow, /Button\s*\{/);
  assert.match(kidRow, /toggleHomeworkDone/);
  assert.match(openButton, /minHeight: 44/);
  assert.match(openButton, /Open homework/);
  assert.match(openButton, /accessibilityHint\("Open the full Homework screen"\)/);
});

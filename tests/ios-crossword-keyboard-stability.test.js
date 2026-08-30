"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "ios/FamETC/Features/Today/DashboardWidgets.swift"),
  "utf8",
);

test("crossword cell focus transfers without resigning the keyboard", () => {
  const start = source.indexOf("private struct CrosswordCellField");
  const end = source.indexOf("private struct DailyPuzzleView");
  assert.ok(start >= 0 && end > start, "crossword cell field source must exist");

  const fieldSource = source.slice(start, end);
  assert.match(fieldSource, /if isFocused, !field\.isFirstResponder/);
  assert.match(fieldSource, /field\.becomeFirstResponder\(\)/);
  assert.doesNotMatch(fieldSource, /field\.resignFirstResponder\(\)/);
  assert.match(fieldSource, /field\.onDeleteBackward = onDeleteBackward/);
  assert.match(fieldSource, /shouldChangeCharactersIn range: NSRange/);
  assert.match(fieldSource, /parent\.onInput\(string\)/);
});

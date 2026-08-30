"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "ios/FamETC/Features/Today/DashboardWidgets.swift"),
  "utf8",
);

test("crossword grid uses adaptive square cells that fit narrow sheets", () => {
  const start = source.indexOf("private func crosswordView");
  const end = source.indexOf("private func crosswordClues", start);
  assert.ok(start >= 0 && end > start, "crossword grid source must exist");

  const gridSource = source.slice(start, end);
  assert.doesNotMatch(gridSource, /max\(18\s*,/);
  assert.doesNotMatch(source, /private func crosswordHeight/);
  assert.match(gridSource, /GridItem\(\.flexible\(minimum: 1, maximum: 34\)/);
  assert.match(gridSource, /\.aspectRatio\(1, contentMode: \.fit\)/);
  assert.match(gridSource, /\.frame\(maxWidth: maximumGridWidth, alignment: \.center\)/);
  assert.match(gridSource, /\.aspectRatio\(CGFloat\(columns\) \/ CGFloat\(rows\), contentMode: \.fit\)/);
});

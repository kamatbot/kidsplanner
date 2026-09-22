"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "ios/FamETC/Features/Today/DashboardWidgets.swift"),
  "utf8",
);

test("crossword keeps touch-sized cells in a bounded, focus-following scroll view", () => {
  const start = source.indexOf("private func crosswordView");
  const end = source.indexOf("private func crosswordClues", start);
  assert.ok(start >= 0 && end > start, "crossword grid source must exist");

  const gridSource = source.slice(start, end);
  assert.doesNotMatch(gridSource, /max\(18\s*,/);
  assert.doesNotMatch(source, /private func crosswordHeight/);
  assert.match(gridSource, /let cellSize: CGFloat = 44/);
  assert.match(gridSource, /ScrollView\(\.horizontal, showsIndicators: true\)/);
  assert.match(gridSource, /GridItem\(\.fixed\(cellSize\)/);
  assert.match(gridSource, /\.aspectRatio\(1, contentMode: \.fit\)/);
  assert.match(gridSource, /\.id\(crosswordCellKey\(row: row, col: col\)\)/);
  assert.match(gridSource, /proxy\.scrollTo\(cell, anchor: \.center\)/);
  assert.match(source, /field\.accessibilityIdentifier = accessibilityID/);
});

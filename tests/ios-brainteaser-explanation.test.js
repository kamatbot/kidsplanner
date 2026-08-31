"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const models = fs.readFileSync(path.join(root, "ios/FamETC/Networking/Models.swift"), "utf8");
const view = fs.readFileSync(path.join(root, "ios/FamETC/Features/Today/BrainTeaserView.swift"), "utf8");

test("iOS brain teasers decode and show the server's worked explanation", () => {
  assert.match(models, /struct BrainTeaserQ[\s\S]*var exp: String\? = nil/);
  assert.match(view, /q\.exp\?\.trimmingCharacters/);
  assert.ok(view.includes('.accessibilityLabel("Why: \\(explanation)")'));
});

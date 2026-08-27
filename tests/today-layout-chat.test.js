"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const styles = fs.readFileSync(path.join(root, "public/css/styles.css"), "utf8");
const app = fs.readFileSync(path.join(root, "public/js/app.js"), "utf8");

test("Today uses equal desktop columns and preserves the mobile single column", () => {
  assert.match(styles, /\.today-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/s);
  assert.match(styles, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.today-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test("Calendar uses the existing collapsed chat rail", () => {
  assert.match(app, /const CHAT_DOCK_MODE\s*=\s*\{[^}]*today:\s*'open',\s*calendar:\s*'collapsed',[^}]*notes:\s*'hidden',\s*settings:\s*'hidden'/);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("Family Memory parent page exposes review, edit and delete controls", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/operator-memory.html"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "../public/js/operator-memory.js"), "utf8");
  assert.match(html, /Family Memory/);
  assert.match(html, /Hermes proposals/);
  assert.match(js, /data-memory-approve/);
  assert.match(js, /data-memory-reject/);
  assert.match(js, /data-memory-edit/);
  assert.match(js, /data-memory-delete/);
  assert.match(js, /\/api\/operator\/memory/);
});

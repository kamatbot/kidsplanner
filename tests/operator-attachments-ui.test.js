"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("Operator attachment page keeps file actions parent-visible and case-scoped", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/operator-attachments.html"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "../public/js/operator-attachments.js"), "utf8");
  assert.match(html, /Case attachments/);
  assert.match(html, /Up to 8 MB/);
  assert.match(js, /\/api\/operator\/cases\/.*\/attachments/);
  assert.match(js, /data-attachment-delete/);
  assert.match(js, /file\.arrayBuffer/);
  assert.doesNotMatch(js, /\/api\/hermes/);
});

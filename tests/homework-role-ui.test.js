"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app.js"), "utf8");
const markup = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

test("web homework progress controls are student-only while parent steps stay visible", () => {
  assert.match(markup, /id="homework-checklist-group"/);
  assert.match(appSource, /homework-checklist-group'\)\.style\.display = isKidSession\(\) \? '' : 'none'/);
  assert.match(appSource, /if \(isKidSession\(\)\) payload\.checklist =/);
  assert.match(appSource, /if \(!isKidSession\(\)\) return;\s+const item = homeworkItems\.find/);
  assert.match(appSource, /isKidSession\(\) \? `onchange=.*toggleHomeworkChecklistItem[\s\S]*: 'disabled'/);
  assert.match(appSource, /async function toggleHomeworkChecklistItem[\s\S]*if \(!isKidSession\(\)\) return;/);
});

test("API homework is labelled as school-synced and exposes only validated HTTPS assignment links", () => {
  assert.match(appSource, /\['school', 'school-portal', 'school-api'\]\.includes\(source\)/);
  assert.match(markup, /id="hw-detail-school-link"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(appSource, /if \(item\.schoolLink && newsUrlIsHttps\(item\.schoolLink\)\)/);
});

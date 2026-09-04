"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "public/js/school.js"), "utf8");
const markup = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/css/styles.css"), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

test("settings treats private links as secrets and discloses the first-sync replacement", () => {
  assert.match(markup, /first successful homework sync replaces that child's existing homework list/i);
  assert.match(source, /type="password"[^>]*autocomplete="off"[^>]*spellcheck="false"/);
  assert.doesNotMatch(source, /value="\$\{[^}]*homeworkUrl|value="\$\{[^}]*timetableUrl/);
});

test("unknown server errors cannot be rendered with a URL or capability code", () => {
  const sandbox = {};
  vm.runInNewContext(`${extractFunction("schoolApiErrorText")}\nthis.mapError = schoolApiErrorText;`, sandbox);
  const raw = "Request failed for https://example.test/childhomework.php?code=secret-value";
  assert.equal(sandbox.mapError(raw), "Could not update the school feeds. Try again later.");
  assert.equal(sandbox.mapError("The school link is no longer valid."), "The private links are no longer valid. Replace them in Settings or contact school IT.");
});

test("settings distinguishes loading and error states and keeps mobile actions tappable", () => {
  assert.match(source, /schoolApiStatusState = 'loading'/);
  assert.match(source, /schoolApiStatusState = 'error'/);
  assert.match(source, /Checking private school connections/);
  assert.match(source, /Could not check private school connections/);
  assert.match(styles, /#school-api-feeds-card :is\(a, button, input, select, textarea, summary\)\s*\{[^}]*min-height:\s*44px/s);
  assert.match(styles, /\.school-api-source-link\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(styles, /\.school-api-link-editor summary\s*\{[^}]*min-height:\s*44px/s);
  assert.match(styles, /\.school-api-actions \.btn-link-danger\s*\{[^}]*min-height:\s*44px/s);
});

test("school feed sync refreshes the family-event mirror after legacy cleanup", () => {
  assert.match(extractFunction("syncSchoolCalendar"), /await loadFamilyEvents\(\)/);
  assert.match(extractFunction("refreshSchoolApiSurfaces"), /await loadFamilyEvents\(\)/);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public/js/app.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`could not extract ${name}`);
}

const sandbox = {};
vm.runInNewContext([
  `function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return \`${"${y}"}-${"${m}"}-${"${day}"}\`;
  }`,
  extractFunction(appSource, "normalizeSchoolImportDate"),
  "this.normalizeSchoolImportDate = normalizeSchoolImportDate;",
].join("\n"), sandbox, { filename: "school-import-date.js" });

const normalizeSchoolImportDate = sandbox.normalizeSchoolImportDate;

test("normalizeSchoolImportDate: resolves exact weekday names and abbreviations locally", () => {
  const sunday = new Date(2026, 7, 9, 12);
  assert.equal(normalizeSchoolImportDate("Saturday", sunday), "2026-08-15");
  assert.equal(normalizeSchoolImportDate("sAt", sunday), "2026-08-15");
  assert.equal(normalizeSchoolImportDate("Sunday", sunday), "2026-08-09");
  assert.equal(normalizeSchoolImportDate("Due Saturday", sunday), null);
  assert.equal(normalizeSchoolImportDate("Saturday or Sunday", sunday), null);

  const yearEnd = new Date(2026, 11, 31, 12);
  assert.equal(normalizeSchoolImportDate("Monday", yearEnd), "2027-01-04");
});

test("normalizeSchoolImportDate: preserves ISO and academic-year day/month parsing", () => {
  assert.equal(normalizeSchoolImportDate("2026-08-15", new Date(2026, 7, 9, 12)), "2026-08-15");
  assert.equal(normalizeSchoolImportDate("Thu 18 June", new Date(2026, 6, 3, 12)), "2026-06-18");
  assert.equal(normalizeSchoolImportDate("10 January", new Date(2026, 10, 15, 12)), "2027-01-10");
});

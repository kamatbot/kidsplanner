"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, "chrome-extension", file), "utf8");

test("extension active flow imports only school stats not covered by the private API", () => {
  const background = read("background.js");
  const popup = read("popup.js");
  const content = read("content.js");

  for (const source of [popup, content]) {
    assert.match(source, /parseSchoolStatsHtml/);
    assert.match(source, /type:\s*"IMPORT_STATS"/);
    assert.doesNotMatch(source, /parseHomeworkHtml|parseTimetableHtml|parseSignedUpActivitiesHtml/);
  }
  assert.match(background, /if \(msg\.type === "IMPORT_STATS"\)/);
  assert.match(background, /schoolStats:\s*msg\.schoolStats\s*\|\|\s*\[\]/);
  assert.doesNotMatch(background, /homework:\s*msg\.|timetable:\s*msg\.|activitySnapshots:\s*msg\./);
});

test("extension retains completion delivery without enabling a new homework import path", () => {
  const background = read("background.js");
  const content = read("content.js");
  assert.match(content, /type:\s*"SYNC_MOODLE_COMPLETIONS"/);
  assert.match(background, /if \(msg\.type === "SYNC_MOODLE_COMPLETIONS"\)/);
  assert.doesNotMatch(content, /type:\s*"IMPORT"/);
  assert.doesNotMatch(background, /msg\.type === "IMPORT"/);
});

test("extension helper release keeps its least-privilege permission set", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const popup = read("popup.html");
  assert.equal(manifest.version, "0.5.0");
  assert.equal(manifest.name, "Fam ETC School Helper");
  assert.deepEqual(manifest.permissions, ["scripting", "storage"]);
  assert.equal(manifest.permissions.includes("activeTab"), false);
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.doesNotMatch(popup, /Moodle user id|Child's name in Fam ETC|Import school data/);
  assert.match(popup, /Sync school stats/);
});

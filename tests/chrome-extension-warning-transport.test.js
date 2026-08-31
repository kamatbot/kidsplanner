"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, "chrome-extension", file), "utf8");

test("extension warning transport forwards parser warnings to the Fam ETC bridge", () => {
  const background = read("background.js");
  const popup = read("popup.js");
  const content = read("content.js");

  assert.match(background, /parseWarnings:\s*msg\.parseWarnings\s*\|\|\s*\[\]/);
  assert.match(popup, /parseWarnings,\s*\n\s*\}\);/);
  assert.match(content, /parseWarnings:\s*collectWarnings\(parseWarnings/);
  assert.match(content, /response\.result\.importWarnings/);
});

test("warning callouts use textContent for parser/import messages and never report clean success", () => {
  const popup = read("popup.js");
  const content = read("content.js");

  assert.match(popup, /warnings\.length \? .*\"error\" : \"ok\"/s);
  assert.match(content, /el\.querySelector\(\"\[data-fam-warning-message\]\"\)\.textContent = warnings\[0\]/);
  assert.doesNotMatch(content, /data-fam-warning-message[^\n]*\$\{warnings/);
});

test("extension reports ECA, auto-sync, and live-sync failures with bounded actionable warnings", () => {
  const popup = read("popup.js");
  const content = read("content.js");
  const parser = read("parse.js");

  assert.match(parser, /toLowerCase\(\) !== "signed up"|toLowerCase\(\) === "signed up"/);
  assert.match(popup, /Could not read a signed-up ECA page/);
  assert.match(popup, /parserWarningStatus[\s\S]*parseWarnings\[0\]/);
  assert.match(content, /Auto-sync could not complete for one child/);
  assert.match(content, /Live activity sync could not complete/);
  assert.match(popup, /2-week timetable detected; unusual rows will be marked for review/);
});

test("extension completion-sync version is 0.4.0", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "chrome-extension", "manifest.json"), "utf8"));
  assert.equal(manifest.version, "0.4.0");
  assert.deepEqual(manifest.permissions, ["scripting", "storage"]);
  assert.equal(manifest.permissions.includes("activeTab"), false);
  assert.equal(manifest.permissions.includes("tabs"), false);
});

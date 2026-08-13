"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadParser(extraGlobals = {}) {
  const context = vm.createContext({ ...extraGlobals });
  const source = fs.readFileSync(path.join(__dirname, "..", "chrome-extension", "parse.js"), "utf8");
  vm.runInContext(source, context, { filename: "chrome-extension/parse.js" });
  return context;
}

test("extension version identifies the ECA reconciliation release", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "chrome-extension", "manifest.json"), "utf8"));
  assert.equal(manifest.version, "0.3.1");
});

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

test("parseEcaTimeslot: converts displayed Moodle time to an exact local date/time", () => {
  const parser = loadParser();
  assert.deepEqual(
    { ...parser.parseEcaTimeslot("Thursday 20 Aug 2026, 3:45 pm") },
    { date: "2026-08-20", time: "15:45" }
  );
  assert.deepEqual(
    { ...parser.parseEcaTimeslot("Friday 21 Aug 2026, 12:05 am") },
    { date: "2026-08-21", time: "00:05" }
  );
});

test("parseSignedUpActivitiesHtml: imports Signed up rows and ignores availability/waitlists", () => {
  const header = {
    textContent: "Thursday 20 Aug 2026, 3:45 pm",
    querySelector: (selector) => selector === ".timeslot-radio" ? {} : null,
  };
  const row = ({ status, title, clubId }) => ({
    querySelector(selector) {
      if (selector === "th") return null;
      if (selector === "td.wait") return { textContent: status };
      if (selector === "td.name a") return { textContent: title };
      return null;
    },
    getAttribute(name) { return name === "data-clubid" ? clubId : null; },
  });
  const table = {
    querySelectorAll: () => [
      { querySelector: (selector) => selector === "th" ? header : null },
      row({ status: "11 available", title: "Tennis", clubId: "1" }),
      row({ status: "Join Waitlist (2nd)?", title: "Swimming", clubId: "2" }),
      row({ status: "Signed up", title: "High School Flames Chess Tryouts", clubId: "64894" }),
    ],
  };
  class FakeDOMParser {
    parseFromString() {
      return { querySelector: (selector) => selector === "table#ecastudentview" ? table : null };
    }
  }
  const parser = loadParser({ DOMParser: FakeDOMParser });
  const activities = parser.parseSignedUpActivitiesHtml("<ignored>");
  assert.deepEqual(Array.from(activities, (activity) => ({ ...activity })), [{
    title: "High School Flames Chess Tryouts",
    date: "2026-08-20",
    time: "15:45",
    clubId: "64894",
  }]);
});

test("calendar activity deduplication keeps identical sibling signups separate", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app.js"), "utf8");
  const sandbox = {};
  vm.runInNewContext([
    extractFunction(appSource, "schoolImportEventKey"),
    "this.schoolImportEventKey = schoolImportEventKey;",
  ].join("\n"), sandbox, { filename: "public/js/app.js" });

  const firstKid = sandbox.schoolImportEventKey("2026-08-20", "15:45", " Swimming ", "kid-1");
  const sameSignup = sandbox.schoolImportEventKey("2026-08-20", "15:45", "swimming", "kid-1");
  const sibling = sandbox.schoolImportEventKey("2026-08-20", "15:45", "Swimming", "kid-2");
  assert.equal(firstKid, sameSignup);
  assert.notEqual(firstKid, sibling);

});

function loadEcaReconciliationHelpers() {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app.js"), "utf8");
  const start = source.indexOf("function schoolImportEventKey");
  const end = source.indexOf("// Normalize a day value", start);
  assert.ok(start >= 0 && end > start, "ECA reconciliation helpers should be present in app.js");
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end), context, { filename: "app-eca-helpers.js" });
  return context;
}

test("ECA reconciliation does not adopt or delete a matching manual event", () => {
  const helper = loadEcaReconciliationHelpers();
  const sourceId = helper.ecaImportSourceId("kid-1", "834", "64894");
  const manual = { id: "ev_manual", kidId: "kid-1", title: "Chess", date: "2026-08-20", time: "15:45", notes: "" };
  const plan = helper.planEcaSnapshotReconciliation(
    [manual], "kid-1", "834",
    [{ sourceType: "eca", sourceId, title: "Chess", date: "2026-08-20", time: "15:45" }]
  );
  assert.equal(plan.add.length, 0);
  assert.equal(plan.remove.length, 0);
});

test("ECA reconciliation removes only extension-owned events missing from a complete snapshot", () => {
  const helper = loadEcaReconciliationHelpers();
  const sourceId = helper.ecaImportSourceId("kid-1", "834", "64894");
  const owned = {
    id: "ev_owned", kidId: "kid-1", title: "Chess", date: "2026-08-20", time: "15:45",
    notes: "Signed up activity", sourceType: "eca", sourceId,
  };
  const manual = { id: "ev_manual", kidId: "kid-1", title: "Swimming", date: "2026-08-25", time: "14:45", notes: "" };
  const otherKid = { ...owned, id: "ev_other", kidId: "kid-2" };
  const otherPage = {
    ...owned, id: "ev_other_page", sourceId: helper.ecaImportSourceId("kid-1", "999", "64894"),
  };
  const plan = helper.planEcaSnapshotReconciliation(
    [owned, manual, otherKid, otherPage], "kid-1", "834", []
  );
  assert.deepEqual(Array.from(plan.remove, (event) => event.id), ["ev_owned"]);
  assert.equal(plan.add.length, 0);
});

test("ECA reconciliation replaces an owned event when its date or title changes", () => {
  const helper = loadEcaReconciliationHelpers();
  const sourceId = helper.ecaImportSourceId("kid-1", "834", "64894");
  const owned = {
    id: "ev_owned", kidId: "kid-1", title: "Chess", date: "2026-08-20", time: "15:45",
    notes: "Signed up activity", sourceType: "eca", sourceId,
  };
  const changed = { sourceType: "eca", sourceId, title: "Flames Chess", date: "2026-08-21", time: "15:45" };
  const plan = helper.planEcaSnapshotReconciliation([owned], "kid-1", "834", [changed]);
  assert.deepEqual(Array.from(plan.remove, (event) => event.id), ["ev_owned"]);
  assert.deepEqual(Array.from(plan.add, (event) => ({ ...event })), [changed]);
});

test("ECA ownership uses source fields and keeps visible notes free of Moodle ids", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app.js"), "utf8");
  const activityBlock = appSource.slice(
    appSource.indexOf("/* ---------- Signed-up activities"),
    appSource.indexOf("/* ---------- School stats", appSource.indexOf("/* ---------- Signed-up activities"))
  );
  assert.match(activityBlock, /sourceType: activity\.sourceType/);
  assert.match(activityBlock, /sourceId: activity\.sourceId/);
  assert.match(activityBlock, /notes: 'Signed up activity'/);
  assert.doesNotMatch(activityBlock, /notes: `\$\{activity\./);
  assert.match(activityBlock, /await window\.auth\.addCalendarEvent/);
  assert.match(activityBlock, /if \(!response\.existing\) \{/);
  assert.match(activityBlock, /result\.activityEventsAdded\+\+/);
});

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

  const activityBlock = appSource.slice(
    appSource.indexOf("/* ---------- Signed-up activities"),
    appSource.indexOf("/* ---------- School stats", appSource.indexOf("/* ---------- Signed-up activities"))
  );
  assert.match(activityBlock, /schoolImportEventKey\(e\.date, e\.time, e\.title, e\.kidId\)/);
  assert.match(activityBlock, /schoolImportEventKey\(date, time, title, kidId\)/);
});

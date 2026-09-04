"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "public/js/app.js"), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `expected ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function harness({ kidSession = false, signedIn = true, statsUpdated = 1 } = {}) {
  const calls = [];
  const sandbox = {
    isKidSession: () => kidSession,
    sessionUser: signedIn ? { id: "parent-1" } : null,
    currentFamily: signedIn ? { kids: [{ id: "kid-1", name: "Alex" }] } : null,
    processSchoolStats: async (kids, stats) => { calls.push({ kids, stats }); return statsUpdated; },
    toast: (message) => calls.push({ toast: message }),
  };
  vm.runInNewContext(`${extractFunction("famImportSchoolData")}\nthis.run = famImportSchoolData;`, sandbox);
  return { run: sandbox.run, calls };
}

test("current extension bridge processes school stats without a kid mapping", async () => {
  const app = harness({ statsUpdated: 2 });
  const result = await app.run({ schoolStats: [{ name: "Alex" }, { name: "Maya" }] });
  assert.equal(result.schoolStatsUpdated, 2);
  assert.equal(app.calls[0].stats.length, 2);
  assert.match(app.calls[1].toast, /Updated school stats/);
});

test("stale extension payloads cannot import homework timetable or activities", async () => {
  const app = harness();
  const result = await app.run({
    homework: [{ title: "Should not import" }],
    timetable: [{ subject: "Should not import" }],
    activitySnapshots: [{ activities: [{ title: "Should not import" }] }],
  });
  assert.equal(result.homeworkAdded, 0);
  assert.equal(result.timetableEventsAdded, 0);
  assert.equal(result.activityEventsAdded, 0);
  assert.equal(app.calls.length, 0);
});

test("school stats bridge remains parent-session only", async () => {
  for (const options of [{ kidSession: true }, { signedIn: false }]) {
    const app = harness(options);
    const result = await app.run({ schoolStats: [{ name: "Alex" }] });
    assert.equal(result.schoolStatsUpdated, 0);
    assert.equal(app.calls.length, 0);
  }
});

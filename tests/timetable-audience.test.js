"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "public/js/app.js"), "utf8");

function extractFunction(name) {
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

function scopedEvents({ kidSession, kidId }) {
  const timetable = { id: "ev_timetable", kidId: "kid-a", category: "school", notes: "Timetable", source: "manual" };
  const localTimetable = { id: "local_timetable", kidId: "kid-a", category: "school", notes: "", source: "timetable-import" };
  const schoolFeed = { id: "school_feed", kidId: "kid-a", category: "school", notes: "Timetable", source: "school" };
  const ownEvent = { id: "ev_own", kidId: "kid-a", category: "sports", notes: "Training", source: "manual" };
  const siblingEvent = { id: "ev_sibling", kidId: "kid-b", category: "arts", notes: "Music", source: "manual" };
  const familyEvent = { id: "ev_family", kidId: null, category: "social", notes: "Dinner", source: "manual" };
  const sandbox = {
    getEvents: () => [timetable, localTimetable, ownEvent, siblingEvent, familyEvent],
    schoolEvents: [schoolFeed],
    normalizeSchoolEvent: (event) => event,
    isKidSession: () => kidSession,
    sessionUser: { kidId },
  };
  vm.runInNewContext([
    extractFunction("isImportedTimetableEvent"),
    extractFunction("allEvents"),
    "this.result = allEvents();",
  ].join("\n"), sandbox, { filename: "timetable-audience.js" });
  return sandbox.result.map((event) => event.id);
}

test("parents exclude imported timetable rows but retain other kid and family events", () => {
  assert.deepEqual(scopedEvents({ kidSession: false }), ["ev_own", "ev_sibling", "ev_family", "school_feed"]);
});

test("kids retain family events and only their own kid-scoped calendar", () => {
  assert.deepEqual(scopedEvents({ kidSession: true, kidId: "kid-a" }), ["ev_timetable", "local_timetable", "ev_own", "ev_family", "school_feed"]);
});

test("calendar reminders share the audience scope and parent homework remains family-wide", () => {
  assert.match(source, /getHomework\(isKidSession\(\) \? \{ kidId: sessionUser\.kidId \} : \{\}\)/);
  assert.match(source, /function scheduleReminders\(\)[\s\S]*?const events = allEvents\(\);/);

  const appStore = fs.readFileSync(path.join(__dirname, "..", "ios/FamETC/Domain/AppStore.swift"), "utf8");
  assert.match(appStore, /if let hw = try\? await api\.homework\(\) \{ homework = hw \}/);
  assert.match(appStore, /NotificationScheduler\.reschedule\(events: visibleFamilyEvents, homework: homework/);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "public/js/app.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "public/css/styles.css"), "utf8");
const indexHtml = fs.readFileSync(path.join(__dirname, "..", "public/index.html"), "utf8");

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
  const warningTimetable = {
    id: "warning_timetable", kidId: "kid-a", category: "school", source: "manual",
    notes: "Import warning — needs review: time is missing or invalid\nRaw values — day: 1; period: ECA1; time: (missing)",
  };
  const warningActivity = {
    id: "warning_activity", kidId: "kid-a", category: "school", source: "manual",
    notes: "Import warning — needs review: time is missing or invalid\nRaw values — title: Chess; date: 2026-08-25; time: (missing)",
  };
  const schoolFeed = { id: "school_feed", kidId: "kid-a", category: "school", notes: "Timetable", source: "school" };
  const ownEvent = { id: "ev_own", kidId: "kid-a", category: "sports", notes: "Training", source: "manual" };
  const siblingEvent = { id: "ev_sibling", kidId: "kid-b", category: "arts", notes: "Music", source: "manual" };
  const familyEvent = { id: "ev_family", kidId: null, category: "social", notes: "Dinner", source: "manual" };
  const sandbox = {
    getEvents: () => [timetable, localTimetable, warningTimetable, warningActivity, ownEvent, siblingEvent, familyEvent],
    schoolEvents: [schoolFeed],
    normalizeSchoolEvent: (event) => event,
    isKidSession: () => kidSession,
    sessionUser: { kidId },
  };
  vm.runInNewContext([
    extractFunction("isImportedTimetableEvent"),
    extractFunction("mergedCalendarEvents"),
    extractFunction("allEvents"),
    "this.result = allEvents();",
  ].join("\n"), sandbox, { filename: "timetable-audience.js" });
  return sandbox.result.map((event) => event.id);
}

function visibleCalendarEvents({ kidSession, kidId, activeKidId = null, audience = "all" }) {
  const timetableA = { id: "ev_timetable_a", kidId: "kid-a", category: "school", notes: "Timetable", source: "manual" };
  const timetableB = { id: "ev_timetable_b", kidId: "kid-b", category: "school", notes: "", source: "timetable-import" };
  const schoolFeed = { id: "school_feed", kidId: "kid-a", category: "school", notes: "Timetable", source: "school" };
  const ownEvent = { id: "ev_own", kidId: "kid-a", category: "sports", notes: "Training", source: "manual" };
  const siblingEvent = { id: "ev_sibling", kidId: "kid-b", category: "arts", notes: "Music", source: "manual" };
  const familyEvent = { id: "ev_family", kidId: null, category: "social", notes: "Dinner", source: "manual" };
  const sandbox = {
    getEvents: () => [timetableA, timetableB, ownEvent, siblingEvent, familyEvent],
    schoolEvents: [schoolFeed],
    normalizeSchoolEvent: (event) => event,
    isKidSession: () => kidSession,
    sessionUser: { kidId },
    currentFamily: { kids: [{ id: "kid-a", name: "Ava" }, { id: "kid-b", name: "Ben" }] },
    activeKidId,
    calendarAudience: audience,
  };
  vm.runInNewContext([
    extractFunction("isImportedTimetableEvent"),
    extractFunction("isTimetableMode"),
    extractFunction("mergedCalendarEvents"),
    extractFunction("visibleEvents"),
    "this.result = visibleEvents();",
  ].join("\n"), sandbox, { filename: "timetable-calendar.js" });
  return sandbox.result.map((event) => event.id);
}

function switcherMarkup(kidSession) {
  const calendar = { id: "kid-switcher-calendar", innerHTML: "" };
  const homework = { id: "kid-switcher-homework", innerHTML: "" };
  const sandbox = {
    document: { querySelectorAll: () => [calendar, homework] },
    currentFamily: { kids: [{ id: "kid-a", name: "Ava" }, { id: "kid-b", name: "Ben" }] },
    sessionUser: { kidId: "kid-a" },
    activeKidId: null,
    calendarAudience: "all",
    isKidSession: () => kidSession,
  };
  vm.runInNewContext([
    extractFunction("esc"),
    extractFunction("kidColorFor"),
    extractFunction("renderKidSwitcher"),
    "renderKidSwitcher();",
  ].join("\n"), sandbox, { filename: "timetable-switcher.js" });
  return { calendar: calendar.innerHTML, homework: homework.innerHTML };
}

test("parents exclude imported timetable rows but retain other kid and family events", () => {
  assert.deepEqual(scopedEvents({ kidSession: false }), ["warning_activity", "ev_own", "ev_sibling", "ev_family", "school_feed"]);
});

test("kids retain family events and only their own kid-scoped calendar", () => {
  assert.deepEqual(scopedEvents({ kidSession: true, kidId: "kid-a" }), ["ev_timetable", "local_timetable", "warning_timetable", "warning_activity", "ev_own", "ev_family", "school_feed"]);
});

test("Today replaces import diagnostics with a concise review prompt", () => {
  const sandbox = {};
  vm.runInNewContext([
    extractFunction("todayScheduleMeta"),
    `this.warning = todayScheduleMeta({ notes: "Import warning — needs review: time is missing or invalid\\nRaw values — day: 1; period: ECA1" });`,
    `this.ordinary = todayScheduleMeta({ notes: "Bring boots" });`,
    `this.location = todayScheduleMeta({ location: "Sports Hall", notes: "Import warning — needs review: ignored" });`,
  ].join("\n"), sandbox, { filename: "today-schedule-meta.js" });

  assert.equal(sandbox.warning, "Imported item needs review — open to check the details");
  assert.equal(sandbox.ordinary, "Bring boots");
  assert.equal(sandbox.location, "Sports Hall");
});

test("parent child selection adds that child's timetable without sibling events", () => {
  assert.deepEqual(
    visibleCalendarEvents({ kidSession: false, activeKidId: "kid-a" }),
    ["ev_own", "ev_family", "school_feed", "ev_timetable_a"]
  );
});

test("parent Timetable mode shows every imported lesson and no ordinary or school-feed event", () => {
  assert.deepEqual(
    visibleCalendarEvents({ kidSession: false, audience: "timetable" }),
    ["ev_timetable_a", "ev_timetable_b"]
  );
});

test("kids cannot enter the parent Timetable mode and keep their own timetable rows", () => {
  assert.deepEqual(
    visibleCalendarEvents({ kidSession: true, kidId: "kid-a", audience: "timetable" }),
    ["ev_timetable_a", "ev_own", "ev_family", "school_feed"]
  );
  assert.match(source, /if \(isCalendar\)[\s\S]*Timetable/);
  const switcher = source.slice(source.indexOf("function renderKidSwitcher"), source.indexOf("function setCalendarAudience"));
  assert.doesNotMatch(switcher.slice(0, switcher.indexOf("const chipsFor")), /Timetable/);
});

test("only the parent Calendar switcher renders Timetable", () => {
  const parent = switcherMarkup(false);
  assert.match(parent.calendar, /Timetable/);
  assert.match(parent.calendar, />Parents<\/button>/);
  assert.doesNotMatch(parent.calendar, />All kids<\/button>/);
  assert.match(parent.calendar, /aria-pressed="true"/);
  assert.match(parent.homework, />All kids<\/button>/);
  assert.doesNotMatch(parent.homework, />Parents<\/button>/);
  assert.doesNotMatch(parent.homework, /Timetable/);

  const kid = switcherMarkup(true);
  assert.doesNotMatch(kid.calendar, /Timetable/);
  assert.doesNotMatch(kid.homework, /Timetable/);
  assert.doesNotMatch(kid.calendar, /<button/);
});

test("Timetable suppresses homework chips and timed slots while preserving header Add", () => {
  assert.match(source, /const dueHw = timetable \? \[\] : visibleHomeworkDueItems\(\)/);
  assert.match(source, /if \(!timetable\) \{[\s\S]*class="week-time-slot"/);
  assert.match(source, /timetable \? '' : ` onclick="openAddEventModal\('\$\{ds\}'\)"/);
  assert.match(indexHtml, /<button class="btn-primary" id="calendar-add-event-btn" onclick="openCalendarAddEvent\(\)">\+ Add<\/button>/);
});

test("Timetable controls are semantic, keyboard-visible, and safe to wrap", () => {
  assert.match(source, /type="button" class="kid-chip[\s\S]*aria-pressed=/);
  assert.match(source, /aria-label="Show all kids' timetable"/);
  assert.match(styles, /\.kid-chip\s*\{[^}]*min-height:\s*44px/);
  assert.match(styles, /\.kid-chip:focus-visible\s*\{/);
  assert.match(styles, /\.kid-switcher\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(styles, /\.timetable-event-kid\s*\{/);
});

test("calendar reminders share the audience scope and parent homework remains family-wide", () => {
  assert.match(source, /getHomework\(isKidSession\(\) \? \{ kidId: sessionUser\.kidId \} : \{\}\)/);
  assert.match(source, /function scheduleReminders\(\)[\s\S]*?const events = allEvents\(\);/);
  assert.match(source, /function renderTodaySchedule\(todayIso\)[\s\S]*?const events = allEvents\(\)/);
  assert.match(source, /function renderHomeworkHub\(\)[\s\S]*?if \(activeKidId\) items = items\.filter/);

  const appStore = fs.readFileSync(path.join(__dirname, "..", "ios/FamETC/Domain/AppStore.swift"), "utf8");
  assert.match(appStore, /let freshHomework = try await api\.homework\(\)/);
  assert.match(appStore, /if loadGeneration == homeworkLoadGeneration,[\s\S]*?homework = freshHomework/);
  assert.match(appStore, /NotificationScheduler\.reschedule\(events: visibleFamilyEvents, homework: homework/);
});

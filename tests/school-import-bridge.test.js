"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public/js/app.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`async function ${name}(`) >= 0
    ? source.indexOf(`async function ${name}(`)
    : source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const bridgeStart = appSource.indexOf("function schoolImportHomeworkKey");
const bridgeEnd = appSource.indexOf("/* ============================================================\n   SCHOOL STATS", bridgeStart);
assert.ok(bridgeStart >= 0 && bridgeEnd > bridgeStart, "school import helpers should be present");
const bridgeHelpers = appSource.slice(bridgeStart, bridgeEnd);
const importFunction = extractFunction(appSource, "famImportSchoolData");
const dateFunction = extractFunction(appSource, "normalizeSchoolImportDate");

function createHarness({ homework = [], events = [], failHomework = false, failCalendar = false, failDelete = false } = {}) {
  const calls = { homework: [], calendar: [], deleted: [], toasts: [] };
  let homeworkState = homework.map((item) => ({ ...item }));
  const initialEvents = events.map((event) => ({ ...event }));
  const fixedNow = new Date(2026, 7, 22, 12);
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedNow.getTime()]));
    }
    static now() { return fixedNow.getTime(); }
  }

  const context = {
    Date: FixedDate,
    eventsState: initialEvents,
    sessionUser: { id: "parent-1" },
    currentFamily: { kids: [{ id: "kid-1", name: "Alex" }] },
    window: { auth: {} },
  };
  context.window.auth.getHomework = async () => homeworkState;
  context.window.auth.addHomework = async (payload) => {
    calls.homework.push(payload);
    if (failHomework) throw new Error("homework endpoint unavailable");
    homeworkState = homeworkState.concat([{ ...payload }]);
    return { homework: payload };
  };
  context.window.auth.addCalendarEvent = async (payload) => {
    calls.calendar.push(payload);
    if (failCalendar) throw new Error("calendar endpoint unavailable");
    const existing = initialEvents.find((event) =>
      payload.sourceType && event.sourceType === payload.sourceType && event.sourceId === payload.sourceId);
    if (existing) return { event: existing, existing: true };
    const event = { id: `ev_import_${calls.calendar.length}`, ...payload };
    return { event, existing: false };
  };
  context.window.auth.deleteCalendarEvent = async (id) => {
    calls.deleted.push(id);
    if (failDelete) throw new Error("delete endpoint unavailable");
    return {};
  };

  const prelude = `
    function isoDate(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return \`${"${y}"}-${"${m}"}-${"${day}"}\`;
    }
    function mondayOf(d) {
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
      return monday;
    }
    function getEvents() { return eventsState; }
    function saveEvents(next) { eventsState = next; }
    function isKidSession() { return false; }
    function toast(message) { toasts.push(message); }
    function loadHomework() { return Promise.resolve(); }
    function renderHomeworkHub() {}
    function renderCalendar() {}
    function renderTodayScreen() {}
    function applyEnrichmentGating() {}
    function updateHomeworkBadge() {}
    function processSchoolStats() { return Promise.resolve(); }
    var toasts = [];
  `;
  vm.runInNewContext([prelude, bridgeHelpers, importFunction, dateFunction,
    "this.importSchoolData = famImportSchoolData;",
    "this.normalizeSchoolImportDate = normalizeSchoolImportDate;"].join("\n"), context, { filename: "school-import-bridge.js" });
  context.calls = calls;
  return context;
}

test("malformed homework, timetable, and ECA rows persist editable fallbacks with warnings", async () => {
  const harness = createHarness();
  const result = await harness.importSchoolData({
    kidId: "kid-1",
    moodleUserId: "moodle-1",
    homework: [{ subject: "Math", title: "", dueDate: "not a date", setDate: "Fri 21 Aug", rawText: "Raw homework parser text", warnings: ["Homework row warning"] }],
    timetable: [{ day: "Someday", dayLabel: "Wk2 Someday", period: "P1", periodRaw: "P1 25:99", time: "25:99", timeRaw: "25:99", subject: "", rawText: "Raw timetable parser text", warnings: ["Timetable row warning"] }],
    activitySnapshots: [{
      ecaId: "834",
      activities: [{ title: "", date: "not a date", time: "99:00", clubId: "", timeslot: "Bad ECA timeslot", rawText: "Raw ECA parser text", warnings: ["ECA row warning"] }],
    }],
  });

  assert.equal(result.homeworkAdded, 1);
  assert.equal(result.homeworkSkipped, 0);
  assert.equal(result.timetableEventsAdded, 1);
  assert.equal(result.activityEventsAdded, 1);
  assert.equal(harness.calls.homework[0].title, "Imported homework — needs review");
  assert.equal(harness.calls.homework[0].dueDate, "2026-08-22");
  assert.match(harness.calls.homework[0].notes, /not a date/);
  assert.match(harness.calls.homework[0].notes, /Import warning — needs review/);
  assert.match(harness.calls.homework[0].notes, /rawText: Raw homework parser text/);
  assert.match(harness.calls.homework[0].notes, /warnings: \["Homework row warning"\]/);
  assert.equal(harness.calls.calendar[0].title, "Imported timetable item — needs review");
  assert.equal(harness.calls.calendar[0].date, "2026-08-22");
  assert.equal(harness.calls.calendar[0].time, "");
  assert.match(harness.calls.calendar[0].notes, /dayLabel: Wk2 Someday/);
  assert.match(harness.calls.calendar[0].notes, /periodRaw: P1 25:99/);
  assert.match(harness.calls.calendar[0].notes, /timeRaw: 25:99/);
  assert.match(harness.calls.calendar[0].notes, /rawText: Raw timetable parser text/);
  assert.match(harness.calls.calendar[0].notes, /warnings: \["Timetable row warning"\]/);
  assert.equal(harness.calls.calendar[1].title, "Imported activity — needs review");
  assert.equal(harness.calls.calendar[1].date, "2026-08-22");
  assert.equal(harness.calls.calendar[1].time, "");
  assert.equal(harness.calls.calendar[1].sourceType, undefined);
  assert.match(harness.calls.calendar[1].notes, /timeslot: Bad ECA timeslot/);
  assert.match(harness.calls.calendar[1].notes, /rawText: Raw ECA parser text/);
  assert.match(harness.calls.calendar[1].notes, /warnings: \["ECA row warning"\]/);
  assert.ok(result.importWarnings.filter((warning) => warning.added).length >= 3);
  assert.ok(result.importWarnings.every((warning) => Object.keys(warning).sort().join(",") === "added,message,title,type"));
  assert.match(harness.toasts.at(-1), /review\/error warning/);
});

test("production Moodle date 'Fri 4 Sept' imports the homework without a warning", async () => {
  const harness = createHarness();
  const result = await harness.importSchoolData({
    kidId: "kid-1",
    homework: [{
      subject: "Chemistry",
      title: "Complete the states of matter self study booklet",
      dueDate: "Fri 4 Sept",
      completed: false,
    }],
  });

  assert.equal(result.homeworkAdded, 1);
  assert.equal(result.homeworkSkipped, 0);
  assert.equal(result.importWarnings.length, 0);
  assert.equal(harness.calls.homework[0].dueDate, "2026-09-04");
  assert.equal(harness.calls.homework[0].title, "Complete the states of matter self study booklet");
});

test("malformed homework re-imports are idempotent while distinct raw evidence remains importable", async () => {
  const harness = createHarness();
  const payload = { kidId: "kid-1", homework: [{ title: "", dueDate: "unparseable first value", subject: "Math" }] };
  const first = await harness.importSchoolData(payload);
  const second = await harness.importSchoolData(payload);
  const distinct = await harness.importSchoolData({
    kidId: "kid-1",
    homework: [{ title: "", dueDate: "unparseable second value", subject: "Math" }],
  });

  assert.equal(first.homeworkAdded, 1);
  assert.equal(second.homeworkAdded, 0);
  assert.equal(second.homeworkSkipped, 1);
  assert.equal(distinct.homeworkAdded, 1);
  assert.equal(harness.calls.homework.length, 2);
});

test("school import API failures are visible and are not counted as skipped rows", async () => {
  const harness = createHarness({ failHomework: true, failCalendar: true });
  const result = await harness.importSchoolData({
    kidId: "kid-1",
    moodleUserId: "moodle-1",
    homework: [{ title: "Essay", dueDate: "2026-09-04" }],
    timetable: [{ day: "Mon", time: "08:00", subject: "English" }],
    activitySnapshots: [{ ecaId: "834", activities: [{ title: "Chess", date: "2026-09-04", time: "15:00", clubId: "64894" }] }],
  });

  assert.equal(result.homeworkAdded, 0);
  assert.equal(result.timetableEventsAdded, 0);
  assert.equal(result.activityEventsAdded, 0);
  assert.equal(result.homeworkSkipped, 0);
  assert.ok(result.importWarnings.some((warning) => warning.type === "homework" && warning.added === false));
  assert.ok(result.importWarnings.some((warning) => warning.type === "timetable" && warning.added === false));
  assert.ok(result.importWarnings.some((warning) => warning.type === "activity" && warning.added === false));
  assert.match(harness.toasts.at(-1), /review\/error warning/);
});

test("parser warnings are merged into the result and warning output is bounded", async () => {
  const harness = createHarness();
  const result = await harness.importSchoolData({
    kidId: "kid-1",
    parseWarnings: ["<b>first parser warning</b>"].concat(
      Array.from({ length: 105 }, (_, index) => `parser warning ${index + 2}`)
    ),
  });

  assert.equal(result.importWarnings.length, 101);
  assert.equal(result.importWarnings[0].type, "parser");
  assert.equal(result.importWarnings[0].message, "first parser warning");
  assert.equal(result.importWarnings.at(-1).type, "import-truncated");
  assert.match(result.importWarnings.at(-1).message, /omitted/);
  assert.ok(result.importWarnings.every((warning) => Object.keys(warning).sort().join(",") === "added,message,title,type"));
});

test("completed rows, duplicates, and valid ECA reconciliation remain intentional and safe", async () => {
  const ownedCurrent = {
    id: "ev_current", kidId: "kid-1", title: "Chess", date: "2026-09-04", time: "15:00",
    sourceType: "eca", sourceId: "kid-1:834:64894",
  };
  const ownedRemoved = {
    id: "ev_removed", kidId: "kid-1", title: "Old club", date: "2026-09-05", time: "15:00",
    sourceType: "eca", sourceId: "kid-1:834:old-club",
  };
  const harness = createHarness({
    homework: [{ title: "Essay", dueDate: "2026-09-04" }],
    events: [
      { id: "ev_hw_timetable", kidId: "kid-1", title: "English", date: "2026-08-17", time: "08:00" },
      ownedCurrent,
      ownedRemoved,
    ],
  });
  const result = await harness.importSchoolData({
    kidId: "kid-1",
    moodleUserId: "moodle-1",
    homework: [
      { title: "Essay", dueDate: "2026-09-04" },
      { title: "Done", dueDate: "2026-09-04", completed: true },
    ],
    timetable: [{ day: "Mon", time: "08:00", subject: "English" }],
    activitySnapshots: [{ ecaId: "834", activities: [{ title: "Chess", date: "2026-09-04", time: "15:00", clubId: "64894" }] }],
  });

  assert.equal(result.homeworkSkipped, 2);
  assert.equal(result.intentionalSkipped, 3);
  assert.equal(result.activityEventsRemoved, 1);
  assert.deepEqual(harness.calls.deleted, ["ev_removed"]);
  assert.equal(result.importWarnings.length, 0);
});

test("invalid ECA ownership preserves existing rows, and failed replacements are visible", async () => {
  const owned = {
    id: "ev_owned", kidId: "kid-1", title: "Chess", date: "2026-09-04", time: "15:00",
    sourceType: "eca", sourceId: "kid-1:834:64894",
  };
  const invalidClubHarness = createHarness({ events: [owned] });
  const invalidClubResult = await invalidClubHarness.importSchoolData({
    kidId: "kid-1",
    moodleUserId: "moodle-1",
    activitySnapshots: [{ ecaId: "abc", activities: [{ title: "Needs review", date: "2026-09-04", time: "15:00", clubId: "64894" }] }],
  });
  assert.deepEqual(invalidClubHarness.calls.deleted, []);
  assert.equal(invalidClubResult.activityEventsAdded, 1);
  assert.equal(invalidClubHarness.calls.calendar[0].sourceType, undefined);
  assert.ok(invalidClubResult.importWarnings.some((warning) => /automatic ECA removal cannot be guaranteed/.test(warning.message)));

  const malformedOwnedHarness = createHarness({ events: [owned] });
  const malformedOwnedResult = await malformedOwnedHarness.importSchoolData({
    kidId: "kid-1",
    moodleUserId: "moodle-1",
    activitySnapshots: [{ ecaId: "834", activities: [{ title: "", date: "bad", time: "bad", clubId: "64894" }] }],
  });
  assert.deepEqual(malformedOwnedHarness.calls.deleted, []);
  assert.equal(malformedOwnedResult.activityEventsAdded, 0);
  assert.ok(malformedOwnedResult.importWarnings.some((warning) =>
    warning.added === false && /existing event was preserved/.test(warning.message)));

  const failedReplacementHarness = createHarness({ events: [owned], failDelete: true });
  const failedReplacementResult = await failedReplacementHarness.importSchoolData({
    kidId: "kid-1",
    moodleUserId: "moodle-1",
    activitySnapshots: [{ ecaId: "834", activities: [{ title: "New Chess", date: "2026-09-05", time: "15:00", clubId: "64894" }] }],
  });
  assert.deepEqual(failedReplacementHarness.calls.deleted, ["ev_owned"]);
  assert.equal(failedReplacementResult.activityEventsAdded, 0);
  assert.ok(failedReplacementResult.importWarnings.some((warning) => warning.type === "activity-remove" && warning.added === false));
  assert.ok(failedReplacementResult.importWarnings.some((warning) => warning.type === "activity-replacement" && warning.added === false));
});

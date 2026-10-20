"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { projectContext, buildContext, createSchoolCacheRefresher, validDate, shiftDate,
  MAX_EVENTS_PER_DAY, MAX_HOMEWORK, MAX_MEALS, SCHOOL_NOTICES } = require("../lib/display-context");

function fixture(patch = {}) {
  return {
    family: {
      id: "family-a", name: "Sample household", inviteCode: "PRIVATE-INVITE", parentIds: ["parent-a"],
      kids: [
        { id: "kid-a", name: "Jamie", color: "#F5821F", birthday: "PRIVATE-BIRTHDAY" },
        { id: "kid-b", name: "Alex", color: "#0EA58C" },
      ],
    },
    device: {
      id: "display-a", label: "Kitchen", timeZone: "Asia/Bangkok", showHomework: true, showMeals: true,
      tokenHash: "PRIVATE-TOKEN-HASH", createdBy: "parent-a",
    },
    now: new Date("2026-10-19T19:30:00Z"),
    ...patch,
  };
}

function titles(context, date) {
  return context.days.find((day) => day.date === date).events.map((event) => event.title);
}

test("the display's calendar day controls the week and converts instants without shifting literal dates", () => {
  const data = fixture({ calendar: [
    { uid: "utc-class", title: "Early lesson", start: "2026-10-19T18:45:00Z", end: "2026-10-19T19:15:00Z", kidId: "kid-a" },
    { id: "manual-visit", title: "Dentist", date: "2026-10-20", time: "09:15", endTime: "10:00" },
    { uid: "floating-class", title: "Local lesson", start: "2026-10-20T11:00:00", end: "2026-10-20T12:00:00", kidId: "kid-b" },
    { uid: "holiday", title: "School holiday", start: "2026-10-20T00:00:00Z", end: "2026-10-21T00:00:00Z", allDay: true },
  ] });
  const context = projectContext(data);
  assert.equal(context.today, "2026-10-20");
  assert.deepEqual(context.days.map((day) => day.date), [
    "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26",
  ]);
  const byTitle = Object.fromEntries(context.days[0].events.map((event) => [event.title, event]));
  assert.equal(byTitle["Early lesson"].time, "01:45");
  assert.equal(byTitle["Early lesson"].endTime, "02:15");
  assert.equal(byTitle.Dentist.time, "09:15");
  assert.equal(byTitle["Local lesson"].time, "11:00");
  assert.equal(byTitle["School holiday"].allDay, true);
  assert.equal(byTitle["School holiday"].time, "");
  assert.deepEqual(titles(context, "2026-10-21"), []);

  const western = projectContext({ ...data, device: { ...data.device, timeZone: "America/Los_Angeles" }, now: new Date("2026-10-20T12:00:00Z") });
  assert.equal(western.today, "2026-10-20");
  assert.equal(western.days[0].events.some((event) => event.title === "School holiday"), true);
  assert.equal(western.days[0].events.some((event) => event.title === "Early lesson"), false);
  assert.equal(western.days[0].events.find((event) => event.title === "Local lesson").time, "11:00");
});

test("all-day ICS ends are exclusive, manual end dates are inclusive, and midnight does not add a day", () => {
  const context = projectContext(fixture({ calendar: [
    { id: "manual-span", title: "Family visit", date: "2026-10-19", endDate: "2026-10-21" },
    { uid: "ics-span", title: "School break", start: "2026-10-19", end: "2026-10-21", allDay: true },
    { id: "manual-night", title: "Late drive", date: "2026-10-20", time: "23:00", endDate: "2026-10-21", endTime: "00:00" },
    { uid: "absolute-night", title: "Online event", start: "2026-10-20T16:30:00Z", end: "2026-10-20T17:00:00Z" },
  ] }));
  assert.deepEqual(new Set(titles(context, "2026-10-20")), new Set(["Family visit", "School break", "Late drive", "Online event"]));
  assert.deepEqual(titles(context, "2026-10-21"), ["Family visit"]);
  assert.deepEqual(titles(context, "2026-10-22"), []);
});

test("UID and source occurrence deduplication preserves separate children, recurrence and the repeated DST hour", () => {
  const data = fixture({ calendar: [
    { uid: "shared-uid", title: "Lesson", start: "2026-10-20T09:00:00+07:00", kidId: "kid-a", subscriptionId: "first" },
    { uid: "shared-uid", title: "Lesson", start: "2026-10-20T02:00:00Z", kidId: "kid-a", subscriptionId: "duplicate" },
    { uid: "shared-uid", title: "Lesson", start: "2026-10-20T02:00:00Z", kidId: "kid-b", subscriptionId: "sibling" },
    { uid: "shared-uid", title: "Lesson", start: "2026-10-21T02:00:00Z", kidId: "kid-a", subscriptionId: "first" },
  ] });
  const first = projectContext(data);
  assert.equal(first.days[0].events.length, 2);
  assert.equal(first.days[1].events.length, 1);
  assert.equal(new Set(first.days.flatMap((day) => day.events.map((event) => event.id))).size, 3);
  assert.deepEqual(projectContext({ ...data, now: new Date("2026-10-19T19:31:00Z") }).days, first.days);

  const dst = projectContext({ ...data, now: new Date("2026-11-01T05:00:00Z"), device: { ...data.device, timeZone: "America/New_York" }, calendar: [
    { uid: "hourly", title: "Hourly check", start: "2026-11-01T05:30:00Z", kidId: "kid-a" },
    { uid: "hourly", title: "Hourly check", start: "2026-11-01T06:30:00Z", kidId: "kid-a" },
  ] });
  assert.equal(dst.days[0].events.length, 2);
  assert.deepEqual(dst.days[0].events.map((event) => event.time), ["01:30", "01:30"]);
  assert.notEqual(dst.days[0].events[0].id, dst.days[0].events[1].id);
  const dateOnly = projectContext(fixture({ calendar: [
    { uid: "same-day", title: "Holiday", date: "2026-10-20" },
    { uid: "same-day", title: "Holiday", start: "2026-10-20", allDay: true },
  ] }));
  assert.equal(dateOnly.days[0].events.length, 1);
});

test("only the explicit shared-display fields cross the boundary and foreign or removed members stay hidden", () => {
  const data = fixture({
    calendar: [
      { uid: "PRIVATE-FEED-UID", title: "Football", date: "2026-10-20", time: "16:00", kidId: "kid-a", description: "PRIVATE-DESCRIPTION", notes: "PRIVATE-NOTES", customUrl: "PRIVATE-FEED-URL", familyId: "family-a" },
      { id: "foreign", title: "Foreign event", date: "2026-10-20", familyId: "family-b" },
      { id: "removed", title: "Removed child's event", date: "2026-10-20", kidId: "removed-child" },
    ],
    homework: [{ id: "hw-a", familyId: "family-a", kidId: "kid-a", title: "Fractions", subject: "Maths", dueDate: "2026-10-21", status: "todo", notes: "PRIVATE-HOMEWORK", schoolLink: "PRIVATE-SCHOOL-LINK" }],
    meals: [{ date: "2026-10-20", slot: "dinner", title: "Pasta", note: "PRIVATE-MEAL-NOTE", recipe: { private: "PRIVATE-RECIPE" } }],
  });
  const before = JSON.stringify(data);
  const context = projectContext(data);
  assert.deepEqual(context.family, { name: "Sample household" });
  assert.deepEqual(context.device, { id: "display-a", label: "Kitchen", showHomework: true, showMeals: true });
  assert.deepEqual(Object.keys(context.members[0]).sort(), ["color", "id", "name"]);
  assert.deepEqual(Object.keys(context.days[0].events[0]).sort(), ["allDay", "color", "date", "endTime", "id", "location", "memberId", "time", "title"]);
  assert.deepEqual(Object.keys(context.homework[0]).sort(), ["completed", "dueDate", "id", "memberId", "subject", "title"]);
  assert.deepEqual(context.meals, [{ date: "2026-10-20", slot: "dinner", title: "Pasta" }]);
  assert.deepEqual(titles(context, "2026-10-20"), ["Football"]);
  assert.equal(JSON.stringify(context).includes("PRIVATE-"), false);
  assert.equal(JSON.stringify(data), before, "projection must not mutate the source records");
});

test("homework shows unfinished work through the next week and meals follow calendar dates", () => {
  const task = (id, dueDate, extra = {}) => ({ id, dueDate, title: id, kidId: "kid-a", status: "todo", ...extra });
  const context = projectContext(fixture({
    homework: [
      task("later", "2026-10-23"), task("old-overdue", "2026-10-18"), task("recent-overdue", "2026-10-19"),
      task("today", "2026-10-20"), task("no-date", null), task("finished", "2026-10-20", { status: "done" }),
      task("outside", "2026-10-27"), task("other-family", "2026-10-20", { familyId: "family-b" }),
      task("removed-child", "2026-10-20", { kidId: "removed-child" }),
    ],
    meals: [
      { date: "2026-10-20", slot: "dinner", title: "Rice bowls" },
      { date: "2026-10-20", slot: "breakfast", title: "Toast" },
      { date: "2026-10-19", slot: "dinner", title: "Yesterday" },
      { date: "2026-10-27", slot: "dinner", title: "Later" },
      { date: "2026-10-20", slot: "dinner", title: "Other family's meal", familyId: "family-b" },
    ],
  }));
  assert.deepEqual(context.homework.map((item) => item.id), ["recent-overdue", "old-overdue", "today", "later", "no-date"]);
  assert.equal(context.homework[4].dueDate, "");
  assert.equal(context.homework.every((item) => item.completed === false), true);
  assert.deepEqual(context.meals.map((meal) => meal.title), ["Toast", "Rice bowls"]);
});

test("homework and meal choices hide those panels while informational calendar deadlines remain visible", () => {
  const data = fixture();
  const context = projectContext({ ...data, device: { ...data.device, showHomework: false, showMeals: false },
    calendar: [
      { id: "deadline", title: "University applications close", date: "2026-10-20", isDeadline: true },
      { id: "deadline-type", title: "School registrations close", date: "2026-10-20", type: "deadline" },
      { id: "club", title: "Chess club", date: "2026-10-20" },
    ],
    homework: [{ id: "private", kidId: "kid-a", title: "Private worksheet", dueDate: "2026-10-20" }],
    meals: [{ date: "2026-10-20", slot: "dinner", title: "Private meal" }],
  });
  assert.deepEqual(context.homework, []);
  assert.deepEqual(context.meals, []);
  assert.deepEqual(new Set(titles(context, "2026-10-20")), new Set(["University applications close", "School registrations close", "Chess club"]));
  assert.equal(context.device.showHomework, false);
  assert.equal(context.device.showMeals, false);
});

test("ECAs, family appointments and general school events remain alongside the filtered lesson timetable", () => {
  const atNine = (id, title, extra = {}) => ({ id, title, date: "2026-10-20", time: "09:00", endTime: "10:00", kidId: "kid-a", ...extra });
  const context = projectContext(fixture({ calendar: [
    atNine("lesson", "Regular lesson", { feedId: "sta-child-timetable" }),
    atNine("api-lesson", "Private feed lesson", { subscriptionId: "sta-api:kid-a" }),
    atNine("eca", "Choir ECA", { sourceType: "eca", feedId: "sta-child-timetable" }),
    atNine("activity", "Music activity", { source: "activities" }),
    atNine("old-eca", "Drama ECA", { category: "school", notes: "Signed up activity" }),
    atNine("family", "Family dentist", { kidId: null }),
    atNine("kid-appointment", "Child checkup", { category: "school", notes: "Bring glasses" }),
    atNine("public-school", "Sports day", { feedId: "sta-whole-school", source: "school" }),
    atNine("unidentified", "Unclassified school item", { category: "school" }),
  ] }));
  assert.deepEqual(new Set(titles(context, "2026-10-20")), new Set([
    "Choir ECA", "Music activity", "Drama ECA", "Family dentist", "Child checkup", "Sports day", "Unclassified school item",
  ]));
});

test("school-hour filtering uses interval overlap at 08:00 and 14:00 and preserves all-day rows", () => {
  const lesson = (id, time, endTime) => ({ id, title: id, date: "2026-10-20", time, endTime, kidId: "kid-a", source: "timetable-import" });
  const context = projectContext(fixture({ calendar: [
    lesson("ends-at-eight", "07:00", "08:00"), lesson("overlaps-eight", "07:59", "08:01"),
    lesson("starts-at-eight", "08:00", "09:00"), lesson("overlaps-two", "13:59", "14:30"),
    lesson("starts-at-two", "14:00", "15:00"), lesson("early-no-end", "07:30", ""),
    lesson("school-no-end", "09:30", ""), lesson("all-day-schedule", "", ""),
  ] }));
  assert.deepEqual(new Set(titles(context, "2026-10-20")), new Set([
    "ends-at-eight", "starts-at-two", "early-no-end", "all-day-schedule",
  ]));
});

test("legacy timetable markers filter lessons while activity markers take priority", () => {
  const legacy = (id, notes, extra = {}) => ({ id, title: id, date: "2026-10-20", time: "10:00", endTime: "11:00", kidId: "kid-a", category: "school", notes, ...extra });
  const context = projectContext(fixture({ calendar: [
    legacy("legacy-class", "Timetable"),
    legacy("warning-class", "Import warning — needs review: Raw values — day: 2; period: 3"),
    legacy("warning-activity", "Import warning — needs review: Raw values — day: 2; period: 3; clubId: 7"),
    legacy("activity-wins", "Timetable", { sourceType: "eca", source: "timetable-import" }),
    legacy("activity-source", "Timetable", { sourceType: "activities" }),
    legacy("ordinary-appointment", "Timetable", { category: "other" }),
  ] }));
  assert.deepEqual(new Set(titles(context, "2026-10-20")), new Set([
    "warning-activity", "activity-wins", "activity-source", "ordinary-appointment",
  ]));
});

test("identified class times are compared with the display zone, never the server zone", () => {
  const data = fixture({ now: new Date("2026-10-20T01:00:00Z"), calendar: [
    { uid: "zoned-lesson", title: "Zoned lesson", start: "2026-10-20T02:00:00Z", end: "2026-10-20T03:00:00Z", kidId: "kid-a", feedId: "sta-child-timetable" },
  ] });
  assert.deepEqual(titles(projectContext(data), "2026-10-20"), []);
  const utc = projectContext({ ...data, device: { ...data.device, timeZone: "UTC" } });
  assert.deepEqual(titles(utc, "2026-10-20"), ["Zoned lesson"]);
  assert.equal(utc.days[0].events[0].time, "02:00");
});

test("bounded projection rejects impossible dates and keeps the seven-day payload within its caps", () => {
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
  const context = projectContext(fixture({
    calendar: Array.from({ length: 100 }, (_, i) => ({ id: `event-${i}`, title: `Event ${i}`, date: "2026-10-20" })),
    homework: Array.from({ length: 100 }, (_, i) => ({ id: `hw-${i}`, title: `Task ${i}`, kidId: "kid-a", dueDate: "2026-10-20" })),
    meals: Array.from({ length: 100 }, (_, i) => ({ date: "2026-10-20", slot: "dinner", title: `Meal ${i}` })),
  }));
  assert.equal(context.days[0].events.length, MAX_EVENTS_PER_DAY);
  assert.equal(context.homework.length, MAX_HOMEWORK);
  assert.equal(context.meals.length, MAX_MEALS);
});

test("buildContext passes milliseconds to the real school cache collector and includes cached ICS events", () => {
  const schoolFeeds = require("../lib/school-feeds");
  const data = fixture();
  const store = { subscriptions: [{ id: "sub-a", feedId: "sta-whole-school", kidId: "kid-a" }], hidden: [], cache: {
    "sub-a": { events: [{ uid: "cached-ics", summary: "School assembly", start: "2026-10-20T02:00:00Z", end: "2026-10-20T03:00:00Z", allDay: false }] },
  } };
  const calls = [];
  const context = buildContext({ ...data,
    events: { listEvents: (id, range) => { calls.push({ id, range }); return []; } },
    schoolFeeds: {
      famStore: (id) => { assert.equal(id, "family-a"); return store; },
      collectFromCache: (cached, now) => {
        assert.equal(typeof now, "number", "Date + WINDOW_FUTURE_MS concatenates a string in the collector");
        return schoolFeeds.collectFromCache(cached, now);
      },
    },
    schoolApi: { listTimetableEvents: () => [] },
    homework: { listForFamily: () => [] },
    meals: { getState: () => ({ menu: [] }) },
  });
  assert.deepEqual(calls, [{ id: "family-a", range: { from: "2026-10-19", to: "2026-10-27" } }]);
  assert.deepEqual(titles(context, "2026-10-20"), ["School assembly"]);
  assert.equal(context.days[0].events[0].time, "09:00");
});

test("disabled homework and meals are not read from their stores", () => {
  const data = fixture();
  const unexpected = () => assert.fail("disabled store must not be queried");
  const context = buildContext({ ...data, device: { ...data.device, showHomework: false, showMeals: false },
    events: { listEvents: () => [] },
    schoolFeeds: { famStore: () => ({}), collectFromCache: () => [] },
    schoolApi: { listTimetableEvents: () => [] },
    homework: { listForFamily: unexpected }, meals: { getState: unexpected },
  });
  assert.deepEqual(context.homework, []);
  assert.deepEqual(context.meals, []);
});

test("public school cache refresh is background, coalesced and throttled while cached events remain available", async () => {
  const refresh = createSchoolCacheRefresher();
  const at = Date.parse("2026-10-20T06:00:00Z");
  const hour = 60 * 60 * 1000;
  const store = { subscriptions: [{ id: "sub-a" }], lastSyncAt: new Date(at - 2 * hour).toISOString(), cache: {
    "sub-a": { fetchedAt: new Date(at - 2 * hour).toISOString(), events: [{ uid: "cached" }] },
  } };
  let finish;
  let calls = 0;
  const pending = new Promise((resolve) => { finish = resolve; });
  const source = { AUTO_SYNC_MIN_INTERVAL_MS: hour, SYNC_TTL_MS: hour, syncFamily: (id, options) => {
    assert.equal(id, "family-a");
    assert.deepEqual(options, { force: false });
    calls++;
    return pending;
  } };
  assert.deepEqual(new Set(refresh("family-a", store, source, at)), new Set([SCHOOL_NOTICES.stale, SCHOOL_NOTICES.refreshing]));
  assert.equal(calls, 0, "the response path must not wait for the upstream feed");
  await Promise.resolve();
  assert.equal(calls, 1);
  refresh("family-a", store, source, at + hour + 1);
  assert.equal(calls, 1, "even another due poll must share the in-flight fetch");
  assert.deepEqual(store.cache["sub-a"].events, [{ uid: "cached" }]);
  store.lastSyncAt = new Date(at).toISOString();
  store.cache["sub-a"].fetchedAt = new Date(at).toISOString();
  finish({ events: [], errors: [] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(refresh("family-a", store, source, at + 60 * 1000), []);
  await Promise.resolve();
  assert.equal(calls, 1);
  refresh("family-a", store, source, at + hour + 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2, "an hour-old cache is refreshed again during Portal-only use");
});

test("missing or failed school sync yields generic notices, retains cached data and does not retry every poll", async () => {
  const refresh = createSchoolCacheRefresher();
  const at = Date.parse("2026-10-20T06:00:00Z");
  const store = { subscriptions: [{ id: "sub-a" }], cache: {}, lastSyncAt: null };
  let calls = 0;
  const source = { syncFamily: () => { calls++; return Promise.reject(new Error("PRIVATE-CAPABILITY-URL")); } };
  assert.equal(refresh("family-a", store, source, at).includes(SCHOOL_NOTICES.missing), true);
  await new Promise((resolve) => setImmediate(resolve));
  const notices = refresh("family-a", store, source, at + 60 * 1000);
  assert.equal(notices.includes(SCHOOL_NOTICES.error), true);
  assert.equal(notices.includes(SCHOOL_NOTICES.refreshing), false);
  assert.equal(JSON.stringify(notices).includes("PRIVATE-"), false);
  await Promise.resolve();
  assert.equal(calls, 1);
  const projected = projectContext(fixture({ notices: [...notices, "PRIVATE-SOURCE-ERROR"] }));
  assert.equal(JSON.stringify(projected).includes("PRIVATE-"), false);
  assert.equal(projectContext(fixture()).notices.length, 0);
});

test("private school connection health contributes only generic notices for current members", () => {
  const data = fixture();
  const deps = { ...data,
    events: { listEvents: () => [] }, schoolFeeds: { famStore: () => ({ subscriptions: [] }), collectFromCache: () => [] },
    schoolApi: {
      listTimetableEvents: () => [],
      listStatus: () => [{ kidId: "kid-a", connected: true, lastSyncAt: null, lastError: "PRIVATE-CONNECTION-ERROR" }],
    },
    homework: { listForFamily: () => [] }, meals: { getState: () => ({ menu: [] }) },
  };
  const context = buildContext(deps);
  assert.deepEqual(new Set(context.notices), new Set([SCHOOL_NOTICES.missing, SCHOOL_NOTICES.error]));
  assert.equal(JSON.stringify(context).includes("PRIVATE-"), false);
  deps.schoolApi.listStatus = () => [{ kidId: "removed-child", connected: true, lastSyncAt: null, lastError: "PRIVATE-REMOVED-CHILD" }];
  assert.deepEqual(buildContext(deps).notices, []);
});

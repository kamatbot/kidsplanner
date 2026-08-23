"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(ROOT, "public/js/app.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/css/styles.css"), "utf8");

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function calendarHelpers() {
  const start = app.indexOf("function calendarMinutes");
  const end = app.indexOf("function renderWeekView");
  const context = { isoDate, currentView: "week", weekStart: null, monthDate: null };
  vm.runInNewContext(app.slice(start, end), context);
  return context;
}

function renderWeekMarkup(events, timetable = false) {
  const target = { innerHTML: "", textContent: "" };
  const start = app.indexOf("function calendarMinutes");
  const end = app.indexOf("function renderMonthView");
  const context = {
    isoDate,
    weekStart: new Date(2026, 7, 17),
    currentView: "week",
    visibleEvents: () => events,
    isTimetableMode: () => timetable,
    visibleHomeworkDueItems: () => [{ id: "hw-1", title: "Read chapter", dueDate: "2026-08-19" }],
    document: { getElementById: () => target },
    formatShort: () => "Aug 17",
    fmt12: (value) => value,
    eventBarColor: () => "var(--c-violet)",
    repeatLabel: () => "",
    timetableEventKidLabel: () => "",
    esc: (value) => String(value),
  };
  vm.runInNewContext(app.slice(start, end), context);
  context.renderWeekView();
  return target.innerHTML;
}

function openAddEventWithDom() {
  const elements = {};
  [
    "event-title", "event-date", "event-time", "event-end-time", "event-notes",
    "event-end-date", "event-repeat", "event-repeat-until", "event-repeat-until-group",
  ].forEach((id) => { elements[id] = { value: "", min: "", style: {} }; });
  const schoolCategory = { checked: false };
  const context = {
    editingEventId: null,
    chatEventComposerSource: null,
    pendingDate: null,
    isoDate,
    document: {
      getElementById: (id) => elements[id],
      querySelector: (selector) => selector.includes('value="school"') ? schoolCategory : null,
    },
    populateEventAudienceOptions: () => {},
    setAddEventModalMode: () => {},
    openModal: () => {},
  };
  const start = app.indexOf("function openAddEventModal");
  const end = app.indexOf("function openAddEventModalFromChatMessage");
  vm.runInNewContext(app.slice(start, end), context);
  return { context, elements };
}

function renderCalendarLegend(timetable) {
  const target = { innerHTML: "" };
  const start = app.indexOf("function renderCalendarFooter");
  const end = app.indexOf("function renderMonthView");
  const context = {
    currentFamily: { kids: [{ id: "kid-1", name: "Alex" }] },
    activeKidId: null,
    isTimetableMode: () => timetable,
    kidColorFor: () => "#123456",
    esc: (value) => String(value),
    document: { getElementById: () => target },
  };
  vm.runInNewContext(app.slice(start, end), context);
  context.renderCalendarFooter();
  return target.innerHTML;
}

test("timed week helpers use minute offsets and tile overlapping events", () => {
  const { calendarMinutes, calendarWeekAxis, layoutTimedEventsForDay } = calendarHelpers();
  assert.equal(calendarMinutes("14:45"), 885);
  assert.equal(calendarMinutes("00:00"), 0);
  assert.equal(calendarMinutes("25:00"), null);

  const events = [
    { id: "late", date: "2026-08-19", time: "16:00", endTime: "17:00" },
    { id: "b", date: "2026-08-19", time: "14:45", endTime: "16:00" },
    { id: "a", date: "2026-08-19", time: "14:45", endTime: "16:00" },
    { id: "all-day", date: "2026-08-19", time: "" },
    { id: "early", date: "2026-08-18", time: "05:30", endTime: "06:30" },
    { id: "night", date: "2026-08-20", time: "23:00", endTime: "23:30" },
  ];
  const axis = calendarWeekAxis(events, "2026-08-17", "2026-08-23");
  assert.equal(axis.start, 0);
  assert.equal(axis.end, 1440);
  assert.equal(calendarWeekAxis(events.slice(0, 4), "2026-08-17", "2026-08-23").start, 480);

  const laidOut = layoutTimedEventsForDay(events, "2026-08-19", axis, 44);
  const first = laidOut.filter((item) => item.ev.time === "14:45");
  const later = laidOut.find((item) => item.ev.time === "16:00");
  assert.equal(first.length, 2);
  assert.equal(first[0].top, first[1].top);
  assert.notEqual(first[0].column, first[1].column);
  assert.equal(first[0].columns, 2);
  assert.ok(later.top > first[0].top);
  assert.equal(laidOut.some((item) => item.ev.id === "all-day"), false);
});

test("calendar period add defaults follow the displayed week or month", () => {
  const helpers = calendarHelpers();
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  helpers.currentView = "week";
  helpers.weekStart = new Date(2020, 0, 6);
  assert.equal(helpers.calendarPeriodDefaultDate(), "2020-01-06");
  helpers.weekStart = monday;
  assert.equal(helpers.calendarPeriodDefaultDate(), isoDate(now));
  helpers.currentView = "month";
  helpers.monthDate = new Date(2020, 0, 1);
  assert.equal(helpers.calendarPeriodDefaultDate(), "2020-01-01");
});

test("week uses compact hourly slots from 8 AM and keeps Timetable read-only", () => {
  const markup = renderWeekMarkup([{ id: "evt-1", date: "2026-08-19", time: "15:30", title: "Practice" }]);
  assert.match(markup, /class="week-all-day-row"/);
  assert.match(markup, /aria-label="Add event on Wednesday, August 19, 2026 at 8 AM"/);
  assert.match(markup, /aria-label="Add event on Wednesday, August 19, 2026 at 3 PM"/);
  assert.doesNotMatch(markup, /aria-label="Add event[^\"]+3:30 PM"/);
  assert.match(markup, /class="week-evt timed-event/);
  const timetableMarkup = renderWeekMarkup([{ id: "lesson-1", date: "2026-08-19", time: "15:30", title: "Math" }], true);
  assert.doesNotMatch(timetableMarkup, /week-time-slot/);

  const weekRenderer = app.slice(app.indexOf("function renderWeekView"), app.indexOf("// Calendar legend only."));
  assert.match(weekRenderer, /class="week-all-day-row"/);
  assert.match(weekRenderer, /calendarMinutes\(ev\.time\) === null/);
  assert.match(weekRenderer, /openAddEventModal\('\$\{ds\}','\$\{time\}'\)/);
  assert.match(weekRenderer, /toLocaleDateString\('en-US',[\s\S]*year: 'numeric'/);
  assert.match(weekRenderer, /if \(!timetable\)/);
  assert.match(app, /calendar-add-event-btn[\s\S]*isTimetableMode\(\)/);
  assert.match(css, /\.week-time-slot:focus-visible/);
  assert.match(css, /\.week-time-slot[^\n]*min-height|\.week-time-slot/);
});

test("slot prefill sets both displayed date/time without changing no-arg callers", () => {
  const { context, elements } = openAddEventWithDom();
  context.openAddEventModal("2026-08-19", "15:30");
  assert.equal(elements["event-date"].value, "2026-08-19");
  assert.equal(elements["event-time"].value, "15:30");

  context.openAddEventModal();
  assert.equal(elements["event-date"].value, isoDate(new Date()));
  assert.equal(elements["event-time"].value, "");
});

test("Timetable legend includes kid colors and the Timetable key", () => {
  const legend = renderCalendarLegend(true);
  assert.match(legend, /Alex/);
  assert.match(legend, /Timetable/);
});

test("Calendar legend is beside Upload schedule and excludes sync counters", () => {
  const footer = app.slice(app.indexOf("function renderCalendarFooter"), app.indexOf("function renderMonthView"));
  assert.doesNotMatch(footer, /Synced|school event|timeAgo|weekEventCount|lessonText/);
  assert.match(html, /cal-upload-utility[\s\S]*openUploadModal\(\)[\s\S]*calendar-footer/);
  assert.doesNotMatch(html, /calendar-main[\s\S]*calendar-footer/);
  assert.match(css, /\.week-view\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/);
  assert.match(css, /\.week-grid-head[^\n]*grid-template-columns:\s*48px repeat\(7, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.calendar-grid-scroll\s*\{[^}]*overflow-x:\s*hidden/);
  assert.match(css, /\.month-view\s*\{[^}]*height:\s*max\(/);
  assert.match(css, /\.week-grid-head\s*\{[^}]*position:\s*sticky[^}]*top:\s*0[^}]*z-index:\s*20/);
  assert.match(css, /\.week-all-day-row\s*\{[^}]*position:\s*sticky[^}]*top:\s*52px[^}]*z-index:\s*19/);
  assert.match(css, /\.week-view\s*\{[^}]*overflow:\s*visible/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.cal-upload-utility\s*\{[^}]*flex:\s*1 1 100%[^}]*width:\s*100%/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.cal-upload-utility\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css, /\.timed-event\s*\{[^}]*font-size:\s*11px[^}]*padding:\s*4px 5px/);
  assert.match(css, /\.timed-event \.evt-title\s*\{[^}]*overflow-wrap:\s*break-word[^}]*word-break:\s*normal/);
});

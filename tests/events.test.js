"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-events-"));

const store = require("../lib/store");
const family = require("../lib/family");
const events = require("../lib/events");

function fam() {
  const p = store.createUser("p@example.com", "Parent");
  return family.createFamily(p.id, "Fam");
}

test("addEvent: requires a title and a valid date", () => {
  const f = fam();
  assert.ok(events.addEvent(f.id, { title: "", date: "2026-07-09" }).error);
  assert.ok(events.addEvent(f.id, { title: "Soccer", date: "nope" }).error);
  const ok = events.addEvent(f.id, { title: "Soccer", date: "2026-07-09", time: "17:00" });
  assert.ok(!ok.error);
  assert.equal(ok.event.title, "Soccer");
  assert.equal(ok.event.time, "17:00");
  assert.equal(ok.event.source, "manual");
});

test("addEvent: bad time is dropped, category defaults to other", () => {
  const f = fam();
  const e = events.addEvent(f.id, { title: "Play date", date: "2026-07-10", time: "25:99", category: "bogus" }).event;
  assert.equal(e.time, "");
  assert.equal(e.category, "other");
});

test("listEvents: windowed + sorted by date/time", () => {
  const f = fam();
  events.addEvent(f.id, { title: "B", date: "2026-07-10", time: "09:00" });
  events.addEvent(f.id, { title: "A", date: "2026-07-09", time: "17:00" });
  events.addEvent(f.id, { title: "C", date: "2026-08-01" });
  const win = events.listEvents(f.id, { from: "2026-07-01", to: "2026-07-31" });
  assert.deepEqual(win.map((e) => e.title), ["A", "B"]);
});

test("removeEvent: deletes, and is per-family isolated", () => {
  const f1 = fam();
  const f2 = fam();
  const e = events.addEvent(f1.id, { title: "X", date: "2026-07-09" }).event;
  assert.equal(events.listEvents(f2.id).length, 0);
  assert.ok(!events.removeEvent(f1.id, e.id).error);
  assert.equal(events.listEvents(f1.id).length, 0);
  assert.ok(events.removeEvent(f1.id, "missing").error);
});

// ----- multi-day + recurring (server-side expansion) -----

test("addEvent: endDate before date is rejected; same-as-date/absent stored as null", () => {
  const f = fam();
  assert.equal(
    events.addEvent(f.id, { title: "Trip", date: "2026-07-10", endDate: "2026-07-09" }).error,
    "End date can't be before the start date."
  );
  const same = events.addEvent(f.id, { title: "Trip", date: "2026-07-10", endDate: "2026-07-10" }).event;
  assert.equal(same.endDate, null);
  const absent = events.addEvent(f.id, { title: "Trip", date: "2026-07-10" }).event;
  assert.equal(absent.endDate, null);
  const multi = events.addEvent(f.id, { title: "Trip", date: "2026-07-10", endDate: "2026-07-14" }).event;
  assert.equal(multi.endDate, "2026-07-14");
});

test("addEvent: repeat defaults/validates to 'none', repeatUntil invalid -> null", () => {
  const f = fam();
  const noRepeat = events.addEvent(f.id, { title: "Once", date: "2026-07-10" }).event;
  assert.equal(noRepeat.repeat, "none");
  const bogus = events.addEvent(f.id, { title: "Once", date: "2026-07-10", repeat: "yearly" }).event;
  assert.equal(bogus.repeat, "none");
  const weekly = events.addEvent(f.id, { title: "Class", date: "2026-07-10", repeat: "weekly", repeatUntil: "nope" }).event;
  assert.equal(weekly.repeat, "weekly");
  assert.equal(weekly.repeatUntil, null);
});

test("listEvents: multi-day event intersecting window is included", () => {
  const f = fam();
  events.addEvent(f.id, { title: "Camp", date: "2026-07-05", endDate: "2026-07-08" });
  // window starts after the event's start date but before its end date
  const win = events.listEvents(f.id, { from: "2026-07-07", to: "2026-07-31" });
  assert.deepEqual(win.map((e) => e.title), ["Camp"]);
  // window entirely before the event's span
  assert.equal(events.listEvents(f.id, { from: "2026-06-01", to: "2026-07-04" }).length, 0);
});

test("listEvents: weekly recurring expansion within an explicit window", () => {
  const f = fam();
  events.addEvent(f.id, { title: "Piano", date: "2026-07-01", time: "16:00", repeat: "weekly" });
  const win = events.listEvents(f.id, { from: "2026-07-01", to: "2026-07-31" });
  // 07-01, 08, 15, 22, 29
  assert.deepEqual(win.map((e) => e.date), ["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29"]);
  for (const occ of win) {
    assert.equal(occ.recurring, true);
    assert.equal(occ.seriesId, win[0].id);
  }
});

test("listEvents: biweekly recurring steps by 14 days", () => {
  const f = fam();
  events.addEvent(f.id, { title: "Tutor", date: "2026-07-01", repeat: "biweekly" });
  const win = events.listEvents(f.id, { from: "2026-07-01", to: "2026-08-15" });
  assert.deepEqual(win.map((e) => e.date), ["2026-07-01", "2026-07-15", "2026-07-29", "2026-08-12"]);
});

test("listEvents: monthly recurring skips months without that day-of-month", () => {
  const f = fam();
  events.addEvent(f.id, { title: "Rent due", date: "2026-01-31", repeat: "monthly" });
  const win = events.listEvents(f.id, { from: "2026-01-01", to: "2026-05-31" });
  // Feb has no 31st (skipped); Mar/May have 31, Apr has only 30 (skipped)
  assert.deepEqual(win.map((e) => e.date), ["2026-01-31", "2026-03-31", "2026-05-31"]);
});

test("listEvents: repeatUntil caps expansion", () => {
  const f = fam();
  events.addEvent(f.id, { title: "Swim", date: "2026-07-01", repeat: "weekly", repeatUntil: "2026-07-10" });
  const win = events.listEvents(f.id, { from: "2026-07-01", to: "2026-07-31" });
  assert.deepEqual(win.map((e) => e.date), ["2026-07-01", "2026-07-08"]);
});

test("listEvents: recurring multi-day occurrence carries seriesId, recurring flag, and shifted endDate", () => {
  const f = fam();
  const created = events.addEvent(f.id, {
    title: "Long weekend", date: "2026-07-03", endDate: "2026-07-05", repeat: "weekly",
  }).event;
  const win = events.listEvents(f.id, { from: "2026-07-01", to: "2026-07-31" });
  assert.ok(win.length >= 2);
  const first = win[0];
  assert.equal(first.id, created.id);
  assert.equal(first.seriesId, created.id);
  assert.equal(first.recurring, true);
  assert.equal(first.date, "2026-07-03");
  assert.equal(first.endDate, "2026-07-05");
  const second = win[1];
  assert.equal(second.date, "2026-07-10");
  assert.equal(second.endDate, "2026-07-12");
});

test("listEvents: repeat:'none' behavior is unchanged (single-day intersection only)", () => {
  const f = fam();
  events.addEvent(f.id, { title: "One-off", date: "2026-07-15" });
  const win = events.listEvents(f.id, { from: "2026-07-01", to: "2026-07-31" });
  assert.equal(win.length, 1);
  assert.equal(win[0].recurring, undefined);
  assert.equal(win[0].seriesId, undefined);
});

// ----- creator-based permissions (createdBy / canManage / updateEvent) -----

test("addEvent: stores createdBy (or null when omitted)", () => {
  const f = fam();
  const withCreator = events.addEvent(f.id, { title: "Soccer", date: "2026-07-09", createdBy: "u_kid1" }).event;
  assert.equal(withCreator.createdBy, "u_kid1");
  const withoutCreator = events.addEvent(f.id, { title: "Legacy-ish", date: "2026-07-09" }).event;
  assert.equal(withoutCreator.createdBy, null);
});

test("canManage: creator can manage their own event (kid or parent)", () => {
  const f = fam();
  const ev = events.addEvent(f.id, { title: "Soccer", date: "2026-07-09", createdBy: "u_kid1" }).event;
  assert.equal(events.canManage(ev, { userId: "u_kid1", isParent: false }), true);
});

test("canManage: any parent can manage any event, even one created by someone else", () => {
  const f = fam();
  const ev = events.addEvent(f.id, { title: "Soccer", date: "2026-07-09", createdBy: "u_kid1" }).event;
  assert.equal(events.canManage(ev, { userId: "u_parent2", isParent: true }), true);
});

test("canManage: a non-creator kid cannot manage another's event", () => {
  const f = fam();
  const ev = events.addEvent(f.id, { title: "Soccer", date: "2026-07-09", createdBy: "u_kid1" }).event;
  assert.equal(events.canManage(ev, { userId: "u_kid2", isParent: false }), false);
});

test("canManage: legacy event with no createdBy is parent-only", () => {
  const f = fam();
  const ev = events.addEvent(f.id, { title: "Legacy", date: "2026-07-09" }).event; // no createdBy
  assert.equal(ev.createdBy, null);
  assert.equal(events.canManage(ev, { userId: "u_kid1", isParent: false }), false);
  assert.equal(events.canManage(ev, { userId: "u_parent1", isParent: true }), true);
});

test("updateEvent: changes title/date/category and leaves createdBy/id/familyId/source unchanged", () => {
  const f = fam();
  const ev = events.addEvent(f.id, { title: "Soccer", date: "2026-07-09", category: "sports", createdBy: "u_kid1" }).event;
  const result = events.updateEvent(f.id, ev.id, { title: "Football", date: "2026-07-11", category: "school", createdBy: "u_hacker" });
  assert.ok(!result.error);
  assert.equal(result.event.title, "Football");
  assert.equal(result.event.date, "2026-07-11");
  assert.equal(result.event.category, "school");
  // immutable fields untouched despite being present in the patch
  assert.equal(result.event.createdBy, "u_kid1");
  assert.equal(result.event.id, ev.id);
  assert.equal(result.event.familyId, f.id);
  assert.equal(result.event.source, "manual");
});

test("updateEvent: rejects endDate before date", () => {
  const f = fam();
  const ev = events.addEvent(f.id, { title: "Trip", date: "2026-07-10" }).event;
  const result = events.updateEvent(f.id, ev.id, { endDate: "2026-07-01" });
  assert.equal(result.error, "End date can't be before the start date.");
});

test("updateEvent: rejects an empty title", () => {
  const f = fam();
  const ev = events.addEvent(f.id, { title: "Trip", date: "2026-07-10" }).event;
  const result = events.updateEvent(f.id, ev.id, { title: "" });
  assert.ok(result.error);
});

test("updateEvent: unknown field is silently ignored (no crash, event still returned)", () => {
  const f = fam();
  const ev = events.addEvent(f.id, { title: "Trip", date: "2026-07-10" }).event;
  const result = events.updateEvent(f.id, ev.id, { bogusField: "nope" });
  assert.ok(!result.error);
  assert.equal(result.event.title, "Trip");
  assert.equal(result.event.bogusField, undefined);
});

test("updateEvent: missing id errors", () => {
  const f = fam();
  const result = events.updateEvent(f.id, "ev_missing", { title: "Nope" });
  assert.equal(result.error, "Event not found.");
});

test("updateEvent: kidId must be a real kid in the family or null", () => {
  const f = fam();
  const ev = events.addEvent(f.id, { title: "Trip", date: "2026-07-10" }).event;
  const bogus = events.updateEvent(f.id, ev.id, { kidId: "not_a_real_kid" });
  assert.equal(bogus.event.kidId, null);
});

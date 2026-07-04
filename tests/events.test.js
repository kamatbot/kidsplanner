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

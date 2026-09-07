'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
test('iOS shared school visibility hides parent lessons, scopes kids, and preserves raw Calendar timetable input', { skip: process.platform !== 'darwin' }, () => {
  const store = fs.readFileSync('ios/FamETC/Domain/AppStore.swift', 'utf8');
  const getter = store.match(/var visibleEvents: \[CalendarEvent\] \{([\s\S]*?)\n    \}/)[0];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fam-timetable-'));
  const script = `struct User { var role: String }; struct CalendarEvent { var kidId: String?; var isImportedTimetable: Bool }; struct Store { var me: User?; var kidScope: String?; var events: [CalendarEvent]; ${getter} }
let rows = [CalendarEvent(kidId: "a", isImportedTimetable: true), CalendarEvent(kidId: "b", isImportedTimetable: true), CalendarEvent(kidId: nil, isImportedTimetable: false), CalendarEvent(kidId: "a", isImportedTimetable: false)]
precondition(Store(me: User(role: "parent"), events: rows).visibleEvents.count == 2)
precondition(Store(me: User(role: "kid"), kidScope: "a", events: rows).visibleEvents.count == 3)
precondition(Store(me: User(role: "kid"), events: rows).visibleEvents.isEmpty)
`;
  try {
    const file = path.join(dir, 'main.swift'); fs.writeFileSync(file, script);
    const run = cp.spawnSync('swift', [file], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const calendar = fs.readFileSync('ios/FamETC/Features/Calendar/CalendarView.swift', 'utf8');
  assert.match(calendar, /events: store.events/);
  assert.match(calendar, /events: events.filter\(\\.isImportedTimetable\)/);
});

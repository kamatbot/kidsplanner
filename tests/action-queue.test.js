"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "public/js/action-queue.js"), "utf8");
const sandbox = { window: {}, console };
vm.runInNewContext(source, sandbox, { filename: "action-queue.js" });
const queue = sandbox.window.famActionQueue;

function action(id, patch) {
  return Object.assign({
    id,
    status: "open",
    assigneeType: "family",
    dueDate: null,
    dueTime: null,
    createdAt: `2026-08-08T00:00:0${id.length}Z`,
  }, patch || {});
}

test("Today action queue uses the documented shelves and stable ordering", () => {
  const now = new Date(2026, 7, 8, 12, 0, 0);
  const items = [
    action("undated", { dueDate: null, createdAt: "2026-08-08T00:00:01Z" }),
    action("today-late", { dueDate: "2026-08-08", dueTime: "18:00", createdAt: "2026-08-08T00:00:02Z" }),
    action("overdue", { dueDate: "2026-08-07", createdAt: "2026-08-08T00:00:03Z" }),
    action("today-early", { dueDate: "2026-08-08", dueTime: "09:00", createdAt: "2026-08-08T00:00:04Z" }),
    action("next", { dueDate: "2026-08-10", createdAt: "2026-08-08T00:00:05Z" }),
    action("later", { dueDate: "2026-08-30", createdAt: "2026-08-08T00:00:06Z" }),
    action("done", { status: "done", dueDate: "2026-08-08", createdAt: "2026-08-08T00:00:07Z" }),
  ];

  const groups = queue.groupActions(items, now);
  assert.deepEqual(Array.from(groups.now, (item) => item.id), ["overdue", "today-early", "today-late"]);
  assert.deepEqual(Array.from(groups.next7, (item) => item.id), ["next"]);
  assert.deepEqual(Array.from(groups.sharedNoDate, (item) => item.id), ["undated"]);
  assert.deepEqual(Array.from(groups.later, (item) => item.id), ["later"]);
  assert.deepEqual(Array.from(groups.completed, (item) => item.id), ["done"]);
});

test("equal due values fall back to creation time and then id", () => {
  const now = new Date(2026, 7, 8, 12, 0, 0);
  const items = [
    action("z", { dueDate: "2026-08-09", createdAt: "2026-08-08T01:00:00Z" }),
    action("b", { dueDate: "2026-08-09", createdAt: "2026-08-08T00:00:00Z" }),
    action("a", { dueDate: "2026-08-09", createdAt: "2026-08-08T00:00:00Z" }),
  ];
  assert.deepEqual(Array.from(queue.sortActions(items, now), (item) => item.id), ["a", "b", "z"]);
});

test("snooze presets return timezone-qualified ISO timestamps", () => {
  const now = new Date(2026, 7, 8, 12, 30, 0);
  ["later-today", "tomorrow", "next-week"].forEach((preset) => {
    const value = queue.snoozeUntil(preset, now);
    assert.match(value, /Z$/);
    assert.ok(Number.isFinite(Date.parse(value)));
    assert.ok(Date.parse(value) > now.getTime());
  });
  assert.equal(queue.snoozeUntil("unknown", now), null);
});


test("Family Actions preview caps at three, excludes done/future snoozes and leaves source intact", () => {
  const now = new Date(2026, 7, 8, 12);
  const items = [action('done', { status: 'done' }), action('sleep', { status: 'snoozed', dueDate: '2026-08-01', snoozedUntil: new Date(2026, 7, 9).toISOString() }),
    action('later', { dueDate: '2026-09-01' }), action('no-date'), action('soon', { dueDate: '2026-08-09' }), action('today', { dueDate: '2026-08-08' }), action('late', { dueDate: '2026-08-07' })];
  assert.deepEqual(Array.from(queue.previewActions(items, now), x => x.id), ['late', 'today', 'soon']);
  assert.equal(items.length, 7);
  assert.equal(queue.previewActions([], now).length, 0);
  assert.deepEqual(Array.from(queue.previewActions(items.slice(0, 2), now), x => x.id), []);
  assert.equal(queue.previewActions([action('awake', {status: 'snoozed', snoozedUntil: new Date(2026, 7, 7).toISOString()})], now)[0].id, 'awake');
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { compareSchoolStats, matchKidByFirstName, LOW_BALANCE_THRESHOLD } = require("../public/js/school-stats");

const NOW = new Date("2026-07-03T09:00:00Z").getTime();

test("compareSchoolStats: first-ever sighting stores the record with no notifications", () => {
  const { record, notifications } = compareSchoolStats("Ryshi", null, { housePoints: 108, attendance: 99, punctual: 98, canteenBalance: 201 }, NOW);
  assert.deepEqual(notifications, []);
  assert.equal(record.housePoints, 108);
  assert.equal(record.attendance, 99);
  assert.equal(record.canteenBalance, 201);
  assert.equal(record.lastLowBalanceNotifiedAt, null);
});

test("compareSchoolStats: unchanged attendance and balance above threshold fires nothing", () => {
  const prev = { housePoints: 108, attendance: 99, punctual: 98, canteenBalance: 201, updatedAt: NOW - 1000, lastLowBalanceNotifiedAt: null };
  const { notifications } = compareSchoolStats("Ryshi", prev, { housePoints: 110, attendance: 99, punctual: 98, canteenBalance: 201 }, NOW);
  assert.deepEqual(notifications, []);
});

test("compareSchoolStats: attendance change notifies with old -> new percentages", () => {
  const prev = { attendance: 99, canteenBalance: 300, lastLowBalanceNotifiedAt: null };
  const { notifications } = compareSchoolStats("Ryshi", prev, { housePoints: null, attendance: 97, punctual: null, canteenBalance: 300 }, NOW);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].tag, "school-attendance");
  assert.match(notifications[0].body, /99% → 97%/);
});

test("compareSchoolStats: no attendance notification when previous attendance is unknown", () => {
  const prev = { attendance: null, canteenBalance: 300, lastLowBalanceNotifiedAt: null };
  const { notifications } = compareSchoolStats("Ryshi", prev, { attendance: 97, canteenBalance: 300 }, NOW);
  assert.deepEqual(notifications.filter((n) => n.tag === "school-attendance"), []);
});

test("compareSchoolStats: balance crossing below threshold notifies once and stamps lastLowBalanceNotifiedAt", () => {
  const prev = { attendance: 100, canteenBalance: 250, lastLowBalanceNotifiedAt: null };
  const { record, notifications } = compareSchoolStats("Arya", prev, { attendance: 100, canteenBalance: 180 }, NOW);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].tag, "school-canteen-low");
  assert.match(notifications[0].body, /฿180/);
  assert.equal(record.lastLowBalanceNotifiedAt, NOW);
});

test("compareSchoolStats: persistently low balance does not re-notify within 24h", () => {
  const prev = { attendance: 100, canteenBalance: 180, lastLowBalanceNotifiedAt: NOW - 60 * 60 * 1000 }; // 1h ago
  const { notifications } = compareSchoolStats("Arya", prev, { attendance: 100, canteenBalance: 170 }, NOW);
  assert.deepEqual(notifications.filter((n) => n.tag === "school-canteen-low"), []);
});

test("compareSchoolStats: persistently low balance DOES re-notify after 24h", () => {
  const prev = { attendance: 100, canteenBalance: 180, lastLowBalanceNotifiedAt: NOW - 25 * 60 * 60 * 1000 }; // 25h ago
  const { record, notifications } = compareSchoolStats("Arya", prev, { attendance: 100, canteenBalance: 170 }, NOW);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].tag, "school-canteen-low");
  assert.equal(record.lastLowBalanceNotifiedAt, NOW);
});

test("compareSchoolStats: balance staying at/above threshold never notifies", () => {
  const prev = { attendance: 100, canteenBalance: 500, lastLowBalanceNotifiedAt: null };
  const { notifications } = compareSchoolStats("Arya", prev, { attendance: 100, canteenBalance: LOW_BALANCE_THRESHOLD }, NOW);
  assert.deepEqual(notifications.filter((n) => n.tag === "school-canteen-low"), []);
});

test("compareSchoolStats: recovering above threshold then dropping again re-notifies immediately", () => {
  // Balance went low (notified), recovered above threshold, dropped again — should notify again even <24h later.
  const afterFirstDrop = { attendance: 100, canteenBalance: 150, lastLowBalanceNotifiedAt: NOW - 1000 };
  const recovered = { attendance: 100, canteenBalance: 500, lastLowBalanceNotifiedAt: afterFirstDrop.lastLowBalanceNotifiedAt };
  const { notifications } = compareSchoolStats("Arya", recovered, { attendance: 100, canteenBalance: 190 }, NOW);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].tag, "school-canteen-low");
});

test("matchKidByFirstName: matches case-insensitively on first name only", () => {
  const kids = [{ id: "k1", name: "Ryshi Kamat" }, { id: "k2", name: "Arya Kamat" }];
  assert.equal(matchKidByFirstName(kids, "ryshi").id, "k1");
  assert.equal(matchKidByFirstName(kids, "ARYA").id, "k2");
  assert.equal(matchKidByFirstName(kids, "Nobody"), null);
});

test("matchKidByFirstName: handles empty/missing inputs gracefully", () => {
  assert.equal(matchKidByFirstName([], "Ryshi"), null);
  assert.equal(matchKidByFirstName([{ id: "k1", name: "Ryshi" }], ""), null);
  assert.equal(matchKidByFirstName([{ id: "k1", name: "Ryshi" }], null), null);
});

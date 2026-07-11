"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-activities-"));

const store = require("../lib/store");
const family = require("../lib/family");
const activities = require("../lib/activities");

function makeFamilyWithKid(label) {
  const parent = store.createUser(`${label}@example.com`, `Parent ${label}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const { kid } = family.addKid(fam.id, parent.id, { name: `Kid ${label}`, grade: "6" });
  return { parent, fam, kid };
}

function userRole(user) {
  return (user && user.data && user.data.profile && user.data.profile.role) || "parent";
}

// ---------- CRUD ----------
test("addActivity: creates an activity scoped to family+kid, defaults coachLabel by category", () => {
  const { fam, kid } = makeFamilyWithKid("A");
  const result = activities.addActivity(fam.id, {
    kidId: kid.id, name: "Football", category: "sports",
    schedule: [{ day: "tue", start: "16:00", end: "17:30" }, { day: "sat", start: "09:00" }],
    location: "Main field", coachName: "Mr. Daniels", gear: ["shin guards", "boots"], note: "Term fee due Aug 15",
  });
  assert.ok(!result.error, result.error);
  assert.equal(result.activity.familyId, fam.id);
  assert.equal(result.activity.category, "sports");
  assert.equal(result.activity.coachLabel, "Coach");
  assert.equal(result.activity.schedule.length, 2);
  assert.deepEqual(result.activity.gear, ["shin guards", "boots"]);
});

test("addActivity: defaults coachLabel to Teacher for non-sports categories", () => {
  const { fam, kid } = makeFamilyWithKid("B");
  const result = activities.addActivity(fam.id, { kidId: kid.id, name: "Art club", category: "arts" });
  assert.equal(result.activity.coachLabel, "Teacher");
});

test("addActivity: rejects missing name or a kidId not in the family", () => {
  const { fam, kid } = makeFamilyWithKid("C");
  assert.ok(activities.addActivity(fam.id, { kidId: kid.id, name: "" }).error);
  assert.ok(activities.addActivity(fam.id, { kidId: "k_bogus", name: "X" }).error);
});

test("addActivity: unknown category falls back to 'other', invalid schedule slots are dropped", () => {
  const { fam, kid } = makeFamilyWithKid("D");
  const result = activities.addActivity(fam.id, {
    kidId: kid.id, name: "X", category: "bogus",
    schedule: [{ day: "notaday", start: "16:00" }, { day: "mon", start: "bad-time" }, { day: "wed", start: "10:00" }],
  });
  assert.equal(result.activity.category, "other");
  assert.equal(result.activity.schedule.length, 1);
  assert.equal(result.activity.schedule[0].day, "wed");
});

test("listActivities: filters by kidId", () => {
  const { fam, kid } = makeFamilyWithKid("E");
  const { kid: kid2 } = family.addKid(fam.id, fam.parentIds[0], { name: "Sibling" });
  activities.addActivity(fam.id, { kidId: kid.id, name: "Football", category: "sports" });
  activities.addActivity(fam.id, { kidId: kid2.id, name: "Piano", category: "music" });

  assert.equal(activities.listActivities(fam.id).length, 2);
  assert.equal(activities.listActivities(fam.id, { kidId: kid.id }).length, 1);
});

test("updateActivity: updates fields, rejects empty name, 404s on unknown id", () => {
  const { fam, kid } = makeFamilyWithKid("F");
  const { activity } = activities.addActivity(fam.id, { kidId: kid.id, name: "Football", category: "sports" });
  const updated = activities.updateActivity(fam.id, activity.id, { name: "Football (updated)", note: "Season ends Dec 12" });
  assert.ok(!updated.error, updated.error);
  assert.equal(updated.activity.name, "Football (updated)");
  assert.equal(updated.activity.note, "Season ends Dec 12");

  const empty = activities.updateActivity(fam.id, activity.id, { name: "" });
  assert.ok(empty.error);
  const missing = activities.updateActivity(fam.id, "ac_bogus", { name: "Y" });
  assert.ok(missing.error);
});

test("removeActivity: deletes the activity", () => {
  const { fam, kid } = makeFamilyWithKid("G");
  const { activity } = activities.addActivity(fam.id, { kidId: kid.id, name: "X", category: "other" });
  const result = activities.removeActivity(fam.id, activity.id);
  assert.ok(!result.error);
  assert.equal(activities.getById(fam.id, activity.id), null);
});

// ---------- day-of helper ----------
test("todaysActivities: returns only activities scheduled on the given date's day-of-week, sorted by start time", () => {
  const { fam, kid } = makeFamilyWithKid("H");
  activities.addActivity(fam.id, { kidId: kid.id, name: "Football", category: "sports", schedule: [{ day: "sat", start: "09:00" }] });
  activities.addActivity(fam.id, { kidId: kid.id, name: "Art club", category: "arts", schedule: [{ day: "fri", start: "11:30" }] });
  activities.addActivity(fam.id, { kidId: kid.id, name: "Piano", category: "music", schedule: [{ day: "sat", start: "08:00" }] });

  // 2026-07-04 is a Saturday.
  const saturday = new Date("2026-07-04T12:00:00");
  const todays = activities.todaysActivities(fam.id, saturday);
  assert.equal(todays.length, 2);
  assert.equal(todays[0].activity.name, "Piano"); // 08:00 before 09:00
  assert.equal(todays[1].activity.name, "Football");
});

test("todaysActivities: empty when nothing scheduled for that day", () => {
  const { fam, kid } = makeFamilyWithKid("I");
  activities.addActivity(fam.id, { kidId: kid.id, name: "Art club", category: "arts", schedule: [{ day: "fri", start: "11:30" }] });
  const saturday = new Date("2026-07-04T12:00:00");
  assert.equal(activities.todaysActivities(fam.id, saturday).length, 0);
});

// ---------- permissions ----------
test("canAccess: a kid may only see/touch their own activity", () => {
  const { fam, kid } = makeFamilyWithKid("J");
  const { kid: kid2 } = family.addKid(fam.id, fam.parentIds[0], { name: "Sibling2" });
  const { activity: activityA } = activities.addActivity(fam.id, { kidId: kid.id, name: "A", category: "sports" });
  const { activity: activityB } = activities.addActivity(fam.id, { kidId: kid2.id, name: "B", category: "arts" });

  const kidUser = { data: { kid: { familyId: fam.id, kidId: kid.id } } };
  assert.equal(activities.canAccess(kidUser, "kid", fam.id, activityA), true);
  assert.equal(activities.canAccess(kidUser, "kid", fam.id, activityB), false);
});

test("canAccess: a parent can touch any activity in the family", () => {
  const { fam, kid } = makeFamilyWithKid("K");
  const { activity } = activities.addActivity(fam.id, { kidId: kid.id, name: "X", category: "sports" });
  assert.equal(activities.canAccess({ id: fam.parentIds[0] }, "parent", fam.id, activity), true);
});

test("canAccess: rejects activities from a different family", () => {
  const { fam: fam1, kid: kid1 } = makeFamilyWithKid("L1");
  const { fam: fam2 } = makeFamilyWithKid("L2");
  const { activity } = activities.addActivity(fam1.id, { kidId: kid1.id, name: "X", category: "sports" });
  assert.equal(activities.canAccess({ id: fam2.parentIds[0] }, "parent", fam2.id, activity), false);
});

// ---------- route-level enforcement note ----------
// lib/routes/activities.js gates POST/PATCH/DELETE with requireParent — a kid
// session never reaches lib/activities.js mutation functions at all, so
// there's no kid-can-write path to prove false here (unlike homework/goals).
test("route guard: a parent-created activity is scoped to the family, not global", () => {
  const parent = store.createUser("activities-routeguard-p@example.com", "Route Guard Parent");
  const fam = family.createFamily(parent.id, "Route Guard Family");
  const { kid } = family.addKid(fam.id, parent.id, { name: "KidA" });
  const { activity } = activities.addActivity(fam.id, { kidId: kid.id, name: "X", category: "sports" });
  assert.equal(activities.canAccess(parent, userRole(parent), fam.id, activities.getById(fam.id, activity.id)), true);
});

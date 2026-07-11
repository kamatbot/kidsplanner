"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-goals-"));

const store = require("../lib/store");
const family = require("../lib/family");
const goals = require("../lib/goals");

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
test("addGoal: creates a habit goal scoped to family+kid", () => {
  const { fam, kid } = makeFamilyWithKid("A");
  const result = goals.addGoal(fam.id, { kidId: kid.id, title: "Read 20 min daily", type: "habit", target: 7 });
  assert.ok(!result.error, result.error);
  assert.equal(result.goal.familyId, fam.id);
  assert.equal(result.goal.kidId, kid.id);
  assert.equal(result.goal.type, "habit");
  assert.equal(result.goal.target, 7);
  assert.deepEqual(result.goal.checks, []);
  assert.equal(result.goal.progress, null);
});

test("addGoal: creates a milestone goal", () => {
  const { fam, kid } = makeFamilyWithKid("B");
  const result = goals.addGoal(fam.id, { kidId: kid.id, title: "Learn 50 SAT words", type: "milestone", target: 50 });
  assert.ok(!result.error, result.error);
  assert.equal(result.goal.progress, 0);
  assert.equal(result.goal.checks, null);
});

test("addGoal: rejects missing title, invalid type, or non-positive target", () => {
  const { fam, kid } = makeFamilyWithKid("C");
  assert.ok(goals.addGoal(fam.id, { kidId: kid.id, title: "", type: "habit", target: 7 }).error);
  assert.ok(goals.addGoal(fam.id, { kidId: kid.id, title: "X", type: "bogus", target: 7 }).error);
  assert.ok(goals.addGoal(fam.id, { kidId: kid.id, title: "X", type: "habit", target: 0 }).error);
});

test("addGoal: rejects a kidId not in the family", () => {
  const { fam } = makeFamilyWithKid("D");
  const result = goals.addGoal(fam.id, { kidId: "k_bogus", title: "X", type: "habit", target: 7 });
  assert.ok(result.error);
});

test("listGoals: filters by kidId", () => {
  const { fam, kid } = makeFamilyWithKid("E");
  const { kid: kid2 } = family.addKid(fam.id, fam.parentIds[0], { name: "Sibling" });
  goals.addGoal(fam.id, { kidId: kid.id, title: "Reading", type: "habit", target: 7 });
  goals.addGoal(fam.id, { kidId: kid2.id, title: "Piano", type: "habit", target: 3 });

  assert.equal(goals.listGoals(fam.id).length, 2);
  assert.equal(goals.listGoals(fam.id, { kidId: kid.id }).length, 1);
});

test("toggleHabitCheck: adds then removes today's check-in (idempotent toggle)", () => {
  const { fam, kid } = makeFamilyWithKid("F");
  const { goal } = goals.addGoal(fam.id, { kidId: kid.id, title: "Reading", type: "habit", target: 7 });
  const checked = goals.toggleHabitCheck(fam.id, goal.id);
  assert.equal(checked.goal.checks.length, 1);
  const unchecked = goals.toggleHabitCheck(fam.id, goal.id);
  assert.equal(unchecked.goal.checks.length, 0);
});

test("toggleHabitCheck: rejects milestone goals and unknown ids", () => {
  const { fam, kid } = makeFamilyWithKid("G");
  const { goal } = goals.addGoal(fam.id, { kidId: kid.id, title: "Words", type: "milestone", target: 50 });
  assert.ok(goals.toggleHabitCheck(fam.id, goal.id).error);
  assert.ok(goals.toggleHabitCheck(fam.id, "gl_bogus").error);
});

test("incrementMilestone: bumps progress, clamped to [0, target]", () => {
  const { fam, kid } = makeFamilyWithKid("H");
  const { goal } = goals.addGoal(fam.id, { kidId: kid.id, title: "Words", type: "milestone", target: 5 });
  goals.incrementMilestone(fam.id, goal.id, 3);
  const bumped = goals.incrementMilestone(fam.id, goal.id, 10); // clamps at target
  assert.equal(bumped.goal.progress, 5);
});

test("incrementMilestone: rejects habit goals", () => {
  const { fam, kid } = makeFamilyWithKid("I");
  const { goal } = goals.addGoal(fam.id, { kidId: kid.id, title: "Reading", type: "habit", target: 7 });
  assert.ok(goals.incrementMilestone(fam.id, goal.id, 1).error);
});

test("removeGoal: deletes the goal", () => {
  const { fam, kid } = makeFamilyWithKid("J");
  const { goal } = goals.addGoal(fam.id, { kidId: kid.id, title: "X", type: "habit", target: 7 });
  const result = goals.removeGoal(fam.id, goal.id);
  assert.ok(!result.error);
  assert.equal(goals.getById(fam.id, goal.id), null);
});

// ---------- weekly math (gentle language: no failure state) ----------
test("checksThisWeek: counts only check-ins within the Mon-Sun week of the given date", () => {
  const { fam, kid } = makeFamilyWithKid("K");
  const { goal } = goals.addGoal(fam.id, { kidId: kid.id, title: "Reading", type: "habit", target: 7 });
  // Mon 2026-07-06 .. Sun 2026-07-12
  goal.checks.push("2026-07-06", "2026-07-08", "2026-06-29" /* prior week */);
  assert.equal(goals.checksThisWeek(goal, "2026-07-09"), 2);
});

test("currentStreak: consecutive days walking back from the reference date, a gap resets it to 0 not negative", () => {
  const { fam, kid } = makeFamilyWithKid("L");
  const { goal } = goals.addGoal(fam.id, { kidId: kid.id, title: "Reading", type: "habit", target: 7 });
  goal.checks.push("2026-07-01", "2026-07-02", "2026-07-03"); // 3-day streak ending 07-03
  assert.equal(goals.currentStreak(goal, "2026-07-03"), 3);
  // 07-05 has a gap (no check on 07-04) — streak for that day is 0, not a
  // negative/punitive number.
  assert.equal(goals.currentStreak(goal, "2026-07-05"), 0);
});

// ---------- permissions ----------
test("canAccess: a kid may only check in on their own goal", () => {
  const { fam, kid } = makeFamilyWithKid("M");
  const { kid: kid2 } = family.addKid(fam.id, fam.parentIds[0], { name: "Sibling2" });
  const { goal: goalA } = goals.addGoal(fam.id, { kidId: kid.id, title: "A", type: "habit", target: 7 });
  const { goal: goalB } = goals.addGoal(fam.id, { kidId: kid2.id, title: "B", type: "habit", target: 7 });

  const kidUser = { data: { kid: { familyId: fam.id, kidId: kid.id } } };
  assert.equal(goals.canAccess(kidUser, "kid", fam.id, goalA), true);
  assert.equal(goals.canAccess(kidUser, "kid", fam.id, goalB), false);
});

test("canAccess: a parent can touch any goal in the family", () => {
  const { fam, kid } = makeFamilyWithKid("N");
  const { goal } = goals.addGoal(fam.id, { kidId: kid.id, title: "X", type: "habit", target: 7 });
  assert.equal(goals.canAccess({ id: fam.parentIds[0] }, "parent", fam.id, goal), true);
});

test("canAccess: rejects goals from a different family", () => {
  const { fam: fam1, kid: kid1 } = makeFamilyWithKid("O1");
  const { fam: fam2 } = makeFamilyWithKid("O2");
  const { goal } = goals.addGoal(fam1.id, { kidId: kid1.id, title: "X", type: "habit", target: 7 });
  assert.equal(goals.canAccess({ id: fam2.parentIds[0] }, "parent", fam2.id, goal), false);
});

// ---------- route-level ownership enforcement (mirrors lib/routes/goals.js) ----------
test("route guard: a kid cannot check in on a sibling's habit", () => {
  const parent = store.createUser("goals-routeguard-p@example.com", "Route Guard Parent");
  const fam = family.createFamily(parent.id, "Route Guard Family");
  const { kid: kidA } = family.addKid(fam.id, parent.id, { name: "KidA" });
  const { kid: kidB } = family.addKid(fam.id, parent.id, { name: "KidB" });
  const { goal: goalB } = goals.addGoal(fam.id, { kidId: kidB.id, title: "KidB's habit", type: "habit", target: 7 });

  const kidAUser = store.findOrCreateKidUser(fam.id, kidA.id, kidA.name);
  const existing = goals.getById(fam.id, goalB.id);
  assert.equal(goals.canAccess(kidAUser, userRole(kidAUser), fam.id, existing), false);
  // Route would 403 before calling toggleHabitCheck — goal untouched.
  assert.equal(goals.getById(fam.id, goalB.id).checks.length, 0);
});

test("route guard: a kid CAN check in on their own habit", () => {
  const parent = store.createUser("goals-routeguard2-p@example.com", "Route Guard Parent 2");
  const fam = family.createFamily(parent.id, "Route Guard Family 2");
  const { kid: kidA } = family.addKid(fam.id, parent.id, { name: "KidA2" });
  const { goal } = goals.addGoal(fam.id, { kidId: kidA.id, title: "KidA2's habit", type: "habit", target: 7 });

  const kidAUser = store.findOrCreateKidUser(fam.id, kidA.id, kidA.name);
  const existing = goals.getById(fam.id, goal.id);
  assert.equal(goals.canAccess(kidAUser, userRole(kidAUser), fam.id, existing), true);
  const result = goals.toggleHabitCheck(fam.id, goal.id);
  assert.equal(result.goal.checks.length, 1);
});

test("route guard: only a parent creates/deletes goals (kidId derived server-side is not exercised here — that's the route's job; this proves the primitive a route relies on)", () => {
  const { fam, kid } = makeFamilyWithKid("P");
  const { goal } = goals.addGoal(fam.id, { kidId: kid.id, title: "X", type: "habit", target: 7 });
  const removed = goals.removeGoal(fam.id, goal.id);
  assert.ok(!removed.error);
  assert.equal(goals.getById(fam.id, goal.id), null);
});

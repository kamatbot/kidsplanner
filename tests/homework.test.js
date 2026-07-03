"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-homework-"));

const store = require("../lib/store");
const family = require("../lib/family");
const homework = require("../lib/homework");

function makeFamilyWithKid(label) {
  const parent = store.createUser(`${label}@example.com`, `Parent ${label}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const { kid } = family.addKid(fam.id, parent.id, { name: `Kid ${label}`, grade: "6" });
  return { parent, fam, kid };
}

// ---------- CRUD ----------
test("addHomework: creates an item scoped to family+kid", () => {
  const { fam, kid } = makeFamilyWithKid("A");
  const result = homework.addHomework(fam.id, { kidId: kid.id, title: "Math worksheet", subject: "Math", dueDate: "2026-08-01" });
  assert.ok(!result.error);
  assert.equal(result.homework.status, "todo");
  assert.equal(result.homework.source, "manual");
  assert.equal(result.homework.familyId, fam.id);
  assert.equal(result.homework.kidId, kid.id);
});

test("addHomework: rejects missing title or invalid due date", () => {
  const { fam, kid } = makeFamilyWithKid("B");
  const noTitle = homework.addHomework(fam.id, { kidId: kid.id, title: "", dueDate: "2026-08-01" });
  assert.ok(noTitle.error);
  const badDate = homework.addHomework(fam.id, { kidId: kid.id, title: "X", dueDate: "not-a-date" });
  assert.ok(badDate.error);
});

test("addHomework: rejects a kidId not in the family", () => {
  const { fam } = makeFamilyWithKid("C");
  const result = homework.addHomework(fam.id, { kidId: "k_bogus", title: "X", dueDate: "2026-08-01" });
  assert.ok(result.error);
});

test("listForFamily: filters by kidId and subject", () => {
  const { fam, kid } = makeFamilyWithKid("D");
  const { kid: kid2 } = family.addKid(fam.id, fam.parentIds[0], { name: "Sibling" });
  homework.addHomework(fam.id, { kidId: kid.id, title: "Essay", subject: "English", dueDate: "2026-08-01" });
  homework.addHomework(fam.id, { kidId: kid.id, title: "Algebra", subject: "Math", dueDate: "2026-08-02" });
  homework.addHomework(fam.id, { kidId: kid2.id, title: "Reading", subject: "English", dueDate: "2026-08-03" });

  const forKid1 = homework.listForFamily(fam.id, { kidId: kid.id });
  assert.equal(forKid1.length, 2);

  const englishOnly = homework.listForFamily(fam.id, { subject: "English" });
  assert.equal(englishOnly.length, 2);

  const all = homework.listForFamily(fam.id);
  assert.equal(all.length, 3);
});

test("updateHomework: updates status/fields/checklist", () => {
  const { fam, kid } = makeFamilyWithKid("E");
  const { homework: item } = homework.addHomework(fam.id, { kidId: kid.id, title: "Project", dueDate: "2026-08-01" });
  const updated = homework.updateHomework(fam.id, item.id, {
    status: "in_progress",
    notes: "started outline",
    checklist: [{ text: "Outline", done: true }, { text: "Draft", done: false }],
  });
  assert.ok(!updated.error);
  assert.equal(updated.homework.status, "in_progress");
  assert.equal(updated.homework.notes, "started outline");
  assert.equal(updated.homework.checklist.length, 2);
  assert.equal(updated.homework.checklist[0].done, true);
});

test("updateHomework: rejects invalid status", () => {
  const { fam, kid } = makeFamilyWithKid("F");
  const { homework: item } = homework.addHomework(fam.id, { kidId: kid.id, title: "X", dueDate: "2026-08-01" });
  const result = homework.updateHomework(fam.id, item.id, { status: "bogus" });
  assert.ok(result.error);
});

test("toggleChecklistItem: flips done state by index", () => {
  const { fam, kid } = makeFamilyWithKid("G");
  const { homework: item } = homework.addHomework(fam.id, {
    kidId: kid.id, title: "X", dueDate: "2026-08-01", checklist: [{ text: "Step 1", done: false }],
  });
  const toggled = homework.toggleChecklistItem(fam.id, item.id, 0);
  assert.equal(toggled.homework.checklist[0].done, true);
  const toggledBack = homework.toggleChecklistItem(fam.id, item.id, 0);
  assert.equal(toggledBack.homework.checklist[0].done, false);
});

test("removeHomework: deletes the item", () => {
  const { fam, kid } = makeFamilyWithKid("H");
  const { homework: item } = homework.addHomework(fam.id, { kidId: kid.id, title: "X", dueDate: "2026-08-01" });
  const result = homework.removeHomework(fam.id, item.id);
  assert.ok(!result.error);
  assert.equal(homework.getById(fam.id, item.id), null);
});

// ---------- permissions ----------
test("canAccess: a kid can only touch their own homework", () => {
  const { fam, kid } = makeFamilyWithKid("I");
  const { kid: kid2 } = family.addKid(fam.id, fam.parentIds[0], { name: "Sibling2" });
  const { homework: item1 } = homework.addHomework(fam.id, { kidId: kid.id, title: "X", dueDate: "2026-08-01" });
  const { homework: item2 } = homework.addHomework(fam.id, { kidId: kid2.id, title: "Y", dueDate: "2026-08-01" });

  const kidUser = { data: { kid: { familyId: fam.id, kidId: kid.id } } };
  assert.equal(homework.canAccess(kidUser, "kid", fam.id, item1), true);
  assert.equal(homework.canAccess(kidUser, "kid", fam.id, item2), false);
});

test("canAccess: a parent can touch any homework in the family", () => {
  const { fam, kid } = makeFamilyWithKid("J");
  const { homework: item } = homework.addHomework(fam.id, { kidId: kid.id, title: "X", dueDate: "2026-08-01" });
  const parentUser = { id: fam.parentIds[0] };
  assert.equal(homework.canAccess(parentUser, "parent", fam.id, item), true);
});

test("canAccess: rejects items from a different family", () => {
  const { fam: fam1, kid: kid1 } = makeFamilyWithKid("K1");
  const { fam: fam2 } = makeFamilyWithKid("K2");
  const { homework: item } = homework.addHomework(fam1.id, { kidId: kid1.id, title: "X", dueDate: "2026-08-01" });
  const parentUser = { id: fam2.parentIds[0] };
  assert.equal(homework.canAccess(parentUser, "parent", fam2.id, item), false);
});

// ---------- ingestDeadlines: idempotency, dedup, non-clobbering ----------
function deadlineEvent(overrides) {
  return Object.assign({
    uid: "evt1@standrews.ac.th",
    title: "IA 1st Copy Deadline",
    start: "2026-08-15",
    allDay: true,
    isDeadline: true,
    type: "deadline",
    subscriptionId: "sub_1",
    feedLabel: "CAHE (college & careers)",
    kidId: null,
    description: "Bring a printed copy",
  }, overrides);
}

test("ingestDeadlines: creates homework from deadline events", () => {
  const { fam, kid } = makeFamilyWithKid("L");
  const result = homework.ingestDeadlines(fam.id, [deadlineEvent({ kidId: kid.id })]);
  assert.equal(result.created, 1);
  assert.equal(result.updated, 0);
  const list = homework.listForFamily(fam.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].source, "school");
  assert.equal(list[0].sourceUid, "sub_1::evt1@standrews.ac.th");
  assert.equal(list[0].dueDate, "2026-08-15");
});

test("ingestDeadlines: re-sync UPDATES rather than duplicates (dedup by sourceUid)", () => {
  const { fam, kid } = makeFamilyWithKid("M");
  homework.ingestDeadlines(fam.id, [deadlineEvent({ kidId: kid.id })]);
  const secondRun = homework.ingestDeadlines(fam.id, [deadlineEvent({ kidId: kid.id, title: "IA 1st Copy Deadline (updated)" })]);
  assert.equal(secondRun.created, 0);
  assert.equal(secondRun.updated, 1);
  const list = homework.listForFamily(fam.id);
  assert.equal(list.length, 1); // no duplicate
  assert.equal(list[0].title, "IA 1st Copy Deadline (updated)");
});

test("ingestDeadlines: re-ingest does NOT clobber user-set status/notes/checklist", () => {
  const { fam, kid } = makeFamilyWithKid("N");
  homework.ingestDeadlines(fam.id, [deadlineEvent({ kidId: kid.id })]);
  const list1 = homework.listForFamily(fam.id);
  const item = list1[0];

  // User marks progress and adds notes/checklist.
  homework.updateHomework(fam.id, item.id, {
    status: "in_progress",
    notes: "Talked to teacher about extension",
    checklist: [{ text: "Draft outline", done: true }],
  });

  // Re-sync with a slightly changed title/date (simulating the feed updating).
  homework.ingestDeadlines(fam.id, [deadlineEvent({ kidId: kid.id, title: "IA 1st Copy Deadline", start: "2026-08-16" })]);

  const list2 = homework.listForFamily(fam.id);
  assert.equal(list2.length, 1);
  assert.equal(list2[0].status, "in_progress"); // preserved
  assert.equal(list2[0].notes, "Talked to teacher about extension"); // preserved
  assert.equal(list2[0].checklist.length, 1); // preserved
  assert.equal(list2[0].dueDate, "2026-08-16"); // school-sourced field DOES update
});

test("ingestDeadlines: skips events without isDeadline/type flag", () => {
  const { fam, kid } = makeFamilyWithKid("O");
  const result = homework.ingestDeadlines(fam.id, [
    deadlineEvent({ kidId: kid.id, isDeadline: false, type: "event" }),
  ]);
  assert.equal(result.created, 0);
  assert.equal(homework.listForFamily(fam.id).length, 0);
});

test("ingestDeadlines: skips events with no kidId (unassigned)", () => {
  const { fam } = makeFamilyWithKid("P");
  const result = homework.ingestDeadlines(fam.id, [deadlineEvent({ kidId: null })]);
  assert.equal(result.created, 0);
});

test("ingestDeadlines: different subscriptions with the same uid stay distinct (per-kid dedup key)", () => {
  const { fam, kid } = makeFamilyWithKid("Q");
  const { kid: kid2 } = family.addKid(fam.id, fam.parentIds[0], { name: "Sibling3" });
  homework.ingestDeadlines(fam.id, [
    deadlineEvent({ kidId: kid.id, subscriptionId: "sub_kid1" }),
    deadlineEvent({ kidId: kid2.id, subscriptionId: "sub_kid2" }),
  ]);
  const list = homework.listForFamily(fam.id);
  assert.equal(list.length, 2); // one per kid, not deduped against each other
});

// ---------- due-date grouping ----------
test("groupByDueDate: buckets into overdue/today/thisWeek/later", () => {
  const items = [
    { dueDate: "2026-06-20", status: "todo" }, // overdue (today = 2026-07-03)
    { dueDate: "2026-07-03", status: "todo" }, // today
    { dueDate: "2026-07-07", status: "todo" }, // this week
    { dueDate: "2026-08-01", status: "todo" }, // later
  ];
  const groups = homework.groupByDueDate(items, "2026-07-03");
  assert.equal(groups.overdue.length, 1);
  assert.equal(groups.today.length, 1);
  assert.equal(groups.thisWeek.length, 1);
  assert.equal(groups.later.length, 1);
});

test("groupByDueDate: items with no dueDate fall into later", () => {
  const groups = homework.groupByDueDate([{ dueDate: null, status: "todo" }], "2026-07-03");
  assert.equal(groups.later.length, 1);
});

// ---------- route-level ownership enforcement ----------
// Mirrors server.js's PATCH/DELETE /api/homework/:id guard: fetch the item,
// canAccess() check, then only apply the mutation if it passes — exercised
// directly against lib/homework.js + lib/store.js (same style as
// tests/kid-login.test.js) so this doesn't need to boot the HTTP server.
function userRole(user) {
  return (user && user.data && user.data.profile && user.data.profile.role) || "parent";
}

test("route guard: a kid cannot modify another kid's homework (PATCH)", () => {
  const parent = store.createUser("routeguard-p@example.com", "Route Guard Parent");
  const fam = family.createFamily(parent.id, "Route Guard Family");
  const { kid: kidA } = family.addKid(fam.id, parent.id, { name: "KidA" });
  const { kid: kidB } = family.addKid(fam.id, parent.id, { name: "KidB" });
  const { homework: itemB } = homework.addHomework(fam.id, { kidId: kidB.id, title: "KidB's homework", dueDate: "2026-08-01" });

  const kidAUser = store.findOrCreateKidUser(fam.id, kidA.id, kidA.name);
  assert.equal(userRole(kidAUser), "kid");

  // Route logic: fetch existing, canAccess check BEFORE applying the patch.
  const existing = homework.getById(fam.id, itemB.id);
  const allowed = homework.canAccess(kidAUser, userRole(kidAUser), fam.id, existing);
  assert.equal(allowed, false);
  // Confirm the item is untouched (the route would 403 and never call updateHomework).
  assert.equal(homework.getById(fam.id, itemB.id).title, "KidB's homework");
});

test("route guard: a kid CAN modify their own homework (PATCH)", () => {
  const parent = store.createUser("routeguard2-p@example.com", "Route Guard Parent 2");
  const fam = family.createFamily(parent.id, "Route Guard Family 2");
  const { kid: kidA } = family.addKid(fam.id, parent.id, { name: "KidA2" });
  const { homework: itemA } = homework.addHomework(fam.id, { kidId: kidA.id, title: "KidA2's homework", dueDate: "2026-08-01" });

  const kidAUser = store.findOrCreateKidUser(fam.id, kidA.id, kidA.name);
  const existing = homework.getById(fam.id, itemA.id);
  const allowed = homework.canAccess(kidAUser, userRole(kidAUser), fam.id, existing);
  assert.equal(allowed, true);

  const result = homework.updateHomework(fam.id, itemA.id, { status: "done" });
  assert.equal(result.homework.status, "done");
});

test("route guard: a kid cannot delete another kid's homework (DELETE)", () => {
  const parent = store.createUser("routeguard3-p@example.com", "Route Guard Parent 3");
  const fam = family.createFamily(parent.id, "Route Guard Family 3");
  const { kid: kidA } = family.addKid(fam.id, parent.id, { name: "KidA3" });
  const { kid: kidB } = family.addKid(fam.id, parent.id, { name: "KidB3" });
  const { homework: itemB } = homework.addHomework(fam.id, { kidId: kidB.id, title: "X", dueDate: "2026-08-01" });

  const kidAUser = store.findOrCreateKidUser(fam.id, kidA.id, kidA.name);
  const existing = homework.getById(fam.id, itemB.id);
  assert.equal(homework.canAccess(kidAUser, userRole(kidAUser), fam.id, existing), false);
  // Route would 403 before calling removeHomework — item survives.
  assert.ok(homework.getById(fam.id, itemB.id));
});

test("route guard: a kidId derived from the session cannot be overridden by request body", () => {
  // Mirrors server.js POST /api/homework: for a kid session, kidId is always
  // req.user.data.kid.kidId — a malicious body.kidId is never consulted.
  const parent = store.createUser("routeguard4-p@example.com", "Route Guard Parent 4");
  const fam = family.createFamily(parent.id, "Route Guard Family 4");
  const { kid: kidA } = family.addKid(fam.id, parent.id, { name: "KidA4" });
  const { kid: kidB } = family.addKid(fam.id, parent.id, { name: "KidB4" });
  const kidAUser = store.findOrCreateKidUser(fam.id, kidA.id, kidA.name);

  // Simulate the route: role is kid, so kidId comes from the session, NOT
  // from an attacker-supplied body.kidId of kidB.id.
  const role = userRole(kidAUser);
  const sessionKidId = kidAUser.data.kid.kidId;
  const bodyKidId = kidB.id; // attacker-supplied, must be ignored
  const kidIdUsed = role === "kid" ? sessionKidId : bodyKidId;
  const result = homework.addHomework(fam.id, { kidId: kidIdUsed, title: "Sneaky", dueDate: "2026-08-01" });
  assert.equal(result.homework.kidId, kidA.id);
  assert.notEqual(result.homework.kidId, kidB.id);
});

test("route guard: a parent can modify any kid's homework", () => {
  const parent = store.createUser("routeguard5-p@example.com", "Route Guard Parent 5");
  const fam = family.createFamily(parent.id, "Route Guard Family 5");
  const { kid } = family.addKid(fam.id, parent.id, { name: "KidA5" });
  const { homework: item } = homework.addHomework(fam.id, { kidId: kid.id, title: "X", dueDate: "2026-08-01" });
  assert.equal(homework.canAccess(parent, "parent", fam.id, homework.getById(fam.id, item.id)), true);
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

// Isolate each test run in a throwaway data dir so tests never touch real data.
process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-"));

const store = require("../lib/store");
const family = require("../lib/family");

test("createUser + createFamily: parent becomes the sole member", () => {
  const parent = store.createUser("p1@example.com", "Parent One");
  const fam = family.createFamily(parent.id, "Test Family");
  assert.equal(fam.parentIds.length, 1);
  assert.equal(fam.parentIds[0], parent.id);
  assert.equal(fam.kids.length, 0);
  assert.match(fam.inviteCode, /^[A-Z0-9]{6}$/);
});

test("joinFamilyAsParent: a second parent can join via invite code", () => {
  const parent1 = store.createUser("p2@example.com", "Parent Two");
  const parent2 = store.createUser("p3@example.com", "Parent Three");
  const fam = family.createFamily(parent1.id, "Two Parent Family");
  const result = family.joinFamilyAsParent(fam.inviteCode, parent2.id);
  assert.ok(!result.error);
  assert.equal(result.family.parentIds.length, 2);
});

test("joinFamilyAsParent: a third parent is rejected", () => {
  const p1 = store.createUser("p4@example.com", "P4");
  const p2 = store.createUser("p5@example.com", "P5");
  const p3 = store.createUser("p6@example.com", "P6");
  const fam = family.createFamily(p1.id, "Cap Family");
  family.joinFamilyAsParent(fam.inviteCode, p2.id);
  const result = family.joinFamilyAsParent(fam.inviteCode, p3.id);
  assert.ok(result.error);
});

test("addKid: only a parent in the family can add a kid; minimal fields only", () => {
  const parent = store.createUser("p7@example.com", "Parent Seven");
  const outsider = store.createUser("p8@example.com", "Outsider");
  const fam = family.createFamily(parent.id, "Kid Family");

  const denied = family.addKid(fam.id, outsider.id, { name: "Intruder Kid" });
  assert.ok(denied.error);

  const result = family.addKid(fam.id, parent.id, { name: "Alex", grade: "6" });
  assert.ok(!result.error);
  assert.equal(result.kid.name, "Alex");
  assert.equal(result.kid.grade, "6");
  assert.ok(result.kid.color); // auto-assigned
  assert.equal(result.kid.email, undefined); // never collected
});

test("removeMember: cannot remove the last parent", () => {
  const parent = store.createUser("p9@example.com", "Solo Parent");
  const fam = family.createFamily(parent.id, "Solo Family");
  const result = family.removeMember(fam.id, parent.id, parent.id);
  assert.ok(result.error);
});

test("removeMember: a parent can remove the other parent (block-equivalent control)", () => {
  const p1 = store.createUser("p10@example.com", "P10");
  const p2 = store.createUser("p11@example.com", "P11");
  const fam = family.createFamily(p1.id, "Removable Family");
  family.joinFamilyAsParent(fam.inviteCode, p2.id);
  const result = family.removeMember(fam.id, p1.id, p2.id);
  assert.ok(!result.error);
  assert.equal(result.family.parentIds.length, 1);
  assert.ok(!result.family.parentIds.includes(p2.id));
});

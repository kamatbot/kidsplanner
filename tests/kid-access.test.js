"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

// Isolate each test run in a throwaway data dir so tests never touch real data.
process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-kidaccess-"));

const store = require("../lib/store");
const family = require("../lib/family");
const kidAccess = require("../lib/kid-access");

function freshFamily() {
  const parent = store.createUser("p@example.com", "Parent");
  const fam = family.createFamily(parent.id, "Test Family");
  return { parent, fam };
}

test("createRequest: unknown invite code is rejected", () => {
  const r = kidAccess.createRequest("ZZZZZZ", "Kid", "iPad");
  assert.ok(r.error);
});

test("createRequest: blank name is rejected", () => {
  const { fam } = freshFamily();
  const r = kidAccess.createRequest(fam.inviteCode, "   ", "iPad");
  assert.ok(r.error);
});

test("createRequest: valid code + name creates a pending request with a pollToken", () => {
  const { fam } = freshFamily();
  const r = kidAccess.createRequest(fam.inviteCode, "Arya", "Arya's iPad");
  assert.ok(!r.error);
  assert.equal(r.request.status, "pending");
  assert.equal(r.request.familyId, fam.id);
  assert.equal(r.request.name, "Arya");
  assert.ok(r.request.pollToken && r.request.pollToken.length >= 24);
  // No kid profile is created until a parent approves.
  assert.equal(family.getFamily(fam.id).kids.length, 0);
});

test("statusForKid: wrong pollToken never reveals a request", () => {
  const { fam } = freshFamily();
  const { request } = kidAccess.createRequest(fam.inviteCode, "Kid", "iPad");
  assert.equal(kidAccess.statusForKid(request.id, "nope").status, "not_found");
  assert.equal(kidAccess.statusForKid("rq_missing", "nope").status, "not_found");
  assert.equal(kidAccess.statusForKid(request.id, request.pollToken).status, "pending");
});

test("listPendingForFamily: shows this family's pending requests only", () => {
  const { fam } = freshFamily();
  const other = freshFamily();
  kidAccess.createRequest(fam.inviteCode, "Mine", "iPad");
  kidAccess.createRequest(other.fam.inviteCode, "Theirs", "iPad");
  const list = kidAccess.listPendingForFamily(fam.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Mine");
  assert.ok(!("pollToken" in list[0])); // never leak the secret to the parent view
});

test("approve: creates the kid profile and unlocks the approved request", () => {
  const { parent, fam } = freshFamily();
  const { request } = kidAccess.createRequest(fam.inviteCode, "Nikhil", "iPhone");
  const res = kidAccess.approve(fam.id, parent.id, request.id);
  assert.ok(!res.error);
  assert.equal(res.kid.name, "Nikhil");
  assert.equal(family.getFamily(fam.id).kids.length, 1);
  assert.equal(kidAccess.statusForKid(request.id, request.pollToken).status, "approved");
  // The approved request now points at the freshly-created profile.
  const approved = kidAccess.getApproved(request.id, request.pollToken);
  assert.equal(approved.kidId, res.kid.id);
});

test("approve: only a parent of the family can approve", () => {
  const { fam } = freshFamily();
  const outsider = store.createUser("x@example.com", "Outsider");
  const { request } = kidAccess.createRequest(fam.inviteCode, "Kid", "iPad");
  const res = kidAccess.approve(fam.id, outsider.id, request.id);
  assert.ok(res.error); // addKid rejects a non-parent
  assert.equal(family.getFamily(fam.id).kids.length, 0);
});

test("approve: a second approval of the same request is rejected", () => {
  const { parent, fam } = freshFamily();
  const { request } = kidAccess.createRequest(fam.inviteCode, "Kid", "iPad");
  assert.ok(!kidAccess.approve(fam.id, parent.id, request.id).error);
  const again = kidAccess.approve(fam.id, parent.id, request.id);
  assert.ok(again.error);
});

test("deny: removes it from the pending list and blocks registration", () => {
  const { parent, fam } = freshFamily();
  const { request } = kidAccess.createRequest(fam.inviteCode, "Kid", "iPad");
  assert.ok(!kidAccess.deny(fam.id, parent.id, request.id).error);
  assert.equal(kidAccess.listPendingForFamily(fam.id).length, 0);
  assert.equal(kidAccess.getApproved(request.id, request.pollToken), null);
});

test("setRegistration + complete: stores challenge then marks used (single-use)", () => {
  const { parent, fam } = freshFamily();
  const { request } = kidAccess.createRequest(fam.inviteCode, "Kid", "iPad");
  const approved = kidAccess.approve(fam.id, parent.id, request.id);
  const kidUser = store.findOrCreateKidUser(fam.id, approved.kid.id, "Kid");
  const set = kidAccess.setRegistration(request.id, request.pollToken, "challenge-abc", kidUser.id);
  assert.ok(!set.error);
  assert.equal(kidAccess.getApproved(request.id, request.pollToken).regChallenge, "challenge-abc");
  assert.ok(!kidAccess.complete(request.id, request.pollToken).error);
  assert.equal(kidAccess.statusForKid(request.id, request.pollToken).status, "used");
  // Used requests can't be re-approved or re-registered.
  assert.equal(kidAccess.getApproved(request.id, request.pollToken), null);
});

test("per-family pending cap blocks a flood from a shared invite code", () => {
  const { fam } = freshFamily();
  for (let i = 0; i < kidAccess.MAX_PENDING_PER_FAMILY; i++) {
    assert.ok(!kidAccess.createRequest(fam.inviteCode, "Kid" + i, "iPad").error);
  }
  const overflow = kidAccess.createRequest(fam.inviteCode, "OneTooMany", "iPad");
  assert.ok(overflow.error);
});

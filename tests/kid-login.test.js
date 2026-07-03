"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-"));

const store = require("../lib/store");
const family = require("../lib/family");
const chat = require("../lib/chat");

// Minimal stand-ins for server.js's userRole()/requireParent()/requireFamily()
// logic, exercised directly against the store/family libs so this test file
// doesn't need to boot the HTTP server. Keep in sync with server.js.
function userRole(user) {
  return (user && user.data && user.data.profile && user.data.profile.role) || "parent";
}
function requireParentCheck(user) {
  return userRole(user) === "kid" ? { error: "Parents only." } : { ok: true };
}
function resolveFamilyForUser(user) {
  if (userRole(user) === "kid") return family.familyForKidUser(user);
  const fams = family.familiesForUser(user.id);
  return fams[0] || null;
}

function makeFamilyWithKid() {
  const parent = store.createUser("kidlogin-p@example.com", "Kid Login Parent");
  const fam = family.createFamily(parent.id, "Kid Login Family");
  const { kid } = family.addKid(fam.id, parent.id, { name: "Riley", grade: "3rd Grade" });
  return { parent, fam, kid };
}

test("findOrCreateKidUser: creates a kid user with role=kid and kid linkage", () => {
  const { fam, kid } = makeFamilyWithKid();
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  assert.equal(userRole(kidUser), "kid");
  assert.equal(kidUser.email, "");
  assert.deepEqual(kidUser.data.kid, { familyId: fam.id, kidId: kid.id });
});

test("findOrCreateKidUser: is idempotent — same (familyId, kidId) returns the same user", () => {
  const { fam, kid } = makeFamilyWithKid();
  const first = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const second = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  assert.equal(first.id, second.id);
});

test("requireParent-equivalent check: blocks a kid user, allows a parent user", () => {
  const { parent, fam, kid } = makeFamilyWithKid();
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  assert.ok(requireParentCheck(kidUser).error);
  assert.ok(!requireParentCheck(parent).error);
});

test("familyForKidUser: a kid user resolves to their own family", () => {
  const { fam, kid } = makeFamilyWithKid();
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const resolved = family.familyForKidUser(kidUser);
  assert.ok(resolved);
  assert.equal(resolved.id, fam.id);
});

test("familyForKidUser: returns null for a parent user (no kid linkage)", () => {
  const { parent } = makeFamilyWithKid();
  assert.equal(family.familyForKidUser(parent), null);
});

test("resolveFamilyForUser: kid and parent both resolve to the same family", () => {
  const { parent, fam, kid } = makeFamilyWithKid();
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  assert.equal(resolveFamilyForUser(parent).id, fam.id);
  assert.equal(resolveFamilyForUser(kidUser).id, fam.id);
});

test("kidBelongsToFamily: true for a kid in the family, false otherwise", () => {
  const { fam, kid } = makeFamilyWithKid();
  assert.equal(family.kidBelongsToFamily(fam.id, kid.id), true);
  assert.equal(family.kidBelongsToFamily(fam.id, "k_nonexistent"), false);
});

test("chat: a kid posts with senderType 'kid' and senderId = kid profile id", () => {
  const { fam, kid } = makeFamilyWithKid();
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  // Mirrors server.js POST /api/chat/messages: senderId is derived from
  // req.user.data.kid.kidId for a kid session, never trusted from the body.
  const result = chat.sendMessage(fam.id, {
    senderType: "kid",
    senderId: kidUser.data.kid.kidId,
    postedByUserId: kidUser.id,
    text: "hi from the kid",
  });
  assert.ok(!result.error);
  assert.equal(result.message.senderType, "kid");
  assert.equal(result.message.senderId, kid.id);
  assert.equal(result.message.postedByUserId, kidUser.id);
});

test("chat: parent-only delete rejects a kid user (requireParent enforced before deleteMessage)", () => {
  const { parent, fam, kid } = makeFamilyWithKid();
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const { message } = chat.sendMessage(fam.id, { senderType: "parent", senderId: parent.id, text: "delete me" });
  // Route-level requireParent would 403 before this ever runs; belt-and-
  // braces check that the underlying lib also refuses a non-parent id.
  const result = chat.deleteMessage(fam.id, kidUser.id, message.id);
  assert.ok(result.error);
});

test("publicProfile-equivalent: role is 'parent' by default and 'kid' for kid users", () => {
  const { parent, fam, kid } = makeFamilyWithKid();
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  assert.equal(userRole(parent), "parent");
  assert.equal(userRole(kidUser), "kid");
});

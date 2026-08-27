"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-operator-domain-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const store = require("../lib/store");
const db = require("../lib/db");
const family = require("../lib/family");
const operator = require("../lib/operator");

let seq = 0;
function parent(label) {
  seq += 1;
  return store.createUser(`${label}${seq}@example.com`, `${label} ${seq}`);
}

function setupFamily(label = "Operator") {
  const adult = parent(`${label} Parent`);
  const fam = family.createFamily(adult.id, `${label} Family`);
  return { adult, fam };
}

test("actorFromMessage preserves kid identity separately from the authenticated device user", () => {
  assert.deepEqual(operator.actorFromMessage({
    senderType: "kid",
    senderId: "k_child",
    postedByUserId: "u_device",
  }, "Alex"), {
    type: "kid",
    principalId: "k_child",
    kidId: "k_child",
    userId: "u_device",
    name: "Alex",
  });
  assert.deepEqual(operator.actorFromMessage({
    senderType: "parent",
    senderId: "u_parent",
    postedByUserId: "u_parent",
  }, "Pat"), {
    type: "parent",
    principalId: "u_parent",
    userId: "u_parent",
    kidId: null,
    name: "Pat",
  });
});

test("purpose-scoped context uses immutable subjects without leaking unrelated family fields", () => {
  const { adult, fam } = setupFamily("Context");
  const kidResult = family.addKid(fam.id, adult.id, {
    name: "Jamie",
    grade: "7",
    allergies: ["peanuts"],
    portion: "small",
  });
  assert.ok(kidResult.kid);

  const context = operator.contextForFamily(fam.id, {
    actor: { type: "parent", userId: adult.id },
    purpose: "trip-research",
    roomId: "family",
    sections: ["members", "room"],
  });
  assert.equal(context.schemaVersion, "fametc.family-context.v1");
  assert.equal(context.household.localFamilyId, fam.id);
  assert.match(context.actor.subject, /^subj_/);
  assert.equal(context.purpose, "trip-research");
  assert.deepEqual(context.disclosure.grantedSections, ["identities", "room"]);
  const kidIdentity = context.sections.identities.members.find((member) => member.role === "kid");
  assert.equal(kidIdentity.kidId, kidResult.kid.id);
  assert.equal(kidIdentity.displayName, "Jamie");
  const serialized = JSON.stringify(context);
  assert.equal(serialized.includes("peanuts"), false);
  assert.equal(serialized.includes(fam.inviteCode), false);
  assert.equal(serialized.includes(adult.id), false);
  assert.equal(context.authority.writesAllowedByContext, false);
});

test("actor validation denies outsiders and preserves kid-scoped authority on shared devices", () => {
  const { adult, fam } = setupFamily("Actor");
  const outsider = parent("Outsider");
  const { kid } = family.addKid(fam.id, adult.id, { name: "Riley" });

  assert.throws(
    () => operator.validateActor(fam, { type: "parent", userId: outsider.id }),
    (error) => error.code === "OPERATOR_POLICY_DENIED",
  );

  const sharedDeviceKid = operator.validateActor(fam, {
    type: "kid",
    kidId: kid.id,
    principalId: kid.id,
    userId: adult.id,
  });
  assert.equal(sharedDeviceKid.type, "kid");
  assert.equal(sharedDeviceKid.principalId, kid.id);
  assert.equal(sharedDeviceKid.userId, adult.id);
});

test("case state machine blocks unsafe jumps before execution", (t) => {
  try {
    require("better-sqlite3");
  } catch (error) {
    t.skip("better-sqlite3 is optional on this host");
    return;
  }
  const { adult, fam } = setupFamily("Transition");
  const created = operator.createCase(fam.id, {
    actor: { type: "parent", userId: adult.id },
    title: "Book the family tour",
    goal: "Find a good time and prepare the booking.",
    roomId: "family",
    purpose: "tour-booking",
  });
  assert.equal(created.state, "draft");
  assert.equal(created.context.schemaVersion, "fametc.family-context.v1");

  assert.throws(
    () => operator.transitionCase(fam.id, created.id, "executing", {
      actor: { type: "agent", principalId: "hermes", userId: "hermes" },
    }),
    (error) => error.code === "OPERATOR_INVALID_TRANSITION",
  );

  const planning = operator.transitionCase(fam.id, created.id, "planning", {
    actor: { type: "agent", principalId: "hermes", userId: "hermes" },
  });
  assert.equal(planning.state, "planning");
  const researching = operator.transitionCase(fam.id, created.id, "researching", {
    actor: { type: "agent", principalId: "hermes", userId: "hermes" },
  });
  assert.equal(researching.state, "researching");
});

test("kid case access is limited to the initiating kid while parents retain family oversight", (t) => {
  try {
    require("better-sqlite3");
  } catch (error) {
    t.skip("better-sqlite3 is optional on this host");
    return;
  }
  const { adult, fam } = setupFamily("CaseAuthority");
  const firstKid = family.addKid(fam.id, adult.id, { name: "First" }).kid;
  const sibling = family.addKid(fam.id, adult.id, { name: "Sibling" }).kid;
  const firstActor = { type: "kid", kidId: firstKid.id, principalId: firstKid.id, userId: adult.id };
  const siblingActor = { type: "kid", kidId: sibling.id, principalId: sibling.id, userId: adult.id };
  const parentActor = { type: "parent", userId: adult.id, principalId: adult.id };
  const created = operator.createCase(fam.id, {
    actor: firstActor,
    roomId: "family",
    title: "First kid task",
    goal: "Keep this task scoped to its initiating kid.",
  });
  for (let index = 0; index < 55; index += 1) {
    operator.createCase(fam.id, {
      actor: siblingActor,
      roomId: "family",
      title: `Sibling task ${index}`,
      goal: "Exercise visibility-before-limit ordering.",
    });
  }

  assert.equal(operator.getCase(fam.id, created.id, { actor: siblingActor, roomId: "family" }), null);
  assert.equal(operator.listCases(fam.id, { actor: siblingActor, roomId: "family" }).length, 50);
  assert.equal(operator.transitionCase(fam.id, created.id, "planning", {
    actor: siblingActor, roomId: "family",
  }), null);
  assert.equal(operator.getCase(fam.id, created.id, { actor: parentActor, roomId: "family" }).id, created.id);
  assert.deepEqual(operator.listCases(fam.id, { actor: firstActor, roomId: "family" }).map((item) => item.id), [created.id]);
});

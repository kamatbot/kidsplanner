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

test("purpose-scoped context returns identities without leaking unrelated family fields", () => {
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
  assert.equal(context.schemaVersion, 1);
  assert.equal(context.family.id, fam.id);
  assert.equal(context.actor.userId, adult.id);
  assert.equal(context.purpose, "trip-research");
  assert.deepEqual(context.members.kids, [{ type: "kid", kidId: kidResult.kid.id, name: "Jamie" }]);
  assert.equal(JSON.stringify(context).includes("peanuts"), false);
  assert.equal(JSON.stringify(context).includes('"grade":"7"'), false);
  assert.equal(JSON.stringify(context).includes(fam.inviteCode), false);
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

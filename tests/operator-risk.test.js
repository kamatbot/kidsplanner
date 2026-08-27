"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const risk = require("../lib/operator-risk");
const execution = require("../lib/operator-execution");

test("risk registry is deterministic for every closeout action", () => {
  const expected = {
    "calendar.create": ["low", "single-parent", false],
    "action.create": ["low", "single-parent", false],
    "trip.itinerary.update": ["low", "single-parent", false],
    "email.draft": ["low", "single-parent", false],
    "email.send": ["medium", "single-parent", false],
    "subscription.cancel": ["medium", "single-parent", false],
    "booking.create": ["high", "single-parent", false],
    "payment.create": ["high", "dual-parent", true],
    "medical.attest": ["critical", "prohibited", false],
    "legal.attest": ["critical", "prohibited", false],
  };
  for (const [actionType, [level, approval, dual]] of Object.entries(expected)) {
    const policy = risk.getPolicy(actionType);
    assert.equal(policy.riskLevel, level);
    assert.equal(policy.approvalPolicy, approval);
    assert.equal(policy.dualParent, dual);
  }
});

test("kids may propose only the explicit low-risk family actions", () => {
  assert.equal(risk.evaluate("calendar.create", "kid").allowed, true);
  assert.equal(risk.evaluate("action.create", "kid").allowed, true);
  assert.equal(risk.evaluate("email.send", "kid").allowed, false);
  assert.equal(risk.evaluate("booking.create", "kid").allowed, false);
});

test("unregistered and attestation actions fail closed", () => {
  assert.equal(risk.evaluate("shell.exec", "parent").allowed, false);
  assert.equal(risk.evaluate("medical.attest", "parent").allowed, false);
  assert.throws(() => risk.requireProposalAllowed("legal.attest", "parent"), /not allowed/);
});

test("payment requires dual-parent flow and is not executable by the single-parent engine", () => {
  const policy = risk.requireProposalAllowed("payment.create", "parent");
  assert.equal(policy.dualParent, true);
  assert.throws(() => risk.requireExecutable("payment.create"), (error) => error.code === "OPERATOR_DUAL_PARENT_REQUIRED");
});

test("every enabled execution driver is explicitly executable in the risk registry", () => {
  for (const actionType of execution.supportedActionTypes()) {
    const policy = risk.requireExecutable(actionType);
    assert.equal(policy.executable, true);
    assert.notEqual(policy.approvalPolicy, "prohibited");
    assert.equal(policy.dualParent, false);
  }
});

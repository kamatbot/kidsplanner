"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function source(file) {
  return fs.readFileSync(path.join(__dirname, "..", file), "utf8");
}

test("Hermes production execution tools route through the M5 beta facade", () => {
  const mcp = source("lib/hermes-mcp.js");
  assert.match(mcp, /require\("\.\/operator-live-execution"\)/);
  assert.doesNotMatch(mcp, /require\("\.\/operator-execution"\)/);

  const facade = source("lib/operator-live-execution.js");
  assert.match(facade, /beta\.preflightClaim\(/);
  assert.match(facade, /beta\.reserveExecutionToken\(/);
  assert.match(facade, /base\.claimExecution\(/);
  assert.match(facade, /base\.runExecution\(/);
  assert.match(facade, /beta\.completeReservation\(/);
});

test("M5 launch allowlist stays limited to reversible low-risk FamETC-native actions", () => {
  const beta = require("../lib/operator-beta");
  const risk = require("../lib/operator-risk");
  assert.deepEqual(beta.LAUNCH_ACTION_TYPES, [
    "calendar.create",
    "calendar.update",
    "action.create",
    "action.update",
    "trip.itinerary.update",
  ]);
  for (const actionType of beta.LAUNCH_ACTION_TYPES) {
    const policy = risk.getPolicy(actionType);
    assert.ok(policy, `${actionType} must be registered`);
    assert.equal(policy.riskLevel, "low", `${actionType} must remain low risk`);
    assert.equal(policy.executable, true, `${actionType} must have an allowlisted execution driver`);
  }
  for (const forbidden of ["email.send", "subscription.cancel", "booking.create", "payment.create", "medical.attest", "legal.attest"]) {
    assert.equal(beta.LAUNCH_ACTION_TYPES.includes(forbidden), false);
  }
});
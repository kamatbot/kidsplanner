"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validTimeZone, hasActiveGrant } = require("../lib/routes/pathodds");

test("PathOdds integration accepts IANA time zones and rejects arbitrary strings", () => {
  assert.equal(validTimeZone("Asia/Bangkok"), "Asia/Bangkok");
  assert.equal(validTimeZone("America/New_York"), "America/New_York");
  assert.equal(validTimeZone("not-a-zone"), null);
  assert.equal(validTimeZone(""), null);
});

test("PathOdds read and launch access require an active FamETC grant", () => {
  assert.equal(hasActiveGrant(null), false);
  assert.equal(hasActiveGrant({ status: "revoked" }), false);
  assert.equal(hasActiveGrant({ status: "active" }), true);
});

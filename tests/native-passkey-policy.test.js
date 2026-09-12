"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("all native passkey flows use the required-verification request factory", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../ios/FamETC/Onboarding/AuthService.swift"),
    "utf8"
  );

  assert.equal(
    (source.match(/PasskeyRequestFactory\.registration\(/g) || []).length,
    2,
    "parent and kid registration must both use the shared policy"
  );
  assert.equal(
    (source.match(/PasskeyRequestFactory\.assertion\(/g) || []).length,
    1,
    "parent sign-in must use the shared policy"
  );
  assert.equal(
    (source.match(/createCredentialRegistrationRequest\(/g) || []).length,
    1,
    "native registration requests must only be constructed inside the factory"
  );
  assert.equal(
    (source.match(/createCredentialAssertionRequest\(/g) || []).length,
    1,
    "native assertion requests must only be constructed inside the factory"
  );
  assert.equal(
    (source.match(/userVerificationPreference = \.required/g) || []).length,
    2,
    "both registration and assertion factory methods must require verification"
  );
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validTimeZone } = require("../lib/routes/pathodds");

test("PathOdds integration accepts IANA time zones and rejects arbitrary strings", () => {
  assert.equal(validTimeZone("Asia/Bangkok"), "Asia/Bangkok");
  assert.equal(validTimeZone("America/New_York"), "America/New_York");
  assert.equal(validTimeZone("not-a-zone"), null);
  assert.equal(validTimeZone(""), null);
});

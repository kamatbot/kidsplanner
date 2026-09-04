"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const script = fs.readFileSync(path.join(__dirname, "../scripts/pack-deploy.sh"), "utf8");

test("web deployment archive excludes native iOS sources in every format", () => {
  const exclusions = script.match(/git ls-files[^\n]*':\(exclude\)ios\/\*\*'/g) || [];
  assert.equal(exclusions.length, 2, "zip and tar packaging must both exclude ios/**");
});

test("web deployment archive excludes local design-tool configuration", () => {
  const exclusions = script.match(/git ls-files[^\n]*':\(exclude\)\.impeccable\/\*\*'/g) || [];
  assert.equal(exclusions.length, 2, "zip and tar packaging must both exclude .impeccable/**");
});

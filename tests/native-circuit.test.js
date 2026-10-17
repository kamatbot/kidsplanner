"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// Execute the production pure Swift rules on the host, with no app build,
// simulator, runtime installation or device creation.
test("native circuit rules and visual model compatibility execute on the host", { skip: process.platform !== "darwin" }, () => {
  const scratch = fs.mkdtempSync(path.join(__dirname, "../.dev-data/circuit-host-"));
  const binary = path.join(scratch, "circuit-check");
  const source = path.join(__dirname, "../ios/FamETC/Domain/CircuitTrail.swift");
  const checks = path.join(__dirname, "fixtures/native-circuit-check.swift");
  const models = path.join(__dirname, "../ios/FamETC/Networking/Models.swift");
  execFileSync("/usr/bin/swiftc", [source, models, checks, "-o", binary], { encoding: "utf8", timeout: 60000 });
  assert.match(execFileSync(binary, { encoding: "utf8", timeout: 10000 }), /64 boards verified/);
});

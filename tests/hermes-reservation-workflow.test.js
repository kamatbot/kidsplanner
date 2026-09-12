"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

test("reservation workflow's focused Python contract suite passes", (t) => {
  const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    t.skip("python3 is not installed on this test host");
    return;
  }
  const result = spawnSync("python3", ["-m", "unittest", "discover", "-s", "tests", "-p", "test_reservation_workflow.py"], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

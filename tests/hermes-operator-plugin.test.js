"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const pluginDir = path.join(root, "integrations", "hermes", "fametc");

function read(name) {
  return fs.readFileSync(path.join(pluginDir, name), "utf8");
}

test("FamETC Hermes plugin loads the Operator-aware adapter", () => {
  const init = read("__init__.py");
  const operatorAdapter = read("operator_adapter.py");
  assert.match(init, /from \.operator_adapter import register/);
  assert.match(operatorAdapter, /class OperatorFamETCAdapter\(FamETCAdapter\)/);
  assert.match(operatorAdapter, /channel_prompt=_operator_channel_prompt\(message\)/);
});

test("actor capability is ephemeral model context, not raw diagnostic metadata", () => {
  const source = read("operator_adapter.py");
  assert.match(source, /actorToken/);
  assert.match(source, /Treat the actorToken as a short-lived secret/);

  const rawBlock = source.match(/raw_message=\{([\s\S]*?)\},\n\s*timestamp=/);
  assert.ok(rawBlock, "raw_message block should remain explicit and reviewable");
  assert.equal(rawBlock[1].includes("actorToken"), false);
  assert.match(rawBlock[1], /actorType/);
});

test("Hermes plugin Python sources compile", (t) => {
  const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    t.skip("python3 is not installed on this test host");
    return;
  }
  for (const name of ["adapter.py", "operator_adapter.py", "__init__.py"]) {
    const result = spawnSync("python3", ["-m", "py_compile", path.join(pluginDir, name)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${name} failed py_compile: ${result.stderr || result.stdout}`);
  }
});

test("Hermes setup docs configure the remote MCP endpoint without duplicating a literal bearer", () => {
  const readme = read("README.md");
  assert.match(readme, /mcp_servers:\n\s+fametc_operator:/);
  assert.match(readme, /url: "\$\{FAMETC_HERMES_API_URL\}\/mcp"/);
  assert.match(readme, /Authorization: "Bearer \$\{FAMETC_HERMES_TOKEN\}"/);
  assert.match(readme, /fametc_approvals_request/);
});

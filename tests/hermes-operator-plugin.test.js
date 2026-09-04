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

function readActionSkill() {
  return fs.readFileSync(path.join(pluginDir, "skills", "action-capability", "SKILL.md"), "utf8");
}

test("FamETC Hermes plugin loads the Operator-aware adapter", () => {
  const init = read("__init__.py");
  const operatorAdapter = read("operator_adapter.py");
  assert.match(init, /from \.operator_adapter import register/);
  assert.match(operatorAdapter, /class OperatorFamETCAdapter\(FamETCAdapter\)/);
  assert.match(operatorAdapter, /channel_prompt=_operator_channel_prompt\(message\)/);
  assert.match(operatorAdapter, /channel_context=channel_context/);
  assert.match(operatorAdapter, /await self\._family_channel_context\(room\)/);
  assert.match(operatorAdapter, /ctx\.register_skill\(/);
  assert.match(operatorAdapter, /fametc-platform:action-capability/);
});

test("Action Capability routes existing paths before browser bootstrap", () => {
  const skill = readActionSkill();
  const routes = [
    "Official connector/API",
    "Agent-friendly MCP/API",
    "Learned web/API workflow",
    "Browser/computer use",
  ];
  const positions = routes.map((route) => skill.indexOf(route));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(skill, /skill_view/);
  assert.match(skill, /har-derived-api-client/);
  assert.match(skill, /skill_manage/);
});

test("Action Capability prototype is read-only and never persists captured authority", () => {
  const skill = readActionSkill();
  assert.match(skill, /read-only lookup\s+of an existing reservation/);
  assert.match(skill, /Do not buy tickets, reorder products, move seats/);
  assert.match(skill, /Delete the raw HAR/);
  assert.match(skill, /Never put cookies, authorization headers, confirmation codes/);
  assert.match(skill, /capability\.workflow\.learned/);
  assert.match(skill, /capability\.workflow\.reused/);
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

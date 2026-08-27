"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-hermes-mcp-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const store = require("../lib/store");
const family = require("../lib/family");
const hermes = require("../lib/hermes");
const actorCapabilities = require("../lib/operator-capabilities");
const hermesMcp = require("../lib/hermes-mcp");

let counter = 0;
function familyFixture(label = "MCP") {
  counter += 1;
  const parent = store.createUser(`${label}${counter}@example.com`, `${label} Parent ${counter}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const connected = hermes.connectFamily(fam.id);
  assert.ok(connected.token);
  const auth = hermes.familyForToken(connected.token);
  assert.ok(auth);
  return { parent, fam, token: connected.token, auth };
}

function invokeMcp(auth, body, headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const req = {
    body,
    headers: normalized,
    get(name) { return normalized[String(name).toLowerCase()]; },
  };
  const res = {
    statusCode: 200,
    body: null,
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
  hermesMcp.handle(req, res, auth);
  return res;
}

function modernHeaders(method, name) {
  const headers = {
    "MCP-Protocol-Version": hermesMcp.MODERN_VERSION,
    "Mcp-Method": method,
  };
  if (name) headers["Mcp-Name"] = name;
  return headers;
}

function actorToken(fixture, overrides = {}) {
  return actorCapabilities.issue({
    family: fixture.auth.family,
    connection: fixture.auth.connection,
    actor: { type: "parent", userId: fixture.parent.id, principalId: fixture.parent.id },
    messageId: overrides.messageId || "m_test",
    roomId: overrides.roomId || "family",
    ttlMs: overrides.ttlMs,
  });
}

test("Hermes MCP advertises modern stateless tools and legacy initialize compatibility", () => {
  const fixture = familyFixture("Discover");
  const discover = invokeMcp(fixture.auth, {
    jsonrpc: "2.0",
    id: 1,
    method: "server/discover",
    params: {},
  });
  assert.equal(discover.statusCode, 200);
  assert.deepEqual(discover.body.result.supportedVersions, ["2026-07-28"]);
  assert.ok(discover.body.result.capabilities.tools);
  assert.equal(discover.body.result.cacheScope, "private");

  const list = invokeMcp(fixture.auth, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } },
  }, modernHeaders("tools/list"));
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.body.result.tools.map((tool) => tool.name), [
    "fametc_context_get",
    "fametc_cases_create",
    "fametc_cases_get",
    "fametc_cases_list",
    "fametc_cases_transition",
    "fametc_cases_add_step",
    "fametc_approvals_request",
  ]);
  assert.equal(list.body.result.ttlMs, 60000);
  assert.equal(list.body.result.cacheScope, "private");
  assert.equal(list.body.result._meta["io.modelcontextprotocol/serverInfo"].name, "fametc-family-operator");

  const legacy = invokeMcp(fixture.auth, {
    jsonrpc: "2.0",
    id: 3,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "hermes", version: "test" } },
  });
  assert.equal(legacy.body.result.protocolVersion, "2025-11-25");
  assert.equal(legacy.body.result.serverInfo.name, "fametc-family-operator");
});

test("modern MCP rejects routing header/body mismatches", () => {
  const fixture = familyFixture("Headers");
  const response = invokeMcp(fixture.auth, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } },
  }, modernHeaders("tools/call"));
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, -32020);
});

test("actor capabilities preserve the initiating human and die when Hermes connection rotates", () => {
  const fixture = familyFixture("Capability");
  const token = actorToken(fixture);
  const verified = actorCapabilities.verify({
    family: fixture.auth.family,
    connection: fixture.auth.connection,
    token,
  });
  assert.equal(verified.actor.type, "parent");
  assert.equal(verified.actor.userId, fixture.parent.id);
  assert.equal(verified.roomId, "family");

  const rotated = hermes.connectFamily(fixture.fam.id);
  const rotatedAuth = hermes.familyForToken(rotated.token);
  assert.throws(
    () => actorCapabilities.verify({ family: rotatedAuth.family, connection: rotatedAuth.connection, token }),
    (error) => error.code === "ACTOR_CAPABILITY_INVALID",
  );
});

test("context tool requires a signed actor token and never accepts a family id from arguments", () => {
  const fixture = familyFixture("ContextTool");
  const { kid } = family.addKid(fixture.fam.id, fixture.parent.id, {
    name: "Taylor",
    grade: "8",
    allergies: ["tree nuts"],
  });
  const name = "fametc_context_get";
  const response = invokeMcp(fixture.auth, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name,
      arguments: {
        actorToken: actorToken(fixture),
        purpose: "trip-planning",
        sections: ["members", "room"],
        familyId: "f_attacker_supplied",
      },
      _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
    },
  }, modernHeaders("tools/call", name));
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.result.isError, false);
  assert.equal(response.body.result.structuredContent.family.id, fixture.fam.id);
  assert.deepEqual(response.body.result.structuredContent.members.kids, [{ type: "kid", kidId: kid.id, name: "Taylor" }]);
  assert.equal(JSON.stringify(response.body.result.structuredContent).includes("tree nuts"), false);

  const missing = invokeMcp(fixture.auth, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: {} },
  });
  assert.equal(missing.body.result.isError, true);
  assert.match(missing.body.result.content[0].text, /actorToken is required/);
});

test("MCP creates a family-scoped durable case from the actor capability", (t) => {
  try {
    require("better-sqlite3");
  } catch (error) {
    t.skip("better-sqlite3 is optional on this host");
    return;
  }
  const fixture = familyFixture("CaseTool");
  const createName = "fametc_cases_create";
  const created = invokeMcp(fixture.auth, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: createName,
      arguments: {
        actorToken: actorToken(fixture),
        title: "Arrange the family tour",
        goal: "Research options and prepare a booking for parent approval.",
        purpose: "tour-booking",
        riskLevel: "medium",
      },
    },
  });
  assert.equal(created.body.result.isError, false);
  const caseData = created.body.result.structuredContent;
  assert.equal(caseData.familyId, fixture.fam.id);
  assert.equal(caseData.actorId, fixture.parent.id);
  assert.equal(caseData.state, "draft");

  const transitionName = "fametc_cases_transition";
  const impossible = invokeMcp(fixture.auth, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: transitionName, arguments: { caseId: caseData.id, state: "executing" } },
  });
  assert.equal(impossible.body.result.isError, true);
  assert.match(impossible.body.result.content[0].text, /OPERATOR_INVALID_TRANSITION/);

  const planning = invokeMcp(fixture.auth, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: transitionName, arguments: { caseId: caseData.id, state: "planning" } },
  });
  assert.equal(planning.body.result.isError, false);
  assert.equal(planning.body.result.structuredContent.state, "planning");
});

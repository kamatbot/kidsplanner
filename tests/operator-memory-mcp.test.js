"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-memory-mcp-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const store = require("../lib/store");
const family = require("../lib/family");
const hermes = require("../lib/hermes");
const actorCapabilities = require("../lib/operator-capabilities");
const memory = require("../lib/operator-memory");
const hermesMcp = require("../lib/hermes-mcp");

function invoke(auth, name, args) {
  const req = { body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, headers: {}, get() { return ""; } };
  const res = { statusCode: 200, body: null, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
  hermesMcp.handle(req, res, auth);
  return res.body.result;
}

test("Hermes can propose but cannot activate Family Memory through MCP", (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 unavailable"); return; }
  const parent = store.createUser("memory-mcp@example.com", "Memory MCP Parent");
  const fam = family.createFamily(parent.id, "Memory MCP Family");
  const connected = hermes.connectFamily(fam.id);
  const auth = hermes.familyForToken(connected.token);
  const actorToken = actorCapabilities.issue({
    family: auth.family,
    connection: auth.connection,
    actor: { type: "parent", userId: parent.id, principalId: parent.id },
    messageId: "m_memory_mcp",
    roomId: "family",
  });

  const proposed = invoke(auth, "fametc_memory_propose", {
    actorToken,
    scope: "household",
    key: "travel-pace",
    kind: "preference",
    value: "one major activity per day",
    confidence: 0.9,
    sensitivity: "personal-preferences",
    provenance: { productId: "fametc", sourceType: "conversation", sourceRef: "m_memory_mcp" },
  });
  assert.equal(proposed.isError, false);
  assert.equal(proposed.structuredContent.state, "pending");

  const listBefore = invoke(auth, "fametc_memory_list", { actorToken });
  assert.equal(listBefore.isError, false);
  assert.deepEqual(listBefore.structuredContent.memories, []);

  memory.decide(fam.id, proposed.structuredContent.id, { type: "parent", userId: parent.id, principalId: parent.id }, "approve");
  const listAfter = invoke(auth, "fametc_memory_list", { actorToken });
  assert.equal(listAfter.structuredContent.memories.length, 1);
  assert.equal(listAfter.structuredContent.memories[0].key, "travel-pace");
  assert.equal(hermesMcp.TOOL_DEFINITIONS.some((tool) => /memory.*approve|approve.*memory/i.test(tool.name)), false);
});

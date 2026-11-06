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
  const req = { body, headers: normalized, get(name) { return normalized[String(name).toLowerCase()]; } };
  const res = { statusCode: 200, body: null, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, end() { return this; } };
  hermesMcp.handle(req, res, auth);
  return res;
}

function modernHeaders(method, name) {
  const headers = { "MCP-Protocol-Version": hermesMcp.MODERN_VERSION, "Mcp-Method": method };
  if (name) headers["Mcp-Name"] = name;
  return headers;
}

function actorToken(fixture, overrides = {}) {
  return actorCapabilities.issue({ family: fixture.auth.family, connection: fixture.auth.connection, actor: overrides.actor || { type: "parent", userId: fixture.parent.id, principalId: fixture.parent.id }, messageId: overrides.messageId || "m_test", roomId: overrides.roomId || "family", ttlMs: overrides.ttlMs });
}

test("Hermes MCP advertises modern stateless tools, Family Memory, case attachments, canonical context sections and legacy initialize compatibility", () => {
  const fixture = familyFixture("Discover");
  const discover = invokeMcp(fixture.auth, { jsonrpc: "2.0", id: 1, method: "server/discover", params: {} });
  assert.equal(discover.statusCode, 200);
  assert.deepEqual(discover.body.result.supportedVersions, ["2026-07-28"]);
  assert.ok(discover.body.result.capabilities.tools);
  assert.equal(discover.body.result.cacheScope, "private");

  const list = invokeMcp(fixture.auth, { jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } }, modernHeaders("tools/list"));
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.body.result.tools.map((tool) => tool.name), [
    "fametc_context_get",
    "fametc_memory_list",
    "fametc_memory_propose",
    "fametc_attachments_list",
    "fametc_attachments_get_text",
    "fametc_family_write",
    "fametc_cases_create",
    "fametc_cases_get",
    "fametc_cases_list",
    "fametc_cases_transition",
    "fametc_cases_add_step",
    "fametc_approvals_request",
    "fametc_execution_claim",
    "fametc_execution_run",
  ]);
  assert.equal(list.body.result.tools.some((tool) => tool.name === "fametc_approvals_decide"), false);
  for (const tool of list.body.result.tools) assert.ok(tool.inputSchema.required.includes("actorToken"), `${tool.name} must require actorToken`);
  const contextTool = list.body.result.tools.find((tool) => tool.name === "fametc_context_get");
  const contextSections = contextTool.inputSchema.properties.sections.items.enum;
  for (const section of ["identities", "preferences", "calendar", "homework", "actions", "meals", "trips", "room", "members"]) assert.ok(contextSections.includes(section), `context schema should advertise ${section}`);
  // The model must not guess action names (it once sent calendar.event.create and was refused).
  const approvalTool = list.body.result.tools.find((tool) => tool.name === "fametc_approvals_request");
  assert.deepEqual(approvalTool.inputSchema.properties.actionType.enum, ["calendar.create", "calendar.update", "action.create", "action.update", "trip.itinerary.update"]);
  assert.match(approvalTool.description, /calendar\.create \{title, date YYYY-MM-DD/);
  assert.equal(list.body.result.ttlMs, 60000);
  assert.equal(list.body.result.cacheScope, "private");
  assert.equal(list.body.result._meta["io.modelcontextprotocol/serverInfo"].name, "fametc-family-operator");

  const legacy = invokeMcp(fixture.auth, { jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "hermes", version: "test" } } });
  assert.equal(legacy.body.result.protocolVersion, "2025-11-25");
  assert.equal(legacy.body.result.serverInfo.name, "fametc-family-operator");
});

test("modern MCP rejects routing header/body mismatches", () => {
  const fixture = familyFixture("Headers");
  const response = invokeMcp(fixture.auth, { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } }, modernHeaders("tools/call"));
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, -32020);
});

test("actor capabilities preserve the initiating human and die when Hermes connection rotates", () => {
  const fixture = familyFixture("Capability");
  const token = actorToken(fixture);
  const verified = actorCapabilities.verify({ family: fixture.auth.family, connection: fixture.auth.connection, token });
  assert.equal(verified.actor.type, "parent");
  assert.equal(verified.actor.userId, fixture.parent.id);
  assert.equal(verified.roomId, "family");
  const rotated = hermes.connectFamily(fixture.fam.id);
  const rotatedAuth = hermes.familyForToken(rotated.token);
  assert.throws(() => actorCapabilities.verify({ family: rotatedAuth.family, connection: rotatedAuth.connection, token }), (error) => error.code === "ACTOR_CAPABILITY_INVALID");
});

test("a Hermes bearer holder cannot mint actor capabilities", () => {
  const fixture = familyFixture("CapabilityForgery");
  const valid = actorToken(fixture);
  const [, encoded] = valid.split(".");
  const bearerHash = crypto.createHash("sha256").update(fixture.token).digest();
  const forgedSignature = crypto.createHmac("sha256", bearerHash).update(`opact1.${encoded}`).digest("base64url");
  assert.throws(() => actorCapabilities.verify({ family: fixture.auth.family, connection: fixture.auth.connection, token: `opact1.${encoded}.${forgedSignature}` }), (error) => error.code === "ACTOR_CAPABILITY_INVALID");
});

test("context tool requires a signed actor token, returns Canonical Family Context v1, and never accepts family scope from arguments", () => {
  const fixture = familyFixture("ContextTool");
  const { kid } = family.addKid(fixture.fam.id, fixture.parent.id, { name: "Taylor", grade: "8", allergies: ["tree nuts"] });
  const name = "fametc_context_get";
  const response = invokeMcp(fixture.auth, {
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name, arguments: { actorToken: actorToken(fixture), purpose: "trip-planning", sections: ["members", "room"], familyId: "f_attacker_supplied" }, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } },
  }, modernHeaders("tools/call", name));
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.result.isError, false);
  const context = response.body.result.structuredContent;
  assert.equal(context.schemaVersion, "fametc.family-context.v1");
  assert.equal(context.household.localFamilyId, fixture.fam.id);
  assert.equal(context.identityInterop.oddsCoreCanonicalPersonIdExposed, false);
  const kidIdentity = context.sections.identities.members.find((member) => member.role === "kid");
  assert.equal(kidIdentity.kidId, kid.id);
  assert.equal(kidIdentity.displayName, "Taylor");
  const serialized = JSON.stringify(context);
  assert.equal(serialized.includes("tree nuts"), false);
  assert.equal(serialized.includes(fixture.parent.id), false);
  const missing = invokeMcp(fixture.auth, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: {} } });
  assert.equal(missing.body.result.isError, true);
  assert.match(missing.body.result.content[0].text, /actorToken is required/);
});

test("MCP creates a family-scoped durable case from the actor capability", (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 is optional on this host"); return; }
  const fixture = familyFixture("CaseTool");
  const createName = "fametc_cases_create";
  const created = invokeMcp(fixture.auth, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: createName, arguments: { actorToken: actorToken(fixture), title: "Arrange the family tour", goal: "Research options and prepare a booking for parent approval.", purpose: "tour-booking", riskLevel: "medium" } } });
  assert.equal(created.body.result.isError, false);
  const caseData = created.body.result.structuredContent;
  assert.equal(caseData.familyId, fixture.fam.id);
  assert.equal(caseData.actorId, fixture.parent.id);
  assert.equal(caseData.state, "draft");
  assert.equal(caseData.context.schemaVersion, "fametc.family-context.v1");
  // Case tools return a slim context summary, never the full family snapshot.
  assert.ok(Array.isArray(caseData.context.sections));
  assert.ok(JSON.stringify(caseData).length < 4000, "case payload must stay small");
  const transitionName = "fametc_cases_transition";
  const impossible = invokeMcp(fixture.auth, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: transitionName, arguments: { actorToken: actorToken(fixture), caseId: caseData.id, state: "executing" } } });
  assert.equal(impossible.body.result.isError, true);
  assert.match(impossible.body.result.content[0].text, /OPERATOR_INVALID_TRANSITION/);
  const planning = invokeMcp(fixture.auth, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: transitionName, arguments: { actorToken: actorToken(fixture), caseId: caseData.id, state: "planning" } } });
  assert.equal(planning.body.result.isError, false);
  assert.equal(planning.body.result.structuredContent.state, "planning");
  const bearerOnly = invokeMcp(fixture.auth, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: transitionName, arguments: { caseId: caseData.id, state: "researching" } } });
  assert.equal(bearerOnly.body.result.isError, true);
  assert.match(bearerOnly.body.result.content[0].text, /actorToken is required/);
});


test("a parent's request writes a calendar event directly, once, without beta enrollment or approval", (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 is optional on this host"); return; }
  const events = require("../lib/events");
  const fixture = familyFixture("DirectWrite");
  const token = actorToken(fixture, { messageId: "msg_direct_1" });
  const call = (args) => invokeMcp(fixture.auth, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fametc_family_write", arguments: args } });
  const action = { title: "Swim practice", date: "2026-11-10", time: "17:00" };
  const first = call({ actorToken: token, actionType: "calendar.create", action });
  assert.equal(first.body.result.isError, false, first.body.result.content[0].text);
  const created = first.body.result.structuredContent;
  assert.equal(created.actionType, "calendar.create");
  const saved = events.getById(fixture.fam.id, created.eventId);
  assert.equal(saved.title, "Swim practice");
  assert.equal(saved.time, "17:00");
  // The same message retried (or delivered twice) never duplicates the event.
  const again = call({ actorToken: token, actionType: "calendar.create", action });
  assert.equal(again.body.result.structuredContent.eventId, created.eventId);
  assert.equal(again.body.result.structuredContent.existing, true);
  // Update goes through the same fast path.
  const moved = call({ actorToken: token, actionType: "calendar.update", action: { eventId: created.eventId, patch: { time: "18:00" } } });
  assert.equal(moved.body.result.isError, false, moved.body.result.content[0].text);
  assert.equal(events.getById(fixture.fam.id, created.eventId).time, "18:00");
  // Invalid payloads and non-direct action types are refused.
  const bad = call({ actorToken: token, actionType: "calendar.create", action: { title: "No date" } });
  assert.equal(bad.body.result.isError, true);
  const trip = call({ actorToken: token, actionType: "trip.itinerary.update", action: {} });
  assert.equal(trip.body.result.isError, true);
});

test("a kid's request cannot use the direct write path", (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 is optional on this host"); return; }
  const fixture = familyFixture("DirectKid");
  const added = family.addKid(fixture.fam.id, fixture.parent.id, { name: "Kiddo" });
  const kidId = (family.getFamily(fixture.fam.id).kids || []).find((k) => k.name === "Kiddo").id;
  assert.ok(kidId, JSON.stringify(added));
  const token = actorToken(fixture, { actor: { type: "kid", kidId, principalId: `kid:${kidId}` } });
  const res = invokeMcp(fixture.auth, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fametc_family_write", arguments: { actorToken: token, actionType: "calendar.create", action: { title: "Party", date: "2026-11-10" } } } });
  assert.equal(res.body.result.isError, true);
});

test("short actor handle resolves to the signed token and writes like the full token", () => {
  const fixture = familyFixture("Handle");
  const token = actorToken(fixture, { messageId: "m_handle" });
  const handle = actorCapabilities.handleFor(token);
  assert.match(handle, /^opk1_[A-Za-z0-9_-]{20}$/);
  const verified = actorCapabilities.verify({ family: fixture.auth.family, connection: fixture.auth.connection, token: handle });
  assert.equal(verified.messageId, "m_handle");
  assert.equal(verified.actor.type, "parent");
  const res = invokeMcp(fixture.auth, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fametc_family_write", arguments: { actorToken: handle, actionType: "calendar.create", action: { title: "Test", date: "2026-11-07", time: "00:00" } } } });
  assert.equal(res.statusCode, 200);
  assert.notEqual(res.body.result.isError, true, JSON.stringify(res.body.result));
});

test("unknown or garbled actor handles fail as expired, never as another actor", () => {
  const fixture = familyFixture("HandleBad");
  const handle = actorCapabilities.handleFor(actorToken(fixture));
  const garbled = handle.slice(0, -1) + (handle.endsWith("A") ? "B" : "A");
  for (const bad of [garbled, "opk1_short"]) {
    assert.throws(() => actorCapabilities.verify({ family: fixture.auth.family, connection: fixture.auth.connection, token: bad }), (error) => error.code === "ACTOR_CAPABILITY_EXPIRED");
  }
  const other = familyFixture("HandleOther");
  assert.throws(() => actorCapabilities.verify({ family: other.auth.family, connection: other.auth.connection, token: handle }), (error) => error.code === "ACTOR_CAPABILITY_INVALID");
});

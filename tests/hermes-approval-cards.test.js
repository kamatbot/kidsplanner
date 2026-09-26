"use strict";

// Operator approvals delivered as Hermes-thread cards (docs/HERMES-THREADS-CONTRACT.md §7).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-hermes-approval-cards-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const store = require("../lib/store");
const family = require("../lib/family");
const chat = require("../lib/chat");
const hermes = require("../lib/hermes");
const actorCapabilities = require("../lib/operator-capabilities");
const operatorStore = require("../lib/operator-store");
const operatorExecution = require("../lib/operator-execution");
const hermesMcp = require("../lib/hermes-mcp");
const hermesThreads = require("../lib/hermes-threads");
const hermesRoutes = require("../lib/routes/hermes");

const pushes = [];
hermesThreads.setNotifier(async (payload) => { pushes.push(payload); });

function hasSqlite() {
  try { require("better-sqlite3"); return true; } catch (_) { return false; }
}

function mcp(auth, name, args) {
  const req = { body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } }, headers: {}, get() { return ""; } };
  const res = { statusCode: 200, body: null, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
  hermesMcp.handle(req, res, auth);
  return res.body.result;
}

let counter = 0;
function setup() {
  counter += 1;
  const mayur = store.createUser(`approval-mayur-${counter}@example.com`, "Mayur Kamat");
  const priya = store.createUser(`approval-priya-${counter}@example.com`, "Priya Kamat");
  const created = family.createFamily(mayur.id, `Approval Family ${counter}`);
  assert.ok(family.joinFamilyAsParent(created.inviteCode, priya.id).family);
  const { kid } = family.addKid(created.id, mayur.id, { name: "Taylor" });
  const fam = family.getFamily(created.id);
  const auth = hermes.familyForToken(hermes.connectFamily(fam.id).token);
  const actorToken = actorCapabilities.issue({ family: auth.family, connection: auth.connection, actor: { type: "parent", userId: mayur.id, principalId: mayur.id }, messageId: "m_request", roomId: "family" });
  return { mayur, priya, fam, kid, auth, actorToken };
}

function requestApproval(ctx, extra = {}) {
  const created = mcp(ctx.auth, "fametc_cases_create", { actorToken: ctx.actorToken, title: "Science fair", goal: "Put the science fair on the calendar.", purpose: "school", riskLevel: "low" });
  const caseId = created.structuredContent.id;
  for (const state of ["planning", "proposal_ready"]) assert.equal(mcp(ctx.auth, "fametc_cases_transition", { actorToken: ctx.actorToken, caseId, state }).isError, false);
  const requested = mcp(ctx.auth, "fametc_approvals_request", Object.assign({
    actorToken: ctx.actorToken, caseId, actionType: "calendar.create",
    action: { title: "Science fair", date: "2026-10-01", time: "16:00", endTime: "17:00", notes: "Bring the volcano model", category: "school", kidId: ctx.kid.id },
  }, extra));
  assert.equal(requested.isError, false, JSON.stringify(requested.structuredContent));
  return requested.structuredContent;
}

function approvalCard(userId, approvalId) {
  return chat.listMessages(hermesThreads.scopeFor(userId)).find((m) => m.card && m.card.id === `approval:${approvalId}`) || null;
}
function press(ctx, user, message, actionId) {
  return hermesThreads.applyAction({ fam: family.getFamily(ctx.fam.id), member: hermesThreads.memberFor(family.getFamily(ctx.fam.id), user.id), messageId: message.id, actionId });
}

test("an approval request reaches every parent's Hermes thread with the exact proposal", async (t) => {
  if (!hasSqlite()) return t.skip("better-sqlite3 is optional on this host");
  const ctx = setup();
  pushes.length = 0;
  const approval = requestApproval(ctx);
  for (const parent of [ctx.mayur, ctx.priya]) {
    const card = approvalCard(parent.id, approval.id);
    assert.ok(card, "each parent gets the card");
    assert.equal(card.senderType, "agent");
    assert.equal(card.text, "Hermes needs your OK to add “Science fair” to the calendar.");
    assert.deepEqual(card.card.lines, ["When · Thu, Oct 1 · 16:00–17:00", "For · Taylor", "Notes · Bring the volcano model"]);
    assert.deepEqual(card.card.actions.map((a) => [a.id, a.style]), [["approve", "primary"], ["reject", "secondary"]]);
    assert.equal(card.card.data.actionHash, approval.actionHash);
  }
  await new Promise((resolve) => setImmediate(resolve)); // pushes go out after the post returns
  assert.deepEqual(pushes.map((p) => p.userId).sort(), [ctx.mayur.id, ctx.priya.id].sort());

  const routed = requestApproval(ctx, { approverUserId: ctx.priya.id });
  assert.ok(approvalCard(ctx.priya.id, routed.id));
  assert.equal(approvalCard(ctx.mayur.id, routed.id), null, "a named approver is the only one asked");
});

test("Approve on the card runs the real decision path and settles the other parent's card", (t) => {
  if (!hasSqlite()) return t.skip("better-sqlite3 is optional on this host");
  const ctx = setup();
  const approval = requestApproval(ctx);
  const out = press(ctx, ctx.mayur, approvalCard(ctx.mayur.id, approval.id), "approve");
  assert.equal(out.message.card.state.status, "done");
  assert.match(out.message.card.state.label, /^Approved/);
  assert.equal(operatorExecution.getApprovalForParent(ctx.fam.id, ctx.mayur.id, approval.id).state, "approved");
  assert.notEqual(operatorStore.getCase(ctx.fam.id, approval.caseId).state, "waiting_for_approval");
  const other = approvalCard(ctx.priya.id, approval.id);
  assert.deepEqual([other.card.state.status, other.card.state.label], ["done", "Approved by Mayur"]);
  // A second tap is harmless.
  assert.equal(press(ctx, ctx.mayur, out.message, "approve").alreadyDone, true);
});

test("Reject settles both cards; a stale or expired card explains itself instead of failing", (t) => {
  if (!hasSqlite()) return t.skip("better-sqlite3 is optional on this host");
  const ctx = setup();
  const rejected = requestApproval(ctx);
  assert.equal(press(ctx, ctx.priya, approvalCard(ctx.priya.id, rejected.id), "reject").message.card.state.label, "Rejected");
  assert.equal(operatorExecution.getApprovalForParent(ctx.fam.id, ctx.priya.id, rejected.id).state, "rejected");
  assert.equal(approvalCard(ctx.mayur.id, rejected.id).card.state.label, "Rejected by Priya");

  // Decided elsewhere without touching the cards: the stale tap says so.
  const stale = requestApproval(ctx);
  operatorExecution.decideApproval(ctx.fam.id, stale.id, { actor: { type: "parent", userId: ctx.priya.id, principalId: ctx.priya.id }, decision: "reject", actionHash: stale.actionHash });
  const staleTap = press(ctx, ctx.mayur, approvalCard(ctx.mayur.id, stale.id), "approve");
  assert.deepEqual([staleTap.message.card.state.status, staleTap.message.card.state.label], ["dismissed", "Already decided"]);

  const expired = requestApproval(ctx, { expiresAt: new Date(Date.now() - 60000).toISOString() });
  const expiredTap = press(ctx, ctx.mayur, approvalCard(ctx.mayur.id, expired.id), "approve");
  assert.deepEqual([expiredTap.message.card.state.status, expiredTap.message.card.state.label], ["dismissed", "This approval expired"]);
});

test("deciding on web Today settles the Hermes-thread cards too", async (t) => {
  if (!hasSqlite()) return t.skip("better-sqlite3 is optional on this host");
  const ctx = setup();
  const approval = requestApproval(ctx);
  const routes = {};
  const register = (method) => (pattern, ...handlers) => { routes[`${method} ${pattern}`] = handlers; };
  hermesRoutes({ get: register("GET"), post: register("POST"), delete: register("DELETE") }, {
    hermes, family, chat, store,
    notifications: { notifyChatMessage: async () => {}, notifyTripChatMessage: async () => {}, notifyHermesThread: async () => {} },
    requireAuth: (req, res, next) => next(),
    requireParent: (req, res, next) => next(),
    requireFamily: (req, res, next) => { req.family = family.getFamily(ctx.fam.id); next(); },
    requireOperatorAdmin: (req, res, next) => next(),
  });
  const handlers = routes["POST /api/operator/approvals/:approvalId/decision"];
  const res = await new Promise((resolve, reject) => {
    const response = { statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; resolve(this); return this; } };
    const req = { user: ctx.priya, params: { approvalId: approval.id }, body: { decision: "approve", actionHash: approval.actionHash }, query: {}, headers: {}, get() { return ""; } };
    let i = 0;
    const next = () => (i < handlers.length ? handlers[i++](req, response, next) : undefined);
    Promise.resolve().then(next).catch(reject);
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  for (const parent of [ctx.mayur, ctx.priya]) {
    assert.deepEqual([approvalCard(parent.id, approval.id).card.state.status, approvalCard(parent.id, approval.id).card.state.label], ["done", "Approved by Priya"]);
  }
});

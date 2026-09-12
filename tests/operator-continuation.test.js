"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-continuation-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.OPERATOR_BETA_ENFORCE = "1";
const store = require("../lib/store");
const family = require("../lib/family");
const operator = require("../lib/operator");
const execution = require("../lib/operator-execution");
const beta = require("../lib/operator-beta");
const events = require("../lib/events");
const hermes = require("../lib/hermes");
const capabilities = require("../lib/operator-capabilities");
const routes = new Map();
require("../lib/routes/hermes")({
  get: (url, ...handlers) => routes.set(`GET ${url}`, handlers),
  post: (url, ...handlers) => routes.set(`POST ${url}`, handlers),
  delete() {},
}, {
  hermes, family, store,
  requireAuth: (req, res, next) => req.user ? next() : res.status(401).json({}),
  requireParent: (req, res, next) => req.user.data.profile.role === "kid" ? res.status(403).json({}) : next(),
  requireFamily: (req, res, next) => { req.family = family.familiesForUser(req.user.id)[0]; return req.family ? next() : res.status(403).json({}); },
});
let sequence = 0;
function fixture({ enroll = true, actionType = "calendar.create", action } = {}) {
  const parent = store.createUser(`continuation-${++sequence}@example.com`, "Parent");
  const fam = family.createFamily(parent.id, "School family");
  const actor = { type: "parent", userId: parent.id, principalId: parent.id };
  if (enroll) beta.setFamilyConfig(fam.id, { enabled: true, autonomyCeiling: "approved-low-risk", hourlyQuota: 10, dailyQuota: 25 });
  const connection = hermes.connectFamily(fam.id);
  const auth = hermes.familyForToken(connection.token);
  const oldNow = Date.now;
  let actorToken;
  try {
    Date.now = () => oldNow() - 20 * 60 * 1000;
    actorToken = capabilities.issue({ family: fam, connection: auth.connection, actor, messageId: "school-message", roomId: "family" });
  } finally { Date.now = oldNow; }
  const current = operator.createCase(fam.id, { actor, roomId: "family", title: "School assembly", goal: "Add the assembly after parent approval", purpose: "operator-case" });
  for (const state of ["planning", "proposal_ready"]) operator.transitionCase(fam.id, current.id, state, { actor, roomId: "family" });
  const approval = operator.requestApproval(fam.id, current.id, { actor, roomId: "family", approverUserId: parent.id, actionType, action: action || { title: "School assembly", date: "2026-10-20", time: "09:00", category: "other", repeat: "none" } });
  operator.transitionCase(fam.id, current.id, "waiting_for_approval", { actor, roomId: "family" });
  return { parent, fam, actor, approval, caseId: current.id, auth, actorToken, token: connection.token };
}
function invoke(route, req) {
  const handlers = routes.get(route);
  assert.ok(handlers, `Missing route ${route}`);
  const res = { statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  req.headers ||= {};
  req.get = (name) => req.headers[name];
  let index = 0;
  const next = () => handlers[index++]?.(req, res, next);
  next();
  return res;
}
function decide(f, decision = "approve", overrides = {}) {
  return invoke("POST /api/operator/approvals/:approvalId/decision", {
    user: f.parent, params: { approvalId: f.approval.id }, body: { decision, actionHash: f.approval.actionHash }, ...overrides,
  });
}
function drain(f, body = {}, headers = { authorization: `Bearer ${f.token}` }) {
  return invoke("POST /api/hermes/continuations", { headers, body });
}
function approveOnly(f) {
  return execution.decideApproval(f.fam.id, f.approval.id, { actor: f.actor, decision: "approve", actionHash: f.approval.actionHash });
}

test("stored parent authority completes an approved create through beta and read-back verification", () => {
  const f = fixture();
  execution.decideApproval(f.fam.id, f.approval.id, { actor: f.actor, decision: "approve", actionHash: f.approval.actionHash });
  const live = require("../lib/operator-live-execution");
  assert.deepEqual(live.continueApproved(f.fam.id, f.approval.id, f.parent.id), { state: "completed" });
  assert.equal(operator.getCase(f.fam.id, f.caseId, { actor: f.actor }).state, "completed");
});

test("delayed parent approval executes the stored action without a fresh Hermes turn", () => {
  const f = fixture();
  assert.throws(() => capabilities.verify({ family: f.fam, connection: f.auth.connection, token: f.actorToken }), { code: "ACTOR_CAPABILITY_EXPIRED" });
  const response = decide(f);
  assert.equal(response.statusCode, 200);
  const grant = execution.getExecutionForApproval(f.fam.id, f.approval.id);
  assert.equal(grant.state, "consumed");
  assert.ok(events.getBySource(f.fam.id, "operator", grant.id));
  assert.equal(operator.getCase(f.fam.id, f.caseId, { actor: f.actor }).state, "completed");
  const replay = decide(f);
  assert.equal(replay.statusCode, 200);
  assert.equal(execution.getExecutionForApproval(f.fam.id, f.approval.id).id, grant.id);
  assert.equal(beta.statusForFamily(f.fam.id).usage.daily, 1);
  assert.ok(!JSON.stringify(response.body).includes("oprun1."));
});

test("school reminder uses the same automatic exact-approval flow", () => {
  const f = fixture({ actionType: "action.create", action: { title: "Bring assembly costume", dueDate: "2026-10-19", dueTime: "18:00", assigneeType: "family" } });
  assert.equal(decide(f).body.continuation.state, "completed");
  const grant = execution.getExecutionForApproval(f.fam.id, f.approval.id);
  const saved = require("../lib/actions").getBySource(f.fam.id, "manual", grant.id);
  assert.equal(saved.dueDate, "2026-10-19");
  assert.equal(saved.dueTime, "18:00");
  assert.equal(drain(f).body.continuations.length, 0);
});

test("restart between approval and dispatch recovers persisted work once", () => {
  const f = fixture();
  approveOnly(f);
  const { spawnSync } = require("node:child_process");
  require("../lib/db").flushSync();
  const child = spawnSync(process.execPath, ["-e", `
    const live = require('./lib/operator-live-execution');
    const beta = require('./lib/operator-beta');
    const id = process.argv[1];
    const first = live.drainContinuations(id);
    const second = live.drainContinuations(id);
    console.log(JSON.stringify({ first, second, usage: beta.statusForFamily(id).usage.daily }));
  `, f.fam.id], { cwd: path.join(__dirname, ".."), env: process.env, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { first: [{ state: "completed" }], second: [], usage: 1 });
  assert.equal(execution.getExecutionForApproval(f.fam.id, f.approval.id).state, "consumed");
});

test("expired claims recover, but unexpired claims and uncertain running writes are never replayed", () => {
  const live = require("../lib/operator-live-execution");
  const f = fixture();
  approveOnly(f);
  const claim = live.claimExecution(f.fam.id, f.approval.id, { actor: f.actor });
  assert.deepEqual(drain(f).body.continuations, []);
  const db = new (require("better-sqlite3"))(path.join(process.env.FAM_DATA_DIR, "operator.sqlite"));
  db.prepare("UPDATE operator_execution_grants SET token_expires_at = ? WHERE approval_id = ?").run("2020-01-01T00:00:00.000Z", f.approval.id);
  assert.equal(drain(f).body.continuations[0].state, "completed");
  assert.throws(() => live.runExecution(f.fam.id, claim.executionToken, f.approval.actionHash, { actor: f.actor }));
  const uncertain = fixture();
  approveOnly(uncertain);
  live.claimExecution(uncertain.fam.id, uncertain.approval.id, { actor: uncertain.actor });
  db.prepare("UPDATE operator_execution_grants SET state = 'running', token_expires_at = ? WHERE approval_id = ?").run("2020-01-01T00:00:00.000Z", uncertain.approval.id);
  db.close();
  assert.deepEqual(drain(uncertain).body.continuations, [{ state: "blocked", code: "EXECUTION_OUTCOME_UNCERTAIN" }]);
  assert.equal(operator.getCase(uncertain.fam.id, uncertain.caseId, { actor: uncertain.actor }).state, "failed");
  assert.deepEqual(drain(uncertain).body.continuations, []);
});

test("pending, rejected and cancelled cases cannot become continuation authority", () => {
  const f = fixture();
  assert.deepEqual(drain(f).body.continuations, []);
  assert.equal(decide(f, "reject").statusCode, 200);
  assert.deepEqual(drain(f).body.continuations, []);
  const cancelled = fixture();
  approveOnly(cancelled);
  operator.transitionCase(cancelled.fam.id, cancelled.caseId, "cancelled", { actor: cancelled.actor });
  assert.deepEqual(drain(cancelled).body.continuations, []);
  assert.equal(execution.getExecutionForApproval(cancelled.fam.id, cancelled.approval.id).state, "ready");
});

test("continuation rejects cross-family, forged-body and unauthenticated requests", () => {
  const f = fixture();
  const other = fixture();
  approveOnly(f);
  assert.equal(drain(f, {}, {}).statusCode, 401);
  assert.equal(drain(f, { familyId: other.fam.id }).statusCode, 400);
  assert.deepEqual(drain(other).body.continuations, []);
  assert.equal(execution.getExecutionForApproval(f.fam.id, f.approval.id).state, "ready");
  assert.equal(decide(f, "approve", { user: other.parent }).statusCode, 404);
  assert.equal(drain(f).body.continuations[0].state, "completed");
});

test("denied beta execution leaves visible blocked evidence without a retry storm", () => {
  const f = fixture({ enroll: false });
  assert.equal(decide(f).body.continuation.state, "blocked");
  assert.equal(beta.statusForFamily(f.fam.id).usage.daily, 0);
  assert.equal(operator.getCase(f.fam.id, f.caseId, { actor: f.actor }).state, "failed");
  assert.ok(beta.evidenceForCase(f.fam.id, f.caseId).some((item) => item.kind === "beta.blocked"));
  assert.deepEqual(drain(f).body.continuations, []);
});

test("persisted execution result is verified after a crash without writing again", () => {
  const f = fixture();
  approveOnly(f);
  const live = require("../lib/operator-live-execution");
  const claim = live.claimExecution(f.fam.id, f.approval.id, { actor: f.actor });
  const result = live.runExecution(f.fam.id, claim.executionToken, f.approval.actionHash, { actor: f.actor });
  assert.equal(drain(f).body.continuations[0].state, "completed");
  assert.equal(beta.statusForFamily(f.fam.id).usage.daily, 1);
  const changed = fixture();
  approveOnly(changed);
  const secondClaim = live.claimExecution(changed.fam.id, changed.approval.id, { actor: changed.actor });
  const secondResult = live.runExecution(changed.fam.id, secondClaim.executionToken, changed.approval.actionHash, { actor: changed.actor });
  events.updateEvent(changed.fam.id, secondResult.result.eventId, { date: "2026-10-21" });
  assert.equal(drain(changed).body.continuations[0].code, "EXECUTION_VERIFICATION_FAILED");
  assert.ok(result.result.eventId);
});

test("a calendar plus reminder case completes only after both approvals execute", () => {
  for (const recover of [false, true]) {
    const f = fixture();
    const reminder = operator.requestApproval(f.fam.id, f.caseId, { actor: f.actor, roomId: "family", approverUserId: f.parent.id, actionType: "action.create", action: { title: "Bring assembly costume", dueDate: "2026-10-19" } });
    if (recover) {
      approveOnly(f);
      execution.decideApproval(f.fam.id, reminder.id, { actor: f.actor, decision: "approve", actionHash: reminder.actionHash });
      assert.deepEqual(drain(f).body.continuations.map((item) => item.state), ["completed", "completed"]);
    } else {
      assert.equal(decide(f).statusCode, 200);
      assert.equal(operator.getCase(f.fam.id, f.caseId, { actor: f.actor }).state, "verifying");
      assert.equal(decide({ ...f, approval: reminder }).statusCode, 200);
    }
    assert.equal(operator.getCase(f.fam.id, f.caseId, { actor: f.actor }).state, "completed");
    assert.equal(beta.statusForFamily(f.fam.id).usage.daily, 2);
  }
});

test("removed approving parent cannot authorize recovered execution", () => {
  const f = fixture();
  approveOnly(f);
  family.getFamily(f.fam.id).parentIds = [];
  assert.equal(require("../lib/operator-live-execution").drainContinuations(f.fam.id)[0].state, "blocked");
  assert.equal(execution.getExecutionForApproval(f.fam.id, f.approval.id).state, "ready");
});

test("a rejected historical proposal does not prevent a revised approved proposal completing", () => {
  const f = fixture();
  assert.equal(decide(f, "reject").statusCode, 200);
  operator.transitionCase(f.fam.id, f.caseId, "proposal_ready", { actor: f.actor });
  const revised = operator.requestApproval(f.fam.id, f.caseId, { actor: f.actor, roomId: "family", approverUserId: f.parent.id, actionType: "calendar.create", action: { title: "Corrected school assembly", date: "2026-10-21", time: "10:00" } });
  operator.transitionCase(f.fam.id, f.caseId, "waiting_for_approval", { actor: f.actor });
  assert.equal(decide({ ...f, approval: revised }).body.continuation.state, "completed");
  assert.equal(operator.getCase(f.fam.id, f.caseId, { actor: f.actor }).state, "completed");
  assert.equal(execution.getExecutionForApproval(f.fam.id, f.approval.id), null);
});

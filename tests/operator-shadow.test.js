"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-operator-shadow-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const datacrypto = require("../lib/datacrypto");
datacrypto._resetKeyCache();
const store = require("../lib/store");
const family = require("../lib/family");
const operator = require("../lib/operator");
const operatorStore = require("../lib/operator-store");
const operatorShadow = require("../lib/operator-shadow");
const events = require("../lib/events");
const actions = require("../lib/actions");

let seq = 0;
function parent(label = "Shadow Parent") {
  seq += 1;
  return store.createUser(`shadow-${seq}@example.com`, `${label} ${seq}`);
}
function actor(user) { return { type: "parent", userId: user.id, principalId: user.id }; }
function makeCase(label = "Shadow") {
  const user = parent(label);
  const fam = family.createFamily(user.id, `${label} Family`);
  let current = operator.createCase(fam.id, {
    actor: actor(user),
    roomId: "family",
    title: "Turn a confirmation into family plans",
    goal: "Prepare calendar and action changes without writing them yet.",
    purpose: "operator-case",
  });
  current = operator.transitionCase(fam.id, current.id, "planning", { actor: actor(user), roomId: "family" });
  current = operator.transitionCase(fam.id, current.id, "proposal_ready", { actor: actor(user), roomId: "family" });
  return { user, fam, current };
}
function loadSqliteOrSkip(t) {
  try { return require("better-sqlite3"); }
  catch (error) { t.skip("better-sqlite3 is optional on this host"); return null; }
}

function safeProposal() {
  return {
    workflowId: "confirmation-to-calendar",
    plan: ["Read the confirmation", "Check family calendar", "Prepare the exact calendar change"],
    contextSections: ["identities", "calendar", "actions"],
    clarifyingQuestions: 0,
    proposedActions: [{
      actionType: "calendar.create",
      approvalPolicy: "single-parent",
      action: { title: "School concert", date: "2026-10-03", time: "18:00", category: "school" },
      expectedResult: "A family calendar event exists after approval.",
      executed: false,
    }],
    expectedResult: { summary: "Calendar event ready for parent approval; no write performed in shadow mode." },
  };
}

test("shadow.proposal records what Hermes would do and blocks approval/execution transitions", (t) => {
  if (!loadSqliteOrSkip(t)) return;
  const f = makeCase("Lock");
  const beforeEvents = events.listEvents(f.fam.id).length;
  const beforeActions = actions.listForFamily(f.fam.id).length;
  const step = operator.addStep(f.fam.id, f.current.id, {
    actor: actor(f.user),
    roomId: "family",
    kind: "shadow.proposal",
    input: safeProposal(),
    idempotencyKey: "shadow:confirmation:1",
  });
  assert.equal(step.kind, "shadow.proposal");
  assert.equal(step.state, "completed");
  assert.equal(step.output.executionBlocked, true);
  assert.match(step.output.shadowRunId, /^shadow_[0-9a-f]{24}$/);

  const run = operatorShadow.getRun(f.fam.id, step.output.shadowRunId);
  assert.equal(run.state, "active");
  assert.equal(run.executionBlocked, true);
  assert.equal(run.initialScore.dimensions.safeAction, 1);
  assert.equal(run.initialScore.dimensions.approvalCorrectness, 1);
  assert.equal(run.initialScore.dimensions.unnecessaryQuestions, 1);

  assert.throws(
    () => operator.requestApproval(f.fam.id, f.current.id, {
      actor: actor(f.user), roomId: "family", actionType: "calendar.create",
      action: safeProposal().proposedActions[0].action,
    }),
    (error) => error.code === "OPERATOR_SHADOW_EXECUTION_BLOCKED",
  );
  assert.throws(
    () => operator.transitionCase(f.fam.id, f.current.id, "waiting_for_approval", { actor: actor(f.user), roomId: "family" }),
    (error) => error.code === "OPERATOR_SHADOW_EXECUTION_BLOCKED",
  );
  assert.equal(events.listEvents(f.fam.id).length, beforeEvents);
  assert.equal(actions.listForFamily(f.fam.id).length, beforeActions);
  assert.equal(operatorStore.listApprovals(f.fam.id, f.current.id).length, 0);
});

test("shadow retry is idempotent and does not create duplicate runs or steps", (t) => {
  if (!loadSqliteOrSkip(t)) return;
  const f = makeCase("Retry");
  const input = { actor: actor(f.user), roomId: "family", kind: "shadow.proposal", input: safeProposal(), idempotencyKey: "same-shadow-run" };
  const first = operator.addStep(f.fam.id, f.current.id, input);
  const second = operator.addStep(f.fam.id, f.current.id, input);
  assert.equal(second.id, first.id);
  assert.equal(second.output.shadowRunId, first.output.shadowRunId);
  assert.equal(operatorShadow.listRuns(f.fam.id, { caseId: f.current.id }).length, 1);
});

test("parent review completes all seven benchmark dimensions and compares eventual action choice", (t) => {
  if (!loadSqliteOrSkip(t)) return;
  const f = makeCase("Review");
  const step = operator.addStep(f.fam.id, f.current.id, {
    actor: actor(f.user), roomId: "family", kind: "shadow.proposal", input: safeProposal(), idempotencyKey: "review-shadow",
  });
  const reviewed = operatorShadow.reviewRun(f.fam.id, step.output.shadowRunId, actor(f.user), {
    choice: "accepted",
    actualActionTypes: ["calendar.create"],
    contextMisses: [],
    hallucinations: [],
    notes: "This is what I would have done.",
  });
  assert.equal(reviewed.state, "reviewed");
  assert.equal(reviewed.executionBlocked, false);
  assert.equal(reviewed.finalScore.score, 100);
  assert.equal(reviewed.finalScore.passed, true);
  assert.deepEqual(reviewed.finalScore.dimensions, {
    correctPlan: 1,
    correctContext: 1,
    unnecessaryQuestions: 1,
    approvalCorrectness: 1,
    completion: 1,
    hallucinationFree: 1,
    safeAction: 1,
  });
  assert.equal(reviewed.finalScore.comparison.exactActionTypeMatch, true);
  assert.equal(reviewed.finalScore.comparison.actionTypeAgreement, 1);

  // Once reviewed, shadow mode releases the case. A fresh approval may now be
  // created, but the shadow proposal itself never became execution authority.
  const approval = operator.requestApproval(f.fam.id, f.current.id, {
    actor: actor(f.user), roomId: "family", approverUserId: f.user.id,
    actionType: "calendar.create", action: safeProposal().proposedActions[0].action,
  });
  assert.ok(approval);
});

test("unsafe or actor-disallowed proposals are recorded for evaluation but score safeAction zero", (t) => {
  if (!loadSqliteOrSkip(t)) return;
  const f = makeCase("Unsafe");
  const proposal = safeProposal();
  proposal.proposedActions = [{
    actionType: "payment.create",
    approvalPolicy: "dual-parent",
    action: { amountCents: 10000 },
    executed: false,
  }];
  const step = operator.addStep(f.fam.id, f.current.id, {
    actor: actor(f.user), roomId: "family", kind: "shadow.proposal", input: proposal, idempotencyKey: "unsafe-shadow",
  });
  const run = operatorShadow.getRun(f.fam.id, step.output.shadowRunId);
  assert.equal(run.initialScore.dimensions.safeAction, 0);
  assert.equal(run.proposedActions[0].policy.riskLevel, "high");
  assert.equal(run.proposedActions[0].policy.allowed, true);
  assert.equal(operatorStore.listApprovals(f.fam.id, f.current.id).length, 0);
});

test("shadow reviews are parent/family scoped and telemetry gates workflow graduation", (t) => {
  if (!loadSqliteOrSkip(t)) return;
  const f = makeCase("Metrics");
  const outsider = parent("Outsider");
  const outsiderFamily = family.createFamily(outsider.id, "Outsider Family");
  const step = operator.addStep(f.fam.id, f.current.id, {
    actor: actor(f.user), roomId: "family", kind: "shadow.proposal", input: safeProposal(), idempotencyKey: "metrics-shadow",
  });
  assert.throws(
    () => operatorShadow.reviewRun(outsiderFamily.id, step.output.shadowRunId, actor(outsider), { choice: "accepted" }),
    (error) => error.code === "OPERATOR_SHADOW_NOT_ACTIVE" || error.code === "OPERATOR_SHADOW_ERROR" || error.code === "OPERATOR_SHADOW_ACTOR_DENIED" || error.message,
  );
  operatorShadow.reviewRun(f.fam.id, step.output.shadowRunId, actor(f.user), {
    choice: "modified",
    actualActionTypes: ["calendar.create", "action.create"],
    contextMisses: ["Need pickup location"],
    hallucinations: [],
  });
  const metrics = operatorShadow.metrics(f.fam.id, { workflowId: "confirmation-to-calendar" });
  assert.equal(metrics.reviewedRuns, 1);
  assert.equal(metrics.contextMissRate, 1);
  assert.equal(metrics.hallucinationRate, 0);
  const gate = operatorShadow.graduationStatus(f.fam.id, "confirmation-to-calendar");
  assert.equal(gate.eligible, false);
  assert.equal(gate.status, "insufficient-data");
});

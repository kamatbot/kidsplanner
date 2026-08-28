"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-operator-execution-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const datacrypto = require("../lib/datacrypto");
datacrypto._resetKeyCache();
const store = require("../lib/store");
const family = require("../lib/family");
const events = require("../lib/events");
const operator = require("../lib/operator");
const operatorStore = require("../lib/operator-store");
const {
  createOperatorExecution,
  OperatorExecutionError,
} = require("../lib/operator-execution");

let seq = 0;
function makeParent(label) {
  seq += 1;
  return store.createUser(`${label}${seq}@example.com`, `${label} ${seq}`);
}

function setupFamily(label = "Execution") {
  const parent = makeParent(`${label} Parent`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  return { parent, fam };
}

function parentActor(user) {
  return { type: "parent", userId: user.id, principalId: user.id };
}

function createApprovalFixture({ approverUserId, expiresAt = "2026-09-20T12:00:00.000Z" } = {}) {
  const { parent, fam } = setupFamily("Approval");
  const secondParent = makeParent("Second Parent");
  const joined = family.joinFamilyAsParent(fam.inviteCode, secondParent.id);
  assert.ok(joined.family);
  const { kid } = family.addKid(fam.id, parent.id, { name: "Taylor" });

  let op = operator.createCase(fam.id, {
    actor: parentActor(parent),
    title: "Put the confirmed appointment on the calendar",
    goal: "Create the approved family calendar event.",
    roomId: "family",
    purpose: "calendar-booking",
    riskLevel: "medium",
  });
  op = operator.transitionCase(fam.id, op.id, "planning", { actor: parentActor(parent), roomId: "family" });
  op = operator.transitionCase(fam.id, op.id, "proposal_ready", { actor: parentActor(parent), roomId: "family" });

  const action = {
    title: "Factory tour",
    date: "2026-09-10",
    time: "14:00",
    endTime: "15:30",
    notes: "Confirmed by the venue",
    category: "social",
    repeat: "none",
  };
  const approval = operator.requestApproval(fam.id, op.id, {
    actor: parentActor(parent),
    roomId: "family",
    approverUserId: approverUserId === undefined ? parent.id : approverUserId,
    actionType: "calendar.create",
    action,
    expiresAt,
  });
  operator.transitionCase(fam.id, op.id, "waiting_for_approval", { actor: parentActor(parent), roomId: "family" });

  return { parent, secondParent, kid, fam, caseId: op.id, approval, action };
}

function loadSqliteOrSkip(t) {
  try {
    return require("better-sqlite3");
  } catch (error) {
    t.skip("better-sqlite3 is optional on this host");
    return null;
  }
}

test("approval/execution layer fails closed when SQLite is unavailable", () => {
  function BrokenDatabase() {
    throw new Error("sqlite unavailable");
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-op-exec-broken-"));
  const execution = createOperatorExecution({
    dbFile: path.join(dir, "operator.sqlite"),
    Database: BrokenDatabase,
  });
  assert.deepEqual(execution.status(), {
    available: false,
    backend: "sqlite",
    fallback: false,
    supportedActionTypes: [
      "calendar.create",
      "calendar.update",
      "action.create",
      "action.update",
      "trip.itinerary.update",
    ],
    errorCode: "OPERATOR_EXECUTION_UNAVAILABLE",
  });
  assert.throws(
    () => execution.listApprovalsForParent("f_nope", "u_nope"),
    (error) => error instanceof OperatorExecutionError && error.code === "OPERATOR_EXECUTION_UNAVAILABLE",
  );
});

test("only the assigned parent can approve the exact action hash", (t) => {
  const Database = loadSqliteOrSkip(t);
  if (!Database) return;
  const fixture = createApprovalFixture();
  const execution = createOperatorExecution({ dbFile: operatorStore.DEFAULT_DB_FILE, Database });
  t.after(() => execution.close());

  assert.throws(
    () => execution.decideApproval(fixture.fam.id, fixture.approval.id, {
      actor: { type: "kid", kidId: fixture.kid.id, principalId: fixture.kid.id, userId: fixture.parent.id },
      decision: "approve",
      actionHash: fixture.approval.actionHash,
    }),
    (error) => error.code === "APPROVAL_PARENT_REQUIRED",
  );

  assert.throws(
    () => execution.decideApproval(fixture.fam.id, fixture.approval.id, {
      actor: parentActor(fixture.secondParent),
      decision: "approve",
      actionHash: fixture.approval.actionHash,
    }),
    (error) => error.code === "APPROVAL_WRONG_APPROVER",
  );

  assert.throws(
    () => execution.decideApproval(fixture.fam.id, fixture.approval.id, {
      actor: parentActor(fixture.parent),
      decision: "approve",
      actionHash: "0".repeat(64),
    }),
    (error) => error.code === "APPROVAL_HASH_MISMATCH",
  );

  const decided = execution.decideApproval(fixture.fam.id, fixture.approval.id, {
    actor: parentActor(fixture.parent),
    decision: "approve",
    actionHash: fixture.approval.actionHash,
  });
  assert.equal(decided.approval.state, "approved");
  assert.equal(decided.approval.decidedBy, fixture.parent.id);
  assert.equal(decided.execution.state, "ready");
  assert.equal(decided.execution.actionHash, fixture.approval.actionHash);
  assert.equal(operatorStore.getCase(fixture.fam.id, fixture.caseId).state, "executing");

  const repeated = execution.decideApproval(fixture.fam.id, fixture.approval.id, {
    actor: parentActor(fixture.parent),
    decision: "approve",
    actionHash: fixture.approval.actionHash,
  });
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.execution.id, decided.execution.id);
});

test("single-use execution token runs only the stored approved calendar action", (t) => {
  const Database = loadSqliteOrSkip(t);
  if (!Database) return;
  const fixture = createApprovalFixture();
  const execution = createOperatorExecution({ dbFile: operatorStore.DEFAULT_DB_FILE, Database });
  t.after(() => execution.close());

  const decided = execution.decideApproval(fixture.fam.id, fixture.approval.id, {
    actor: parentActor(fixture.parent),
    decision: "approve",
    actionHash: fixture.approval.actionHash,
  });
  const approvingActor = parentActor(fixture.parent);
  const claimed = execution.claimExecution(fixture.fam.id, fixture.approval.id, {
    actor: approvingActor,
    executorType: "hermes",
  });
  assert.match(claimed.executionToken, /^oprun1\.exec_[0-9a-f]{24}\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(claimed.action, fixture.action);
  assert.equal(claimed.actionHash, fixture.approval.actionHash);
  assert.equal(claimed.grant.state, "claimed");

  const disk = [operatorStore.DEFAULT_DB_FILE, operatorStore.DEFAULT_DB_FILE + "-wal"]
    .filter(fs.existsSync)
    .map((file) => fs.readFileSync(file).toString("latin1"))
    .join("");
  assert.equal(disk.includes(claimed.executionToken), false);

  assert.throws(
    () => execution.claimExecution(fixture.fam.id, fixture.approval.id, {
      actor: approvingActor,
      executorType: "hermes",
    }),
    (error) => error.code === "EXECUTION_ALREADY_CLAIMED",
  );
  assert.throws(
    () => execution.runExecution(fixture.fam.id, claimed.executionToken, "f".repeat(64), { actor: approvingActor }),
    (error) => error.code === "EXECUTION_HASH_MISMATCH",
  );

  const run = execution.runExecution(
    fixture.fam.id,
    claimed.executionToken,
    fixture.approval.actionHash,
    { actor: approvingActor },
  );
  assert.equal(run.execution.state, "consumed");
  assert.equal(run.result.driver, "calendar.create");
  assert.equal(run.result.sourceId, decided.execution.id);
  assert.equal(operatorStore.getCase(fixture.fam.id, fixture.caseId).state, "verifying");

  const event = events.getBySource(fixture.fam.id, "operator", decided.execution.id);
  assert.ok(event);
  assert.equal(event.title, fixture.action.title);
  assert.equal(event.date, fixture.action.date);
  assert.equal(event.time, fixture.action.time);
  assert.equal(event.sourceType, "operator");
  assert.equal(event.sourceId, decided.execution.id);
  assert.equal(event.createdBy, fixture.parent.id);

  assert.throws(
    () => execution.runExecution(
      fixture.fam.id,
      claimed.executionToken,
      fixture.approval.actionHash,
      { actor: approvingActor },
    ),
    (error) => error.code === "EXECUTION_TOKEN_INVALID",
  );

  const matching = events.listEvents(fixture.fam.id, { from: "2026-09-10", to: "2026-09-10" })
    .filter((candidate) => candidate.sourceType === "operator" && candidate.sourceId === decided.execution.id);
  assert.equal(matching.length, 1);
});

test("an in-flight execution cannot be replayed or reclaimed after its token expires", (t) => {
  const Database = loadSqliteOrSkip(t);
  if (!Database) return;
  const fixture = createApprovalFixture();
  const execution = createOperatorExecution({ dbFile: operatorStore.DEFAULT_DB_FILE, Database });
  t.after(() => execution.close());

  const decided = execution.decideApproval(fixture.fam.id, fixture.approval.id, {
    actor: parentActor(fixture.parent),
    decision: "approve",
    actionHash: fixture.approval.actionHash,
  });
  const approvingActor = parentActor(fixture.parent);
  const claimed = execution.claimExecution(fixture.fam.id, fixture.approval.id, {
    actor: approvingActor,
    executorType: "hermes",
  });

  const db = new Database(operatorStore.DEFAULT_DB_FILE);
  t.after(() => db.close());
  db.prepare(`
    UPDATE operator_execution_grants
    SET token_expires_at = ?
    WHERE id = ?
  `).run("2000-01-01T00:00:00.000Z", decided.execution.id);
  const reclaimed = execution.claimExecution(fixture.fam.id, fixture.approval.id, {
    actor: approvingActor,
    executorType: "hermes",
  });
  assert.notEqual(reclaimed.executionToken, claimed.executionToken);

  db.prepare(`
    UPDATE operator_execution_grants
    SET state = 'running', token_expires_at = ?
    WHERE id = ?
  `).run("2000-01-01T00:00:00.000Z", decided.execution.id);

  assert.throws(
    () => execution.runExecution(
      fixture.fam.id,
      reclaimed.executionToken,
      fixture.approval.actionHash,
      { actor: approvingActor },
    ),
    (error) => error.code === "EXECUTION_NOT_READY",
  );
  assert.throws(
    () => execution.claimExecution(fixture.fam.id, fixture.approval.id, {
      actor: approvingActor,
      executorType: "hermes",
    }),
    (error) => error.code === "EXECUTION_ALREADY_CLAIMED",
  );
  assert.equal(events.getBySource(fixture.fam.id, "operator", decided.execution.id), null);
});

test("an expired approval is closed atomically without creating execution authority", (t) => {
  const Database = loadSqliteOrSkip(t);
  if (!Database) return;
  const fixture = createApprovalFixture({ expiresAt: "2000-01-01T00:00:00.000Z" });
  const execution = createOperatorExecution({ dbFile: operatorStore.DEFAULT_DB_FILE, Database });
  t.after(() => execution.close());

  assert.throws(
    () => execution.decideApproval(fixture.fam.id, fixture.approval.id, {
      actor: parentActor(fixture.parent),
      decision: "approve",
      actionHash: fixture.approval.actionHash,
    }),
    (error) => error.code === "APPROVAL_EXPIRED",
  );
  const approval = execution.getApprovalForParent(fixture.fam.id, fixture.parent.id, fixture.approval.id);
  assert.equal(approval.state, "expired");
  assert.equal(approval.execution, null);
  assert.equal(operatorStore.getCase(fixture.fam.id, fixture.caseId).state, "planning");
});

test("rejecting an approval creates no execution grant and returns the case to planning", (t) => {
  const Database = loadSqliteOrSkip(t);
  if (!Database) return;
  const fixture = createApprovalFixture({ approverUserId: null });
  const execution = createOperatorExecution({ dbFile: operatorStore.DEFAULT_DB_FILE, Database });
  t.after(() => execution.close());

  const rejected = execution.decideApproval(fixture.fam.id, fixture.approval.id, {
    actor: parentActor(fixture.secondParent),
    decision: "reject",
    actionHash: fixture.approval.actionHash,
  });
  assert.equal(rejected.approval.state, "rejected");
  assert.equal(rejected.approval.decidedBy, fixture.secondParent.id);
  assert.equal(rejected.execution, null);
  assert.equal(operatorStore.getCase(fixture.fam.id, fixture.caseId).state, "planning");

  assert.throws(
    () => execution.claimExecution(fixture.fam.id, fixture.approval.id, {
      actor: parentActor(fixture.secondParent),
    }),
    (error) => error.code === "EXECUTION_NOT_READY",
  );
});

test("parent approval inbox is family scoped and respects assigned approvers", (t) => {
  const Database = loadSqliteOrSkip(t);
  if (!Database) return;
  const fixture = createApprovalFixture();
  const execution = createOperatorExecution({ dbFile: operatorStore.DEFAULT_DB_FILE, Database });
  t.after(() => execution.close());

  const assigned = execution.listApprovalsForParent(fixture.fam.id, fixture.parent.id, { state: "pending" });
  assert.ok(assigned.some((item) => item.id === fixture.approval.id));
  assert.deepEqual(assigned.find((item) => item.id === fixture.approval.id).action, fixture.action);

  const otherParent = execution.listApprovalsForParent(fixture.fam.id, fixture.secondParent.id, { state: "pending" });
  assert.equal(otherParent.some((item) => item.id === fixture.approval.id), false);

  const outsider = setupFamily("Outsider");
  const outside = execution.listApprovalsForParent(outsider.fam.id, outsider.parent.id, { state: "pending" });
  assert.equal(outside.some((item) => item.id === fixture.approval.id), false);
});

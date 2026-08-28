"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-operator-beta-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.OPERATOR_BETA_ENFORCE = "1";

const datacrypto = require("../lib/datacrypto");
datacrypto._resetKeyCache();
const store = require("../lib/store");
const family = require("../lib/family");
const events = require("../lib/events");
const operator = require("../lib/operator");
const operatorExecution = require("../lib/operator-execution");
const liveExecution = require("../lib/operator-live-execution");
const operatorBeta = require("../lib/operator-beta");

let seq = 0;
function makeFamily(label = "Beta") {
  seq += 1;
  const parent = store.createUser(`beta-${seq}@example.com`, `${label} Parent ${seq}`);
  const fam = family.createFamily(parent.id, `${label} Family ${seq}`);
  return { parent, fam, actor: { type: "parent", userId: parent.id, principalId: parent.id } };
}

function approvedCalendar(fixture, suffix) {
  let current = operator.createCase(fixture.fam.id, {
    actor: fixture.actor,
    roomId: "family",
    title: `Beta calendar ${suffix}`,
    goal: "Create one approved low-risk calendar event.",
    purpose: "operator-case",
  });
  current = operator.transitionCase(fixture.fam.id, current.id, "planning", { actor: fixture.actor, roomId: "family" });
  current = operator.transitionCase(fixture.fam.id, current.id, "proposal_ready", { actor: fixture.actor, roomId: "family" });
  const action = { title: `Beta event ${suffix}`, date: "2026-10-20", time: "16:00", category: "other", repeat: "none" };
  const approval = operator.requestApproval(fixture.fam.id, current.id, {
    actor: fixture.actor,
    roomId: "family",
    approverUserId: fixture.parent.id,
    actionType: "calendar.create",
    action,
  });
  operator.transitionCase(fixture.fam.id, current.id, "waiting_for_approval", { actor: fixture.actor, roomId: "family" });
  operatorExecution.decideApproval(fixture.fam.id, approval.id, {
    actor: fixture.actor,
    decision: "approve",
    actionHash: approval.actionHash,
  });
  return { caseId: current.id, approval, action };
}

test("limited beta is deny-by-default, then permits only enrolled approved low-risk execution", (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 is optional on this host"); return; }
  const fixture = makeFamily("Enrollment");
  const first = approvedCalendar(fixture, "one");

  assert.throws(
    () => liveExecution.claimExecution(fixture.fam.id, first.approval.id, { actor: fixture.actor, executorType: "hermes" }),
    (error) => error.code === "OPERATOR_BETA_NOT_ENROLLED",
  );
  assert.equal(operatorBeta.feedbackStatus(fixture.fam.id, first.caseId).reason, "blocked");

  const config = operatorBeta.setFamilyConfig(fixture.fam.id, {
    enabled: true,
    autonomyCeiling: "approved-low-risk",
    hourlyQuota: 2,
    dailyQuota: 3,
    allowedActionTypes: ["calendar.create", "action.create"],
  });
  assert.equal(config.enabled, true);
  assert.equal(config.autonomyCeiling, "approved-low-risk");

  const claim = liveExecution.claimExecution(fixture.fam.id, first.approval.id, { actor: fixture.actor, executorType: "hermes" });
  const run = liveExecution.runExecution(fixture.fam.id, claim.executionToken, first.approval.actionHash, { actor: fixture.actor });
  assert.equal(run.result.driver, "calendar.create");
  assert.ok(events.getBySource(fixture.fam.id, "operator", run.execution.id));

  const status = operatorBeta.statusForFamily(fixture.fam.id);
  assert.equal(status.usage.hourly, 1);
  assert.equal(status.usage.daily, 1);
  const evidence = operatorBeta.evidenceForCase(fixture.fam.id, first.caseId);
  assert.ok(evidence.some((item) => item.kind === "beta.execution_completed"));

  const feedbackBefore = operatorBeta.feedbackStatus(fixture.fam.id, first.caseId);
  assert.equal(feedbackBefore.required, true);
  assert.equal(feedbackBefore.submitted, false);
  const feedbackAfter = operatorBeta.submitFeedback(fixture.fam.id, first.caseId, fixture.actor, { outcome: "helpful", rating: 5 });
  assert.equal(feedbackAfter.submitted, true);
  assert.equal(feedbackAfter.feedback.outcome, "helpful");
});

test("family and global kill switches block claims immediately and leave evidence", (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 is optional on this host"); return; }
  const fixture = makeFamily("Kill");
  operatorBeta.setFamilyConfig(fixture.fam.id, { enabled: true, autonomyCeiling: "approved-low-risk", hourlyQuota: 5, dailyQuota: 10 });

  const familyKilled = approvedCalendar(fixture, "family-kill");
  operatorBeta.setFamilyConfig(fixture.fam.id, { killSwitch: true });
  assert.throws(
    () => liveExecution.claimExecution(fixture.fam.id, familyKilled.approval.id, { actor: fixture.actor }),
    (error) => error.code === "OPERATOR_BETA_FAMILY_KILL_SWITCH",
  );
  assert.ok(operatorBeta.evidenceForCase(fixture.fam.id, familyKilled.caseId).some((item) => item.code === "OPERATOR_BETA_FAMILY_KILL_SWITCH"));

  operatorBeta.setFamilyConfig(fixture.fam.id, { killSwitch: false });
  const globallyKilled = approvedCalendar(fixture, "global-kill");
  operatorBeta.setGlobal({ killSwitch: true });
  assert.throws(
    () => liveExecution.claimExecution(fixture.fam.id, globallyKilled.approval.id, { actor: fixture.actor }),
    (error) => error.code === "OPERATOR_BETA_KILL_SWITCH",
  );
  operatorBeta.setGlobal({ killSwitch: false });
});

test("quota and launch allowlist fail closed, and dashboard reports the safety boundary", (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 is optional on this host"); return; }
  const fixture = makeFamily("Quota");
  assert.throws(
    () => operatorBeta.setFamilyConfig(fixture.fam.id, { enabled: true, autonomyCeiling: "approved-low-risk", allowedActionTypes: ["payment.create"] }),
    (error) => error.code === "OPERATOR_BETA_CONFIG_INVALID",
  );
  operatorBeta.setFamilyConfig(fixture.fam.id, {
    enabled: true,
    autonomyCeiling: "approved-low-risk",
    hourlyQuota: 1,
    dailyQuota: 1,
    allowedActionTypes: ["calendar.create"],
  });

  const one = approvedCalendar(fixture, "quota-one");
  const claim = liveExecution.claimExecution(fixture.fam.id, one.approval.id, { actor: fixture.actor });
  liveExecution.runExecution(fixture.fam.id, claim.executionToken, one.approval.actionHash, { actor: fixture.actor });

  const two = approvedCalendar(fixture, "quota-two");
  assert.throws(
    () => liveExecution.claimExecution(fixture.fam.id, two.approval.id, { actor: fixture.actor }),
    (error) => error.code === "OPERATOR_BETA_HOURLY_QUOTA",
  );

  const dashboard = operatorBeta.dashboard();
  const row = dashboard.families.find((item) => item.familyId === fixture.fam.id);
  assert.ok(row);
  assert.equal(row.usage.hourly, 1);
  assert.ok(row.blocked7d >= 1);
  assert.deepEqual(dashboard.safetyBoundary, {
    launchActionTypes: ["calendar.create", "calendar.update", "action.create", "action.update", "trip.itinerary.update"],
    maximumRiskLevel: "low",
    exactParentApprovalRequired: true,
    paymentsEnabled: false,
    medicalLegalAttestationsEnabled: false,
    unrestrictedBrowserExecutionEnabled: false,
    silentExternalMessagingEnabled: false,
  });
});

test("a concurrent replay cannot release the winning execution's quota reservation", (t) => {
  let Database;
  try { Database = require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 is optional on this host"); return; }
  const fixture = makeFamily("ConcurrentQuota");
  operatorBeta.setFamilyConfig(fixture.fam.id, { enabled: true, autonomyCeiling: "approved-low-risk", hourlyQuota: 2, dailyQuota: 3 });
  const pending = approvedCalendar(fixture, "concurrent");
  const claim = operatorExecution.claimExecution(fixture.fam.id, pending.approval.id, { actor: fixture.actor, executorType: "hermes" });
  const reservation = operatorBeta.reserveExecutionToken(fixture.fam.id, claim.executionToken, pending.approval.actionHash);

  const db = new Database(require("../lib/operator-store").DEFAULT_DB_FILE);
  db.prepare("UPDATE operator_execution_grants SET state = 'running' WHERE id = ?").run(reservation.grantId);
  assert.equal(operatorBeta.releaseReservation(reservation.grantId, "EXECUTION_NOT_READY"), false);
  assert.equal(db.prepare("SELECT state FROM operator_beta_usage WHERE grant_id = ?").get(reservation.grantId).state, "reserved");
  db.close();
});

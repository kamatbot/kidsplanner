"use strict";

/**
 * Production live-execution facade.
 *
 * The base approval/execution engine retains exact-action authority. This
 * facade adds M5 beta enrollment, kill-switch and quota enforcement before any
 * live driver runs, then records beta evidence after the base engine completes.
 */
const base = require("./operator-execution");
const beta = require("./operator-beta");
const operator = require("./operator");
const events = require("./events");
const actions = require("./actions");

// ponytail: automatic continuation covers the two idempotent create drivers;
// add update/trip drivers only with their own read-back and recovery contracts.
const CONTINUATION_TYPES = new Set(["calendar.create", "action.create"]);

function continueApproved(familyId, approvalId, parentUserId) {
  const actor = { type: "parent", userId: parentUserId, principalId: parentUserId };
  const approval = base.getApprovalForParent(familyId, parentUserId, approvalId);
  if (!approval || approval.state !== "approved" || approval.decidedBy !== parentUserId || !CONTINUATION_TYPES.has(approval.actionType)) return { state: "skipped" };
  const current = operator.getCase(familyId, approval.caseId, { actor });
  if (!current || !["executing", "verifying"].includes(current.state)) return { state: "skipped" };
  let grant = base.getExecutionForApproval(familyId, approvalId);
  if (!grant) return { state: "skipped" };
  const attention = (code) => {
    operator.addStep(familyId, approval.caseId, { actor, kind: "execution.continuation.blocked", state: "failed", idempotencyKey: `continuation:${grant.id}:${code}`, output: { code } });
    operator.transitionCase(familyId, approval.caseId, "failed", { actor, detail: "Approved action needs review before another attempt." });
    return { state: "blocked", code };
  };
  if (grant.state === "running") {
    if (Date.parse(grant.tokenExpiresAt) > Date.now()) return { state: "pending" };
    // A crash after the domain write has an uncertain result: never replay it.
    return attention("EXECUTION_OUTCOME_UNCERTAIN");
  }
  if (grant.state === "claimed" && Date.parse(grant.tokenExpiresAt) > Date.now()) return { state: "pending" };
  if (!["ready", "claimed", "consumed"].includes(grant.state)) return { state: "skipped" };
  try {
    if (grant.state !== "consumed") {
      const claim = claimExecution(familyId, approvalId, { actor, executorType: "fametc-continuation" });
      grant = runExecution(familyId, claim.executionToken, approval.actionHash, { actor }).execution;
    }
    const record = approval.actionType === "calendar.create"
      ? events.getBySource(familyId, "operator", grant.id)
      : actions.getBySource(familyId, "manual", grant.id);
    const resultId = grant.result && (grant.result.eventId || grant.result.actionId);
    const expected = base.validateAction(familyId, approval.actionType, approval.action);
    if (approval.actionType === "calendar.create" && expected.endDate === expected.date) expected.endDate = null;
    if (!record || record.id !== resultId || Object.entries(expected).some(([key, value]) => (record[key] ?? null) !== (value ?? null))) return attention("EXECUTION_VERIFICATION_FAILED");
    operator.addStep(familyId, approval.caseId, { actor, kind: "execution.verified", state: "completed", idempotencyKey: `continuation:${grant.id}:verified`, output: { actionType: approval.actionType, recordId: record.id } });
    const detail = operator.getCase(familyId, approval.caseId, { actor, includeChildren: true });
    const allVerified = detail.approvals.every((item) => {
      if (["rejected", "expired", "cancelled"].includes(item.state)) return true;
      if (item.state !== "approved") return false;
      const saved = base.getExecutionForApproval(familyId, item.id);
      return saved && saved.state === "consumed" && detail.steps.some((step) => step.idempotencyKey === `continuation:${saved.id}:verified` && step.state === "completed");
    });
    if (allVerified) operator.transitionCase(familyId, approval.caseId, "completed", { actor, detail: "All approved actions verified in family data." });
    return { state: "completed" };
  } catch (error) {
    if (["EXECUTION_ALREADY_CLAIMED", "EXECUTION_NOT_READY"].includes(error.code)) return { state: "pending" };
    // Keep the persisted grant and failure evidence; retry requires parent review.
    const latest = operator.getCase(familyId, approval.caseId, { actor });
    if (latest && ["executing", "verifying"].includes(latest.state)) return attention(error.code || "EXECUTION_CONTINUATION_FAILED");
    return { state: "blocked", code: error.code || "EXECUTION_CONTINUATION_FAILED" };
  }
}

function drainContinuations(familyId) {
  return base.listContinuations(familyId).map(({ approvalId, parentUserId }) => {
    try { return continueApproved(familyId, approvalId, parentUserId); }
    catch (_) { return { state: "blocked", code: "EXECUTION_CONTINUATION_UNAVAILABLE" }; }
  });
}

function claimExecution(familyId, approvalId, input = {}) {
  beta.preflightClaim(familyId, approvalId, input.actor);
  return base.claimExecution(familyId, approvalId, input);
}

function runExecution(familyId, executionToken, actionHash, input = {}) {
  let reservation = null;
  try {
    reservation = beta.reserveExecutionToken(familyId, executionToken, actionHash);
    const result = base.runExecution(familyId, executionToken, actionHash, input);
    beta.completeReservation(reservation.grantId, result && result.result || null);
    return result;
  } catch (error) {
    if (reservation && reservation.grantId) {
      // If the base engine rejected the token/state before a driver began, do
      // not permanently consume family quota. Driver/runtime failures remain
      // counted to prevent retry storms.
      const releaseCodes = new Set([
        "EXECUTION_TOKEN_INVALID",
        "EXECUTION_HASH_MISMATCH",
        "EXECUTION_TOKEN_EXPIRED",
        "EXECUTION_NOT_READY",
        "EXECUTION_APPROVER_REQUIRED",
      ]);
      if (releaseCodes.has(error && error.code)) beta.releaseReservation(reservation.grantId, error.code);
      else beta.failReservation(reservation.grantId, error);
    }
    throw error;
  }
}

module.exports = {
  ...base,
  claimExecution,
  runExecution,
  continueApproved,
  drainContinuations,
};

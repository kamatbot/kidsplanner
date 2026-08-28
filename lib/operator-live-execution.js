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
};
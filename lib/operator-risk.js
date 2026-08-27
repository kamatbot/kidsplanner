"use strict";

/** Deterministic action-risk registry for Family Operator. */
const POLICIES = Object.freeze({
  "calendar.create": Object.freeze({ riskLevel: "low", allowedActors: ["parent", "kid"], approvalPolicy: "single-parent", dualParent: false, executable: true }),
  "action.create": Object.freeze({ riskLevel: "low", allowedActors: ["parent", "kid"], approvalPolicy: "single-parent", dualParent: false, executable: false }),
  "trip.itinerary.update": Object.freeze({ riskLevel: "low", allowedActors: ["parent"], approvalPolicy: "single-parent", dualParent: false, executable: false }),
  "email.draft": Object.freeze({ riskLevel: "low", allowedActors: ["parent"], approvalPolicy: "single-parent", dualParent: false, executable: false }),
  "email.send": Object.freeze({ riskLevel: "medium", allowedActors: ["parent"], approvalPolicy: "single-parent", dualParent: false, executable: false }),
  "subscription.cancel": Object.freeze({ riskLevel: "medium", allowedActors: ["parent"], approvalPolicy: "single-parent", dualParent: false, executable: false }),
  "booking.create": Object.freeze({ riskLevel: "high", allowedActors: ["parent"], approvalPolicy: "single-parent", dualParent: false, executable: false }),
  "payment.create": Object.freeze({ riskLevel: "high", allowedActors: ["parent"], approvalPolicy: "dual-parent", dualParent: true, executable: false }),
  "medical.attest": Object.freeze({ riskLevel: "critical", allowedActors: [], approvalPolicy: "prohibited", dualParent: false, executable: false }),
  "legal.attest": Object.freeze({ riskLevel: "critical", allowedActors: [], approvalPolicy: "prohibited", dualParent: false, executable: false }),
});

class OperatorRiskError extends Error {
  constructor(message, code = "OPERATOR_ACTION_POLICY_DENIED") {
    super(message);
    this.name = "OperatorRiskError";
    this.code = code;
  }
}

function getPolicy(actionType) {
  const type = String(actionType || "").trim();
  return POLICIES[type] ? { actionType: type, ...POLICIES[type] } : null;
}

function evaluate(actionType, actorType) {
  const policy = getPolicy(actionType);
  if (!policy) {
    return {
      actionType: String(actionType || "").trim(),
      riskLevel: "critical",
      allowed: false,
      executable: false,
      approvalPolicy: "prohibited",
      dualParent: false,
      reason: "unregistered-action-type",
    };
  }
  if (policy.approvalPolicy === "prohibited") return { ...policy, allowed: false, reason: "prohibited-action" };
  const actor = String(actorType || "").trim();
  if (!policy.allowedActors.includes(actor)) return { ...policy, allowed: false, reason: "actor-not-allowed" };
  if (policy.approvalPolicy === "dual-parent" && policy.executable) {
    return { ...policy, allowed: false, reason: "dual-parent-execution-not-implemented" };
  }
  return { ...policy, allowed: true, reason: null };
}

function requireProposalAllowed(actionType, actorType) {
  const result = evaluate(actionType, actorType);
  if (!result.allowed) {
    const code = result.reason === "prohibited-action" ? "OPERATOR_ACTION_PROHIBITED"
      : result.reason === "unregistered-action-type" ? "OPERATOR_ACTION_UNREGISTERED"
        : "OPERATOR_ACTOR_ACTION_DENIED";
    throw new OperatorRiskError(`Action ${result.actionType || "(missing)"} is not allowed for ${actorType || "this actor"}.`, code);
  }
  return result;
}

function requireExecutable(actionType) {
  const policy = getPolicy(actionType);
  if (!policy || policy.approvalPolicy === "prohibited") {
    throw new OperatorRiskError(`Action ${String(actionType || "(missing)")} is not executable.`, "OPERATOR_ACTION_PROHIBITED");
  }
  if (policy.dualParent) {
    throw new OperatorRiskError("This action requires dual-parent approval, which is not executable yet.", "OPERATOR_DUAL_PARENT_REQUIRED");
  }
  if (!policy.executable) {
    throw new OperatorRiskError(`No approved execution driver is enabled for ${actionType}.`, "OPERATOR_EXECUTION_UNSUPPORTED_ACTION");
  }
  return { actionType, ...policy };
}

function registry() {
  return Object.entries(POLICIES).map(([actionType, policy]) => ({ actionType, ...policy }));
}

module.exports = {
  POLICIES,
  OperatorRiskError,
  getPolicy,
  evaluate,
  requireProposalAllowed,
  requireExecutable,
  registry,
};

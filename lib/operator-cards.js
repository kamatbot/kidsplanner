"use strict";

/** Parent-facing read model for Hermes Operator case cards and activity. */
const family = require("./family");
const operatorStore = require("./operator-store");
const operatorExecution = require("./operator-execution");
const operatorRisk = require("./operator-risk");

const STAGE_LABELS = Object.freeze({
  draft: "Getting started",
  planning: "Making a plan",
  researching: "Researching",
  waiting_for_input: "Waiting for your input",
  proposal_ready: "Ready for review",
  waiting_for_approval: "Needs approval",
  executing: "Carrying it out",
  verifying: "Checking the result",
  completed: "Completed",
  failed: "Needs attention",
  cancelled: "Cancelled",
});

const PRIVATE_ACTIVITY_KEYS = new Set([
  "actorId",
  "userId",
  "parentUserId",
  "requestedBy",
  "approverUserId",
  "decidedBy",
  "executionToken",
  "token",
  "tokenHash",
]);

class OperatorCardError extends Error {
  constructor(message, code = "OPERATOR_CARD_DENIED") {
    super(message);
    this.name = "OperatorCardError";
    this.code = code;
  }
}

function requireParent(familyId, parentUserId) {
  const fam = family.getFamily(familyId);
  if (!fam) throw new OperatorCardError("Family not found.", "OPERATOR_FAMILY_NOT_FOUND");
  if (!parentUserId || !(fam.parentIds || []).includes(parentUserId)) {
    throw new OperatorCardError("Only a parent in this family can view Operator cases.");
  }
  return fam;
}

function safeExecution(familyId, approvalId) {
  try {
    return operatorExecution.getExecutionForApproval(familyId, approvalId);
  } catch (error) {
    if (error && ["OPERATOR_EXECUTION_UNAVAILABLE", "OPERATOR_STORAGE_UNAVAILABLE"].includes(error.code)) return null;
    throw error;
  }
}

function approvalProjection(familyId, approval) {
  const execution = safeExecution(familyId, approval.id);
  return {
    id: approval.id,
    actionType: approval.actionType,
    actionHash: approval.actionHash,
    action: approval.action,
    state: approval.state,
    expiresAt: approval.expiresAt || null,
    decidedAt: approval.decidedAt || null,
    createdAt: approval.createdAt,
    policy: operatorRisk.getPolicy(approval.actionType),
    execution: execution ? {
      id: execution.id,
      state: execution.state,
      result: execution.result || null,
      error: execution.error || null,
      consumedAt: execution.consumedAt || null,
    } : null,
  };
}

function safeActivityValue(value) {
  if (Array.isArray(value)) return value.map(safeActivityValue);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (PRIVATE_ACTIVITY_KEYS.has(key)) continue;
    out[key] = safeActivityValue(entry);
  }
  return out;
}

function auditProjection(event) {
  return {
    id: event.id,
    eventType: event.eventType,
    payload: event.payload == null ? null : safeActivityValue(event.payload),
    createdAt: event.createdAt,
  };
}

function evidenceFromApprovals(approvals) {
  return approvals
    .filter((approval) => approval.execution && (approval.execution.result || approval.execution.error))
    .map((approval) => ({
      approvalId: approval.id,
      actionType: approval.actionType,
      state: approval.execution.state,
      result: approval.execution.result,
      error: approval.execution.error,
      at: approval.execution.consumedAt || approval.decidedAt || approval.createdAt,
    }));
}

function caseCard(familyId, caseId, parentUserId) {
  requireParent(familyId, parentUserId);
  const current = operatorStore.getCase(familyId, caseId, { includeChildren: true });
  if (!current) return null;
  const approvals = (current.approvals || []).map((approval) => approvalProjection(familyId, approval));
  const pendingApproval = approvals.find((approval) => approval.state === "pending") || null;
  const activity = operatorStore.listAudit(familyId, { caseId, limit: 200 })
    .map(auditProjection)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return {
    id: current.id,
    title: current.title,
    goal: current.goal,
    state: current.state,
    stageLabel: STAGE_LABELS[current.state] || current.state,
    riskLevel: current.riskLevel,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
    steps: (current.steps || []).map((step) => ({
      id: step.id,
      position: step.position,
      kind: step.kind,
      state: step.state,
      output: step.output || null,
      createdAt: step.createdAt,
      updatedAt: step.updatedAt,
    })),
    proposedAction: pendingApproval ? {
      approvalId: pendingApproval.id,
      actionType: pendingApproval.actionType,
      actionHash: pendingApproval.actionHash,
      action: pendingApproval.action,
      expiresAt: pendingApproval.expiresAt,
      policy: pendingApproval.policy,
    } : null,
    approvals,
    evidence: evidenceFromApprovals(approvals),
    activity,
  };
}

function listCaseCards(familyId, parentUserId, options = {}) {
  requireParent(familyId, parentUserId);
  const limit = Math.max(1, Math.min(Number(options.limit) || 20, 50));
  return operatorStore.listCases(familyId, { state: options.state, limit })
    .map((current) => caseCard(familyId, current.id, parentUserId))
    .filter(Boolean);
}

function familyActivity(familyId, parentUserId, options = {}) {
  requireParent(familyId, parentUserId);
  const limit = Math.max(1, Math.min(Number(options.limit) || 100, 300));
  return operatorStore.listAudit(familyId, { limit }).map(auditProjection);
}

module.exports = {
  STAGE_LABELS,
  OperatorCardError,
  caseCard,
  listCaseCards,
  familyActivity,
};

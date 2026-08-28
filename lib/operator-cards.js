"use strict";

/** Parent-facing read model for Hermes Operator case cards and activity. */
const family = require("./family");
const operatorStore = require("./operator-store");
const operatorExecution = require("./operator-execution");
const operatorRisk = require("./operator-risk");
const operatorAttachments = require("./operator-attachments");
const operatorBeta = require("./operator-beta");

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
  if (!parentUserId || !(fam.parentIds || []).includes(parentUserId)) throw new OperatorCardError("Only a parent in this family can view Operator cases.");
  return fam;
}

function safeExecution(familyId, approvalId) {
  try { return operatorExecution.getExecutionForApproval(familyId, approvalId); }
  catch (error) {
    if (error && ["OPERATOR_EXECUTION_UNAVAILABLE", "OPERATOR_STORAGE_UNAVAILABLE"].includes(error.code)) return null;
    throw error;
  }
}

function safeAttachments(familyId, caseId, parentUserId) {
  try {
    return operatorAttachments.list(familyId, caseId, { type: "parent", userId: parentUserId, principalId: parentUserId }, { limit: 50 });
  } catch (error) {
    if (error && ["OPERATOR_ATTACHMENT_UNAVAILABLE", "OPERATOR_STORAGE_UNAVAILABLE"].includes(error.code)) return [];
    throw error;
  }
}

function safeBetaEvidence(familyId, caseId) {
  try { return operatorBeta.evidenceForCase(familyId, caseId, { limit: 50 }); }
  catch (error) {
    if (error && ["OPERATOR_BETA_UNAVAILABLE", "OPERATOR_STORAGE_UNAVAILABLE"].includes(error.code)) return [];
    throw error;
  }
}

function safeFeedback(familyId, caseId) {
  try { return operatorBeta.feedbackStatus(familyId, caseId); }
  catch (error) {
    if (error && ["OPERATOR_BETA_UNAVAILABLE", "OPERATOR_STORAGE_UNAVAILABLE"].includes(error.code)) return { required: false, reason: null, submitted: false, feedback: null };
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

function auditProjection(event) {
  return { id: event.id, eventType: event.eventType, createdAt: event.createdAt };
}

function evidenceFromApprovals(approvals) {
  return approvals
    .filter((approval) => approval.execution && (approval.execution.result || approval.execution.error))
    .map((approval) => ({
      source: "execution",
      approvalId: approval.id,
      actionType: approval.actionType,
      state: approval.execution.state,
      result: approval.execution.result,
      error: approval.execution.error,
      at: approval.execution.consumedAt || approval.decidedAt || approval.createdAt,
    }));
}

function evidenceFromBeta(items) {
  return (items || []).map((item) => ({
    source: "beta",
    kind: item.kind,
    actionType: item.actionType,
    state: item.kind === "beta.blocked" ? "blocked" : item.kind,
    result: item.result || null,
    error: item.error || (item.code ? { code: item.code, message: item.reason || item.code } : null),
    at: item.createdAt,
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
  const betaEvidence = safeBetaEvidence(familyId, caseId);
  return {
    id: current.id,
    title: current.title,
    goal: current.goal,
    state: current.state,
    stageLabel: STAGE_LABELS[current.state] || current.state,
    riskLevel: current.riskLevel,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
    proposedAction: pendingApproval ? {
      approvalId: pendingApproval.id,
      actionType: pendingApproval.actionType,
      actionHash: pendingApproval.actionHash,
      action: pendingApproval.action,
      expiresAt: pendingApproval.expiresAt,
      policy: pendingApproval.policy,
    } : null,
    attachments: safeAttachments(familyId, caseId, parentUserId),
    approvals,
    evidence: [...evidenceFromApprovals(approvals), ...evidenceFromBeta(betaEvidence)]
      .sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))),
    feedback: safeFeedback(familyId, caseId),
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

module.exports = { STAGE_LABELS, OperatorCardError, caseCard, listCaseCards, familyActivity };

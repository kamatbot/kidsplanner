"use strict";

/**
 * Domain boundary for Hermes Family Operator.
 *
 * operator-store owns durable transactional persistence. This module owns the
 * family/actor policy that must be applied before Hermes can read context or
 * mutate a case. Keeping that policy outside the MCP transport means future
 * transports (background workers, mobile approvals) reuse the same checks.
 */
const operatorStore = require("./operator-store");
const family = require("./family");
const store = require("./store");
const familyContext = require("./family-context");
const operatorRisk = require("./operator-risk");
const operatorShadow = require("./operator-shadow");

const CONTEXT_SECTIONS = new Set([...familyContext.ALL_SECTIONS, "members"]);
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
const ALLOWED_TRANSITIONS = Object.freeze({
  draft: new Set(["planning", "cancelled"]),
  planning: new Set(["researching", "waiting_for_input", "proposal_ready", "failed", "cancelled"]),
  researching: new Set(["waiting_for_input", "proposal_ready", "waiting_for_approval", "failed", "cancelled"]),
  waiting_for_input: new Set(["planning", "researching", "proposal_ready", "failed", "cancelled"]),
  proposal_ready: new Set(["researching", "waiting_for_input", "waiting_for_approval", "executing", "cancelled"]),
  waiting_for_approval: new Set(["planning", "executing", "failed", "cancelled"]),
  executing: new Set(["waiting_for_input", "waiting_for_approval", "verifying", "failed", "cancelled"]),
  verifying: new Set(["executing", "completed", "failed", "cancelled"]),
  completed: new Set(),
  failed: new Set(["planning", "researching", "cancelled"]),
  cancelled: new Set(),
});

class OperatorPolicyError extends Error {
  constructor(message, code = "OPERATOR_POLICY_DENIED") {
    super(message);
    this.name = "OperatorPolicyError";
    this.code = code;
  }
}

function shadowExecutionBlocked() {
  return new OperatorPolicyError(
    "This case is in shadow mode. FamETC recorded what Hermes would do but will not create approval or execution authority until a parent reviews the shadow run.",
    "OPERATOR_SHADOW_EXECUTION_BLOCKED",
  );
}

function userName(userId) {
  if (!userId) return null;
  const user = store.getUser(userId);
  return (user && user.data && user.data.profile && user.data.profile.name) || null;
}

function normalizeActor(actor) {
  if (!actor || typeof actor !== "object") return null;
  const type = String(actor.type || actor.actorType || "").trim();
  const userId = actor.userId ? String(actor.userId) : null;
  const kidId = actor.kidId ? String(actor.kidId) : null;
  const principalId = actor.principalId ? String(actor.principalId) : (type === "kid" ? kidId : userId);
  if (!type || !principalId) return null;
  return {
    type,
    principalId,
    userId,
    kidId: type === "kid" ? (kidId || principalId) : null,
    name: actor.name ? String(actor.name).slice(0, 80) : null,
  };
}

function actorFromMessage(message, displayName) {
  if (!message || message.senderType === "agent") return null;
  if (message.senderType === "kid") {
    return {
      type: "kid",
      principalId: message.senderId || null,
      kidId: message.senderId || null,
      userId: message.postedByUserId || null,
      name: displayName || null,
    };
  }
  const userId = message.postedByUserId || message.senderId || null;
  return {
    type: message.senderType === "member" ? "member" : "parent",
    principalId: userId,
    userId,
    kidId: null,
    name: displayName || null,
  };
}

function validateActor(fam, actor, { allowAgent = false } = {}) {
  if (!fam) throw new OperatorPolicyError("Family not found.", "OPERATOR_FAMILY_NOT_FOUND");
  const normalized = normalizeActor(actor);
  if (!normalized) throw new OperatorPolicyError("A valid family actor is required.", "OPERATOR_ACTOR_REQUIRED");

  if (allowAgent && normalized.type === "agent" && normalized.principalId === "hermes") return normalized;

  if (normalized.type === "parent" || normalized.type === "member") {
    if (!normalized.userId || !(fam.parentIds || []).includes(normalized.userId)) {
      throw new OperatorPolicyError("Actor is not a parent in this family.");
    }
    normalized.type = "parent";
    normalized.name = normalized.name || userName(normalized.userId);
    return normalized;
  }

  if (normalized.type === "kid") {
    const kid = (fam.kids || []).find((candidate) => candidate.id === normalized.kidId);
    if (!kid) throw new OperatorPolicyError("Actor is not a kid in this family.");
    if (normalized.userId) {
      const user = store.getUser(normalized.userId);
      const link = user && user.data && user.data.kid;
      const isLinkedKid = !!(link && link.familyId === fam.id && link.kidId === kid.id);
      const isFamilyParent = (fam.parentIds || []).includes(normalized.userId);
      if (!isLinkedKid && !isFamilyParent) throw new OperatorPolicyError("Kid actor user linkage does not belong to this family.");
    }
    normalized.name = normalized.name || kid.name || null;
    return normalized;
  }

  throw new OperatorPolicyError("Unsupported family actor type.");
}

function sanitizeSections(sections) {
  if (sections == null) return null;
  if (!Array.isArray(sections)) throw new OperatorPolicyError("Context sections must be an array.", "OPERATOR_CONTEXT_INVALID");
  const unique = [];
  for (const raw of sections) {
    const section = String(raw || "").trim();
    if (!CONTEXT_SECTIONS.has(section)) throw new OperatorPolicyError(`Unsupported context section: ${section}.`, "OPERATOR_CONTEXT_INVALID");
    if (!unique.includes(section)) unique.push(section);
  }
  return unique;
}

function contextForFamily(familyId, options = {}) {
  const fam = family.getFamily(familyId);
  if (!fam) throw new OperatorPolicyError("Family not found.", "OPERATOR_FAMILY_NOT_FOUND");
  const actor = validateActor(fam, options.actor, { allowAgent: options.allowAgent === true });
  try {
    return familyContext.buildFamilyContext(familyId, {
      actor,
      purpose: options.purpose || "family-assistance",
      roomId: options.roomId,
      sections: sanitizeSections(options.sections),
      from: options.from,
      to: options.to,
    });
  } catch (error) {
    if (error && error.code && String(error.code).startsWith("FAMILY_CONTEXT_")) {
      throw new OperatorPolicyError(error.message, "OPERATOR_CONTEXT_INVALID");
    }
    throw error;
  }
}

function createCase(familyId, input = {}) {
  const fam = family.getFamily(familyId);
  if (!fam) throw new OperatorPolicyError("Family not found.", "OPERATOR_FAMILY_NOT_FOUND");
  const actor = validateActor(fam, input.actor);
  const context = input.context || contextForFamily(familyId, {
    actor,
    purpose: input.purpose || "operator-case",
    roomId: input.roomId,
    sections: input.contextSections,
  });
  return operatorStore.createCase({
    familyId: fam.id,
    actorId: actor.principalId,
    actorType: actor.type,
    roomId: input.roomId,
    title: input.title,
    goal: input.goal,
    state: "draft",
    riskLevel: input.riskLevel || "low",
    budgetCents: input.budgetCents,
    context,
  });
}

function canAccessCase(actor, current, roomId) {
  if (!current) return false;
  if (roomId && current.roomId && current.roomId !== roomId) return false;
  if (actor.type === "parent" || actor.type === "agent") return true;
  return actor.type === "kid" && current.actorType === "kid" && current.actorId === actor.principalId;
}

function getCase(familyId, caseId, options = {}) {
  const fam = family.getFamily(familyId);
  const actor = validateActor(fam, options.actor, { allowAgent: options.allowAgent === true });
  const current = operatorStore.getCase(familyId, caseId, { includeChildren: options.includeChildren === true });
  return canAccessCase(actor, current, options.roomId) ? current : null;
}

function listCases(familyId, options = {}) {
  const fam = family.getFamily(familyId);
  const actor = validateActor(fam, options.actor, { allowAgent: options.allowAgent === true });
  const limit = options.limit == null ? 50 : Number(options.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new operatorStore.OperatorValidationError("limit must be an integer between 1 and 200.");
  }
  return operatorStore.listCases(familyId, { state: options.state, limit: 200 })
    .filter((current) => canAccessCase(actor, current, options.roomId))
    .slice(0, limit);
}

function transitionCase(familyId, caseId, nextState, input = {}) {
  const fam = family.getFamily(familyId);
  if (!fam) throw new OperatorPolicyError("Family not found.", "OPERATOR_FAMILY_NOT_FOUND");
  const actor = validateActor(fam, input.actor, { allowAgent: true });
  const current = operatorStore.getCase(familyId, caseId);
  if (!canAccessCase(actor, current, input.roomId)) return null;
  const target = String(nextState || "").trim();
  if (current.state === target) return current;
  if (operatorShadow.isCaseLocked(familyId, caseId) && ["waiting_for_approval", "executing"].includes(target)) {
    throw shadowExecutionBlocked();
  }
  if (TERMINAL_STATES.has(current.state) || !(ALLOWED_TRANSITIONS[current.state] || new Set()).has(target)) {
    throw new OperatorPolicyError(
      `Case cannot transition from ${current.state} to ${target}.`,
      "OPERATOR_INVALID_TRANSITION",
    );
  }
  return operatorStore.updateCaseState(familyId, caseId, target, {
    actorId: actor.principalId,
    detail: input.detail || null,
  });
}

function addStep(familyId, caseId, input = {}) {
  const fam = family.getFamily(familyId);
  const actor = validateActor(fam, input.actor, { allowAgent: true });
  const current = operatorStore.getCase(familyId, caseId);
  if (!canAccessCase(actor, current, input.roomId)) return null;
  const kind = String(input.kind || "").trim();
  if (kind === "shadow.proposal") {
    const payload = input.input && typeof input.input === "object" && !Array.isArray(input.input) ? input.input : {};
    const shadow = operatorShadow.recordRun(familyId, caseId, actor, {
      ...payload,
      idempotencyKey: input.idempotencyKey,
    });
    return operatorStore.addStep(familyId, caseId, {
      kind,
      state: "completed",
      position: input.position,
      input: {
        workflowId: shadow.workflowId,
        benchmarkTaskId: shadow.benchmarkTaskId,
        contextSections: shadow.contextSections,
        proposedActionTypes: shadow.proposedActions.map((proposal) => proposal.actionType),
      },
      output: {
        shadowRunId: shadow.id,
        executionBlocked: true,
        initialScore: shadow.initialScore,
      },
      idempotencyKey: input.idempotencyKey,
      actorId: actor.principalId,
    });
  }
  return operatorStore.addStep(familyId, caseId, {
    kind: input.kind,
    state: input.state,
    position: input.position,
    input: input.input,
    output: input.output,
    idempotencyKey: input.idempotencyKey,
    actorId: actor.principalId,
  });
}

function requestApproval(familyId, caseId, input = {}) {
  const fam = family.getFamily(familyId);
  const actor = validateActor(fam, input.actor, { allowAgent: true });
  const current = operatorStore.getCase(familyId, caseId);
  if (!canAccessCase(actor, current, input.roomId)) return null;
  if (operatorShadow.isCaseLocked(familyId, caseId)) throw shadowExecutionBlocked();

  let policy;
  try {
    policy = operatorRisk.requireProposalAllowed(input.actionType, actor.type);
  } catch (error) {
    throw new OperatorPolicyError(error.message, error.code || "OPERATOR_ACTION_POLICY_DENIED");
  }
  if (policy.dualParent) {
    throw new OperatorPolicyError(
      `Action ${input.actionType} requires dual-parent approval; a single-parent approval record would be insufficient.`,
      "OPERATOR_DUAL_PARENT_REQUIRED",
    );
  }

  const approverUserId = input.approverUserId ? String(input.approverUserId) : null;
  if (approverUserId && !(fam.parentIds || []).includes(approverUserId)) {
    throw new OperatorPolicyError("Approval can only be routed to a parent in this family.");
  }
  const approval = operatorStore.requestApproval(familyId, caseId, {
    requestedBy: actor.principalId,
    approverUserId,
    actionType: input.actionType,
    action: input.action,
    expiresAt: input.expiresAt,
  });
  if (approval) {
    operatorStore.recordAudit({
      familyId,
      caseId,
      actorId: actor.principalId,
      eventType: "policy.action_evaluated",
      payload: {
        actionType: policy.actionType,
        riskLevel: policy.riskLevel,
        approvalPolicy: policy.approvalPolicy,
        dualParent: policy.dualParent,
        executable: policy.executable,
      },
    });
  }
  return approval ? { ...approval, policy } : null;
}

module.exports = {
  CONTEXT_SECTIONS: Object.freeze([...CONTEXT_SECTIONS]),
  ALLOWED_TRANSITIONS,
  OperatorPolicyError,
  actorFromMessage,
  validateActor,
  contextForFamily,
  createCase,
  getCase,
  listCases,
  transitionCase,
  addStep,
  requestApproval,
};

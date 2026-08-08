"use strict";
/**
 * Family decisions — a small, family-scoped question/choice primitive.
 *
 * Storage:
 *   root.decisions[familyId] = [decision, ...]
 *
 * The model owns shape validation, family membership checks, persistence, and
 * state transitions. Routes derive the family and actor from the session and
 * pass only those server-owned values here.
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");

const STATUSES = new Set(["open", "resolved"]);
const SOURCE_TYPES = new Set(["chat"]);

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const MAX_QUESTION_LENGTH = 500;
const MAX_OPTION_LABEL_LENGTH = 160;
const MAX_OPTION_ID_LENGTH = 100;
const MAX_SOURCE_ID_LENGTH = 200;
const MAX_DECISIONS_PER_LIST = 200;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function root() {
  const r = db.load();
  if (!r.decisions || typeof r.decisions !== "object" || Array.isArray(r.decisions)) r.decisions = {};
  return r;
}

function famList(familyId) {
  const r = root();
  if (!Array.isArray(r.decisions[familyId])) r.decisions[familyId] = [];
  return r.decisions[familyId];
}

function decisionId() {
  return "dec_" + crypto.randomBytes(9).toString("hex");
}

function optionId() {
  return "opt_" + crypto.randomBytes(9).toString("hex");
}

function cleanText(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function cleanReference(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function validDateOnly(value) {
  const m = DATE_ONLY.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Avoid Date.UTC's special handling of years 0–99.
  const d = new Date(0);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCFullYear(year, month - 1, day);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function sanitizeDeadline(value) {
  if (value == null || String(value).trim() === "") return { value: null };
  const s = String(value).trim();
  if (validDateOnly(s)) return { value: s };
  if (ISO_WITH_ZONE.test(s) && Number.isFinite(Date.parse(s))) return { value: s };
  return { error: "deadline must be a valid YYYY-MM-DD date or ISO timestamp with a timezone." };
}

function normalizeSource(sourceType, sourceId) {
  const hasType = sourceType != null && String(sourceType).trim() !== "";
  const hasId = sourceId != null && String(sourceId).trim() !== "";
  if (!hasType && !hasId) return { sourceType: null, sourceId: null };
  if (!hasType || !hasId) return { error: "sourceType and sourceId must be provided together." };
  const type = String(sourceType).trim();
  if (!SOURCE_TYPES.has(type)) return { error: "sourceType is not supported." };
  const id = String(sourceId).trim();
  if (id.length > MAX_SOURCE_ID_LENGTH) return { error: "sourceId is too long." };
  return { sourceType: type, sourceId: id };
}

function optionEntry(entry) {
  if (typeof entry === "string" || typeof entry === "number") {
    return { id: null, label: String(entry) };
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { error: "Each option must have a label." };
  }
  return { id: entry.id == null ? null : String(entry.id), label: String(entry.label == null ? "" : entry.label) };
}

function normalizeOptions(input, existingOptions) {
  if (!Array.isArray(input)) return { error: "options must be an array." };
  if (input.length < MIN_OPTIONS || input.length > MAX_OPTIONS) {
    return { error: `A decision needs between ${MIN_OPTIONS} and ${MAX_OPTIONS} options.` };
  }

  const existing = Array.isArray(existingOptions) ? existingOptions : [];
  const usedIds = new Set();
  const labels = new Set();
  const options = [];

  for (let i = 0; i < input.length; i++) {
    const parsed = optionEntry(input[i]);
    if (parsed.error) return parsed;
    const label = cleanText(parsed.label, MAX_OPTION_LABEL_LENGTH);
    if (!label) return { error: "Option labels cannot be empty." };
    const labelKey = label.toLocaleLowerCase();
    if (labels.has(labelKey)) return { error: "Option labels must be unique." };
    labels.add(labelKey);

    let id = cleanReference(parsed.id);
    if (id && id.length > MAX_OPTION_ID_LENGTH) return { error: "Option id is too long." };
    if (id && usedIds.has(id)) return { error: "Option ids must be unique." };
    // A missing id on an edit first follows the label so reordering simple
    // string options does not silently move existing responses to another
    // choice. Fall back to the same position for unchanged labels.
    if (!id && existing.length) {
      const byLabel = existing.find((option) =>
        option && !usedIds.has(option.id) && String(option.label).trim().toLocaleLowerCase() === labelKey
      );
      if (byLabel) id = byLabel.id;
    }
    if (!id && existing[i] && existing[i].id) id = existing[i].id;
    if (!id) {
      do { id = optionId(); } while (usedIds.has(id));
    }
    usedIds.add(id);
    options.push({ id, label });
  }

  return { options };
}

function memberUserIds(fam) {
  const ids = new Set(fam.parentIds || []);
  for (const user of Object.values(db.load().users || {})) {
    const link = user && user.data && user.data.kid;
    if (link && link.familyId === fam.id && (fam.kids || []).some((kid) => kid.id === link.kidId)) ids.add(user.id);
  }
  return ids;
}

function isFamilyMember(fam, userId) {
  return !!fam && !!userId && memberUserIds(fam).has(userId);
}

function validateActor(fam, userId, label = "user") {
  const id = cleanReference(userId);
  if (!id || !isFamilyMember(fam, id)) return { error: `${label} must be a member of this family.` };
  return { value: id };
}

function cloneOptions(options) {
  return (Array.isArray(options) ? options : []).map((option) => ({
    id: option.id,
    label: option.label,
  }));
}

function cloneResponses(responses) {
  return (Array.isArray(responses) ? responses : [])
    .map((response) => ({
      userId: response.userId,
      optionId: response.optionId,
      respondedAt: response.respondedAt,
      updatedAt: response.updatedAt,
    }))
    .sort((a, b) => String(a.userId).localeCompare(String(b.userId)));
}

function cloneHistory(history) {
  return (Array.isArray(history) ? history : []).map((entry) => ({
    action: entry.action,
    optionId: entry.optionId || null,
    userId: entry.userId || null,
    at: entry.at,
  }));
}

/**
 * Explicit allowlist serializer. It intentionally returns fresh nested
 * objects so callers cannot mutate the datastore through an API response.
 */
function publicDecision(decision) {
  if (!decision) return null;
  return {
    id: decision.id,
    familyId: decision.familyId,
    question: decision.question,
    options: cloneOptions(decision.options),
    deadline: decision.deadline == null ? null : decision.deadline,
    status: STATUSES.has(decision.status) ? decision.status : "open",
    createdBy: decision.createdBy,
    createdAt: decision.createdAt,
    updatedAt: decision.updatedAt,
    resolvedOptionId: decision.resolvedOptionId || null,
    resolvedBy: decision.resolvedBy || null,
    resolvedAt: decision.resolvedAt || null,
    responses: cloneResponses(decision.responses),
    sourceType: decision.sourceType || null,
    sourceId: decision.sourceId || null,
    history: cloneHistory(decision.history),
  };
}

function compareDecisions(a, b) {
  const statusOrder = (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1);
  if (statusOrder) return statusOrder;
  const aDeadline = a.deadline || "9999-12-31T23:59:59.999Z";
  const bDeadline = b.deadline || "9999-12-31T23:59:59.999Z";
  const deadlineOrder = aDeadline.localeCompare(bDeadline);
  if (deadlineOrder) return deadlineOrder;
  const createdOrder = String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  if (createdOrder) return createdOrder;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

function createDecision(familyId, input = {}) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };

  const actor = validateActor(fam, input.createdBy, "createdBy");
  if (actor.error) return actor;
  const source = normalizeSource(input.sourceType, input.sourceId);
  if (source.error) return source;
  if (source.sourceType && source.sourceId) {
    const existing = getBySource(familyId, source.sourceType, source.sourceId);
    if (existing) return { decision: existing, existing: true };
  }
  const question = cleanText(input.question, MAX_QUESTION_LENGTH);
  if (!question) return { error: "Question is required." };
  const options = normalizeOptions(input.options);
  if (options.error) return options;
  const deadline = sanitizeDeadline(input.deadline);
  if (deadline.error) return deadline;

  const now = new Date().toISOString();
  const decision = {
    id: decisionId(),
    familyId,
    question,
    options: options.options,
    deadline: deadline.value,
    status: "open",
    createdBy: actor.value,
    createdAt: now,
    updatedAt: now,
    resolvedOptionId: null,
    resolvedBy: null,
    resolvedAt: null,
    responses: [],
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    history: [],
  };
  famList(familyId).push(decision);
  db.persist();
  return { decision };
}

function getDecision(familyId, id) {
  return famList(familyId).find((decision) => decision.id === id) || null;
}

function getById(familyId, id) {
  return getDecision(familyId, id);
}

function getBySource(familyId, sourceType, sourceId) {
  if (!sourceType || !sourceId) return null;
  return famList(familyId).find((decision) =>
    decision.sourceType === sourceType && decision.sourceId === sourceId
  ) || null;
}

function findBySource(familyId, sourceType, sourceId) {
  return getBySource(familyId, sourceType, sourceId);
}

function listDecisions(familyId) {
  return famList(familyId).slice().sort(compareDecisions).slice(0, MAX_DECISIONS_PER_LIST);
}

function updateDecision(familyId, id, patch = {}) {
  const decision = getDecision(familyId, id);
  if (!decision) return { error: "Decision not found." };
  if (decision.status !== "open") return { error: "Resolved decisions must be reopened before editing." };

  const fields = ["question", "options", "deadline"];
  if (!fields.some((field) => hasOwn(patch, field))) return { error: "No editable decision fields were provided." };

  let nextQuestion = decision.question;
  let nextOptions = decision.options;
  let nextDeadline = decision.deadline;

  if (hasOwn(patch, "question")) {
    nextQuestion = cleanText(patch.question, MAX_QUESTION_LENGTH);
    if (!nextQuestion) return { error: "Question is required." };
  }
  if (hasOwn(patch, "options")) {
    const normalized = normalizeOptions(patch.options, decision.options);
    if (normalized.error) return normalized;
    const optionIds = new Set(normalized.options.map((option) => option.id));
    if ((decision.responses || []).some((response) => !optionIds.has(response.optionId))) {
      return { error: "Options with existing responses cannot be removed." };
    }
    nextOptions = normalized.options;
  }
  if (hasOwn(patch, "deadline")) {
    const deadline = sanitizeDeadline(patch.deadline);
    if (deadline.error) return deadline;
    nextDeadline = deadline.value;
  }

  decision.question = nextQuestion;
  decision.options = nextOptions;
  decision.deadline = nextDeadline;
  decision.updatedAt = new Date().toISOString();
  db.persist();
  return { decision };
}

function deleteDecision(familyId, id) {
  const decision = getDecision(familyId, id);
  if (!decision) return { error: "Decision not found." };
  if (decision.status !== "open") return { error: "Resolved decisions cannot be deleted." };
  const list = famList(familyId);
  const index = list.findIndex((item) => item.id === id);
  list.splice(index, 1);
  db.persist();
  return { ok: true };
}

function responseInput(optionIdValue, userIdValue) {
  if (optionIdValue && typeof optionIdValue === "object" && !Array.isArray(optionIdValue)) {
    const input = optionIdValue;
    return {
      optionId: input.optionId,
      userId: input.userId || input.respondedBy || userIdValue,
    };
  }
  return { optionId: optionIdValue, userId: userIdValue };
}

function respondToDecision(familyId, id, optionIdValue, userIdValue) {
  const decision = getDecision(familyId, id);
  if (!decision) return { error: "Decision not found." };
  if (decision.status !== "open") return { error: "Resolved decisions cannot receive responses." };
  const input = responseInput(optionIdValue, userIdValue);
  const fam = family.getFamily(familyId);
  const actor = validateActor(fam, input.userId, "userId");
  if (actor.error) return actor;
  const selected = cleanReference(input.optionId);
  if (!selected || !(decision.options || []).some((option) => option.id === selected)) {
    return { error: "Response option must be one of the decision options." };
  }

  const now = new Date().toISOString();
  const responses = Array.isArray(decision.responses) ? decision.responses : (decision.responses = []);
  const existing = responses.find((response) => response.userId === actor.value);
  if (existing) {
    existing.optionId = selected;
    existing.updatedAt = now;
  } else {
    responses.push({ userId: actor.value, optionId: selected, respondedAt: now, updatedAt: now });
  }
  decision.updatedAt = now;
  db.persist();
  return { decision };
}

function resolveInput(optionIdValue, userIdValue) {
  if (optionIdValue && typeof optionIdValue === "object" && !Array.isArray(optionIdValue)) {
    const input = optionIdValue;
    return {
      optionId: input.optionId || input.resolvedOptionId,
      userId: input.userId || input.resolvedBy || userIdValue,
    };
  }
  return { optionId: optionIdValue, userId: userIdValue };
}

function resolveDecision(familyId, id, optionIdValue, userIdValue) {
  const decision = getDecision(familyId, id);
  if (!decision) return { error: "Decision not found." };
  if (decision.status !== "open") return { error: "Decision is already resolved." };
  const input = resolveInput(optionIdValue, userIdValue);
  const fam = family.getFamily(familyId);
  const actor = validateActor(fam, input.userId, "resolvedBy");
  if (actor.error) return actor;
  const selected = cleanReference(input.optionId);
  if (!selected || !(decision.options || []).some((option) => option.id === selected)) {
    return { error: "resolvedOptionId must be one of the decision options." };
  }

  const now = new Date().toISOString();
  decision.status = "resolved";
  decision.resolvedOptionId = selected;
  decision.resolvedBy = actor.value;
  decision.resolvedAt = now;
  decision.updatedAt = now;
  if (!Array.isArray(decision.history)) decision.history = [];
  decision.history.push({ action: "resolved", optionId: selected, userId: actor.value, at: now });
  db.persist();
  return { decision };
}

function reopenDecision(familyId, id, userIdValue) {
  const decision = getDecision(familyId, id);
  if (!decision) return { error: "Decision not found." };
  if (decision.status !== "resolved") return { error: "Decision is already open." };
  const fam = family.getFamily(familyId);
  const actorInput = userIdValue && typeof userIdValue === "object"
    ? (userIdValue.userId || userIdValue.reopenedBy)
    : userIdValue;
  const actor = validateActor(fam, actorInput, "reopenedBy");
  if (actor.error) return actor;

  const now = new Date().toISOString();
  decision.status = "open";
  decision.resolvedOptionId = null;
  decision.resolvedBy = null;
  decision.resolvedAt = null;
  decision.updatedAt = now;
  if (!Array.isArray(decision.history)) decision.history = [];
  decision.history.push({ action: "reopened", optionId: null, userId: actor.value, at: now });
  db.persist();
  return { decision };
}

module.exports = {
  STATUSES,
  SOURCE_TYPES,
  MIN_OPTIONS,
  MAX_OPTIONS,
  MAX_QUESTION_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  MAX_DECISIONS_PER_LIST,
  createDecision,
  getDecision,
  getById,
  getBySource,
  findBySource,
  listDecisions,
  updateDecision,
  deleteDecision,
  respondToDecision,
  resolveDecision,
  reopenDecision,
  respond: respondToDecision,
  resolve: resolveDecision,
  reopen: reopenDecision,
  removeDecision: deleteDecision,
  publicDecision,
  serializeDecision: publicDecision,
  isFamilyMember,
};

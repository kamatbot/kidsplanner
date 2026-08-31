"use strict";

const crypto = require("crypto");
const db = require("./db");

const MOODLE_ORIGIN = "https://bangkok.learn.nae.school";
const HOMEWORK_VIEW_ID = "2";
const MAX_TASK_ID_LENGTH = 200;
const MAX_ACK_IDS = 100;
const MAX_PENDING_BATCH = 50;
const CLAIM_LEASE_MS = 5 * 60 * 1000;

function root() {
  const r = db.load();
  if (!r.moodleCompletionOutbox) r.moodleCompletionOutbox = {};
  return r;
}

function familyRecords(familyId) {
  const r = root();
  if (!r.moodleCompletionOutbox[familyId]) r.moodleCompletionOutbox[familyId] = {};
  return r.moodleCompletionOutbox[familyId];
}

function sanitizeMoodleIdentity(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return null;
  if (identity.origin !== MOODLE_ORIGIN || identity.homeworkViewId !== HOMEWORK_VIEW_ID) return null;
  if (typeof identity.userId !== "string" || !/^\d{1,20}$/.test(identity.userId)) return null;
  if (typeof identity.taskId !== "string") return null;
  const taskId = identity.taskId;
  if (!taskId || taskId.length > MAX_TASK_ID_LENGTH || !/^\d+$/.test(taskId)) return null;
  return {
    origin: MOODLE_ORIGIN,
    homeworkViewId: HOMEWORK_VIEW_ID,
    userId: identity.userId,
    taskId,
  };
}

function sourceUidForIdentity(identity) {
  const clean = sanitizeMoodleIdentity(identity);
  if (!clean) return null;
  return `moodle:${clean.homeworkViewId}:${clean.userId}:${clean.taskId}`;
}

function identityMatches(left, right) {
  const a = sanitizeMoodleIdentity(left);
  const b = sanitizeMoodleIdentity(right);
  return !!a && !!b
    && a.origin === b.origin
    && a.homeworkViewId === b.homeworkViewId
    && a.userId === b.userId
    && a.taskId === b.taskId;
}

function requestId() {
  return "mcr_" + crypto.randomBytes(12).toString("hex");
}

function copyRecord(record) {
  return {
    schemaVersion: record.schemaVersion,
    requestId: record.requestId,
    homeworkId: record.homeworkId,
    kidId: record.kidId,
    sourceUid: record.sourceUid,
    moodle: Object.assign({}, record.moodle),
    desiredState: record.desiredState,
    display: Object.assign({}, record.display),
    state: record.state,
    requestedAt: record.requestedAt,
    claimedAt: record.claimedAt,
    claimExpiresAt: record.claimExpiresAt,
    acknowledgedAt: record.acknowledgedAt,
    cancelledAt: record.cancelledAt,
  };
}

function pendingForHomework(records, homeworkId) {
  return Object.values(records).find(
    (record) => record.homeworkId === homeworkId && record.state === "pending"
  ) || null;
}

// Mutates only the shared in-memory DB root. The homework model owns the one
// persist() call for the enclosing high-level mutation.
function enqueueInMemory(familyId, homework, now = new Date()) {
  const moodle = sanitizeMoodleIdentity(homework && homework.moodleIdentity);
  if (!homework || homework.source !== "school-portal" || !moodle) {
    return { queued: false, reason: "missing_moodle_identity" };
  }
  const records = familyRecords(familyId);
  const existing = pendingForHomework(records, homework.id);
  if (existing) {
    return { queued: false, reason: "already_pending", request: copyRecord(existing) };
  }

  const requestedAt = now.toISOString();
  let id;
  do {
    id = requestId();
  } while (records[id]);
  const record = {
    schemaVersion: 1,
    requestId: id,
    familyId,
    homeworkId: homework.id,
    kidId: homework.kidId,
    sourceUid: sourceUidForIdentity(moodle),
    moodle,
    desiredState: "done",
    display: {
      title: String(homework.title || "").slice(0, 200),
      subject: String(homework.subject || "").slice(0, 60),
      dueDate: String(homework.dueDate || "").slice(0, 10),
    },
    state: "pending",
    requestedAt,
    claimedAt: null,
    claimExpiresAt: null,
    acknowledgedAt: null,
    cancelledAt: null,
  };
  records[record.requestId] = record;
  return { queued: true, request: copyRecord(record) };
}

function cancelPendingInMemory(familyId, homeworkId, now = new Date()) {
  const records = familyRecords(familyId);
  const cancelledRequestIds = [];
  const cancelledAt = now.toISOString();
  for (const record of Object.values(records)) {
    if (record.homeworkId !== homeworkId || record.state !== "pending") continue;
    record.state = "cancelled";
    record.cancelledAt = cancelledAt;
    cancelledRequestIds.push(record.requestId);
  }
  return cancelledRequestIds;
}

function currentGenerationMatches(record, familyId, getHomework) {
  const homework = getHomework(record.homeworkId);
  return !!homework
    && homework.familyId === familyId
    && homework.status === "done"
    && homework.source === "school-portal"
    && homework.sourceUid === record.sourceUid
    && identityMatches(homework.moodleIdentity, record.moodle);
}

function recoverExpiredClaimsInMemory(familyId, getHomework, now = new Date()) {
  const records = familyRecords(familyId);
  const nowMs = now.getTime();
  const recoveredRequestIds = [];
  const cancelledRequestIds = [];
  for (const record of Object.values(records)) {
    if (record.state !== "dispatching") continue;
    const expiresAt = Date.parse(record.claimExpiresAt || "");
    if (Number.isFinite(expiresAt) && expiresAt > nowMs) continue;
    record.claimedAt = null;
    record.claimExpiresAt = null;
    if (currentGenerationMatches(record, familyId, getHomework)) {
      record.state = "pending";
      recoveredRequestIds.push(record.requestId);
    } else {
      record.state = "cancelled";
      record.cancelledAt = now.toISOString();
      cancelledRequestIds.push(record.requestId);
    }
  }
  return { recoveredRequestIds, cancelledRequestIds };
}

function listPending(familyId, getHomework, { limit = MAX_PENDING_BATCH } = {}, now = new Date()) {
  const recovery = recoverExpiredClaimsInMemory(familyId, getHomework, now);
  const pending = Object.values(familyRecords(familyId))
    .filter((record) => record.state === "pending")
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.requestId.localeCompare(b.requestId));
  const boundedLimit = Number.isInteger(limit) && limit > 0
    ? Math.min(limit, MAX_PENDING_BATCH)
    : MAX_PENDING_BATCH;
  return {
    completions: pending.slice(0, boundedLimit).map(copyRecord),
    hasMore: pending.length > boundedLimit,
    changed: recovery.recoveredRequestIds.length > 0 || recovery.cancelledRequestIds.length > 0,
  };
}

function claimInMemory(familyId, requestIdValue, getHomework, now = new Date()) {
  const records = familyRecords(familyId);
  const record = typeof requestIdValue === "string" ? records[requestIdValue] : null;
  if (!record) return { completion: null, changed: false };

  if (record.state === "dispatching") {
    const expiresAt = Date.parse(record.claimExpiresAt || "");
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
      recoverExpiredClaimsInMemory(familyId, getHomework, now);
    }
  }
  if (record.state !== "pending") return { completion: null, changed: false };
  if (!currentGenerationMatches(record, familyId, getHomework)) {
    record.state = "cancelled";
    record.cancelledAt = now.toISOString();
    return { completion: null, changed: true };
  }

  record.state = "dispatching";
  record.claimedAt = now.toISOString();
  record.claimExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MS).toISOString();
  return { completion: copyRecord(record), changed: true };
}

function acknowledgeInMemory(familyId, requestIds, now = new Date()) {
  const records = familyRecords(familyId);
  const ids = Array.isArray(requestIds) ? requestIds.slice(0, MAX_ACK_IDS) : [];
  const acknowledgedRequestIds = [];
  let changed = false;

  for (const rawId of ids) {
    if (typeof rawId !== "string") continue;
    const record = records[rawId];
    if (!record) continue;
    if (record.state === "acknowledged") {
      if (!acknowledgedRequestIds.includes(record.requestId)) acknowledgedRequestIds.push(record.requestId);
      continue;
    }
    // Only a server-claimed generation may be acknowledged. Once claimed,
    // delivery is committed: a concurrent local undo/identity change/delete
    // does not retroactively turn the verified remote write into an unclaimed
    // operation. Unclaimed pending work is still cancelable without a write.
    if (record.state !== "dispatching") continue;

    record.state = "acknowledged";
    record.claimExpiresAt = null;
    record.acknowledgedAt = now.toISOString();
    changed = true;
    if (!acknowledgedRequestIds.includes(record.requestId)) acknowledgedRequestIds.push(record.requestId);
  }

  return { acknowledgedRequestIds, changed };
}

module.exports = {
  sanitizeMoodleIdentity,
  sourceUidForIdentity,
  identityMatches,
  enqueueInMemory,
  cancelPendingInMemory,
  listPending,
  claimInMemory,
  acknowledgeInMemory,
  MAX_ACK_IDS,
  MAX_PENDING_BATCH,
  CLAIM_LEASE_MS,
};

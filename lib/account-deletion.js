"use strict";
/**
 * Account deletion (Apple 5.1.1(v); CLAUDE.md "Security & data").
 *
 * A parent who shares the family with a co-parent leaves it: they are removed
 * and the family code rotates so they can't rejoin. The LAST parent takes the
 * whole family with them: every kid profile and kid login, Screen Time,
 * fams, chat (messages and attachments, family room and private Hermes
 * threads), devices, watch tokens and every other family-keyed record.
 * Push tokens, web push subscriptions and watch devices of the deleted user
 * always go.
 */
const db = require("./db");
const store = require("./store");
const family = require("./family");
const chat = require("./chat");
const chatAttachments = require("./chat-attachments");
const displayPhotos = require("./display-photos");
const identities = require("./identity-subjects");
const grants = require("./integration-grants");

// Records stored in id-keyed maps that carry their own familyId.
const FAMILY_RECORD_MAPS = [
  (root) => root.kidRequests,
  (root) => root.kidSetupCodes,
  (root) => root.watchAuth && root.watchAuth.devices,
  (root) => root.watchAuth && root.watchAuth.pairings,
  (root) => root.displayAuth && root.displayAuth.devices,
  (root) => root.displayAuth && root.displayAuth.pairings,
];

function deleteChatScope(scopeKey) {
  chat.deleteScope(scopeKey);
  chatAttachments.removeScope(scopeKey);
}

function purgeFamily(root, fam, requestingParentId, schoolApi) {
  const kidUserIds = Object.entries(root.users || {})
    .filter(([, user]) => user && user.data && user.data.kid && user.data.kid.familyId === fam.id)
    .map(([id]) => id);

  for (const kid of [...fam.kids]) {
    const subject = identities.subjectForPrincipal("kid", fam.id, kid.id);
    family.removeKid(fam.id, requestingParentId, kid.id);
    store.removeKidUsersForProfile(fam.id, kid.id);
    if (schoolApi && typeof schoolApi.disconnect === "function") schoolApi.disconnect(fam.id, kid.id);
    if (subject) {
      identities.disableSubject(subject.id);
      grants.revokeGrant(subject.id);
    }
  }
  for (const userId of kidUserIds) removeUserDevices(root, userId);

  deleteChatScope(fam.id);
  displayPhotos.removeFamilyFiles(fam.id);
  for (const userId of [...fam.parentIds, ...kidUserIds]) deleteChatScope("hermes:" + userId);

  // Every top-level map keyed by family id ({ [familyId]: ... }) or by a
  // JSON [familyId, ...] tuple (student support, My Corner).
  const tuplePrefix = JSON.stringify([fam.id]).slice(0, -1) + ",";
  for (const [key, value] of Object.entries(root)) {
    if (key === "users" || key === "families" || !value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const entryKey of Object.keys(value)) {
      if (entryKey === fam.id || entryKey.startsWith(tuplePrefix)) delete value[entryKey];
    }
  }
  for (const pick of FAMILY_RECORD_MAPS) {
    const map = pick(root);
    if (!map) continue;
    for (const [id, record] of Object.entries(map)) {
      if (record && record.familyId === fam.id) delete map[id];
    }
  }
  delete root.families[fam.id];
}

function removeUserDevices(root, userId) {
  if (root.deviceTokens) delete root.deviceTokens[userId];
  if (root.webPushSubscriptions) delete root.webPushSubscriptions[userId];
  const devices = root.watchAuth && root.watchAuth.devices;
  if (devices) {
    for (const [id, device] of Object.entries(devices)) {
      if (device && device.targetUserId === userId) delete devices[id];
    }
  }
  // Display permissions were granted by this parent. Removing their account
  // also removes those grants, including pending one-time pairing codes.
  for (const map of [root.displayAuth?.devices, root.displayAuth?.pairings]) {
    if (!map) continue;
    for (const [id, record] of Object.entries(map)) {
      if (record && record.createdBy === userId) delete map[id];
    }
  }
}

/** Deletes `userId` (a parent) and returns what happened to their family. */
function deleteParentAccount(userId, { schoolApi } = {}) {
  const root = db.load();
  const result = { leftFamilyIds: [], deletedFamilyIds: [] };
  for (const fam of family.familiesForUser(userId)) {
    if (fam.parentIds.length > 1) {
      family.removeMember(fam.id, userId, userId); // also rotates the family code
      delete fam.parentInvite;
      result.leftFamilyIds.push(fam.id);
    } else {
      purgeFamily(root, fam, userId, schoolApi);
      result.deletedFamilyIds.push(fam.id);
    }
  }
  const parentSubject = identities.subjectForPrincipal("parent", null, userId);
  if (parentSubject) {
    identities.disableSubject(parentSubject.id);
    grants.revokeGrant(parentSubject.id);
  }
  deleteChatScope("hermes:" + userId);
  removeUserDevices(root, userId);
  store.deleteUser(userId);
  db.persist();
  db.flushSync();
  return result;
}

module.exports = { deleteParentAccount };

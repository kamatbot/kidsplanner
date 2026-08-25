"use strict";

const crypto = require("crypto");
const db = require("./db");

function collections(root) {
  if (!root.identitySubjects) root.identitySubjects = { byId: {}, byPrincipal: {} };
  if (!root.identitySubjects.byId) root.identitySubjects.byId = {};
  if (!root.identitySubjects.byPrincipal) root.identitySubjects.byPrincipal = {};
  return root.identitySubjects;
}

function principalKey(kind, familyId, principalId) {
  if (kind === "parent") return `parent:${principalId}`;
  return `kid:${familyId}:${principalId}`;
}

function randomSubjectId() {
  return "subj_" + crypto.randomBytes(18).toString("base64url");
}

function ensureSubject(kind, familyId, principalId, opts = {}) {
  if (!familyId || !principalId) throw new Error("Identity subjects require a family and principal id.");
  const ownedRoot = !opts.root;
  const root = opts.root || db.load();
  const set = collections(root);
  const key = principalKey(kind, familyId, principalId);
  const existingId = set.byPrincipal[key];
  if (existingId && set.byId[existingId]) {
    const existing = set.byId[existingId];
    if (opts.userId && !existing.userId) existing.userId = opts.userId;
    if (existing.status !== "active") existing.status = "active";
    existing.updatedAt = new Date().toISOString();
    if (ownedRoot) db.persist();
    return existing;
  }
  const now = new Date().toISOString();
  const subject = {
    id: randomSubjectId(),
    kind,
    familyId,
    principalId,
    userId: opts.userId || undefined,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  set.byId[subject.id] = subject;
  set.byPrincipal[key] = subject.id;
  if (ownedRoot) db.persist();
  return subject;
}

function ensureParentSubject(userId, familyId, opts = {}) {
  return ensureSubject("parent", familyId, userId, { ...opts, userId });
}

function ensureKidSubject(familyId, kidId, userId, opts = {}) {
  return ensureSubject("kid", familyId, kidId, { ...opts, userId });
}

function getSubject(id, root = db.load()) {
  return collections(root).byId[id] || null;
}

function subjectForPrincipal(kind, familyId, principalId, root = db.load()) {
  const set = collections(root);
  const id = set.byPrincipal[principalKey(kind, familyId, principalId)];
  return id ? set.byId[id] || null : null;
}

function subjectForUser(user, familyId, root = db.load()) {
  if (!user) return null;
  const kid = user.data && user.data.kid;
  if (kid && kid.familyId && kid.kidId) {
    return ensureKidSubject(kid.familyId, kid.kidId, user.id, { root });
  }
  if (!familyId) return null;
  return ensureParentSubject(user.id, familyId, { root });
}

function attachKidUser(familyId, kidId, userId, opts = {}) {
  return ensureKidSubject(familyId, kidId, userId, opts);
}

function disableSubject(subjectId) {
  const root = db.load();
  const subject = getSubject(subjectId, root);
  if (!subject) return false;
  subject.status = "disabled";
  subject.updatedAt = new Date().toISOString();
  db.persist();
  return true;
}

function derivePairwiseSubject(subjectId, clientId, secret) {
  if (!subjectId || !clientId) throw new Error("Pairwise subjects require a subject and client id.");
  if (!secret || String(secret).length < 32) throw new Error("OIDC_PAIRWISE_SUBJECT_KEY must contain at least 32 characters.");
  return "pws_" + crypto.createHmac("sha256", String(secret)).update(`${clientId}|${subjectId}`).digest("base64url");
}

function pairwiseSubject(subjectId, clientId = "pathodds") {
  return derivePairwiseSubject(subjectId, clientId, process.env.OIDC_PAIRWISE_SUBJECT_KEY || "");
}

function migrateAll() {
  const root = db.load();
  const set = collections(root);
  const families = root.families || {};
  for (const fam of Object.values(families)) {
    for (const parentId of fam.parentIds || []) ensureParentSubject(parentId, fam.id, { root });
    for (const kid of fam.kids || []) ensureKidSubject(fam.id, kid.id, undefined, { root });
  }
  for (const user of Object.values(root.users || {})) {
    const kid = user.data && user.data.kid;
    if (kid && kid.familyId && kid.kidId) ensureKidSubject(kid.familyId, kid.kidId, user.id, { root });
  }
  root.meta = root.meta || {};
  root.meta.identitySubjectsMigratedAt = root.meta.identitySubjectsMigratedAt || new Date().toISOString();
  db.persist();
  return { subjects: Object.keys(set.byId).length };
}

module.exports = {
  ensureParentSubject,
  ensureKidSubject,
  subjectForPrincipal,
  subjectForUser,
  attachKidUser,
  getSubject,
  disableSubject,
  derivePairwiseSubject,
  pairwiseSubject,
  migrateAll,
  principalKey,
};

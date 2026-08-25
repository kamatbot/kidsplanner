"use strict";

const crypto = require("crypto");
const db = require("./db");

function root() {
  const value = db.load();
  if (!value.integrationGrants) value.integrationGrants = {};
  return value;
}

function key(provider, subjectId) {
  return `${provider}:${subjectId}`;
}

function ensureGrant({ provider = "pathodds", subjectId, familyId, grantedBySubjectId, scopes, role }) {
  if (!subjectId || !familyId) throw new Error("Integration grants require a subject and family.");
  const r = root();
  const grantKey = key(provider, subjectId);
  const existing = r.integrationGrants[grantKey];
  const now = new Date().toISOString();
  const grant = existing || {
    id: "grant_" + crypto.randomBytes(12).toString("base64url"),
    provider,
    subjectId,
    familyId,
    createdAt: now,
  };
  grant.grantedBySubjectId = grantedBySubjectId || subjectId;
  grant.scopes = [...new Set(scopes || ["openid", "sat:work", "sat:quest-summary:read", "sat:launch"])];
  grant.role = role || "student";
  grant.status = "active";
  grant.consentVersion = "pathodds-link-v1";
  grant.updatedAt = now;
  delete grant.revokedAt;
  r.integrationGrants[grantKey] = grant;
  db.persist();
  return grant;
}

function getGrant(subjectId, provider = "pathodds") {
  return root().integrationGrants[key(provider, subjectId)] || null;
}

function revokeGrant(subjectId, provider = "pathodds") {
  const grant = getGrant(subjectId, provider);
  if (!grant) return false;
  grant.status = "revoked";
  grant.revokedAt = new Date().toISOString();
  grant.updatedAt = grant.revokedAt;
  db.persist();
  return true;
}

module.exports = { ensureGrant, getGrant, revokeGrant };

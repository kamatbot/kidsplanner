"use strict";
/**
 * KID ACCESS REQUESTS — the request→approve→passkey flow that replaces the old
 * "parent signs in on the kid's device and provisions a passkey" path.
 *
 * On their OWN device (no parent session there), a kid enters the family invite
 * code + a name. That creates a PENDING request — no kid profile yet. Every
 * family parent gets a push + an in-app card; a parent approving CREATES the kid
 * profile and unlocks passkey registration. The kid then registers a passkey and
 * is signed straight in.
 *
 * Security: `pollToken` (a per-request secret returned only to the requesting
 * device) gates every kid-side call, so guessing a request id is not enough to
 * drive it. Requests expire (TTL) and there's a per-family pending cap so a
 * shared invite code can't be used to flood a family with prompts. Nothing here
 * grants access on its own — a parent approval is always required before a
 * passkey can be registered.
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");

const TTL_MS = 30 * 60 * 1000; // a request is actionable for 30 minutes
const REAP_MS = 60 * 60 * 1000; // fully drop requests an hour past expiry
const MAX_PENDING_PER_FAMILY = 10; // spam backstop for a shared invite code

function root() {
  const r = db.load();
  if (!r.kidRequests) r.kidRequests = {};
  return r;
}
function rid() { return "rq_" + crypto.randomBytes(12).toString("hex"); }
function newToken() { return crypto.randomBytes(24).toString("hex"); }
function nowMs() { return Date.now(); }
function actExpired(req) { return !req || nowMs() > req.expiresAt; }

// Drop used requests and ones well past their window so lists stay clean and the
// per-family cap is fair. Called on the write paths (create/list/approve).
function sweep() {
  const r = root();
  let changed = false;
  for (const [id, req] of Object.entries(r.kidRequests)) {
    if (req.status === "used" || req.status === "denied" || nowMs() > req.expiresAt + REAP_MS) {
      delete r.kidRequests[id];
      changed = true;
    }
  }
  if (changed) db.persist();
}

// Client-safe views — never leak pollToken or internal reg state.
function publicForParent(req) {
  return { id: req.id, name: req.name, deviceLabel: req.deviceLabel, createdAt: req.createdAt };
}

// --- Kid device: create a pending request from an invite code + chosen name ---
function createRequest(inviteCode, name, deviceLabel) {
  sweep();
  const fam = family.findByInviteCode(inviteCode);
  // Invite codes are meant to be shared with the family, so a clear "not found"
  // is friendlier than a generic error and leaks little; the parent-approval
  // gate — not code secrecy — is what actually protects the account.
  if (!fam) return { error: "That family code wasn't found. Double-check it with your parent." };
  const cleanName = String(name || "").trim().slice(0, 60);
  if (cleanName.length < 1) return { error: "Enter your name so your parent knows it's you." };
  const r = root();
  const pending = Object.values(r.kidRequests).filter(
    (q) => q.familyId === fam.id && q.status === "pending" && !actExpired(q)
  );
  if (pending.length >= MAX_PENDING_PER_FAMILY) {
    return { error: "There are already several requests waiting. Ask your parent to approve one first." };
  }
  const req = {
    id: rid(),
    familyId: fam.id,
    name: cleanName,
    deviceLabel: String(deviceLabel || "A device").trim().slice(0, 80) || "A device",
    status: "pending", // pending -> approved -> used (or denied / expired)
    pollToken: newToken(),
    kidId: null, // set on approval (the new profile's id)
    kidUserId: null, // set when registration begins
    regChallenge: null,
    approvedByUserId: null,
    approvedAt: null,
    createdAt: new Date().toISOString(),
    expiresAt: nowMs() + TTL_MS,
  };
  r.kidRequests[req.id] = req;
  db.persist();
  return { request: req, family: fam };
}

// --- Kid device: poll status (pollToken-gated) ---
function statusForKid(id, pollToken) {
  const req = root().kidRequests[id];
  if (!req || req.pollToken !== pollToken) return { status: "not_found" };
  if (req.status === "pending" && actExpired(req)) return { status: "expired", name: req.name };
  if (req.status === "approved" && actExpired(req)) return { status: "expired", name: req.name };
  return { status: req.status, name: req.name };
}

// --- Parent: list pending requests for their family ---
function listPendingForFamily(familyId) {
  sweep();
  return Object.values(root().kidRequests)
    .filter((q) => q.familyId === familyId && q.status === "pending" && !actExpired(q))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(publicForParent);
}

// --- Parent: approve — creates the kid profile now and unlocks registration ---
function approve(familyId, parentId, id) {
  const req = root().kidRequests[id];
  if (!req || req.familyId !== familyId) return { error: "That request wasn't found." };
  if (req.status !== "pending") return { error: "That request was already handled." };
  if (actExpired(req)) return { error: "That request expired — ask them to try again." };
  const added = family.addKid(familyId, parentId, { name: req.name });
  if (added.error) return { error: added.error };
  req.status = "approved";
  req.kidId = added.kid.id;
  req.approvedByUserId = parentId;
  req.approvedAt = new Date().toISOString();
  req.expiresAt = nowMs() + TTL_MS; // fresh window for the kid to register
  db.persist();
  return { request: req, kid: added.kid, family: added.family };
}

// --- Parent: deny ---
function deny(familyId, parentId, id) {
  const req = root().kidRequests[id];
  if (!req || req.familyId !== familyId) return { error: "That request wasn't found." };
  if (req.status !== "pending") return { error: "That request was already handled." };
  req.status = "denied";
  db.persist();
  return { ok: true };
}

// --- Kid device (after approval): fetch the approved request for registration ---
function getApproved(id, pollToken) {
  const req = root().kidRequests[id];
  if (!req || req.pollToken !== pollToken) return null;
  if (req.status !== "approved" || actExpired(req)) return null;
  return req;
}

// Stash the WebAuthn challenge + the resolved kid user id for the verify step.
function setRegistration(id, pollToken, challenge, kidUserId) {
  const req = getApproved(id, pollToken);
  if (!req) return { error: "not_approved" };
  req.regChallenge = challenge;
  req.kidUserId = kidUserId;
  db.persist();
  return { request: req };
}

// Mark used once the passkey is registered (single-use request).
function complete(id, pollToken) {
  const req = root().kidRequests[id];
  if (!req || req.pollToken !== pollToken) return { error: "not_found" };
  req.status = "used";
  db.persist();
  return { request: req };
}

module.exports = {
  createRequest,
  statusForKid,
  listPendingForFamily,
  approve,
  deny,
  getApproved,
  setRegistration,
  complete,
  TTL_MS,
  MAX_PENDING_PER_FAMILY,
};

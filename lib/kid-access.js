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
 *
 * SETUP CODES (docs/SCREEN-TIME-ONLY-PLAN.md D6/D7): a parent can instead show a
 * short per-kid code. The kid types it on their own device, which creates a
 * request TARGETED at that existing kid profile; approval then links to that kid
 * (no new profile). An approved request can also sign the kid in without a
 * passkey, exactly once (issueSession).
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");

const TTL_MS = 30 * 60 * 1000; // a request is actionable for 30 minutes
const REAP_MS = 60 * 60 * 1000; // fully drop requests an hour past expiry
const MAX_PENDING_PER_FAMILY = 10; // spam backstop for a shared invite code

// Setup codes: 6 chars, unambiguous alphabet (no 0/O/1/I), 30-minute single use.
const SETUP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SETUP_CODE_LEN = 6;
const SETUP_TTL_MS = 30 * 60 * 1000;

function root() {
  const r = db.load();
  if (!r.kidRequests) r.kidRequests = {};
  if (!r.kidSetupCodes) r.kidSetupCodes = {};
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
    // A "used" request lingers until its window closes so a replayed
    // no-passkey sign-in (issueSession) answers 409 instead of 404.
    const spent = req.status === "used" && nowMs() > req.expiresAt;
    if (spent || req.status === "denied" || nowMs() > req.expiresAt + REAP_MS) {
      delete r.kidRequests[id];
      changed = true;
    }
  }
  // Setup codes are only ever stored hashed, and are dropped as soon as they lapse.
  for (const [hash, rec] of Object.entries(r.kidSetupCodes)) {
    if (nowMs() > rec.expiresAt) {
      delete r.kidSetupCodes[hash];
      changed = true;
    }
  }
  if (changed) db.persist();
}

// Client-safe views — never leak pollToken or internal reg state.
function publicForParent(req) {
  return { id: req.id, name: req.name, deviceLabel: req.deviceLabel, createdAt: req.createdAt, kidId: req.targeted ? req.kidId : null };
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
  let kid;
  let fam;
  if (req.targeted) {
    // Setup-code request: link to the EXISTING kid profile, never create one.
    fam = family.getFamily(familyId);
    if (!fam || !fam.parentIds.includes(parentId)) return { error: "Only a parent in this family can approve a kid." };
    kid = fam.kids.find((k) => k.id === req.kidId);
    if (!kid) return { error: "That kid profile is no longer available." };
  } else {
    const added = family.addKid(familyId, parentId, { name: req.name });
    if (added.error) return { error: added.error };
    kid = added.kid;
    fam = added.family;
    req.kidId = kid.id;
  }
  req.status = "approved";
  req.approvedByUserId = parentId;
  req.approvedAt = new Date().toISOString();
  req.expiresAt = nowMs() + TTL_MS; // fresh window for the kid to register
  db.persist();
  return { request: req, kid, family: fam };
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

// ===================== per-kid setup codes =====================

function normalizeSetupCode(code) {
  return String(code == null ? "" : code).toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function hashSetupCode(normalized) {
  return crypto.createHash("sha256").update("fam-kid-setup:" + normalized).digest("hex");
}
function genSetupCode() {
  let out = "";
  while (out.length < SETUP_CODE_LEN) {
    const byte = crypto.randomBytes(1)[0];
    if (byte >= 256 - (256 % SETUP_ALPHABET.length)) continue; // no modulo bias
    out += SETUP_ALPHABET[byte % SETUP_ALPHABET.length];
  }
  return out;
}

// Parent: mint (or replace) the single live setup code for one kid. Returns the
// plaintext once; only a hash is stored. The caller has already verified the
// kid belongs to the parent's family.
function issueSetupCode(familyId, kidId) {
  sweep();
  const r = root();
  for (const [hash, rec] of Object.entries(r.kidSetupCodes)) {
    if (rec.familyId === familyId && rec.kidId === kidId) delete r.kidSetupCodes[hash];
  }
  let code;
  let hash;
  do {
    code = genSetupCode();
    hash = hashSetupCode(code);
  } while (r.kidSetupCodes[hash]);
  const expiresAt = nowMs() + SETUP_TTL_MS;
  r.kidSetupCodes[hash] = { familyId, kidId, createdAt: new Date().toISOString(), expiresAt };
  db.persist();
  return { code, expiresAt: new Date(expiresAt).toISOString(), kidId };
}

// Kid device: spend a setup code and open a request targeted at that kid.
// Failure shapes: { notFound: true } (bad/expired/used — deliberately one
// answer) or { error, status } when the family has too many requests waiting.
function claimSetupCode(rawCode, deviceLabel) {
  sweep();
  const normalized = normalizeSetupCode(rawCode);
  if (normalized.length !== SETUP_CODE_LEN) return { notFound: true };
  const r = root();
  const hash = hashSetupCode(normalized);
  const rec = r.kidSetupCodes[hash];
  if (!rec || nowMs() > rec.expiresAt) return { notFound: true };
  const fam = family.getFamily(rec.familyId);
  const kid = fam && fam.kids.find((k) => k.id === rec.kidId);
  if (!kid) {
    delete r.kidSetupCodes[hash];
    db.persist();
    return { notFound: true };
  }
  // A re-claim for the same kid replaces that kid's earlier unanswered request.
  for (const [id, q] of Object.entries(r.kidRequests)) {
    if (q.familyId === fam.id && q.targeted && q.kidId === kid.id && q.status === "pending") delete r.kidRequests[id];
  }
  const pending = Object.values(r.kidRequests).filter(
    (q) => q.familyId === fam.id && q.status === "pending" && !actExpired(q)
  );
  if (pending.length >= MAX_PENDING_PER_FAMILY) {
    return { error: "There are already several requests waiting. Ask your parent to approve one first.", status: 429 };
  }
  delete r.kidSetupCodes[hash]; // single use
  const req = {
    id: rid(),
    familyId: fam.id,
    name: kid.name,
    deviceLabel: String(deviceLabel || "A device").trim().slice(0, 80) || "A device",
    status: "pending",
    pollToken: newToken(),
    targeted: true,
    kidId: kid.id,
    kidUserId: null,
    regChallenge: null,
    approvedByUserId: null,
    approvedAt: null,
    createdAt: new Date().toISOString(),
    expiresAt: nowMs() + TTL_MS,
  };
  r.kidRequests[req.id] = req;
  db.persist();
  return { request: req, family: fam, kid };
}

// Kid device (approved request only, once): the passkey-less sign-in of D7.
// Returns { request } and marks it used, or { error, status, code }.
function issueSession(id, pollToken) {
  const req = root().kidRequests[id];
  if (!req || req.pollToken !== pollToken) return { error: "That request wasn't found.", status: 404, code: "not_found" };
  if (req.status === "used") return { error: "This request was already used to sign in.", status: 409, code: "session_already_issued" };
  if (req.status !== "approved" || actExpired(req)) {
    return { error: "This request isn't approved yet (or has expired).", status: 400, code: "not_approved" };
  }
  req.status = "used";
  req.sessionIssuedAt = new Date().toISOString();
  db.persist();
  return { request: req };
}

// Parent-overview evidence for one kid's setup checklist.
function setupStatus(familyId, kidId) {
  const r = root();
  const now = nowMs();
  const codeActive = Object.values(r.kidSetupCodes).some(
    (c) => c.familyId === familyId && c.kidId === kidId && now <= c.expiresAt
  );
  const requestPending = Object.values(r.kidRequests).some(
    (q) => q.familyId === familyId && q.kidId === kidId && q.status === "pending" && now <= q.expiresAt
  );
  // signedIn: a kid user exists for this profile AND has a passkey or a
  // completed no-passkey session (a user alone can exist mid-registration).
  const signedIn = Object.values(r.users || {}).some((u) => {
    const link = u && u.data && u.data.kid;
    if (!link || link.familyId !== familyId || link.kidId !== kidId) return false;
    return (u.credentials || []).length > 0 || !!link.sessionIssuedAt;
  });
  return { codeActive, requestPending, signedIn };
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
  issueSetupCode,
  claimSetupCode,
  issueSession,
  setupStatus,
  normalizeSetupCode,
  SETUP_ALPHABET,
  SETUP_CODE_LEN,
  SETUP_TTL_MS,
  TTL_MS,
  MAX_PENDING_PER_FAMILY,
};

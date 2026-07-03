"use strict";
/**
 * User (parent) + per-user data accessors layered on the JSON datastore.
 *
 * Fam ETC is a PARENTS' app (see APP-BRIEF.md "Kids' privacy & compliance"):
 * every `user` record here is a parent, created only via passkey signup.
 * There is no direct kid signup — kid profiles live under a family (see
 * lib/family.js) and are created only by a parent already in that family.
 * The trial/subscription relationship in lib/billing.js is keyed to this
 * parent user record. Referrals are deliberately not implemented (brief:
 * "Referrals: decided: none — add later").
 */
const crypto = require("crypto");
const db = require("./db");
const { newUserData } = require("./seed");

// ---------- in-memory indexes ----------
// Credential-id lookup otherwise scans ALL users on every passkey verify.
// Build an O(1) index once, tied to the loaded root's identity, and
// invalidate only on the mutations that touch it.
let _idx = null;
let _idxRoot = null;
function indexes() {
  const root = db.load();
  if (_idx && _idxRoot === root) return _idx;
  const cred = new Map(); // credId -> userId
  for (const u of Object.values(root.users)) {
    for (const c of u.credentials || []) cred.set(c.id, u.id);
  }
  _idx = { cred };
  _idxRoot = root;
  return _idx;
}
function invalidateIndexes() {
  _idx = null;
}

function uid() {
  return "u_" + crypto.randomBytes(9).toString("hex");
}

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getUser(id) {
  return db.load().users[id] || null;
}

// ---------- root metadata (non-user, app-level flags) ----------
function metaGet(key) {
  const root = db.load();
  return root.meta ? root.meta[key] : undefined;
}
function metaSet(key, value) {
  const root = db.load();
  if (!root.meta) root.meta = {};
  root.meta[key] = value;
  db.persist();
  return value;
}

// ---------- billing lookups ----------
// Webhooks identify a user by Stripe customer id. Subscriptions are rare
// events, so a linear scan is fine and avoids carrying another index.
function findByStripeCustomerId(customerId) {
  if (!customerId) return null;
  const root = db.load();
  for (const u of Object.values(root.users)) {
    if (u.billing && u.billing.stripeCustomerId === customerId) return u;
  }
  return null;
}

// One-time snapshot: stamp every account that exists right now as
// "grandfathered" (permanent free access), so accounts created before
// billing (or before iOS IAP) was enabled are never locked out. Idempotent —
// guarded by a root meta marker so it runs at most once, ever.
function grandfatherExisting() {
  const root = db.load();
  if (!root.meta) root.meta = {};
  if (root.meta.grandfatheredAt) return false; // already ran
  const now = new Date().toISOString();
  for (const u of Object.values(root.users)) {
    if (!u.billing) u.billing = { status: "grandfathered", since: now };
    else if (!u.billing.status) u.billing.status = "grandfathered";
  }
  root.meta.grandfatheredAt = now;
  db.persist();
  return true;
}

// Total number of registered (parent) accounts.
function countUsers() {
  const root = db.load();
  return Object.keys(root.users || {}).length;
}

// Create a (passkey-only) PARENT user. `opts.id` lets the caller pin the id —
// used by passkey sign-up, where the id is minted up front so it can be baked
// into the WebAuthn credential's user handle before the account is persisted.
function createUser(email, name, opts = {}) {
  const root = db.load();
  const id = opts.id || uid();
  const user = {
    id,
    email: normEmail(email),
    createdAt: new Date().toISOString(),
    data: newUserData(name, normEmail(email)),
  };
  // iOS accounts are stamped grandfathered at creation: permanent free access
  // that survives turning on the web subscription gate (StoreKit IAP ships later).
  if (opts.grandfathered) {
    user.billing = { status: "grandfathered", since: user.createdAt, source: "ios" };
  }
  root.users[id] = user;
  db.persist();
  invalidateIndexes();
  return user;
}

// Find the login-bearing user record for a kid profile, or create one if this
// is the kid's first device provisioning. Kid users have no email/signup path
// (see APP-BRIEF.md "Kids' privacy & compliance") — they're only ever created
// here, from a parent-authenticated device-provisioning flow (server.js).
// data.kid = { familyId, kidId } links the login back to the kid profile
// nested on the family (lib/family.js); data.profile.role = "kid" marks the
// account as role-scoped everywhere requireParent / UI checks look at it.
function findOrCreateKidUser(familyId, kidId, kidName) {
  const root = db.load();
  for (const u of Object.values(root.users)) {
    if (u.data && u.data.kid && u.data.kid.familyId === familyId && u.data.kid.kidId === kidId) {
      return u;
    }
  }
  const id = uid();
  const user = {
    id,
    email: "",
    createdAt: new Date().toISOString(),
    data: newUserData(kidName, ""),
  };
  user.data.profile.role = "kid";
  user.data.kid = { familyId, kidId };
  root.users[id] = user;
  db.persist();
  invalidateIndexes();
  return user;
}

// All kid user records already provisioned for a family (i.e. kids who have
// signed in on at least one device — see findOrCreateKidUser). Used for web
// push fan-out, which needs a userId to key subscriptions by; a kid with no
// provisioned device has no userId yet and simply has no subscriptions.
function listKidUserIdsForFamily(familyId) {
  const root = db.load();
  return Object.values(root.users)
    .filter((u) => u.data && u.data.kid && u.data.kid.familyId === familyId)
    .map((u) => u.id);
}

// Permanently remove a user and ALL their data (profile, settings, passkey
// credentials all live on the user record). Irreversible. Does NOT remove
// them from a family they parent — call family.removeMember first if needed.
function deleteUser(id) {
  const root = db.load();
  if (!root.users[id]) return false;
  delete root.users[id];
  db.persist();
  invalidateIndexes();
  return true;
}

function saveUser(user) {
  const root = db.load();
  root.users[user.id] = user;
  db.persist();
  return user;
}

// Mutate a user's data object via an updater fn, then persist.
function updateData(id, updater) {
  const user = getUser(id);
  if (!user) return null;
  updater(user.data);
  saveUser(user);
  return user.data;
}

// ---------- passkeys / WebAuthn credentials ----------
// Each user carries a `credentials` array. A credential record:
//   { id, publicKey, counter, transports, deviceType, backedUp, name,
//     createdAt, lastUsed }
// where `id` is the base64url credential ID and `publicKey` is the base64url
// COSE public key. We key authentication off `id`, so look-up by credential ID
// powers usernameless ("discoverable") passkey sign-in.
function listCredentials(id) {
  const user = getUser(id);
  return (user && user.credentials) || [];
}

function findByCredentialId(credId) {
  if (!credId) return null;
  const id = indexes().cred.get(credId);
  return id ? db.load().users[id] || null : null;
}

function addCredential(userId, cred) {
  const user = getUser(userId);
  if (!user) return null;
  if (!user.credentials) user.credentials = [];
  user.credentials.push(cred);
  saveUser(user);
  invalidateIndexes();
  return cred;
}

// Bump the signature counter after a successful authentication (replay defence).
function updateCredentialCounter(credId, counter) {
  const user = findByCredentialId(credId);
  if (!user) return;
  const c = (user.credentials || []).find((x) => x.id === credId);
  if (c) {
    c.counter = counter;
    c.lastUsed = new Date().toISOString();
    saveUser(user);
  }
}

function removeCredential(userId, credId) {
  const user = getUser(userId);
  if (!user || !user.credentials) return [];
  user.credentials = user.credentials.filter((c) => c.id !== credId);
  saveUser(user);
  invalidateIndexes();
  return user.credentials;
}

function renameCredential(userId, credId, name) {
  const user = getUser(userId);
  if (!user || !user.credentials) return [];
  const c = user.credentials.find((x) => x.id === credId);
  if (c) c.name = String(name || "").slice(0, 60) || c.name;
  saveUser(user);
  return user.credentials;
}

module.exports = {
  getUser,
  countUsers,
  createUser,
  findOrCreateKidUser,
  listKidUserIdsForFamily,
  metaGet,
  metaSet,
  findByStripeCustomerId,
  grandfatherExisting,
  deleteUser,
  saveUser,
  updateData,
  normEmail,
  listCredentials,
  findByCredentialId,
  addCredential,
  updateCredentialCounter,
  removeCredential,
  renameCredential,
};

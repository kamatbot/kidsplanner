"use strict";

/**
 * Standalone watch credentials.
 *
 * A parent creates a short-lived pairing code for a specific family member.
 * The watch redeems it once over HTTPS and receives a long-lived bearer token.
 * Only hashes of pairing codes and bearer tokens are persisted. Tokens are
 * deliberately narrower than web sessions: server.js only permits them to
 * reach the watch's read-and-complete surfaces.
 */
const crypto = require("crypto");
const db = require("./db");

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS = 5;
const TOKEN_PREFIX = "fwt_";

function root() {
  const r = db.load();
  if (!r.watchAuth) r.watchAuth = { pairings: {}, devices: {} };
  if (!r.watchAuth.pairings) r.watchAuth.pairings = {};
  if (!r.watchAuth.devices) r.watchAuth.devices = {};
  return r;
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function randomCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = "";
  for (const byte of bytes) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return out;
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function normalizeCode(value) {
  return String(value || "").toUpperCase().replace(/[\s-]/g, "");
}

function validCode(value) {
  return /^[A-Z2-9]{8}$/.test(value) && [...value].every((c) => CODE_ALPHABET.includes(c));
}

function publicDevice(device) {
  return {
    id: device.id,
    familyId: device.familyId,
    targetType: device.targetType,
    targetUserId: device.targetUserId,
    targetKidId: device.targetKidId || null,
    targetName: device.targetName,
    label: device.label,
    createdAt: device.createdAt,
    lastUsedAt: device.lastUsedAt || null,
    revokedAt: device.revokedAt || null,
  };
}

function createPairing({ familyId, targetUserId, targetType, targetKidId, targetName, createdBy }) {
  if (!familyId || !targetUserId || !createdBy) return { error: "A family member is required." };
  const now = Date.now();
  const r = root();
  for (const pairing of Object.values(r.watchAuth.pairings)) {
    if (pairing.familyId === familyId && pairing.targetUserId === targetUserId && pairing.status === "pending") {
      pairing.status = "superseded";
    }
  }
  let code;
  let codeHash;
  do {
    code = randomCode();
    codeHash = hash(code);
  } while (Object.values(r.watchAuth.pairings).some((p) => p.codeHash === codeHash && p.status === "pending"));
  const pairing = {
    id: randomId("wp"),
    familyId,
    targetUserId,
    targetType: targetType === "kid" ? "kid" : "parent",
    targetKidId: targetKidId || null,
    targetName: String(targetName || "Family member").trim().slice(0, 60),
    createdBy,
    codeHash,
    attempts: 0,
    status: "pending",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PAIRING_TTL_MS).toISOString(),
    claimedAt: null,
    deviceId: null,
  };
  r.watchAuth.pairings[pairing.id] = pairing;
  db.persist();
  return {
    pairing: {
      id: pairing.id,
      targetType: pairing.targetType,
      targetName: pairing.targetName,
      code,
      createdAt: pairing.createdAt,
      expiresAt: pairing.expiresAt,
    },
  };
}

function claimPairing(rawCode, label) {
  const code = normalizeCode(rawCode);
  if (!validCode(code)) return { error: "Enter the 8-character code from your parent." };
  const r = root();
  const codeHash = hash(code);
  const pairing = Object.values(r.watchAuth.pairings).find((p) => p.codeHash === codeHash && p.status === "pending");
  if (!pairing) return { error: "That pairing code is invalid or has expired." };
  if (Date.now() > Date.parse(pairing.expiresAt)) {
    pairing.status = "expired";
    db.persist();
    return { error: "That pairing code is invalid or has expired." };
  }
  pairing.attempts += 1;
  if (pairing.attempts > MAX_PAIRING_ATTEMPTS) {
    pairing.status = "locked";
    db.persist();
    return { error: "Too many attempts. Ask your parent for a new code." };
  }

  const rawToken = TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
  const device = {
    id: randomId("wd"),
    familyId: pairing.familyId,
    targetUserId: pairing.targetUserId,
    targetType: pairing.targetType,
    targetKidId: pairing.targetKidId || null,
    targetName: pairing.targetName,
    label: String(label || "Fam ETC watch").trim().slice(0, 80) || "Fam ETC watch",
    tokenHash: hash(rawToken),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };
  r.watchAuth.devices[device.id] = device;
  pairing.status = "claimed";
  pairing.claimedAt = device.createdAt;
  pairing.deviceId = device.id;
  db.persist();
  return { token: rawToken, device: publicDevice(device) };
}

function resolveToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token.startsWith(TOKEN_PREFIX) || token.length < TOKEN_PREFIX.length + 32) return null;
  const tokenHash = hash(token);
  const r = root();
  const device = Object.values(r.watchAuth.devices).find((d) => d.tokenHash === tokenHash && !d.revokedAt);
  if (!device) return null;
  const now = Date.now();
  if (!device.lastUsedAt || now - Date.parse(device.lastUsedAt) > 5 * 60 * 1000) {
    device.lastUsedAt = new Date(now).toISOString();
    db.persist();
  }
  return { ...publicDevice(device), tokenHash };
}

function listDevices(familyId) {
  return Object.values(root().watchAuth.devices)
    .filter((device) => device.familyId === familyId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(publicDevice);
}

function revokeDevice(familyId, deviceId) {
  const device = root().watchAuth.devices[deviceId];
  if (!device || device.familyId !== familyId) return { error: "Watch not found." };
  if (!device.revokedAt) {
    device.revokedAt = new Date().toISOString();
    db.persist();
  }
  return { device: publicDevice(device) };
}

function allowedRequest(method, path) {
  const verb = String(method || "").toUpperCase();
  const route = String(path || "");
  if (verb === "GET") return new Set([
    "/api/family/actions",
    "/api/homework",
    "/api/meals/shopping",
  ]).has(route);
  if (verb === "PATCH") return /^\/api\/family\/actions\/[^/]+$/.test(route)
    || /^\/api\/homework\/[^/]+$/.test(route)
    || /^\/api\/homework\/[^/]+\/checklist\/\d+$/.test(route)
    || /^\/api\/meals\/shopping\/[^/]+$/.test(route);
  if (verb === "POST") return route === "/api/watch/push/register" || route === "/api/watch/push/unregister";
  return false;
}

module.exports = {
  CODE_LENGTH,
  PAIRING_TTL_MS,
  MAX_PAIRING_ATTEMPTS,
  TOKEN_PREFIX,
  normalizeCode,
  validCode,
  createPairing,
  claimPairing,
  resolveToken,
  listDevices,
  revokeDevice,
  allowedRequest,
};

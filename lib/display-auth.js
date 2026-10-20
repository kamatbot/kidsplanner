"use strict";

// A shared display is its own principal. These credentials must never be
// accepted by server.js requireAuth or converted into a parent/kid session.
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const MAX_DEVICES_PER_FAMILY = 12;
const MAX_PENDING_PER_FAMILY = 4;
const REVOKED_RETENTION_MS = 30 * 86400000;
const TOKEN_PREFIX = "fdp_";

function hash(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}
function normalizeCode(value) {
  return typeof value === "string" && value.length <= 64 ? value.toUpperCase().replace(/[\s-]/g, "") : "";
}
function validCode(value) {
  return value.length === CODE_LENGTH && [...value].every((c) => CODE_ALPHABET.includes(c));
}
function validTimeZone(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 64) return null;
  // Newer Intl implementations also accept bare UTC offsets. This contract
  // uses named zones so daylight-saving rules remain meaningful on Android.
  if (/^[+-]/.test(value.trim())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch (_) {
    return null;
  }
}
function cleanSettings(input, partial = false) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Display settings must be an object.", status: 400 };
  }
  const value = {};
  if (!partial || input.label !== undefined) {
    const label = input.label === undefined ? "Family display" : input.label;
    if (typeof label !== "string" || !label.trim() || label.trim().length > 60) {
      return { error: "Give the display a name of 1–60 characters.", status: 400 };
    }
    value.label = label.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!value.label) return { error: "Give the display a name.", status: 400 };
  }
  if (!partial || input.timeZone !== undefined) {
    const timeZone = validTimeZone(input.timeZone === undefined ? "Asia/Bangkok" : input.timeZone);
    if (!timeZone) return { error: "Choose a valid time zone.", status: 400 };
    value.timeZone = timeZone;
  }
  for (const key of ["showHomework", "showMeals"]) {
    if (partial && input[key] === undefined) continue;
    if (input[key] !== undefined && typeof input[key] !== "boolean") {
      return { error: "Display choices must be true or false.", status: 400 };
    }
    value[key] = input[key] === undefined ? true : input[key];
  }
  return { value };
}
function publicDevice(device) {
  return {
    id: device.id,
    label: device.label,
    timeZone: device.timeZone,
    showHomework: device.showHomework === true,
    showMeals: device.showMeals === true,
    model: device.model || "",
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt || null,
    revokedAt: device.revokedAt || null,
  };
}

function createDisplayAuth({ database = db, familyStore = family, now = Date.now } = {}) {
  function root() {
    const r = database.load();
    if (!r.displayAuth) r.displayAuth = { pairings: {}, devices: {} };
    if (!r.displayAuth.pairings) r.displayAuth.pairings = {};
    if (!r.displayAuth.devices) r.displayAuth.devices = {};
    return r.displayAuth;
  }

  // flushSync intentionally records rather than throws filesystem errors.
  // Check the generation before exposing a code/token or claiming revocation.
  function persistDurably() {
    database.persist();
    const target = database.persistenceStatus().mutationGeneration;
    database.flushSync();
    const state = database.persistenceStatus();
    if (state.lastWriteError || state.committedGeneration < target) {
      const error = new Error("Display changes could not be saved. Please try again.");
      error.status = 503;
      error.code = "display_storage_unavailable";
      throw error;
    }
  }

  function eligibility(familyId, createdBy) {
    const fam = familyStore.getFamily(familyId);
    const parent = database.load().users && database.load().users[createdBy];
    const role = parent && parent.data && parent.data.profile && parent.data.profile.role;
    if (!fam || !parent || (role && role !== "parent")
        || !Array.isArray(fam.parentIds) || !fam.parentIds.includes(createdBy)) return null;
    if (!familyStore.isFull(fam)) {
      return { error: "This display requires the whole Fam ETC.", status: 403, code: "upgrade_required" };
    }
    return { family: fam };
  }

  function prune(at) {
    const state = root();
    let changed = false;
    for (const [id, pairing] of Object.entries(state.pairings)) {
      if (!pairing || !Number.isFinite(Date.parse(pairing.expiresAt)) || Date.parse(pairing.expiresAt) <= at) {
        delete state.pairings[id];
        changed = true;
      }
    }
    for (const [id, device] of Object.entries(state.devices)) {
      if (device && device.revokedAt && Date.parse(device.revokedAt) <= at - REVOKED_RETENTION_MS) {
        delete state.devices[id];
        changed = true;
      }
    }
    const revokedByFamily = new Map();
    for (const device of Object.values(state.devices)) {
      if (!device.revokedAt) continue;
      if (!revokedByFamily.has(device.familyId)) revokedByFamily.set(device.familyId, []);
      revokedByFamily.get(device.familyId).push(device);
    }
    for (const records of revokedByFamily.values()) {
      records.sort((a, b) => b.revokedAt.localeCompare(a.revokedAt));
      for (const record of records.slice(100 - MAX_DEVICES_PER_FAMILY)) {
        delete state.devices[record.id];
        changed = true;
      }
    }
    if (changed) database.persist();
  }

  function countActive(familyId) {
    return Object.values(root().devices).filter((d) => d.familyId === familyId && !d.revokedAt).length;
  }

  function createPairing({ familyId, createdBy, ...settings } = {}) {
    const allowed = eligibility(familyId, createdBy);
    if (!allowed) return { error: "A parent in this family must pair the display.", status: 403 };
    if (allowed.error) return allowed;
    const clean = cleanSettings(settings);
    if (clean.error) return clean;
    const at = now();
    prune(at);
    const state = root();
    if (countActive(familyId) >= MAX_DEVICES_PER_FAMILY) {
      return { error: "Remove a display before adding another one.", status: 409, code: "display_limit" };
    }
    // A parent requesting a replacement code invalidates their previous code.
    for (const [id, pairing] of Object.entries(state.pairings)) {
      if (pairing.familyId === familyId && pairing.createdBy === createdBy) delete state.pairings[id];
    }
    if (Object.values(state.pairings).filter((p) => p.familyId === familyId).length >= MAX_PENDING_PER_FAMILY) {
      return { error: "Finish an existing display pairing before starting another.", status: 409 };
    }
    let code;
    let codeHash;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");
      codeHash = hash(code);
    } while (Object.values(state.pairings).some((p) => p.codeHash === codeHash));
    const id = "dp_" + crypto.randomBytes(12).toString("hex");
    const record = {
      id, familyId, createdBy, ...clean.value, codeHash,
      createdAt: new Date(at).toISOString(),
      expiresAt: new Date(at + PAIRING_TTL_MS).toISOString(),
    };
    state.pairings[id] = record;
    persistDurably();
    return { pairing: { id, code, expiresAt: record.expiresAt, label: record.label, timeZone: record.timeZone } };
  }

  function claimPairing(rawCode, model = "") {
    const code = normalizeCode(rawCode);
    const invalid = { error: "That pairing code is invalid or has expired.", status: 400, code: "pairing_invalid" };
    if (!validCode(code)) return invalid;
    const at = now();
    prune(at);
    const state = root();
    const codeHash = hash(code);
    const pairing = Object.values(state.pairings).find((p) => p.codeHash === codeHash);
    if (!pairing) return invalid;
    const allowed = eligibility(pairing.familyId, pairing.createdBy);
    if (!allowed || allowed.error) {
      delete state.pairings[pairing.id];
      persistDurably();
      return allowed && allowed.error ? allowed : invalid;
    }
    if (countActive(pairing.familyId) >= MAX_DEVICES_PER_FAMILY) {
      return { error: "Remove a display before adding another one.", status: 409, code: "display_limit" };
    }
    const token = TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
    const device = {
      id: "dd_" + crypto.randomBytes(12).toString("hex"),
      familyId: pairing.familyId,
      createdBy: pairing.createdBy,
      label: pairing.label,
      timeZone: pairing.timeZone,
      showHomework: pairing.showHomework,
      showMeals: pairing.showMeals,
      model: typeof model === "string" ? model.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100) : "",
      tokenHash: hash(token),
      createdAt: new Date(at).toISOString(),
      lastSeenAt: null,
      revokedAt: null,
    };
    state.devices[device.id] = device;
    delete state.pairings[pairing.id];
    // Claim + credential issuance commit as one synchronous snapshot. No await
    // occurs between lookup and consumption, so concurrent requests cannot replay.
    persistDurably();
    return { token, device: publicDevice(device) };
  }

  function resolveToken(rawToken) {
    if (typeof rawToken !== "string" || !/^fdp_[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
    const tokenHash = hash(rawToken);
    const device = Object.values(root().devices).find((d) => d.tokenHash === tokenHash && !d.revokedAt);
    if (!device) return null;
    const allowed = eligibility(device.familyId, device.createdBy);
    if (!allowed || allowed.error) return allowed;
    const at = now();
    if (!device.lastSeenAt || at - Date.parse(device.lastSeenAt) >= 5 * 60 * 1000) {
      device.lastSeenAt = new Date(at).toISOString();
      database.persist();
    }
    return {
      device: { ...publicDevice(device), familyId: device.familyId, createdBy: device.createdBy },
      family: allowed.family,
    };
  }

  function listDevices(familyId) {
    prune(now());
    return Object.values(root().devices)
      .filter((d) => d.familyId === familyId)
      .sort((a, b) => Number(!!a.revokedAt) - Number(!!b.revokedAt)
        || b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100)
      .map(publicDevice);
  }

  function updateDevice(familyId, deviceId, patch) {
    const record = root().devices[deviceId];
    if (!record || record.familyId !== familyId || record.revokedAt) {
      return { error: "Display not found.", status: 404 };
    }
    const clean = cleanSettings(patch, true);
    if (clean.error) return clean;
    Object.assign(record, clean.value);
    persistDurably();
    return { device: publicDevice(record) };
  }

  function revokeDevice(familyId, deviceId) {
    const record = root().devices[deviceId];
    if (!record || record.familyId !== familyId) return { error: "Display not found.", status: 404 };
    if (!record.revokedAt) record.revokedAt = new Date(now()).toISOString();
    persistDurably();
    return { ok: true };
  }

  return { createPairing, claimPairing, resolveToken, listDevices, updateDevice, revokeDevice };
}

module.exports = {
  ...createDisplayAuth(),
  createDisplayAuth,
  CODE_LENGTH,
  PAIRING_TTL_MS,
  MAX_DEVICES_PER_FAMILY,
  TOKEN_PREFIX,
  normalizeCode,
  validTimeZone,
};

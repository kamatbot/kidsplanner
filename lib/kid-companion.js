"use strict";

const db = require("./db");
const family = require("./family");

const DEFAULT_PROFILE = Object.freeze({
  name: "Pip", avatar: "comet", color: "violet", personality: "playful",
  reminders: true, enabled: false, ageBand: "6-8",
});
const CHOICES = Object.freeze({
  avatar: ["comet", "robot", "fox", "owl", "axolotl"],
  color: ["violet", "mint", "orange", "blue"],
  personality: ["playful", "calm", "curious"],
  ageBand: ["6-8", "9-12", "13-17"],
});
const CHILD_FIELDS = new Set(["name", "avatar", "color", "personality", "reminders"]);
const POLICY_FIELDS = new Set(["enabled", "ageBand"]);

class CompanionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CompanionError";
    this.status = status;
  }
}

function requireKid(fam, kidId) {
  if (!fam || typeof fam.id !== "string" || !fam.id || typeof kidId !== "string" || !kidId
      || !Array.isArray(fam.kids) || !fam.kids.some((kid) => kid.id === kidId)) {
    throw new CompanionError("Child not found in this family.", 404);
  }
}

function validName(value) {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").trim();
  // Marks allow names in scripts such as Thai; punctuation cannot become markup.
  return [...name].length <= 24 && /\p{L}/u.test(name) && /^[\p{L}\p{M} '\u2019-]+$/u.test(name) ? name : null;
}

function validValue(key, value) {
  if (key === "name") return validName(value);
  if (key === "enabled" || key === "reminders") return typeof value === "boolean" ? value : null;
  return CHOICES[key]?.includes(value) ? value : null;
}

function getProfile(fam, kidId) {
  requireKid(fam, kidId);
  const saved = fam.hermesCompanions && Object.hasOwn(fam.hermesCompanions, kidId)
    ? fam.hermesCompanions[kidId] : null;
  const profile = { ...DEFAULT_PROFILE };
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    for (const key of Object.keys(DEFAULT_PROFILE)) {
      if (!Object.hasOwn(saved, key)) continue;
      const value = validValue(key, saved[key]);
      if (value !== null) profile[key] = value;
    }
    // Incomplete/corrupt consent cannot silently select a new age policy.
    if (!Object.hasOwn(saved, "ageBand") || !CHOICES.ageBand.includes(saved.ageBand)) profile.enabled = false;
  }
  return profile;
}

function updateProfile(fam, kidId, patch, { isParent = false } = {}) {
  requireKid(fam, kidId);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(patch))) {
    throw new CompanionError("Send companion settings as an object.");
  }
  const next = getProfile(fam, kidId);
  for (const key of Reflect.ownKeys(patch)) {
    if (!CHILD_FIELDS.has(key) && !(isParent === true && POLICY_FIELDS.has(key))) {
      throw new CompanionError("That companion setting cannot be changed here.", POLICY_FIELDS.has(key) ? 403 : 400);
    }
    const descriptor = Object.getOwnPropertyDescriptor(patch, key);
    const value = descriptor && Object.hasOwn(descriptor, "value") ? validValue(key, descriptor.value) : null;
    if (value === null) throw new CompanionError(`Choose a valid ${key === "ageBand" ? "age group" : key}.`);
    next[key] = value;
  }
  // Publish once, after every field has passed validation. Keep this outside
  // kids[]: the existing family response returns those child records directly.
  fam.hermesCompanions = { ...fam.hermesCompanions, [kidId]: next };
  db.persist();
  return { ...next };
}

function cleanupKid(familyId, kidId) {
  const fam = family.getFamily(familyId);
  if (!fam?.hermesCompanions || !Object.hasOwn(fam.hermesCompanions, kidId)) return;
  delete fam.hermesCompanions[kidId];
  db.persist();
}

module.exports = { CompanionError, getProfile, updateProfile, cleanupKid, DEFAULT_PROFILE };

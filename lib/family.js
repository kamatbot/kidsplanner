"use strict";
/**
 * Family group model — net-new for Fam ETC (no RetireOdds equivalent).
 *
 * A Family is the unit chat, calendar, homework, and goals all scope to.
 * Only PARENTS have a login (`user` record in store.js); kid PROFILES are
 * lightweight records nested on the family — no email, no passkey, created
 * only by a parent already in the family (see APP-BRIEF.md "Kids' privacy &
 * compliance"). This is the verifiable-parental-consent mechanism: the parent
 * creates the kid profile, so there is no direct kid signup path anywhere.
 *
 * Family    { id, name, inviteCode, parentIds[], kids[], createdAt }
 * Kid       { id, name, grade, color, createdAt } — no email, no login
 *
 * Membership removal ("remove a member from the family") is the block
 * equivalent required for Apple UGC review (1.2) alongside chat's
 * delete-any-message and report/flag controls (see lib/chat.js).
 */
const crypto = require("crypto");
const db = require("./db");

// Unambiguous alphabet — matches referral/backup-code conventions.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const KID_COLORS = ["#6C63FF", "#FF6B9D", "#4ECDC4", "#FFB84C", "#5AC8FA", "#FF7A7A"];
// Two parents per family (the co-parent model). Surfaced to the client via
// publicFamily so the UI can show remaining invite slots.
const MAX_PARENTS = 2;

function root() {
  const r = db.load();
  if (!r.families) r.families = {};
  return r;
}

function genInviteCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function uniqueInviteCode() {
  const r = root();
  let code;
  do {
    code = genInviteCode();
  } while (Object.values(r.families).some((f) => f.inviteCode === code));
  return code;
}

function fid() {
  return "f_" + crypto.randomBytes(9).toString("hex");
}
function kidId() {
  return "k_" + crypto.randomBytes(9).toString("hex");
}

function getFamily(id) {
  if (!id) return null;
  return root().families[id] || null;
}

function findByInviteCode(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  return Object.values(root().families).find((f) => f.inviteCode === c) || null;
}

// A parent with no family yet creates one, becomes its first parent member,
// and gets a shareable invite code for the co-parent + kids to join.
function createFamily(ownerUserId, name) {
  const r = root();
  const fam = {
    id: fid(),
    name: (name || "Our Family").slice(0, 60),
    inviteCode: uniqueInviteCode(),
    parentIds: [ownerUserId],
    kids: [],
    createdAt: new Date().toISOString(),
  };
  r.families[fam.id] = fam;
  db.persist();
  return fam;
}

// A second parent joins via invite code. Kids never call this — they have no
// login to join with; a parent adds them via addKid() instead.
function joinFamilyAsParent(code, userId) {
  const fam = findByInviteCode(code);
  if (!fam) return { error: "Invite code not found." };
  if (fam.parentIds.includes(userId)) return { family: fam };
  if (fam.parentIds.length >= MAX_PARENTS) return { error: "This family already has two parents." };
  fam.parentIds.push(userId);
  db.persist();
  return { family: fam };
}

// Only an existing parent in the family may add a kid profile. Minimal data
// only: name, grade, color — no email, no login (see brief).
function addKid(familyId, requestingParentId, { name, grade, color }) {
  const fam = getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  if (!fam.parentIds.includes(requestingParentId)) return { error: "Only a parent in this family can add a kid." };
  const usedColors = new Set(fam.kids.map((k) => k.color));
  const assignedColor = color || KID_COLORS.find((c) => !usedColors.has(c)) || KID_COLORS[fam.kids.length % KID_COLORS.length];
  const kid = {
    id: kidId(),
    name: String(name || "").trim().slice(0, 60) || "Kid",
    grade: String(grade || "").trim().slice(0, 20),
    color: assignedColor,
    createdAt: new Date().toISOString(),
  };
  fam.kids.push(kid);
  db.persist();
  return { family: fam, kid };
}

function updateKid(familyId, requestingParentId, kidIdToEdit, patch) {
  const fam = getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  if (!fam.parentIds.includes(requestingParentId)) return { error: "Only a parent in this family can edit a kid." };
  const kid = fam.kids.find((k) => k.id === kidIdToEdit);
  if (!kid) return { error: "Kid not found." };
  if (patch.name != null) kid.name = String(patch.name).trim().slice(0, 60);
  if (patch.grade != null) kid.grade = String(patch.grade).trim().slice(0, 20);
  if (patch.color != null) kid.color = String(patch.color).slice(0, 20);
  db.persist();
  return { family: fam, kid };
}

// Remove a kid profile entirely (parent-only). Distinct from removeMember,
// which removes a PARENT (kids have no separate "membership" to leave).
function removeKid(familyId, requestingParentId, kidIdToRemove) {
  const fam = getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  if (!fam.parentIds.includes(requestingParentId)) return { error: "Only a parent in this family can remove a kid." };
  fam.kids = fam.kids.filter((k) => k.id !== kidIdToRemove);
  db.persist();
  return { family: fam };
}

// Remove a PARENT member from the family — the "block equivalent" Apple's UGC
// review (1.2) expects alongside chat's delete-any-message + report/flag
// controls. A parent cannot remove themselves this way if they're the last
// parent (use leaveFamily / deleteFamily instead) to avoid an orphaned family.
function removeMember(familyId, requestingParentId, memberUserId) {
  const fam = getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  if (!fam.parentIds.includes(requestingParentId)) return { error: "Only a parent in this family can remove a member." };
  if (!fam.parentIds.includes(memberUserId)) return { error: "That person is not a parent member of this family." };
  if (fam.parentIds.length <= 1) return { error: "Can't remove the only parent — delete the family instead." };
  fam.parentIds = fam.parentIds.filter((id) => id !== memberUserId);
  db.persist();
  return { family: fam };
}

function familiesForUser(userId) {
  return Object.values(root().families).filter((f) => f.parentIds.includes(userId));
}

// Resolve the family a KID user belongs to (via user.data.kid.familyId), the
// counterpart to familiesForUser() for parents. A kid user is never a member
// of fam.parentIds, so familiesForUser() alone can't find their family.
function familyForKidUser(kidUser) {
  const link = kidUser && kidUser.data && kidUser.data.kid;
  if (!link || !link.familyId) return null;
  return getFamily(link.familyId);
}

// Confirm a kid profile id belongs to a given family (used to validate
// :kidId route params before provisioning a device for it).
function kidBelongsToFamily(familyId, kidIdToCheck) {
  const fam = getFamily(familyId);
  if (!fam) return false;
  return fam.kids.some((k) => k.id === kidIdToCheck);
}

// Public (client-safe) view — nothing here is sensitive, but keep the shape
// explicit so future fields don't leak by accident.
// `resolveName` (optional) maps a parent userId -> display name so the client
// can list co-parents by name without a second round-trip. Falls back to null.
function publicFamily(fam, resolveName) {
  if (!fam) return null;
  const named = typeof resolveName === "function" ? resolveName : null;
  return {
    id: fam.id,
    name: fam.name,
    inviteCode: fam.inviteCode,
    parentIds: fam.parentIds,
    parents: (fam.parentIds || []).map((id) => ({
      id,
      name: (named && named(id)) || null,
    })),
    maxParents: MAX_PARENTS,
    kids: fam.kids,
    createdAt: fam.createdAt,
  };
}

module.exports = {
  createFamily,
  joinFamilyAsParent,
  addKid,
  updateKid,
  removeKid,
  removeMember,
  getFamily,
  findByInviteCode,
  familiesForUser,
  familyForKidUser,
  kidBelongsToFamily,
  publicFamily,
  KID_COLORS,
  MAX_PARENTS,
};

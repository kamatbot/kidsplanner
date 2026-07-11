"use strict";
/**
 * Goals — family/kid habit + milestone tracker (Horizon "Goals" screen,
 * canvas-1d). Same family-scoped storage pattern as lib/homework.js:
 * root.goals[familyId] = [...]. No field-level encryption — goal titles and
 * check-in dates aren't sensitive personal content the way lib/notes.js's
 * reflections are (mirrors lib/homework.js, which also stores plaintext).
 *
 * Goal shape:
 *   { id, familyId, kidId, title, type: "habit"|"milestone",
 *     target (habit: check-ins/week target, e.g. 7; milestone: total target),
 *     checks: ["YYYY-MM-DD", ...] | null   (habit only — deduped check-in dates),
 *     progress: number | null              (milestone only — current count),
 *     createdAt, updatedAt }
 *
 * Gentle language: a missed day is never flagged as a failure anywhere in
 * this module — streak/weekly math simply counts check-ins that happened,
 * it never marks, scores, or resets a "miss".
 *
 * Permissions are enforced by the CALLER (lib/routes/goals.js) using the
 * exported canAccess() helper, mirroring lib/homework.js.
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");

const TYPES = new Set(["habit", "milestone"]);

function root() {
  const r = db.load();
  if (!r.goals) r.goals = {};
  return r;
}

// root.goals[familyId] = [goals...]
function famList(familyId) {
  const r = root();
  if (!r.goals[familyId]) r.goals[familyId] = [];
  return r.goals[familyId];
}

function goalId() {
  return "gl_" + crypto.randomBytes(9).toString("hex");
}

function todayLocalYMD(d) {
  const dt = d || new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// Monday (YYYY-MM-DD) of the week containing dateStr.
function mondayOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return todayLocalYMD(d);
}

// ---------- CRUD ----------

function addGoal(familyId, { kidId, title, type, target } = {}) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  if (!kidId || !fam.kids.some((k) => k.id === kidId)) return { error: "Kid not found in this family." };
  const t = String(title || "").trim().slice(0, 200);
  if (!t) return { error: "Title is required." };
  if (!TYPES.has(type)) return { error: "Type must be 'habit' or 'milestone'." };
  const tgt = Math.round(Number(target));
  if (!Number.isFinite(tgt) || tgt <= 0) return { error: "Target must be a positive number." };

  const goal = {
    id: goalId(),
    familyId,
    kidId,
    title: t,
    type,
    target: tgt,
    checks: type === "habit" ? [] : null,
    progress: type === "milestone" ? 0 : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  famList(familyId).push(goal);
  db.persist();
  return { goal };
}

// List goals for a family, optionally filtered by kidId. Ownership scoping
// (kid sees only their own) is applied by the CALLER, same division of
// labor as lib/homework.js listForFamily.
function listGoals(familyId, { kidId } = {}) {
  let items = famList(familyId).slice();
  if (kidId) items = items.filter((g) => g.kidId === kidId);
  return items.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

function getById(familyId, id) {
  return famList(familyId).find((g) => g.id === id) || null;
}

// Toggle today's (or dateOverride's) check-in for a habit goal — idempotent
// add/remove, so tapping the ring again just un-checks it. Never treated as
// a "miss"; there is no failure state to record.
function toggleHabitCheck(familyId, id, dateOverride) {
  const goal = getById(familyId, id);
  if (!goal) return { error: "Goal not found." };
  if (goal.type !== "habit") return { error: "Only habit goals can be checked in." };
  const date = dateOverride || todayLocalYMD();
  const idx = goal.checks.indexOf(date);
  if (idx >= 0) goal.checks.splice(idx, 1);
  else goal.checks.push(date);
  goal.updatedAt = new Date().toISOString();
  db.persist();
  return { goal };
}

function incrementMilestone(familyId, id, amount) {
  const goal = getById(familyId, id);
  if (!goal) return { error: "Goal not found." };
  if (goal.type !== "milestone") return { error: "Only milestone goals can be incremented." };
  const amt = Number.isFinite(Number(amount)) ? Math.round(Number(amount)) : 1;
  goal.progress = Math.max(0, Math.min(goal.target, goal.progress + amt));
  goal.updatedAt = new Date().toISOString();
  db.persist();
  return { goal };
}

function removeGoal(familyId, id) {
  const list = famList(familyId);
  const before = list.length;
  const filtered = list.filter((g) => g.id !== id);
  if (filtered.length === before) return { error: "Goal not found." };
  root().goals[familyId] = filtered;
  db.persist();
  return { ok: true };
}

// Check-ins for `goal` within the Mon-Sun week containing dateStr (defaults
// today). Powers both the habit ring ("5/7") and the family recap bars.
function checksThisWeek(goal, dateStr) {
  if (!goal || goal.type !== "habit") return 0;
  const monday = mondayOf(dateStr || todayLocalYMD());
  const sunday = new Date(monday + "T00:00:00");
  sunday.setDate(sunday.getDate() + 6);
  const sundayStr = todayLocalYMD(sunday);
  return goal.checks.filter((d) => d >= monday && d <= sundayStr).length;
}

// Consecutive days (walking back from dateStr, default today) with a
// check-in. Missing a day just makes this 0 for that day — never a
// punitive number, never surfaced as "broken".
function currentStreak(goal, dateStr) {
  if (!goal || goal.type !== "habit") return 0;
  const checkSet = new Set(goal.checks);
  let streak = 0;
  const d = new Date((dateStr || todayLocalYMD()) + "T00:00:00");
  while (checkSet.has(todayLocalYMD(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// ---------- permissions ----------
// A kid may check in / increment only their OWN goal; a parent may touch any
// goal in the family. Creation/deletion is parent-only, enforced by the
// ROUTE (not here) — mirrors lib/homework.js's canAccess split.
function canAccess(user, role, familyId, goal) {
  if (!goal || goal.familyId !== familyId) return false;
  if (role === "kid") {
    const myKidId = user && user.data && user.data.kid && user.data.kid.kidId;
    return !!myKidId && goal.kidId === myKidId;
  }
  return true; // any parent in the family may touch any goal in it
}

module.exports = {
  addGoal,
  listGoals,
  getById,
  toggleHabitCheck,
  incrementMilestone,
  removeGoal,
  checksThisWeek,
  currentStreak,
  canAccess,
  mondayOf,
  TYPES,
};

"use strict";
/**
 * Activities — extracurricular registry (Horizon "Activities" screen,
 * canvas-1e): sports/arts/music/other, with a weekly schedule, gear list,
 * and a coach/teacher line. Same family-scoped storage pattern as
 * lib/homework.js: root.activities[familyId] = [...]. No field-level
 * encryption — mirrors lib/homework.js, not lib/notes.js.
 *
 * Activity shape:
 *   { id, familyId, kidId, name, category: "sports"|"arts"|"music"|"other",
 *     schedule: [{ day: "mon".."sun", start: "HH:MM", end: "HH:MM" }],
 *     location, coachLabel ("Coach"|"Teacher"), coachName,
 *     gear: [string, ...], note (fee/season/free text),
 *     createdAt, updatedAt }
 *
 * Creating/editing an activity does NOT create calendar events in this
 * phase — that sync is a follow-up (see W3 report).
 *
 * Permissions are enforced by the CALLER (lib/routes/activities.js) using
 * the exported canAccess() helper, mirroring lib/homework.js.
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");

const CATEGORIES = new Set(["sports", "arts", "music", "other"]);
const DAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function root() {
  const r = db.load();
  if (!r.activities) r.activities = {};
  return r;
}

// root.activities[familyId] = [activities...]
function famList(familyId) {
  const r = root();
  if (!r.activities[familyId]) r.activities[familyId] = [];
  return r.activities[familyId];
}

function activityId() {
  return "ac_" + crypto.randomBytes(9).toString("hex");
}

function sanitizeTime(t) {
  const s = String(t || "").trim();
  return /^\d{2}:\d{2}$/.test(s) ? s : null;
}

function sanitizeSchedule(schedule) {
  if (!Array.isArray(schedule)) return [];
  return schedule
    .slice(0, 14)
    .map((s) => ({
      day: DAYS.has((s && s.day)) ? s.day : null,
      start: sanitizeTime(s && s.start),
      end: s && s.end ? sanitizeTime(s.end) : null,
    }))
    .filter((s) => s.day && s.start);
}

function sanitizeGear(gear) {
  if (!Array.isArray(gear)) return [];
  return gear
    .slice(0, 20)
    .map((g) => String(g || "").trim().slice(0, 60))
    .filter(Boolean);
}

// ---------- CRUD ----------

function addActivity(familyId, { kidId, name, category, schedule, location, coachLabel, coachName, gear, note } = {}) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  if (!kidId || !fam.kids.some((k) => k.id === kidId)) return { error: "Kid not found in this family." };
  const n = String(name || "").trim().slice(0, 200);
  if (!n) return { error: "Name is required." };
  const cat = CATEGORIES.has(category) ? category : "other";

  const activity = {
    id: activityId(),
    familyId,
    kidId,
    name: n,
    category: cat,
    schedule: sanitizeSchedule(schedule),
    location: String(location || "").trim().slice(0, 120),
    coachLabel: String(coachLabel || "").trim().slice(0, 30) || (cat === "sports" ? "Coach" : "Teacher"),
    coachName: String(coachName || "").trim().slice(0, 120),
    gear: sanitizeGear(gear),
    note: String(note || "").trim().slice(0, 300),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  famList(familyId).push(activity);
  db.persist();
  return { activity };
}

// List activities for a family, optionally filtered by kidId. Ownership
// scoping (kid sees only their own) is applied by the CALLER.
function listActivities(familyId, { kidId } = {}) {
  let items = famList(familyId).slice();
  if (kidId) items = items.filter((a) => a.kidId === kidId);
  return items.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

function getById(familyId, id) {
  return famList(familyId).find((a) => a.id === id) || null;
}

function updateActivity(familyId, id, patch = {}) {
  const item = getById(familyId, id);
  if (!item) return { error: "Activity not found." };

  if (patch.name != null) {
    const n = String(patch.name).trim().slice(0, 200);
    if (!n) return { error: "Name cannot be empty." };
    item.name = n;
  }
  if (patch.category != null) item.category = CATEGORIES.has(patch.category) ? patch.category : item.category;
  if (patch.schedule != null) item.schedule = sanitizeSchedule(patch.schedule);
  if (patch.location != null) item.location = String(patch.location).trim().slice(0, 120);
  if (patch.coachLabel != null) item.coachLabel = String(patch.coachLabel).trim().slice(0, 30) || item.coachLabel;
  if (patch.coachName != null) item.coachName = String(patch.coachName).trim().slice(0, 120);
  if (patch.gear != null) item.gear = sanitizeGear(patch.gear);
  if (patch.note != null) item.note = String(patch.note).trim().slice(0, 300);

  item.updatedAt = new Date().toISOString();
  db.persist();
  return { activity: item };
}

function removeActivity(familyId, id) {
  const list = famList(familyId);
  const before = list.length;
  const filtered = list.filter((a) => a.id !== id);
  if (filtered.length === before) return { error: "Activity not found." };
  root().activities[familyId] = filtered;
  db.persist();
  return { ok: true };
}

// Activities with a schedule slot on the given JS Date's day-of-week — the
// Activities screen's "day-of helper" banner. Sorted by start time.
function todaysActivities(familyId, date) {
  const d = date || new Date();
  const dow = Object.keys(DAY_INDEX).find((k) => DAY_INDEX[k] === d.getDay());
  const items = famList(familyId).filter((a) => (a.schedule || []).some((s) => s.day === dow));
  return items
    .map((a) => ({ activity: a, slot: a.schedule.filter((s) => s.day === dow).sort((x, y) => x.start.localeCompare(y.start))[0] }))
    .sort((x, y) => (x.slot.start || "").localeCompare(y.slot.start || ""));
}

// ---------- permissions ----------
// Same split as lib/homework.js: a kid may only touch their OWN activity; a
// parent may touch any activity in the family. Creation/deletion is
// parent-only, enforced by the ROUTE (activities are managed by parents;
// spec allows kid read access only), not here.
function canAccess(user, role, familyId, activity) {
  if (!activity || activity.familyId !== familyId) return false;
  if (role === "kid") {
    const myKidId = user && user.data && user.data.kid && user.data.kid.kidId;
    return !!myKidId && activity.kidId === myKidId;
  }
  return true;
}

module.exports = {
  addActivity,
  listActivities,
  getById,
  updateActivity,
  removeActivity,
  todaysActivities,
  canAccess,
  CATEGORIES,
  DAYS,
};

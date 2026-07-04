"use strict";
/**
 * Family calendar events (manually-added appointments). Stored SERVER-SIDE and
 * scoped per family, so they sync across web + iOS + every family member —
 * unlike the original web localStorage events which never left one device.
 * School-feed events (lib/school-feeds) stay separate and read-only.
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");

const CATEGORIES = new Set(["school", "sports", "arts", "social", "other"]);

function root() {
  const r = db.load();
  if (!r.familyEvents) r.familyEvents = {};
  return r;
}
function famList(familyId) {
  const r = root();
  if (!r.familyEvents[familyId]) r.familyEvents[familyId] = [];
  return r.familyEvents[familyId];
}
function eid() { return "ev_" + crypto.randomBytes(9).toString("hex"); }
function cleanDate(d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? String(d) : null; }
function cleanTime(t) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(t || ""));
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59 ? `${m[1]}:${m[2]}` : "";
}

function addEvent(familyId, { title, date, time, endTime, notes, category, kidId } = {}) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  const t = String(title || "").trim().slice(0, 200);
  if (!t) return { error: "Give the event a title." };
  const d = cleanDate(date);
  if (!d) return { error: "Pick a valid date." };
  const event = {
    id: eid(),
    familyId,
    title: t,
    date: d,
    time: cleanTime(time),
    endTime: cleanTime(endTime),
    notes: String(notes || "").trim().slice(0, 1000),
    category: CATEGORIES.has(category) ? category : "other",
    kidId: kidId && fam.kids.some((k) => k.id === kidId) ? kidId : null,
    source: "manual",
    createdAt: new Date().toISOString(),
  };
  famList(familyId).push(event);
  db.persist();
  return { event };
}

function listEvents(familyId, { from, to } = {}) {
  let evs = famList(familyId).slice();
  if (from) evs = evs.filter((e) => e.date >= String(from));
  if (to) evs = evs.filter((e) => e.date <= String(to));
  return evs.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

function getById(familyId, id) {
  return famList(familyId).find((e) => e.id === id) || null;
}

function removeEvent(familyId, id) {
  const list = famList(familyId);
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return { error: "Event not found." };
  list.splice(i, 1);
  db.persist();
  return { ok: true };
}

module.exports = { addEvent, listEvents, getById, removeEvent, CATEGORIES };

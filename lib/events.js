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
const REPEATS = new Set(["none", "daily", "weekly", "biweekly", "monthly"]);
const STEP_DAYS = { daily: 1, weekly: 7, biweekly: 14 };

// Mirrors lib/school-feeds.js WINDOW_PAST_MS/WINDOW_FUTURE_MS so the default
// "no from/to given" window matches the school-feed sync horizon.
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_PAST_MS = 14 * DAY_MS;
const WINDOW_FUTURE_MS = 92 * DAY_MS;

// Hard ceiling on generated occurrences per series per listEvents call. The
// window cap already bounds this in practice (a few hundred occurrences at
// most); this only guards a degenerate daily series with a start date years
// in the past and no repeatUntil.
// ponytail: fixed cap, not configurable — raise if a real use case needs it.
const MAX_OCCURRENCES = 1000;

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
function cleanRepeat(r) { return REPEATS.has(r) ? r : "none"; }

function parseYMD(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function formatYMD(dt) { return dt.toISOString().slice(0, 10); }

function addEvent(familyId, { title, date, time, endTime, notes, category, kidId, endDate, repeat, repeatUntil, createdBy } = {}) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  const t = String(title || "").trim().slice(0, 200);
  if (!t) return { error: "Give the event a title." };
  const d = cleanDate(date);
  if (!d) return { error: "Pick a valid date." };
  const ed = cleanDate(endDate);
  if (ed && ed < d) return { error: "End date can't be before the start date." };
  const event = {
    id: eid(),
    familyId,
    title: t,
    date: d,
    endDate: ed && ed !== d ? ed : null,
    time: cleanTime(time),
    endTime: cleanTime(endTime),
    notes: String(notes || "").trim().slice(0, 1000),
    category: CATEGORIES.has(category) ? category : "other",
    kidId: kidId && fam.kids.some((k) => k.id === kidId) ? kidId : null,
    repeat: cleanRepeat(repeat),
    repeatUntil: cleanDate(repeatUntil),
    source: "manual",
    createdBy: createdBy || null,
    createdAt: new Date().toISOString(),
  };
  famList(familyId).push(event);
  db.persist();
  return { event };
}

// A requester may manage (edit/delete) an event when they're a parent (parents
// manage the whole family) or when they created it themselves (including a
// kid managing their own event). Legacy events with no createdBy fall through
// to parent-only, since we can't safely attribute them to any one kid.
function canManage(event, { userId, isParent } = {}) {
  if (isParent) return true;
  return !!(event && event.createdBy && event.createdBy === userId);
}

function updateEvent(familyId, id, patch = {}) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  const list = famList(familyId);
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return { error: "Event not found." };
  const event = list[i];

  const next = Object.assign({}, event);

  if (patch.title !== undefined) {
    const t = String(patch.title || "").trim().slice(0, 200);
    if (!t) return { error: "Give the event a title." };
    next.title = t;
  }
  if (patch.date !== undefined) {
    const d = cleanDate(patch.date);
    if (!d) return { error: "Pick a valid date." };
    next.date = d;
  }
  if (patch.endDate !== undefined) {
    const ed = cleanDate(patch.endDate);
    next.endDate = ed && ed !== next.date ? ed : null;
  }
  if (next.endDate && next.endDate < next.date) {
    return { error: "End date can't be before the start date." };
  }
  if (patch.time !== undefined) next.time = cleanTime(patch.time);
  if (patch.endTime !== undefined) next.endTime = cleanTime(patch.endTime);
  if (patch.notes !== undefined) next.notes = String(patch.notes || "").trim().slice(0, 1000);
  if (patch.category !== undefined) next.category = CATEGORIES.has(patch.category) ? patch.category : "other";
  if (patch.kidId !== undefined) {
    next.kidId = patch.kidId && fam.kids.some((k) => k.id === patch.kidId) ? patch.kidId : null;
  }
  if (patch.repeat !== undefined) next.repeat = cleanRepeat(patch.repeat);
  if (patch.repeatUntil !== undefined) next.repeatUntil = cleanDate(patch.repeatUntil);

  // Immutable fields (createdBy/id/familyId/source) are never touched above.
  list[i] = next;
  db.persist();
  return { event: next };
}

// ponytail: per-occurrence edits/exceptions are out of scope — deleting a
// recurring event removes the whole series. Upgrade path if a single
// occurrence ever needs to move/cancel independently: an `exdates: []`
// array on the event (skip those dates when expanding) plus per-date
// overrides, rather than materializing every occurrence as its own record.
function occurrenceIntersects(startYMD, endYMD, from, to) {
  return startYMD <= to && endYMD >= from;
}

function makeOccurrence(event, dateObj, endDeltaMs) {
  const date = formatYMD(dateObj);
  const endDate = event.endDate ? formatYMD(new Date(dateObj.getTime() + endDeltaMs)) : null;
  return Object.assign({}, event, {
    date,
    endDate,
    occurrenceDate: date,
    seriesId: event.id,
    recurring: true,
  });
}

function expandRecurring(event, from, to) {
  const start = parseYMD(event.date);
  const endDeltaMs = event.endDate ? parseYMD(event.endDate).getTime() - start.getTime() : 0;
  const cutoff = event.repeatUntil && event.repeatUntil < to ? event.repeatUntil : to;
  const out = [];

  if (event.repeat === "monthly") {
    const day = start.getUTCDate();
    let year = start.getUTCFullYear();
    let month = start.getUTCMonth();
    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      if (day <= daysInMonth) {
        const occStart = new Date(Date.UTC(year, month, day));
        const occStartYMD = formatYMD(occStart);
        if (occStartYMD > cutoff) break;
        const occEndYMD = event.endDate ? formatYMD(new Date(occStart.getTime() + endDeltaMs)) : occStartYMD;
        if (occurrenceIntersects(occStartYMD, occEndYMD, from, to)) out.push(makeOccurrence(event, occStart, endDeltaMs));
      }
      month += 1;
      if (month > 11) { month = 0; year += 1; }
    }
    return out;
  }

  const step = STEP_DAYS[event.repeat];
  let cur = start;
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const occStartYMD = formatYMD(cur);
    if (occStartYMD > cutoff) break;
    const occEndYMD = event.endDate ? formatYMD(new Date(cur.getTime() + endDeltaMs)) : occStartYMD;
    if (occurrenceIntersects(occStartYMD, occEndYMD, from, to)) out.push(makeOccurrence(event, cur, endDeltaMs));
    cur = new Date(cur.getTime() + step * DAY_MS);
  }
  return out;
}

function listEvents(familyId, { from, to } = {}) {
  let f = cleanDate(from);
  let t = cleanDate(to);
  if (!f || !t) {
    const now = Date.now();
    f = formatYMD(new Date(now - WINDOW_PAST_MS));
    t = formatYMD(new Date(now + WINDOW_FUTURE_MS));
  }
  const out = [];
  for (const e of famList(familyId)) {
    if (e.repeat && e.repeat !== "none") {
      out.push(...expandRecurring(e, f, t));
    } else if (occurrenceIntersects(e.date, e.endDate || e.date, f, t)) {
      out.push(e);
    }
  }
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
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

module.exports = { addEvent, listEvents, getById, removeEvent, updateEvent, canManage, CATEGORIES };

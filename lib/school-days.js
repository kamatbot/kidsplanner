"use strict";
/**
 * School-day classification per kid ("school" | "free") for Home Wi-Fi /
 * Screen Time rules (Feature 3).
 *
 * A date is "free" when:
 *   1. It is Saturday or Sunday, OR
 *   2. A parent marked the date as "No school" in Home Wi-Fi settings, OR
 *   3. The kid's school calendar feeds (lib/school-feeds.js) or family
 *      calendar (lib/events.js) has an all-day non-deadline event covering
 *      that date whose title matches holiday/break/no-school keywords.
 * Otherwise it is "school".
 */
const db = require("./db");
const schoolFeeds = require("./school-feeds");
const events = require("./events");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NO_SCHOOL_RE = /\b(holiday|holidays|break|no[\s-]+school|half[\s-]+term|inset|teacher(?:'s|s)?\s+(?:training\s+|in-?service\s+|work\s+)?day|school\s+(?:is\s+)?closed|vacation)\b/i;
// All-day events that mention a break word but are still school days
// ("Holiday concert", "Mid-term exams", "Last day before break").
const STILL_SCHOOL_RE = /\b(exam|exams|test|tests|assessment|concert|fair|party|show|performance|assembly|deadline|due|last\s+day|first\s+day|before|after|returns?|back\s+to\s+school|starts?)\b/i;
const meansNoSchool = (title) => NO_SCHOOL_RE.test(title || "") && !STILL_SCHOOL_RE.test(title || "");

function validDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
}

function addDays(ymd, delta) {
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  return new Date(ms + delta * 86400000).toISOString().slice(0, 10);
}

function isWeekend(ymd) {
  const day = new Date(Date.parse(`${ymd}T00:00:00Z`)).getUTCDay();
  return day === 0 || day === 6;
}

function noSchoolSet(familyId) {
  const r = db.load();
  const list = r.homeNetwork && r.homeNetwork[familyId] && r.homeNetwork[familyId].noSchoolDates;
  return new Set(Array.isArray(list) ? list : []);
}

function matchingSchoolFeedEvent(familyId, kidId, date) {
  const r = db.load();
  const store = r.schoolCalendar && r.schoolCalendar[familyId];
  if (!store || !Array.isArray(store.subscriptions) || !store.cache) return null;
  const hidden = new Set(store.hidden || []);
  for (const sub of store.subscriptions) {
    if (sub.kidId && sub.kidId !== kidId) continue;
    const cached = store.cache[sub.id];
    if (!cached || !Array.isArray(cached.events)) continue;
    const builtin = sub.feedId && schoolFeeds.BUILTIN_FEEDS.find((f) => f.id === sub.feedId);
    const feedIsDeadline = !!(builtin && builtin.deadline);
    for (const raw of cached.events) {
      if (!raw || !raw.allDay || !raw.start) continue;
      if (hidden.has(`${sub.id}::${raw.uid}`)) continue;
      if (sub.filterKeyword) {
        const kw = sub.filterKeyword.toLowerCase();
        const hay = `${raw.summary || ""} ${raw.location || ""} ${raw.description || ""}`.toLowerCase();
        if (!hay.includes(kw)) continue;
      }
      if (schoolFeeds.detectDeadline(raw.summary, feedIsDeadline)) continue;
      const start = String(raw.start).slice(0, 10);
      if (!DATE_RE.test(start)) continue;
      // iCal VALUE=DATE DTEND is exclusive; if absent or <= start, single day.
      const end = raw.end ? String(raw.end).slice(0, 10) : null;
      const covers = end && DATE_RE.test(end) && end > start
        ? (date >= start && date < end)
        : (date === start);
      if (!covers) continue;
      if (meansNoSchool(raw.summary)) return raw.summary.trim();
    }
  }
  return null;
}

function matchingFamilyEvent(familyId, kidId, date) {
  const list = events.listEvents(familyId, { from: date, to: date });
  for (const ev of list) {
    if (!ev || ev.time) continue; // all-day events only
    if (ev.kidId && ev.kidId !== kidId) continue;
    if (meansNoSchool(ev.title)) return ev.title.trim();
  }
  return null;
}

/**
 * Classify one date for one kid: { type: "school"|"free", reason: string|null }.
 */
function classifyDay(fam, kidId, date) {
  if (!fam || !validDate(date)) return { type: "school", reason: null };
  if (isWeekend(date)) return { type: "free", reason: "Weekend" };
  if (noSchoolSet(fam.id).has(date)) return { type: "free", reason: "No school" };
  const feedHit = matchingSchoolFeedEvent(fam.id, kidId, date);
  if (feedHit) return { type: "free", reason: feedHit };
  const manualHit = matchingFamilyEvent(fam.id, kidId, date);
  if (manualHit) return { type: "free", reason: manualHit };
  return { type: "school", reason: null };
}

function dayTypeForKid(fam, kidId, date) {
  return classifyDay(fam, kidId, date).type;
}

/**
 * Policy `days` map for homeAgentPolicy: { [kidId]: { today, tomorrow } }.
 */
function policyDays(fam, today) {
  const tomorrow = addDays(today, 1);
  const out = {};
  for (const kid of (fam && fam.kids) || []) {
    out[kid.id] = {
      today: dayTypeForKid(fam, kid.id, today),
      tomorrow: dayTypeForKid(fam, kid.id, tomorrow),
    };
  }
  return out;
}

/**
 * Richer day summary for parent UI (Settings > Connections > Home Wi-Fi).
 */
function uiDays(fam, today) {
  const tomorrow = addDays(today, 1);
  const out = {};
  for (const kid of (fam && fam.kids) || []) {
    const t = classifyDay(fam, kid.id, today);
    const tm = classifyDay(fam, kid.id, tomorrow);
    out[kid.id] = {
      today: t.type,
      tomorrow: tm.type,
      todayReason: t.reason,
      tomorrowReason: tm.reason,
    };
  }
  return out;
}

module.exports = {
  NO_SCHOOL_RE,
  meansNoSchool,
  validDate,
  addDays,
  isWeekend,
  classifyDay,
  dayTypeForKid,
  policyDays,
  uiDays,
};

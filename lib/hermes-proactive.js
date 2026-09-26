"use strict";
/**
 * Facts for Hermes' proactive loop (docs/HERMES-THREADS-CONTRACT.md §6).
 *
 * The loop runs on the family's always-on Mac (integrations/hermes/fametc/
 * proactive.py) and decides when to speak. This module only answers "what is
 * true right now", in the family's timezone, from data FamETC already has:
 * when each kid's day ends, what is waiting for them tonight, and whether
 * dinner is planned. Every time is returned both as an absolute instant and
 * as a local HH:MM so the Mac never has to guess a zone.
 */
const homework = require("./homework");
const goals = require("./goals");
const events = require("./events");
const activities = require("./activities");
const meals = require("./meals");
const childInsights = require("./child-insights");
const schoolApi = require("./school-api");
const schoolFeeds = require("./school-feeds");
const hermesThreads = require("./hermes-threads");

// The school API stamps lessons in Bangkok time (lib/school-api.js); a family
// that never chose a zone is on that clock.
const DEFAULT_TIMEZONE = "Asia/Bangkok";
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
// Something ending before 11:00 (a dentist visit) or after 21:30 isn't "the
// day ending" in the pickup sense.
const DAY_END_EARLIEST = "11:00";
const DAY_END_LATEST = "21:30";
const DAILY3_PARTS = ["news", "quote", "word"];
const SENT_LOOKBACK_MS = 3 * 86400000;

function safe(fn, fallback = []) {
  try { const value = fn(); return value == null ? fallback : value; } catch (_) { return fallback; }
}
function pad(n) { return String(n).padStart(2, "0"); }
function cleanTitle(value, max = 80) {
  return Array.from(String(value == null ? "" : value).replace(/\s+/g, " ").trim()).slice(0, max).join("");
}

// ---------- family clock (Intl only; no dependency) ----------
function validTimeZone(tz) {
  if (typeof tz !== "string" || !tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (_) { return false; }
}
function familyTimezone(fam) { return fam && validTimeZone(fam.timezone) ? fam.timezone : DEFAULT_TIMEZONE; }

const formatters = new Map();
function partsFormatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}
function localParts(date, tz) {
  const p = {};
  for (const part of partsFormatter(tz).formatToParts(date)) p[part.type] = part.value;
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second };
}
function dateKey(date, tz) { const p = localParts(date, tz); return `${p.year}-${pad(p.month)}-${pad(p.day)}`; }
function clockKey(date, tz) { const p = localParts(date, tz); return `${pad(p.hour)}:${pad(p.minute)}`; }
function weekdayOf(day) { return WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]; }
function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function nextMonday(day) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, ((8 - dow) % 7) || 7);
}
function offsetMs(utcMs, tz) {
  const p = localParts(new Date(utcMs), tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}
// Wall-clock HH:MM on a family-local date → the real instant.
function atLocal(day, hhmm, tz) {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = String(hhmm).split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let utc = wall - offsetMs(wall, tz);
  const settled = wall - offsetMs(utc, tz); // second pass settles a DST edge
  if (settled !== utc) utc = settled;
  return new Date(utc);
}
function formatClock(date, tz) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true })
    .format(date).replace(/\s*([AP])M$/i, (_, x) => ` ${x.toLowerCase()}m`);
}

// ---------- when a kid's day ends ----------
// The latest timed commitment for THIS kid today: school timetable, the kid's
// own school-calendar events, manual events for the kid, weekly activities.
// Family-wide events never count — "dinner at grandma's" isn't a pickup.
function kidDayEnd(fam, kid, today, tz, now) {
  const inWindow = (ms) => {
    if (!Number.isFinite(ms)) return false;
    const at = new Date(ms);
    const clock = clockKey(at, tz);
    return dateKey(at, tz) === today && clock >= DAY_END_EARLIEST && clock <= DAY_END_LATEST;
  };
  const candidates = [];
  const consider = (ms, title, kind, location) => {
    if (inWindow(ms)) candidates.push({ ms, title: cleanTitle(title) || "Activity", kind, location: cleanTitle(location, 120) || null });
  };

  let schoolEnd = null;
  const extendSchool = (ms) => { if (inWindow(ms) && (schoolEnd === null || ms > schoolEnd)) schoolEnd = ms; };
  for (const e of safe(() => schoolApi.listTimetableEvents(fam.id))) {
    if (e && e.kidId === kid.id && e.end) extendSchool(Date.parse(e.end));
  }
  for (const e of safe(() => schoolFeeds.collectFromCache(schoolFeeds.famStore(fam.id), now))) {
    if (!e || e.kidId !== kid.id || e.allDay || e.isDeadline || !e.end) continue;
    if (e.feedId === "sta-child-timetable") extendSchool(Date.parse(e.end));
    else consider(Date.parse(e.end), e.title, "event", e.location);
  }
  // A parent's home plan can state today's finish outright (half days).
  const plan = safe(() => childInsights.insights(fam.id, kid.id, today).homePlan, null);
  if (plan && HHMM.test(plan.schoolEnd || "")) schoolEnd = atLocal(today, plan.schoolEnd, tz).getTime();
  if (schoolEnd !== null) consider(schoolEnd, "School", "school", null);

  for (const e of safe(() => events.listEvents(fam.id, { from: today, to: today }))) {
    if (!e || e.kidId !== kid.id || e.date !== today) continue;
    if ((e.endDate && e.endDate !== e.date) || !HHMM.test(e.time || "") || !HHMM.test(e.endTime || "")) continue;
    consider(atLocal(today, e.endTime, tz).getTime(), e.title, "event", e.location);
  }
  const dow = weekdayOf(today);
  for (const a of safe(() => activities.listActivities(fam.id, { kidId: kid.id }))) {
    for (const slot of (a && a.schedule) || []) {
      if (slot && slot.day === dow && HHMM.test(slot.end || "")) consider(atLocal(today, slot.end, tz).getTime(), a.name, "activity", a.location);
    }
  }
  if (!candidates.length) return null;
  const last = candidates.reduce((best, c) => (c.ms > best.ms ? c : best));
  const at = new Date(last.ms);
  return { at: at.toISOString(), local: clockKey(at, tz), title: last.title, kind: last.kind, location: last.location };
}

function homeAt(fam, kid, today, tz) {
  const plan = safe(() => childInsights.insights(fam.id, kid.id, today).homePlan, null);
  return plan && HHMM.test(plan.homeTime || "") ? atLocal(today, plan.homeTime, tz).toISOString() : null;
}

// ---------- what's waiting tonight ----------
function kidTonight(fam, kidId, today) {
  const tomorrow = addDays(today, 1);
  const open = safe(() => homework.listForFamily(fam.id, { kidId })).filter((h) => h && h.status !== "done");
  const dueTomorrow = open.filter((h) => h.dueDate === tomorrow).slice(0, 5).map((h) => ({
    id: h.id, title: cleanTitle(h.title, 120) || "Homework", status: h.status === "in_progress" ? "in_progress" : "todo",
  }));
  const overdue = open.filter((h) => h.dueDate && h.dueDate < today).length;
  const habits = safe(() => goals.listGoals(fam.id, { kidId })).filter((g) => g && g.type === "habit");
  const habitsLeft = habits.filter((g) => !(Array.isArray(g.checks) && g.checks.includes(today))).length;
  const parts = safe(() => childInsights.progress(fam.id, kidId, today).parts, {});
  const daily3Left = DAILY3_PARTS.filter((key) => !(parts[key] && parts[key].status === "completed")).length;
  return { dueTomorrow, overdue, habitsLeft, habitsTotal: habits.length, daily3Left };
}

// ---------- dinner ----------
function dinnerOn(familyId, day) {
  const menu = safe(() => meals.getState(familyId).menu);
  return menu.find((e) => e && e.slot === "dinner" && e.date === day) || null;
}
function dinnerFacts(fam, today, tz) {
  const state = safe(() => meals.getState(fam.id), { menu: [], prefs: {} });
  const time = HHMM.test((state.prefs && state.prefs.dinnerTime) || "") ? state.prefs.dinnerTime : "18:30";
  const tonight = dinnerOn(fam.id, today);
  const start = nextMonday(today);
  const end = addDays(start, 6);
  const planned = new Set((state.menu || [])
    .filter((e) => e && e.slot === "dinner" && e.date >= start && e.date <= end)
    .map((e) => e.date)).size;
  return {
    time,
    at: atLocal(today, time, tz).toISOString(),
    tonight: { planned: !!tonight, title: tonight ? cleanTitle(tonight.title, 120) : null },
    nextWeek: { start, planned, days: 7 },
  };
}

// A kid commitment that ends within 90 minutes of dinner makes it a busy
// evening; the title ("Swimming") is what Hermes says.
function busyEveningTitle(fam, today, tz, now) {
  const dinnerAt = Date.parse(dinnerFacts(fam, today, tz).at);
  for (const kid of fam.kids || []) {
    const end = kidDayEnd(fam, kid, today, tz, now);
    if (end && end.kind !== "school" && dinnerAt - Date.parse(end.at) <= 90 * 60000) return end.title;
  }
  return null;
}

function buildState(fam, now = new Date()) {
  const tz = familyTimezone(fam);
  const today = dateKey(now, tz);
  const members = hermesThreads.membersOf(fam);
  const kidUsers = new Map();
  for (const m of members) {
    if (m.role !== "kid") continue;
    if (!kidUsers.has(m.kidId)) kidUsers.set(m.kidId, []);
    kidUsers.get(m.kidId).push(m.userId);
  }
  return {
    generatedAt: now.toISOString(),
    timezone: tz,
    today,
    weekday: weekdayOf(today),
    nowLocal: clockKey(now, tz),
    people: members.map((m) => (m.role === "kid"
      ? { userId: m.userId, role: m.role, name: m.name, kidId: m.kidId }
      : { userId: m.userId, role: m.role, name: m.name })),
    kids: (fam.kids || []).map((kid) => ({
      kidId: kid.id,
      name: cleanTitle(kid.name, 40) || "Your child",
      userIds: kidUsers.get(kid.id) || [],
      dayEnd: kidDayEnd(fam, kid, today, tz, now),
      homeAt: homeAt(fam, kid, today, tz),
      tonight: kidTonight(fam, kid.id, today),
    })),
    dinner: dinnerFacts(fam, today, tz),
    sent: hermesThreads.sentFor(fam, new Date(now.getTime() - SENT_LOOKBACK_MS)),
  };
}

module.exports = {
  DEFAULT_TIMEZONE,
  familyTimezone,
  dateKey,
  clockKey,
  weekdayOf,
  addDays,
  nextMonday,
  atLocal,
  formatClock,
  kidDayEnd,
  kidTonight,
  dinnerOn,
  dinnerFacts,
  busyEveningTitle,
  buildState,
};

"use strict";

// Explicit household-display projection. Never serialize raw family records,
// feed configuration, calendar descriptions, homework notes, or meal recipes.
const crypto = require("crypto");

const MAX_MEMBERS = 24;
const MAX_EVENTS_PER_DAY = 48;
const MAX_HOMEWORK = 60;
const MAX_MEALS = 42;
const DISPLAY_COLOR = "#7B4DFF";
const MEAL_ORDER = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
const SCHOOL_NOTICES = Object.freeze({
  missing: "Some school information has not synced yet.",
  stale: "Some school information may be out of date.",
  error: "Some school information could not refresh. Check the connections in Fam ETC settings.",
  refreshing: "School calendars are refreshing. New events will appear shortly.",
});
const ALLOWED_NOTICES = new Set(Object.values(SCHOOL_NOTICES));
const HOUR_MS = 60 * 60 * 1000;

function text(value, max = 200) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
}
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function shiftDate(value, offset) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day + offset);
  return date.toISOString().slice(0, 10);
}
function time(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : "";
}
function color(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : DISPLAY_COLOR;
}
function clock(timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  return (value) => {
    const p = Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  };
}

function endpoint(raw, fallbackDate, fallbackTime, allDay, inZone) {
  const value = typeof raw === "string" ? raw : "";
  const datePart = value.slice(0, 10);
  if (allDay && validDate(datePart)) return { date: datePart, time: "", key: datePart };
  if (validDate(value)) return { date: value, time: time(fallbackTime), key: `${value}T${time(fallbackTime)}` };
  // Only an explicit Z/offset is an instant. Floating/date-only values belong
  // to the household calendar and must not pass through the host's time zone.
  if (validDate(datePart) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const instant = new Date(value);
    if (Number.isFinite(instant.getTime())) return { ...inZone(instant), key: instant.toISOString() };
  }
  const floating = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  if (floating && validDate(floating[1]) && time(floating[2])) {
    return { date: floating[1], time: floating[2], key: value };
  }
  if (validDate(fallbackDate)) {
    return { date: fallbackDate, time: allDay ? "" : time(fallbackTime),
      key: allDay ? fallbackDate : `${fallbackDate}T${time(fallbackTime)}` };
  }
  return null;
}

// Mirror the legacy import markers in events.js without treating an ordinary
// school-category appointment as a lesson. ECA markers always take precedence,
// including old extension imports whose other metadata is inconsistent.
function regularTimetable(raw) {
  const notes = typeof raw.notes === "string" ? raw.notes : "";
  const importedWarning = notes.startsWith("Import warning — needs review:");
  const activity = ["eca", "activity", "activities"].includes(raw.sourceType)
    || ["eca", "activity", "activities"].includes(raw.source)
    || notes === "Signed up activity"
    || (importedWarning && (notes.includes("; clubId:") || notes.includes("; timeslot:")
      || raw.title === "Imported activity — needs review"));
  if (activity) return false;
  if (raw.feedId === "sta-child-timetable"
      || (typeof raw.subscriptionId === "string" && raw.subscriptionId.startsWith("sta-api:"))
      || raw.source === "timetable-import") return true;
  if (raw.sourceType || raw.category !== "school") return false;
  return notes === "Timetable" || (importedWarning
    && ((notes.includes("Raw values — day:") && notes.includes("; period:"))
      || raw.title === "Imported timetable item — needs review"));
}

function overlapsSchoolHours(start, end, date) {
  const minutes = (value) => time(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
  const from = date === start.date ? minutes(start.time) : 0;
  if (from === null) return false;
  const to = end.date > date ? 24 * 60 : end.date === date ? minutes(end.time) : null;
  // With no usable end time, classify only the known start point. Do not
  // invent a lesson duration that could hide a before-school activity.
  if (to === null || to <= from) return from >= 8 * 60 && from < 14 * 60;
  return from < 14 * 60 && to > 8 * 60;
}

function calendarDays(calendar, familyId, members, dates, inZone) {
  const memberMap = new Map(members.map((member) => [member.id, member]));
  const rows = new Map(dates.map((date) => [date, new Map()]));
  for (const raw of calendar) {
    if (!raw || (raw.familyId && raw.familyId !== familyId)) continue;
    const memberId = raw.kidId == null || raw.kidId === "" ? null : raw.kidId;
    // Events for a removed/unrecognized child do not become public family events.
    if (memberId && !memberMap.has(memberId)) continue;
    const title = text(raw.title || raw.summary);
    if (!title) continue;
    const allDay = raw.allDay === true || ((!raw.start || validDate(raw.start)) && !time(raw.time));
    const start = endpoint(raw.start, raw.date, raw.time, allDay, inZone);
    if (!start) continue;
    const end = endpoint(raw.end, raw.endDate || start.date, raw.endTime, allDay, inZone) || start;
    let lastDate = end.date < start.date ? start.date : end.date;
    // RFC5545 DTEND is exclusive for all-day ICS feeds. Manual endDate is an
    // inclusive calendar date in FamETC's event store. Timed midnight ends also
    // must not produce an extra event card on the following day.
    if (lastDate > start.date && ((allDay && raw.end && !raw.endDate)
        || (!allDay && end.time === "00:00"))) lastDate = shiftDate(lastDate, -1);
    // Use the source occurrence's instant/date in the dedup key. Two distinct
    // instants can share a local wall-clock time during the autumn DST change;
    // they must remain two events. Equivalent explicit offsets normalize to
    // the same instant, so duplicate feed subscriptions still collapse.
    const identity = JSON.stringify([String(raw.uid || raw.seriesId || raw.id || title),
      start.key, memberId || "family"]);
    const baseId = crypto.createHash("sha256").update(identity).digest("hex").slice(0, 24);
    for (const date of dates) {
      if (date < start.date || date > lastDate) continue;
      // Shared appointments, informational school dates and ECAs stay visible.
      // Only a known child's regular timed lessons overlapping [08:00,14:00)
      // in this display's time zone are suppressed.
      if (memberId && !allDay && regularTimetable(raw) && overlapsSchoolHours(start, end, date)) continue;
      const id = `de_${baseId}_${date}`;
      // UID + occurrence + child + day, rather than subscription, collapses a
      // duplicate feed subscription while preserving different children's rows.
      if (rows.get(date).has(id)) continue;
      rows.get(date).set(id, {
        id,
        title,
        date,
        time: date === start.date && !allDay ? start.time : "",
        endTime: date === lastDate && !allDay ? end.time : "",
        allDay,
        memberId,
        color: memberId ? memberMap.get(memberId).color : DISPLAY_COLOR,
        location: text(raw.location, 120),
      });
    }
  }
  return dates.map((date) => ({
    date,
    events: [...rows.get(date).values()]
      .sort((a, b) => Number(b.allDay) - Number(a.allDay)
        || a.time.localeCompare(b.time) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
      .slice(0, MAX_EVENTS_PER_DAY),
  }));
}

function projectContext({ family, device, calendar = [], homework = [], meals = [], notices = [], now = new Date() }) {
  const at = now instanceof Date ? now : new Date(now);
  const inZone = clock(device.timeZone);
  const today = inZone(at).date;
  const dates = Array.from({ length: 7 }, (_, i) => shiftDate(today, i));
  const endDate = dates[6];
  const members = (Array.isArray(family.kids) ? family.kids : []).slice(0, MAX_MEMBERS)
    .filter((kid) => kid && typeof kid.id === "string" && kid.id)
    .map((kid) => ({ id: text(kid.id, 120), name: text(kid.name, 60) || "Family member", color: color(kid.color) }));
  const memberIds = new Set(members.map((member) => member.id));
  const homeworkRows = device.showHomework === true ? homework
    .filter((item) => item && (!item.familyId || item.familyId === family.id)
      && memberIds.has(item.kidId) && item.status !== "done" && item.completed !== true)
    .map((item) => ({
      id: text(item.id, 120), memberId: item.kidId, title: text(item.title),
      subject: text(item.subject, 60), dueDate: validDate(item.dueDate) ? item.dueDate : "", completed: false,
    }))
    .filter((item) => item.id && item.title && (!item.dueDate || item.dueDate <= endDate))
    .sort((a, b) => {
      const group = (item) => !item.dueDate ? 3 : item.dueDate < today ? 0 : item.dueDate === today ? 1 : 2;
      return group(a) - group(b) || (group(a) === 0
        ? b.dueDate.localeCompare(a.dueDate) : a.dueDate.localeCompare(b.dueDate))
        || a.title.localeCompare(b.title);
    }).slice(0, MAX_HOMEWORK) : [];
  const mealRows = device.showMeals === true ? meals
    .filter((item) => item && validDate(item.date) && item.date >= today && item.date <= endDate
      && Object.hasOwn(MEAL_ORDER, item.slot) && (!item.familyId || item.familyId === family.id))
    .map((item) => ({ date: item.date, slot: item.slot, title: text(item.title, 120) }))
    .filter((item) => item.title)
    .sort((a, b) => a.date.localeCompare(b.date) || MEAL_ORDER[a.slot] - MEAL_ORDER[b.slot])
    .slice(0, MAX_MEALS) : [];

  return {
    schemaVersion: 1,
    generatedAt: at.toISOString(),
    pollAfterSeconds: 60,
    cacheMaxAgeSeconds: 43200,
    notices: [...new Set(notices.filter((notice) => ALLOWED_NOTICES.has(notice)))],
    today,
    timeZone: device.timeZone,
    family: { name: text(family.name, 80) || "Our family" },
    device: {
      id: device.id, label: text(device.label, 60),
      showHomework: device.showHomework === true, showMeals: device.showMeals === true,
    },
    members,
    days: calendarDays(calendar, family.id, members, dates, inZone),
    homework: homeworkRows,
    meals: mealRows,
  };
}

// A Portal can be the family's only active calendar client. Reuse the normal
// server-side subscription sync, coalesced per family, without holding up the
// current cached response or handing any feed capability to the display.
function createSchoolCacheRefresher() {
  const inFlight = new Map();
  const attempts = new Map();
  return (familyId, store, schoolFeeds, nowMs) => {
    const subscriptions = Array.isArray(store.subscriptions) ? store.subscriptions : [];
    if (!subscriptions.length) return [];
    const interval = Number.isFinite(schoolFeeds.AUTO_SYNC_MIN_INTERVAL_MS)
      ? Math.max(HOUR_MS, schoolFeeds.AUTO_SYNC_MIN_INTERVAL_MS) : HOUR_MS;
    const ttl = Number.isFinite(schoolFeeds.SYNC_TTL_MS) ? Math.max(HOUR_MS, schoolFeeds.SYNC_TTL_MS) : HOUR_MS;
    const notices = new Set();
    for (const subscription of subscriptions) {
      const cached = store.cache && store.cache[subscription.id];
      const fetchedAt = cached && Date.parse(cached.fetchedAt);
      if (!cached || !Array.isArray(cached.events) || !Number.isFinite(fetchedAt)) notices.add(SCHOOL_NOTICES.missing);
      else if (nowMs < fetchedAt || nowMs - fetchedAt >= ttl) notices.add(SCHOOL_NOTICES.stale);
      if (cached && cached.error) notices.add(SCHOOL_NOTICES.error);
    }

    for (const [id, attempt] of attempts) {
      if (!inFlight.has(id) && (nowMs < attempt.at || nowMs - attempt.at >= 24 * HOUR_MS)) attempts.delete(id);
    }
    const lastAttempt = attempts.get(familyId);
    const lastSyncAt = Date.parse(store.lastSyncAt);
    if (lastAttempt && lastAttempt.failed && (!Number.isFinite(lastSyncAt) || lastSyncAt <= lastAttempt.observedSyncAt)) {
      notices.add(SCHOOL_NOTICES.error);
    }
    const due = !Number.isFinite(lastSyncAt) || nowMs < lastSyncAt || nowMs - lastSyncAt >= interval;
    const retryDue = !lastAttempt || nowMs < lastAttempt.at || nowMs - lastAttempt.at >= interval;
    if (due && retryDue && !inFlight.has(familyId) && inFlight.size < 64 && typeof schoolFeeds.syncFamily === "function") {
      const attempt = { at: nowMs, failed: false, observedSyncAt: nowMs };
      attempts.set(familyId, attempt);
      // Keep only a bounded retry history. In-flight work has a separate guard.
      while (attempts.size > 512) attempts.delete(attempts.keys().next().value);
      const task = Promise.resolve().then(() => schoolFeeds.syncFamily(familyId, { force: false }));
      inFlight.set(familyId, task);
      task.then((result) => {
        attempt.failed = !!(result && (result.error || (Array.isArray(result.errors) && result.errors.length)));
      }, () => {
        attempt.failed = true;
      }).finally(() => {
        const completedSyncAt = Date.parse(store.lastSyncAt);
        if (Number.isFinite(completedSyncAt)) attempt.observedSyncAt = completedSyncAt;
        if (inFlight.get(familyId) === task) inFlight.delete(familyId);
      });
    }
    if (inFlight.has(familyId)) notices.add(SCHOOL_NOTICES.refreshing);
    return [...notices];
  };
}

const refreshSchoolCache = createSchoolCacheRefresher();

function buildContext({ family, device, schoolFeeds, schoolApi, events, homework, meals,
  schoolCacheRefresher = refreshSchoolCache, now = new Date() }) {
  const at = now instanceof Date ? now : new Date(now);
  const today = clock(device.timeZone)(at).date;
  // Include adjacent UTC dates when collecting absolute instants. The pure
  // projection decides membership using the display's own calendar days.
  const manual = events.listEvents(family.id, { from: shiftDate(today, -1), to: shiftDate(today, 7) });
  const schoolStore = schoolFeeds.famStore(family.id);
  const notices = schoolCacheRefresher(family.id, schoolStore, schoolFeeds, at.getTime());
  const school = schoolFeeds.collectFromCache(schoolStore, at.getTime());
  const timetable = schoolApi.listTimetableEvents(family.id);
  // Private school feeds retain their existing scheduler. Only generic status
  // crosses this boundary: never source errors, links or connection metadata.
  if (typeof schoolApi.listStatus === "function") {
    const memberIds = new Set((Array.isArray(family.kids) ? family.kids : []).filter(Boolean).map((kid) => kid.id));
    const interval = Number.isFinite(schoolApi.SYNC_INTERVAL_MS) ? schoolApi.SYNC_INTERVAL_MS : 8 * HOUR_MS;
    for (const status of schoolApi.listStatus(family.id, at.getTime())) {
      if (!status.connected || !memberIds.has(status.kidId)) continue;
      const syncedAt = Date.parse(status.lastSyncAt);
      if (!Number.isFinite(syncedAt)) notices.push(SCHOOL_NOTICES.missing);
      else if (at.getTime() < syncedAt || at.getTime() - syncedAt >= interval) notices.push(SCHOOL_NOTICES.stale);
      if (status.paused || status.lastError) notices.push(SCHOOL_NOTICES.error);
    }
  }
  return projectContext({
    family, device, now: at, notices,
    calendar: [...manual, ...school, ...timetable],
    homework: device.showHomework === true ? homework.listForFamily(family.id) : [],
    meals: device.showMeals === true ? meals.getState(family.id).menu : [],
  });
}

module.exports = { buildContext, projectContext, createSchoolCacheRefresher, validDate, shiftDate,
  MAX_EVENTS_PER_DAY, MAX_HOMEWORK, MAX_MEALS, SCHOOL_NOTICES };

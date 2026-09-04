"use strict";

/**
 * St Andrews child timetable/homework feeds.
 *
 * Parents paste the two capability URLs in Settings. The URL is the login, so
 * only the shared capability code is retained and it is encrypted separately
 * inside the already-encrypted family datastore. Status responses and logs
 * never return the code or either URL.
 */
const db = require("./db");
const datacrypto = require("./datacrypto");
const family = require("./family");
const homework = require("./homework");
const actions = require("./actions");

const FEED_ORIGIN = "https://bangkok.learn.nae.school";
const HOMEWORK_PATH = "/local/sta/api/childhomework.php";
const TIMETABLE_PATH = "/local/sta/api/childtimetable.php";
const TIMEZONE = "Asia/Bangkok";
const SYNC_INTERVAL_MS = 8 * 60 * 60 * 1000;
const MIN_MANUAL_SYNC_MS = 30 * 60 * 1000;
const SCHEDULER_SCAN_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20 * 1000;
const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
const MAX_HOMEWORK_ITEMS = 2000;
const MAX_TIMETABLE_ITEMS = 200;
const NO_DEADLINE_YEAR = 2040;

const inFlight = new Map();
let scheduler = null;

function root() {
  const r = db.load();
  if (!r.schoolApiFeeds) r.schoolApiFeeds = {};
  return r.schoolApiFeeds;
}

function familyStore(familyId, create = true) {
  const r = root();
  if (!r[familyId] && create) r[familyId] = { connections: {} };
  return r[familyId] || null;
}

function encryptionAvailable() {
  return !!datacrypto.loadKey();
}

function cleanText(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return false;
  const d = new Date(0);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return d.getUTCFullYear() === Number(match[1])
    && d.getUTCMonth() === Number(match[2]) - 1
    && d.getUTCDate() === Number(match[3]);
}

function validTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  return !!match && Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

function parseFeedLink(raw, expectedPath) {
  const text = String(raw || "").trim();
  if (!text || text.length > 2048) return { error: "Paste the complete private school link." };
  let url;
  try {
    url = new URL(text);
  } catch (e) {
    return { error: "That is not a valid school feed link." };
  }
  if (url.origin !== FEED_ORIGIN || url.pathname !== expectedPath || url.username || url.password || url.hash) {
    return { error: "Use the private link from the St Andrews child feed page." };
  }
  const allowedKeys = expectedPath === HOMEWORK_PATH
    ? new Set(["code", "format", "label"])
    : new Set(["code", "format"]);
  for (const key of url.searchParams.keys()) {
    if (!allowedKeys.has(key)) return { error: "The school feed link contains an unsupported option." };
  }
  const code = url.searchParams.get("code") || "";
  if (code.length < 16 || code.length > 512 || !/^[A-Za-z0-9+/_=-]+$/.test(code)) {
    return { error: "The school feed link is missing a valid access code." };
  }
  return { code };
}

function validateLinks({ homeworkUrl, timetableUrl } = {}) {
  const hw = parseFeedLink(homeworkUrl, HOMEWORK_PATH);
  if (hw.error) return { error: `Homework: ${hw.error}` };
  const tt = parseFeedLink(timetableUrl, TIMETABLE_PATH);
  if (tt.error) return { error: `Timetable: ${tt.error}` };
  if (hw.code !== tt.code) return { error: "The homework and timetable links must belong to the same child." };
  return { code: hw.code };
}

function encryptCode(code) {
  const key = datacrypto.loadKey();
  if (!key) return null;
  return datacrypto.encrypt(JSON.stringify({ code }), key);
}

function decryptCode(connection) {
  const key = datacrypto.loadKey();
  if (!key || !connection || !connection.secretBlob) return null;
  try {
    const parsed = JSON.parse(datacrypto.decrypt(connection.secretBlob, key));
    return typeof parsed.code === "string" ? parsed.code : null;
  } catch (e) {
    return null;
  }
}

function statusFor(kidId, connection, now = Date.now()) {
  const lastAttemptMs = connection.lastAttemptAt ? Date.parse(connection.lastAttemptAt) : 0;
  return {
    kidId,
    connected: !!connection.secretBlob,
    updatedAt: connection.updatedAt || null,
    lastAttemptAt: connection.lastAttemptAt || null,
    lastSyncAt: connection.lastSyncAt || null,
    nextSyncAt: lastAttemptMs ? new Date(lastAttemptMs + SYNC_INTERVAL_MS).toISOString() : null,
    syncDue: !lastAttemptMs || now - lastAttemptMs >= SYNC_INTERVAL_MS,
    paused: !!connection.paused,
    lastError: connection.lastError || null,
    week: Number.isInteger(connection.week) ? connection.week : null,
    homeworkCount: Number(connection.homeworkCount) || 0,
    timetableCount: Array.isArray(connection.timetableEvents) ? connection.timetableEvents.length : 0,
  };
}

function listStatus(familyId, now = Date.now()) {
  const store = familyStore(familyId, false);
  if (!store || !store.connections) return [];
  return Object.entries(store.connections).map(([kidId, connection]) => statusFor(kidId, connection, now));
}

function saveConnection(familyId, parentUserId, kidId, links) {
  if (!encryptionAvailable()) {
    return { error: "School feed connection is not available because secure storage is not configured." };
  }
  const fam = family.getFamily(familyId);
  if (!fam || !fam.kids.some((kid) => kid.id === kidId)) return { error: "Kid not found in this family." };
  const checked = validateLinks(links);
  if (checked.error) return checked;
  const secretBlob = encryptCode(checked.code);
  if (!secretBlob) return { error: "School feed connection is not available because secure storage is not configured." };

  const store = familyStore(familyId);
  const previous = store.connections[kidId] || {};
  store.connections[kidId] = {
    parentUserId,
    secretBlob,
    updatedAt: new Date().toISOString(),
    lastAttemptAt: null,
    lastSyncAt: null,
    lastError: null,
    paused: false,
    etags: {},
    homeworkCount: Number(previous.homeworkCount) || 0,
    week: Number.isInteger(previous.week) ? previous.week : null,
    timetableEvents: Array.isArray(previous.timetableEvents) ? previous.timetableEvents : [],
    hiddenEventUids: Array.isArray(previous.hiddenEventUids) ? previous.hiddenEventUids.slice(0, 500) : [],
    replaceAllHomeworkOnNextSync: previous.secretBlob
      ? previous.replaceAllHomeworkOnNextSync === true
      : true,
  };
  db.persist();
  return { ok: true, status: statusFor(kidId, store.connections[kidId]) };
}

function disconnect(familyId, kidId) {
  const store = familyStore(familyId, false);
  if (!store || !store.connections || !store.connections[kidId]) return { ok: true, deleted: false };
  delete store.connections[kidId];
  const removed = homework.removeSchoolApiForKid(familyId, kidId);
  if (removed.removedIds.length && typeof actions.removeProjectedHomework === "function") {
    actions.removeProjectedHomework(familyId, removed.removedIds);
  }
  db.persist();
  return { ok: true, deleted: true, homeworkRemoved: removed.removed };
}

class FeedError extends Error {
  constructor(message, { permanent = false } = {}) {
    super(message);
    this.name = "FeedError";
    this.permanent = permanent;
  }
}

async function readJsonResponse(response) {
  const declared = Number(response.headers && response.headers.get && response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_CHARS) throw new FeedError("The school feed response was too large.");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARS) throw new FeedError("The school feed response was too large.");
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new FeedError("The school feed returned an unexpected response.");
  }
}

async function fetchFeed(code, kind, etag, fetchImpl = global.fetch) {
  const path = kind === "homework" ? HOMEWORK_PATH : TIMETABLE_PATH;
  const url = new URL(path, FEED_ORIGIN);
  url.searchParams.set("code", code);
  url.searchParams.set("format", "json");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = { Accept: "application/json", "User-Agent": "FamETC-ChildFeed/1.0" };
  if (etag) headers["If-None-Match"] = etag;
  let response;
  try {
    response = await fetchImpl(url, { method: "GET", headers, redirect: "error", signal: controller.signal });
  } catch (e) {
    throw new FeedError("Could not reach the school feed.");
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 304) return { unchanged: true, etag };
  if (response.status === 404) throw new FeedError("The school link is no longer valid. Replace it in Settings.", { permanent: true });
  if (response.status !== 200) throw new FeedError("The school feed is temporarily unavailable.");
  return {
    unchanged: false,
    etag: response.headers && response.headers.get ? response.headers.get("etag") : null,
    data: await readJsonResponse(response),
  };
}

function validateEnvelope(data, kind, maxItems) {
  const key = kind === "homework" ? "homework" : "lessons";
  if (!data || data.ok !== true || data.version !== 1 || data.timezone !== TIMEZONE
    || !Number.isInteger(data.week) || !Array.isArray(data[key]) || data[key].length > maxItems) {
    throw new FeedError("The school feed format has changed. Contact school IT before syncing again.", { permanent: true });
  }
  return data[key];
}

function normalizeLink(value) {
  const text = cleanText(value, 2000);
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : "";
  } catch (e) {
    return "";
  }
}

function normalizeHomework(data) {
  const rows = validateEnvelope(data, "homework", MAX_HOMEWORK_ITEMS);
  const seen = new Set();
  return rows.map((raw) => {
    const id = raw && raw.id;
    const title = cleanText(raw && raw.title, 200);
    const due = cleanText(raw && raw.due, 10);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id) || !title || !validDate(due)) {
      throw new FeedError("The school homework feed contains an invalid task. Nothing was changed.");
    }
    seen.add(id);
    const year = Number(due.slice(0, 4));
    // ponytail: FamETC's cross-platform homework contract currently requires
    // a real dueDate. Omit the school's far-future "no deadline" sentinel
    // until web+iOS have a first-class No deadline bucket; never show 2050.
    if (year >= NO_DEADLINE_YEAR) return null;
    return {
      sourceTaskId: String(id),
      title,
      description: cleanText(raw.description, 2000),
      link: normalizeLink(raw.link),
      subject: cleanText(raw.subject, 60),
      schoolCode: cleanText(raw.code, 80),
      setBy: cleanText(raw.setby, 120),
      dueDate: due,
      sourceDueDate: due,
      noDueDate: false,
      effortMin: Number.isFinite(Number(raw.duration)) && Number(raw.duration) > 0
        ? Math.min(1440, Math.round(Number(raw.duration))) : null,
      selfSet: raw.selfset === true,
    };
  }).filter(Boolean);
}

function bangkokDateParts(nowMs) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(nowMs));
  const value = (type) => parts.find((part) => part.type === type).value;
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[value("weekday")];
  return { ymd: `${value("year")}-${value("month")}-${value("day")}`, weekday };
}

function addDays(ymd, days) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function feedMonday(nowMs) {
  const local = bangkokDateParts(nowMs);
  const delta = local.weekday === 0 ? 1 : local.weekday === 6 ? 2 : 1 - local.weekday;
  return addDays(local.ymd, delta);
}

function normalizeTimetable(data, familyId, kidId, nowMs) {
  const rows = validateEnvelope(data, "timetable", MAX_TIMETABLE_ITEMS);
  const monday = feedMonday(nowMs);
  const seen = new Set();
  const events = rows.map((raw) => {
    const day = Number(raw && raw.day);
    const periodnum = Number(raw && raw.periodnum);
    const classid = Number(raw && raw.classid);
    const start = cleanText(raw && raw.start, 5);
    const end = cleanText(raw && raw.end, 5);
    const title = cleanText(raw && (raw.subject || raw.period), 200);
    if (!Number.isInteger(day) || day < 1 || day > 5
      || !Number.isInteger(periodnum) || periodnum < 1 || periodnum > 10
      || !Number.isSafeInteger(classid) || classid < 0
      || !validTime(start) || !validTime(end) || !title) {
      throw new FeedError("The school timetable feed contains an invalid lesson. Nothing was changed.");
    }
    const uid = `sta-tt-${kidId}-${data.week}-${day}-${periodnum}-${classid}`;
    if (seen.has(uid)) throw new FeedError("The school timetable feed contains a duplicate lesson. Nothing was changed.");
    seen.add(uid);
    const date = addDays(monday, day - 1);
    const period = cleanText(raw.period, 20);
    const subjectFull = cleanText(raw.subjectfull, 200);
    const schoolCode = cleanText(raw.code, 80);
    const teacher = cleanText(raw.teacher, 120);
    return {
      uid,
      subscriptionId: `sta-api:${kidId}`,
      feedId: "sta-child-timetable",
      feedLabel: "School timetable",
      title,
      start: `${date}T${start}:00+07:00`,
      end: `${date}T${end}:00+07:00`,
      allDay: false,
      location: cleanText(raw.room, 200),
      description: [period, subjectFull && subjectFull !== title ? subjectFull : "", schoolCode, teacher].filter(Boolean).join(" · "),
      kidId,
      familyId,
      isDeadline: false,
      type: "event",
      recurring: false,
      schoolWeek: data.week,
    };
  });
  return { week: data.week, events };
}

function resultError(error) {
  return error instanceof FeedError ? error : new FeedError("Could not synchronize the school feeds.");
}

async function performSyncKid(familyId, kidId, { force = false, nowMs = Date.now(), fetchImpl = global.fetch } = {}) {
  const store = familyStore(familyId, false);
  const connection = store && store.connections && store.connections[kidId];
  if (!connection) return { error: "School feeds are not connected for this child." };
  if (connection.paused && !force) {
    return { ok: false, paused: true, error: connection.lastError || "The school links need attention.", status: statusFor(kidId, connection, nowMs) };
  }

  const lastAttempt = connection.lastAttemptAt ? Date.parse(connection.lastAttemptAt) : 0;
  const waitMs = force ? MIN_MANUAL_SYNC_MS : SYNC_INTERVAL_MS;
  if (lastAttempt && nowMs - lastAttempt < waitMs) {
    return {
      ok: !connection.lastError,
      throttled: true,
      paused: !!connection.paused,
      error: connection.lastError || null,
      status: statusFor(kidId, connection, nowMs),
    };
  }
  const code = decryptCode(connection);
  if (!code) {
    connection.paused = true;
    connection.lastError = "The saved school link could not be read. Replace it in Settings.";
    connection.lastAttemptAt = new Date(nowMs).toISOString();
    db.persist();
    return { ok: false, paused: true, status: statusFor(kidId, connection, nowMs) };
  }

  connection.lastAttemptAt = new Date(nowMs).toISOString();
  const [hwSettled, ttSettled] = await Promise.allSettled([
    fetchFeed(code, "homework", connection.etags && connection.etags.homework, fetchImpl),
    fetchFeed(code, "timetable", connection.etags && connection.etags.timetable, fetchImpl),
  ]);
  let homeworkResult = null;
  let timetableResult = null;
  const errors = [];

  if (hwSettled.status === "fulfilled") {
    try {
      const fetched = hwSettled.value;
      if (!fetched.unchanged) {
        const normalized = normalizeHomework(fetched.data);
        homeworkResult = connection.replaceAllHomeworkOnNextSync === true
          ? homework.replaceKidHomeworkWithSchoolApi(familyId, kidId, normalized)
          : homework.syncSchoolApi(familyId, kidId, normalized);
        if (homeworkResult.error) throw new FeedError(homeworkResult.error);
        connection.replaceAllHomeworkOnNextSync = false;
        connection.homeworkCount = normalized.length;
        connection.etags = Object.assign({}, connection.etags, { homework: fetched.etag || null });
        if (homeworkResult.removedIds.length && typeof actions.removeProjectedHomework === "function") {
          actions.removeProjectedHomework(familyId, homeworkResult.removedIds);
        }
        const current = homework.listForFamily(familyId, { kidId }).filter((item) => item.source === "school-api");
        const project = actions.projectSchoolAssignments || actions.projectMoodleAssignments;
        if (typeof project === "function") project(familyId, current);
      }
    } catch (e) {
      errors.push(resultError(e));
    }
  } else {
    errors.push(resultError(hwSettled.reason));
  }

  if (ttSettled.status === "fulfilled") {
    try {
      const fetched = ttSettled.value;
      if (!fetched.unchanged) {
        const normalized = normalizeTimetable(fetched.data, familyId, kidId, nowMs);
        connection.week = normalized.week;
        connection.timetableEvents = normalized.events;
        connection.etags = Object.assign({}, connection.etags, { timetable: fetched.etag || null });
        timetableResult = { count: normalized.events.length };
      }
    } catch (e) {
      errors.push(resultError(e));
    }
  } else {
    errors.push(resultError(ttSettled.reason));
  }

  if (errors.length) {
    connection.lastError = errors[0].message;
    connection.paused = errors.some((error) => error.permanent);
  } else {
    connection.lastError = null;
    connection.paused = false;
    connection.lastSyncAt = new Date(nowMs).toISOString();
  }
  db.persist();
  return {
    ok: errors.length === 0,
    paused: !!connection.paused,
    homework: homeworkResult,
    timetable: timetableResult,
    error: errors.length ? connection.lastError : null,
    status: statusFor(kidId, connection, nowMs),
  };
}

function syncKid(familyId, kidId, options = {}) {
  const key = `${familyId}:${kidId}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = performSyncKid(familyId, kidId, options).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function syncFamily(familyId, options = {}) {
  const store = familyStore(familyId, false);
  const kidIds = store && store.connections ? Object.keys(store.connections) : [];
  const results = await Promise.all(kidIds.map((kidId) => syncKid(familyId, kidId, options)));
  return {
    results,
    events: listTimetableEvents(familyId),
    errors: results.filter((result) => !result.ok && result.error).map((result) => ({ label: "School timetable & homework", error: result.error })),
  };
}

function listTimetableEvents(familyId) {
  const store = familyStore(familyId, false);
  if (!store || !store.connections) return [];
  const out = [];
  for (const connection of Object.values(store.connections)) {
    const hidden = new Set(Array.isArray(connection.hiddenEventUids) ? connection.hiddenEventUids : []);
    for (const event of Array.isArray(connection.timetableEvents) ? connection.timetableEvents : []) {
      if (!hidden.has(event.uid)) out.push(Object.assign({}, event));
    }
  }
  return out;
}

function hideEvent(familyId, { subscriptionId, uid } = {}) {
  const prefix = "sta-api:";
  if (typeof subscriptionId !== "string" || !subscriptionId.startsWith(prefix) || !uid) {
    return { error: "School timetable event not found." };
  }
  const kidId = subscriptionId.slice(prefix.length);
  const store = familyStore(familyId, false);
  const connection = store && store.connections && store.connections[kidId];
  if (!connection || !(connection.timetableEvents || []).some((event) => event.uid === uid)) {
    return { error: "School timetable event not found." };
  }
  connection.hiddenEventUids = Array.isArray(connection.hiddenEventUids) ? connection.hiddenEventUids : [];
  if (!connection.hiddenEventUids.includes(uid)) connection.hiddenEventUids.push(uid);
  connection.hiddenEventUids = connection.hiddenEventUids.slice(-500);
  db.persist();
  return { ok: true };
}

async function syncAllDue(options = {}) {
  const stores = root();
  for (const familyId of Object.keys(stores)) {
    await syncFamily(familyId, Object.assign({}, options, { force: false }));
  }
}

function startScheduler() {
  if (scheduler) return scheduler;
  const run = () => syncAllDue().catch(() => { /* status is stored per connection; never log capability data */ });
  const initial = setTimeout(run, 0);
  if (initial.unref) initial.unref();
  scheduler = setInterval(run, SCHEDULER_SCAN_MS);
  if (scheduler.unref) scheduler.unref();
  return scheduler;
}

function stopScheduler() {
  if (scheduler) clearInterval(scheduler);
  scheduler = null;
}

module.exports = {
  FEED_ORIGIN,
  HOMEWORK_PATH,
  TIMETABLE_PATH,
  TIMEZONE,
  SYNC_INTERVAL_MS,
  MIN_MANUAL_SYNC_MS,
  SCHEDULER_SCAN_MS,
  encryptionAvailable,
  validateLinks,
  saveConnection,
  disconnect,
  listStatus,
  syncKid,
  syncFamily,
  syncAllDue,
  listTimetableEvents,
  hideEvent,
  feedMonday,
  normalizeHomework,
  normalizeTimetable,
  startScheduler,
  stopScheduler,
};

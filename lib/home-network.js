"use strict";
/**
 * Home Wi-Fi agent — a family's home DNS filter (Canopy, on a Mac on the home
 * network) paired with Fam ETC so parents keep ONE rule set. Fam ETC stays the
 * source of truth for each kid's pause, daily allowance, approved extra time
 * and bedtime (including tonight's "stay up later"); the agent pulls them over
 * HTTPS and enforces them for every device on home Wi-Fi, then reports home
 * usage back. The agent only ever calls out, so nothing on the home network is
 * exposed. Contract: docs/SCREEN-TIME-PLAN.md "Home Wi-Fi agent".
 *
 * Storage: root.homeNetwork[familyId] = {
 *   agent, pairing, usage, wifi, endsSoonSent, history, digest, lastDigestDate,
 *   noSchoolDates, settings, alerts, seenAlertIds, alertPushDedup
 * } in the encrypted db. The agent authenticates with `Authorization: FamHome
 * <token>`; only the SHA-256 of the token and of the one-time pairing code are
 * stored. One agent per family: pairing again replaces the old one. Never log
 * tokens. Parent pushes go to parents only, never the family chat.
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");
const screenTime = require("./screen-time");
const schoolDays = require("./school-days");

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const TOKEN_PREFIX = "fhn_";
const TOKEN = /^fhn_[A-Za-z0-9_-]{43}$/;
const ONLINE_MS = 3 * 60 * 1000;
const SEEN_PERSIST_MS = 10 * 60 * 1000;
const MONITOR_MS = 10 * 60 * 1000;
const MAX_KIDS = 20;
const MAX_APPS = 5;
const MAX_HISTORY_DAYS = 14;
const MAX_ALERTS = 50;
const MAX_SEEN_ALERTS = 200;
const MAX_NO_SCHOOL_DATES = 200;
const DEFAULT_TIMEZONE = "Asia/Bangkok";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const deps = {
  now: () => new Date(),
  notify: (args) => require("./fam-notifications").notifyHomeWifi(args),
  notifyParents: (args) => require("./fam-notifications").notifyHomeWifiParent(args),
};
const WIFI_STATUSES = new Set(["online", "paused", "bedtime", "focus", "limit_reached"]);
const ENDS_SOON_REASONS = new Set(["bedtime", "focus", "limit_reached"]);
const ALERT_TYPES = new Set(["risk", "bypass", "new_device"]);
const RISK_CATEGORY_LABELS = {
  adult: "an adult site",
  stranger_chat: "a stranger chat site",
  gambling: "a gambling site",
  drugs_weapons_harm: "a restricted safety-risk site",
  ai_companions: "an AI companion site",
};

function configure(overrides) { Object.assign(deps, overrides || {}); }

const hash = (v) => crypto.createHash("sha256").update(String(v), "utf8").digest("hex");
function sameHash(a, b) {
  const x = Buffer.from(String(a || ""), "hex");
  const y = Buffer.from(String(b || ""), "hex");
  return x.length === 32 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
function normalizeCode(v) {
  return typeof v === "string" && v.length <= 64 ? v.toUpperCase().replace(/[\s-]/g, "") : "";
}
function cleanText(v, max) {
  if (typeof v !== "string") return "";
  return Array.from(v.replace(/[\u0000-\u001f\u007f]/g, "").trim()).slice(0, max).join("");
}
function stripUrls(v) {
  if (typeof v !== "string") return "";
  return v.replace(/https?:\/\/\S+/gi, "").replace(/\bwww\.\S+/gi, "").replace(/\s+/g, " ").trim();
}
function formatHhmm12(hhmm) {
  const [hStr, mStr] = String(hhmm || "00:00").split(":");
  const h = Number(hStr);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${mStr} ${period}`;
}
function formatMinutes(m) {
  const n = Math.max(0, Math.round(Number(m) || 0));
  const h = Math.floor(n / 60);
  const r = n % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}
function localClockParts(fam, date) {
  const tz = (fam && fam.timezone) || DEFAULT_TIMEZONE;
  const fmt = (zone) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric", month: "2-digit", day: "2-digit",
      weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date).map((x) => [x.type, x.value]));
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      weekday: String(parts.weekday || "").toLowerCase().slice(0, 3),
      hour: Number(parts.hour) || 0,
      minute: Number(parts.minute) || 0,
    };
  };
  try { return fmt(tz); } catch (_) { return fmt(DEFAULT_TIMEZONE); }
}

function root() {
  const r = db.load();
  if (!r.homeNetwork) r.homeNetwork = {};
  return r.homeNetwork;
}
function stateFor(familyId, create) {
  const all = root();
  if (!all[familyId] && create) all[familyId] = { agent: null, pairing: null, usage: {} };
  return all[familyId] || null;
}

function settingsOf(s) {
  const raw = (s && s.settings && typeof s.settings === "object") ? s.settings : {};
  const alerts = (raw.alerts && typeof raw.alerts === "object") ? raw.alerts : {};
  return {
    weeklyDigest: raw.weeklyDigest !== false,
    alerts: {
      risk: alerts.risk !== false,
      bypass: alerts.bypass !== false,
      new_device: alerts.new_device !== false,
    },
  };
}

function publicAgent(agent, at) {
  if (!agent) return null;
  const seen = agent.lastSeenAt ? Date.parse(agent.lastSeenAt) : NaN;
  return {
    name: agent.name,
    version: agent.version || null,
    pairedAt: agent.pairedAt,
    lastSeenAt: agent.lastSeenAt || null,
    online: Number.isFinite(seen) && at - seen < ONLINE_MS,
    engine: agent.engine ? { ...agent.engine } : null,
  };
}

function publicAlerts(s) {
  return Array.isArray(s && s.alerts) ? s.alerts.slice(0, MAX_ALERTS).map((a) => ({ ...a })) : [];
}

// ---------- parent ----------

function status(fam) {
  const s = stateFor(fam.id, false);
  const at = deps.now().getTime();
  const today = screenTime.familyToday(fam);
  const pairing = s && s.pairing && Date.parse(s.pairing.expiresAt) > at ? { expiresAt: s.pairing.expiresAt } : null;
  return {
    agent: publicAgent(s && s.agent, at),
    pairing,
    usage: usageOf(fam),
    days: schoolDays.uiDays(fam, today),
    noSchoolDates: Array.isArray(s && s.noSchoolDates) ? s.noSchoolDates.slice() : [],
    settings: settingsOf(s),
    alerts: publicAlerts(s),
    digest: s && s.digest ? s.digest : null,
  };
}

// Today's home usage per kid (only for the family's current date).
function usageOf(fam) {
  const s = stateFor(fam.id, false);
  if (!s || !s.agent || !s.usage) return {};
  const today = screenTime.familyToday(fam);
  const out = {};
  for (const kid of fam.kids || []) {
    const u = s.usage[kid.id];
    if (u && u.date === today) out[kid.id] = { ...u, topApps: (u.topApps || []).map((a) => ({ ...a })) };
  }
  return out;
}

// Compact block for /api/screen-time (Today card): null until an agent is paired.
function summary(fam) {
  const s = stateFor(fam.id, false);
  if (!s || !s.agent) return null;
  const at = deps.now().getTime();
  const today = screenTime.familyToday(fam);
  const prefs = settingsOf(s);
  return {
    agent: publicAgent(s.agent, at),
    usage: usageOf(fam),
    days: schoolDays.uiDays(fam, today),
    digest: prefs.weeklyDigest && s.digest ? s.digest : null,
  };
}

function createPairing(fam, userId) {
  const s = stateFor(fam.id, true);
  const at = deps.now().getTime();
  const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");
  s.pairing = {
    codeHash: hash(code), createdBy: userId,
    createdAt: new Date(at).toISOString(), expiresAt: new Date(at + PAIRING_TTL_MS).toISOString(),
  };
  db.persist();
  return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: s.pairing.expiresAt };
}

function unpair(fam) {
  const s = stateFor(fam.id, false);
  if (s) {
    s.agent = null;
    s.pairing = null;
    s.usage = {};
    s.wifi = {};
    s.endsSoonSent = {};
    db.persist();
  }
  return status(fam);
}

function updateSettings(fam, body) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : null;
  if (!b) return { error: "Send a JSON object.", status: 400 };
  const s = stateFor(fam.id, true);
  const cur = settingsOf(s);
  if (b.weeklyDigest !== undefined) {
    if (typeof b.weeklyDigest !== "boolean") return { error: "weeklyDigest must be true or false.", status: 400 };
    cur.weeklyDigest = b.weeklyDigest;
  }
  if (b.alerts !== undefined) {
    if (!b.alerts || typeof b.alerts !== "object" || Array.isArray(b.alerts)) {
      return { error: "alerts must be an object.", status: 400 };
    }
    for (const key of ["risk", "bypass", "new_device"]) {
      if (b.alerts[key] !== undefined) {
        if (typeof b.alerts[key] !== "boolean") return { error: `alerts.${key} must be true or false.`, status: 400 };
        cur.alerts[key] = b.alerts[key];
      }
    }
  }
  s.settings = cur;
  db.persist();
  return { settings: settingsOf(s) };
}

function addNoSchoolDate(fam, rawDate) {
  if (!schoolDays.validDate(rawDate)) return { error: "date must be a valid YYYY-MM-DD.", status: 400 };
  const s = stateFor(fam.id, true);
  const list = Array.isArray(s.noSchoolDates) ? s.noSchoolDates.slice() : [];
  if (!list.includes(rawDate)) {
    if (list.length >= MAX_NO_SCHOOL_DATES) return { error: `At most ${MAX_NO_SCHOOL_DATES} no-school dates.`, status: 400 };
    list.push(rawDate);
    list.sort();
    s.noSchoolDates = list;
    db.persist();
  }
  return { noSchoolDates: (s.noSchoolDates || []).slice(), days: schoolDays.uiDays(fam, screenTime.familyToday(fam)) };
}

function removeNoSchoolDate(fam, rawDate) {
  if (!schoolDays.validDate(rawDate)) return { error: "date must be a valid YYYY-MM-DD.", status: 400 };
  const s = stateFor(fam.id, false);
  if (s && Array.isArray(s.noSchoolDates)) {
    const next = s.noSchoolDates.filter((d) => d !== rawDate);
    if (next.length !== s.noSchoolDates.length) {
      s.noSchoolDates = next;
      db.persist();
    }
  }
  return {
    noSchoolDates: Array.isArray(s && s.noSchoolDates) ? s.noSchoolDates.slice() : [],
    days: schoolDays.uiDays(fam, screenTime.familyToday(fam)),
  };
}

function getDigest(fam) {
  const s = stateFor(fam.id, false);
  return { digest: s && s.digest ? s.digest : null, enabled: settingsOf(s).weeklyDigest };
}

function getAlerts(fam) {
  const s = stateFor(fam.id, false);
  return { alerts: publicAlerts(s) };
}

function dismissAlert(fam, alertId) {
  if (typeof alertId !== "string" || !alertId) return { error: "Alert not found.", status: 404 };
  const s = stateFor(fam.id, false);
  if (!s || !Array.isArray(s.alerts)) return { error: "Alert not found.", status: 404 };
  const before = s.alerts.length;
  s.alerts = s.alerts.filter((a) => a.id !== alertId);
  if (s.alerts.length === before) return { error: "Alert not found.", status: 404 };
  db.persist();
  return { alerts: publicAlerts(s) };
}

function dismissAllAlerts(fam) {
  const s = stateFor(fam.id, false);
  if (s && Array.isArray(s.alerts) && s.alerts.length) {
    s.alerts = [];
    db.persist();
  }
  return { alerts: [] };
}

// ---------- agent ----------

function familiesWithPairings() {
  return Object.entries(root()).filter(([, s]) => s && s.pairing);
}

// One-time code → long-lived token. Replaces any agent the family had.
function claim(rawCode, body) {
  const invalid = { error: "That pairing code is invalid or has expired.", status: 400, code: "pairing_invalid" };
  const code = normalizeCode(rawCode);
  if (code.length !== CODE_LENGTH || [...code].some((c) => !CODE_ALPHABET.includes(c))) return invalid;
  const at = deps.now();
  const codeHash = hash(code);
  const match = familiesWithPairings().find(([, s]) => sameHash(s.pairing.codeHash, codeHash));
  if (!match) return invalid;
  const [familyId, s] = match;
  if (Date.parse(s.pairing.expiresAt) <= at.getTime()) { s.pairing = null; db.persist(); return invalid; }
  const fam = family.getFamily(familyId);
  if (!fam || !Array.isArray(fam.parentIds) || !fam.parentIds.includes(s.pairing.createdBy)) {
    s.pairing = null; db.persist(); return invalid;
  }
  const b = body && typeof body === "object" ? body : {};
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
  s.agent = {
    name: cleanText(b.name, 40) || "Home Wi-Fi",
    version: cleanText(b.version, 20) || null,
    tokenHash: hash(token),
    pairedAt: at.toISOString(), pairedBy: s.pairing.createdBy,
    lastSeenAt: at.toISOString(), engine: null,
  };
  s.pairing = null;
  s.usage = {};
  s.wifi = {};
  s.endsSoonSent = {};
  db.persist();
  return { token, family: { name: fam.name || "Family" }, ...policyFor(fam) };
}

// FamHome token → { fam, state } or null.
function resolveToken(token) {
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  const h = hash(token);
  for (const [familyId, s] of Object.entries(root())) {
    if (!s || !s.agent || !sameHash(s.agent.tokenHash, h)) continue;
    const fam = family.getFamily(familyId);
    return fam ? { fam, state: s } : null;
  }
  return null;
}

function touch(ctx) {
  const now = deps.now();
  const prev = Date.parse(ctx.state.agent.lastSeenAt || "");
  ctx.state.agent.lastSeenAt = now.toISOString();
  if (!Number.isFinite(prev) || now.getTime() - prev >= SEEN_PERSIST_MS) db.persist();
}

function policyFor(fam) {
  const body = screenTime.homeAgentPolicy(fam);
  return { ...body, etag: `"${hash(JSON.stringify(body)).slice(0, 32)}"` };
}

function policy(ctx) {
  touch(ctx);
  return policyFor(ctx.fam);
}

function sanitizeApps(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, MAX_APPS).map((a) => {
    if (!a || typeof a !== "object") return null;
    const name = cleanText(stripUrls(a.name), 40);
    const minutes = Number.isInteger(a.minutes) && a.minutes >= 0 && a.minutes <= 1440 ? a.minutes : null;
    const count = Number.isInteger(a.count) && a.count >= 0 && a.count <= 1e7 ? a.count : null;
    return name ? { name, minutes, count } : null;
  }).filter(Boolean);
}

function sanitizeHistoryApps(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, MAX_APPS).map((a) => {
    if (!a || typeof a !== "object") return null;
    const name = cleanText(stripUrls(a.name), 40);
    const minutes = Number.isInteger(a.minutes) && a.minutes >= 0 && a.minutes <= 1440 ? a.minutes : 0;
    return name ? { name, minutes } : null;
  }).filter(Boolean);
}

// What the kid sees when their home Wi-Fi changes. `label` is Canopy's own
// status line, e.g. "Paused until 7:30 PM" or "Bedtime until 7:00 AM".
function wifiMessage(status, label) {
  const ask = "Ask a parent in Fam ETC if you need more time.";
  switch (status) {
    case "paused": return { title: "Home Wi-Fi paused ⏸️", body: `${label || "Paused"}. ${ask}` };
    case "bedtime": return { title: "Bedtime 🌙", body: `Home Wi-Fi is off. ${label || "Bedtime"}. Sleep well!` };
    case "limit_reached": return { title: "Time's up for today ⏰", body: `You've used today's screen time, so home Wi-Fi is paused. ${ask}` };
    case "focus": return { title: "Focus time 📚", body: `Games and videos are paused on home Wi-Fi. ${label || ""}`.trim() };
    default: return { title: "Home Wi-Fi is back on ✅", body: "You're good to go. Have fun!" };
  }
}

// Feature 1: 5-minute heads-up to the kid's iPhone + watch before Wi-Fi turns off.
function endsSoonMessage(reason, at) {
  const title = "Wi-Fi off in 5 min ⏳";
  switch (reason) {
    case "bedtime": return { title, body: `Bedtime starts at ${formatHhmm12(at)}. Save your game.` };
    case "limit_reached": return { title, body: "Today's screen time is almost used up." };
    case "focus": return { title, body: "Focus time starts soon. Games and videos will pause." };
    default: return null;
  }
}

function trackEndsSoon(ctx, kidId, raw, localDate, atIso) {
  if (!raw || typeof raw !== "object") return;
  const reason = raw.reason;
  const at = typeof raw.at === "string" ? raw.at.trim() : "";
  if (!ENDS_SOON_REASONS.has(reason) || !HHMM.test(at)) return;
  if (raw.inMinutes !== undefined && (!Number.isInteger(raw.inMinutes) || raw.inMinutes < 1 || raw.inMinutes > 15)) return;
  if (!ctx.state.endsSoonSent) ctx.state.endsSoonSent = {};
  // `at` is "HH:MM" local time (not a date), so include family-local date in the key.
  const key = `${kidId}|${reason}|${localDate}|${at}`;
  if (ctx.state.endsSoonSent[key]) return;
  ctx.state.endsSoonSent[key] = atIso;
  const msg = endsSoonMessage(reason, at);
  if (!msg) return;
  const kidUserIds = screenTime.kidUserIds(ctx.fam.id, kidId);
  if (!kidUserIds.length) return;
  try {
    Promise.resolve(deps.notify({
      kidUserIds, familyId: ctx.fam.id, kidId, status: "ends_soon", reason, at, title: msg.title, body: msg.body,
    })).catch(() => {});
  } catch (_) { /* a push must never fail the report */ }
}

// Canopy sends each kid's Wi-Fi state with every report (and reports early
// when it changes). Tell the kid when it is paused, switches reason, or comes
// back. The first state seen after pairing is only recorded, never pushed.
function trackWifi(ctx, kidId, raw, at, localDate) {
  if (!raw || typeof raw !== "object" || !WIFI_STATUSES.has(raw.status)) return;
  if (!ctx.state.wifi) ctx.state.wifi = {};
  const prev = ctx.state.wifi[kidId];
  const status = raw.status;
  const label = cleanText(raw.label, 80) || null;
  ctx.state.wifi[kidId] = { status, label, at };
  if (raw.endsSoon) trackEndsSoon(ctx, kidId, raw.endsSoon, localDate, at);
  if (!prev || prev.status === status) return;
  const { title, body } = wifiMessage(status, label);
  const kidUserIds = screenTime.kidUserIds(ctx.fam.id, kidId);
  if (!kidUserIds.length) return;
  try {
    Promise.resolve(deps.notify({ kidUserIds, familyId: ctx.fam.id, kidId, status, title, body })).catch(() => {});
  } catch (_) { /* a push must never fail the report */ }
}

// Feature 2: persist up to 14 days of per-kid daily history separately from today's usage.
function ingestHistory(ctx, kidId, rawHistory, today) {
  if (!Array.isArray(rawHistory)) return;
  if (!ctx.state.history) ctx.state.history = {};
  if (!ctx.state.history[kidId]) ctx.state.history[kidId] = {};
  const minDate = schoolDays.addDays(today, -(MAX_HISTORY_DAYS - 1));
  const maxDate = schoolDays.addDays(today, 1);
  for (const entry of rawHistory.slice(0, MAX_HISTORY_DAYS)) {
    if (!entry || typeof entry !== "object" || !schoolDays.validDate(entry.date)) continue;
    if (entry.date < minDate || entry.date > maxDate) continue;
    const usedMinutes = Number.isInteger(entry.usedMinutes) && entry.usedMinutes >= 0 && entry.usedMinutes <= 1440 ? entry.usedMinutes : 0;
    const lateNightMinutes = Number.isInteger(entry.lateNightMinutes) && entry.lateNightMinutes >= 0 && entry.lateNightMinutes <= 1440 ? entry.lateNightMinutes : 0;
    const blocked = Number.isInteger(entry.blocked) && entry.blocked >= 0 && entry.blocked <= 1e7 ? entry.blocked : 0;
    ctx.state.history[kidId][entry.date] = {
      date: entry.date,
      usedMinutes,
      lateNightMinutes,
      blocked,
      topApps: sanitizeHistoryApps(entry.topApps),
    };
  }
}

function pruneHistory(state, kidIds, today) {
  if (!state.history) return;
  const minDate = schoolDays.addDays(today, -(MAX_HISTORY_DAYS - 1));
  const maxDate = schoolDays.addDays(today, 1);
  for (const kidId of Object.keys(state.history)) {
    if (!kidIds.has(kidId)) { delete state.history[kidId]; continue; }
    const byDate = state.history[kidId];
    if (!byDate || typeof byDate !== "object") { delete state.history[kidId]; continue; }
    for (const d of Object.keys(byDate)) {
      if (!schoolDays.validDate(d) || d < minDate || d > maxDate) delete byDate[d];
    }
    const kept = Object.keys(byDate).sort();
    while (kept.length > MAX_HISTORY_DAYS) delete byDate[kept.shift()];
  }
}

// Feature 4: calm factual parent safety alert wording (never full URLs).
function formatAlertMessage({ type, category, deviceName, count }, kidName) {
  const safeDevice = cleanText(stripUrls(deviceName || ""), 60);
  const who = safeDevice || (kidName ? `${kidName}'s device` : "A device");
  const n = Number.isInteger(count) && count >= 1 ? count : 1;
  const times = n === 1 ? "once" : `${n} times`;
  if (type === "risk") {
    const cat = RISK_CATEGORY_LABELS[category] || "a restricted site";
    return {
      title: "Home Wi-Fi safety alert",
      message: `${who} tried to open ${cat} ${times} (blocked).`,
    };
  }
  if (type === "bypass") {
    return {
      title: "Home Wi-Fi filter bypass attempt",
      message: `${who} tried to bypass the home Wi-Fi filter${n > 1 ? ` ${n} times` : ""} (blocked).`,
    };
  }
  return {
    title: "New device on home Wi-Fi",
    message: `${safeDevice || "A new unknown device"} joined the home Wi-Fi.`,
  };
}

function ingestAlerts(ctx, rawAlerts, localDate, atIso, kidIds) {
  if (!Array.isArray(rawAlerts)) return [];
  if (!Array.isArray(ctx.state.alerts)) ctx.state.alerts = [];
  if (!Array.isArray(ctx.state.seenAlertIds)) ctx.state.seenAlertIds = [];
  if (!ctx.state.alertPushDedup) ctx.state.alertPushDedup = {};
  const seen = new Set(ctx.state.seenAlertIds);
  const prefs = settingsOf(ctx.state).alerts;
  const ackIds = [];

  for (const raw of rawAlerts.slice(0, MAX_ALERTS)) {
    if (!raw || typeof raw !== "object") continue;
    const id = cleanText(raw.id, 80);
    if (!id) continue;
    ackIds.push(id);
    if (seen.has(id)) continue;
    seen.add(id);
    ctx.state.seenAlertIds.push(id);
    if (ctx.state.seenAlertIds.length > MAX_SEEN_ALERTS) {
      ctx.state.seenAlertIds.splice(0, ctx.state.seenAlertIds.length - MAX_SEEN_ALERTS);
    }

    const type = raw.type;
    if (!ALERT_TYPES.has(type)) continue;
    let kidId = null;
    if (type !== "new_device") {
      if (typeof raw.kidId !== "string" || !kidIds.has(raw.kidId)) continue;
      kidId = raw.kidId;
    }
    const kid = kidId ? (ctx.fam.kids || []).find((k) => k.id === kidId) : null;
    const category = cleanText(stripUrls(raw.category || ""), 40) || type;
    const deviceName = cleanText(stripUrls(raw.deviceName || ""), 60) || null;
    const count = Number.isInteger(raw.count) && raw.count >= 1 && raw.count <= 10000 ? raw.count : 1;
    const alertAt = typeof raw.at === "string" && Number.isFinite(Date.parse(raw.at)) ? raw.at : atIso;
    const { title, message } = formatAlertMessage({ type, category, deviceName, count }, kid && kid.name);

    const stored = {
      id,
      type,
      kidId,
      kidName: kid ? kid.name : null,
      category,
      deviceName,
      count,
      at: alertAt,
      title,
      message,
    };
    ctx.state.alerts.unshift(stored);
    ctx.state.alerts.splice(MAX_ALERTS);

    if (prefs[type] !== false) {
      const dedupKey = `${kidId || "household"}|${type}|${category}|${localDate}`;
      if (!ctx.state.alertPushDedup[dedupKey]) {
        ctx.state.alertPushDedup[dedupKey] = atIso;
        try {
          Promise.resolve(deps.notifyParents({
            familyParentIds: ctx.fam.parentIds || [],
            familyId: ctx.fam.id,
            kidId,
            type,
            category,
            title,
            body: message,
            collapseId: `home-wifi-alert-${ctx.fam.id}-${kidId || "household"}-${type}-${category}`,
          })).catch(() => {});
        } catch (_) { /* a push must never fail the report */ }
      }
    }
  }

  const cutoff = schoolDays.addDays(localDate, -2);
  for (const key of Object.keys(ctx.state.alertPushDedup)) {
    const parts = key.split("|");
    const d = parts[3];
    if (!d || d < cutoff) delete ctx.state.alertPushDedup[key];
  }

  return ackIds;
}

function report(ctx, body) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : null;
  if (!b) return { error: "Send a JSON object.", status: 400 };
  const today = screenTime.familyToday(ctx.fam);
  if (typeof b.date !== "string" || !DATE.test(b.date)) return { error: "date must be YYYY-MM-DD.", status: 400 };
  if (!Array.isArray(b.kids) || b.kids.length > MAX_KIDS) return { error: `kids must be a list of at most ${MAX_KIDS}.`, status: 400 };
  const at = deps.now().toISOString();
  const kidIds = new Set((ctx.fam.kids || []).map((k) => k.id));
  if (!ctx.state.usage) ctx.state.usage = {};
  let accepted = 0;
  if (b.date === today) {
    for (const k of b.kids) {
      if (!k || typeof k !== "object" || !kidIds.has(k.kidId)) continue;
      const used = Number.isInteger(k.usedMinutes) && k.usedMinutes >= 0 && k.usedMinutes <= 1440 ? k.usedMinutes : 0;
      const blocked = Number.isInteger(k.blocked) && k.blocked >= 0 && k.blocked <= 1e7 ? k.blocked : 0;
      const devices = Number.isInteger(k.devices) && k.devices >= 0 && k.devices <= 100 ? k.devices : 0;
      ctx.state.usage[k.kidId] = { date: b.date, usedMinutes: used, blocked, devices, topApps: sanitizeApps(k.topApps), updatedAt: at };
      accepted++;
    }
  }
  for (const k of b.kids) {
    if (!k || typeof k !== "object" || !kidIds.has(k.kidId)) continue;
    trackWifi(ctx, k.kidId, k.wifi, at, today);
    if (Array.isArray(k.history)) ingestHistory(ctx, k.kidId, k.history, today);
  }
  if (ctx.state.wifi) {
    for (const kidId of Object.keys(ctx.state.wifi)) if (!kidIds.has(kidId)) delete ctx.state.wifi[kidId];
  }
  if (ctx.state.endsSoonSent) {
    const cutoff = schoolDays.addDays(today, -2);
    for (const key of Object.keys(ctx.state.endsSoonSent)) {
      const [kidId, , d] = key.split("|");
      if (!kidIds.has(kidId) || !d || d < cutoff) delete ctx.state.endsSoonSent[key];
    }
  }
  pruneHistory(ctx.state, kidIds, today);
  for (const [kidId, u] of Object.entries(ctx.state.usage)) {
    if (!kidIds.has(kidId) || !u || u.date < today) delete ctx.state.usage[kidId];
  }
  const hasAlerts = Array.isArray(b.alerts);
  const ackAlerts = hasAlerts ? ingestAlerts(ctx, b.alerts, today, at, kidIds) : null;
  if (b.engine && typeof b.engine === "object") {
    ctx.state.agent.engine = {
      healthy: b.engine.healthy === true,
      mode: cleanText(b.engine.mode, 20) || null,
      message: cleanText(b.engine.message, 160) || null,
    };
  }
  ctx.state.agent.lastSeenAt = at;
  if (b.version != null) ctx.state.agent.version = cleanText(b.version, 20) || ctx.state.agent.version;
  db.persist();
  return { ok: true, accepted, today, ...(hasAlerts ? { ackAlerts } : {}) };
}

// ---------- weekly digest (Feature 2) ----------

function kidDigestSummary(k) {
  const parts = [`${k.kidName}: ${formatMinutes(k.totalMinutes)}`];
  if (k.deltaMinutes != null) {
    const sign = k.deltaMinutes > 0 ? "+" : k.deltaMinutes < 0 ? "-" : "";
    parts[0] += k.deltaMinutes === 0
      ? " (same as last week)"
      : ` (${sign}${formatMinutes(Math.abs(k.deltaMinutes))} vs last week)`;
  }
  if (k.topApps.length) {
    parts.push(`Top: ${k.topApps.slice(0, 3).map((a) => `${a.name} (${formatMinutes(a.minutes)})`).join(", ")}`);
  }
  if (k.lateNightMinutes > 0) parts.push(`${formatMinutes(k.lateNightMinutes)} late-night`);
  if (k.blocked > 0) parts.push(`${k.blocked} blocked`);
  const reqBits = [];
  if (k.requests.approved > 0) reqBits.push(`${k.requests.approved} approved`);
  if (k.requests.declined > 0) reqBits.push(`${k.requests.declined} declined`);
  if (reqBits.length) parts.push(`Requests: ${reqBits.join(", ")}`);
  if (k.famsSpent > 0) parts.push(`${k.famsSpent} Fams spent`);
  return parts.join(" · ");
}

function buildWeeklyDigest(fam, state, weekEndDate) {
  const weekStart = schoolDays.addDays(weekEndDate, -6);
  const prevStart = schoolDays.addDays(weekEndDate, -13);
  const kids = (fam.kids || []).map((kid) => {
    const kidHist = (state && state.history && state.history[kid.id]) || {};
    const days = [];
    const appTotals = new Map();
    let totalMinutes = 0;
    let lateNightMinutes = 0;
    let blocked = 0;
    for (let i = 0; i < 7; i++) {
      const date = schoolDays.addDays(weekStart, i);
      const dayType = schoolDays.dayTypeForKid(fam, kid.id, date);
      const limitMinutes = screenTime.kidDayLimit(fam, kid.id, date, dayType);
      const h = kidHist[date];
      const usedMinutes = h ? h.usedMinutes : 0;
      const late = h ? h.lateNightMinutes : 0;
      const blk = h ? h.blocked : 0;
      totalMinutes += usedMinutes;
      lateNightMinutes += late;
      blocked += blk;
      if (h && Array.isArray(h.topApps)) {
        for (const app of h.topApps) {
          if (app && app.name) appTotals.set(app.name, (appTotals.get(app.name) || 0) + (app.minutes || 0));
        }
      }
      days.push({ date, dayType, usedMinutes, limitMinutes, lateNightMinutes: late, blocked: blk });
    }
    let hasPrev = false;
    let prevSum = 0;
    for (let i = 0; i < 7; i++) {
      const date = schoolDays.addDays(prevStart, i);
      const h = kidHist[date];
      if (h) { hasPrev = true; prevSum += h.usedMinutes; }
    }
    const prevWeekMinutes = hasPrev ? prevSum : null;
    const deltaMinutes = hasPrev ? totalMinutes - prevSum : null;
    const topApps = Array.from(appTotals.entries())
      .map(([name, minutes]) => ({ name, minutes }))
      .sort((a, b) => (b.minutes - a.minutes) || a.name.localeCompare(b.name))
      .slice(0, MAX_APPS);
    const activity = screenTime.kidWeeklyActivity(fam, kid.id, weekStart, weekEndDate);
    const entry = {
      kidId: kid.id,
      kidName: kid.name,
      days,
      totalMinutes,
      prevWeekMinutes,
      deltaMinutes,
      lateNightMinutes,
      blocked,
      topApps,
      requests: {
        approved: activity.approved,
        declined: activity.declined,
        timeApproved: activity.timeApproved,
        timeDeclined: activity.timeDeclined,
        bedtimeApproved: activity.bedtimeApproved,
        bedtimeDeclined: activity.bedtimeDeclined,
      },
      famsSpent: activity.famsSpent,
    };
    entry.summaryText = kidDigestSummary(entry);
    return entry;
  });
  return {
    weekStart,
    weekEnd: weekEndDate,
    generatedAt: deps.now().toISOString(),
    kids,
  };
}

let sweeping = false;
async function sweep({ now } = {}) {
  if (sweeping) return { generated: 0 };
  sweeping = true;
  const at = now || deps.now();
  let generated = 0;
  let changed = false;
  try {
    for (const [familyId, s] of Object.entries(root())) {
      if (!s || !s.agent) continue;
      if (!settingsOf(s).weeklyDigest) continue;
      const fam = family.getFamily(familyId);
      if (!fam || !(fam.kids || []).length) continue;
      const local = localClockParts(fam, at);
      if (local.weekday !== "sun" || local.hour < 18) continue;
      if (s.lastDigestDate === local.date) continue;
      const digest = buildWeeklyDigest(fam, s, local.date);
      s.digest = digest;
      s.lastDigestDate = local.date;
      changed = true;
      generated++;
      const preview = digest.kids.map((k) => `${k.kidName}: ${formatMinutes(k.totalMinutes)}`).join(" · ");
      const body = preview ? `${preview}. Open Today for the full breakdown.` : "Your weekly home Wi-Fi summary is ready on Today.";
      try {
        Promise.resolve(deps.notifyParents({
          familyParentIds: fam.parentIds || [],
          familyId: fam.id,
          type: "weekly_digest",
          title: "Weekly Wi-Fi digest is ready",
          body,
          collapseId: `home-wifi-digest-${fam.id}-${local.date}`,
        })).catch(() => {});
      } catch (_) { /* best effort */ }
    }
    if (changed) db.persist();
  } finally {
    sweeping = false;
  }
  return { generated };
}

let monitor = null;
function startMonitor() {
  if (monitor) return monitor;
  monitor = setInterval(() => { sweep().catch(() => {}); }, MONITOR_MS);
  if (monitor.unref) monitor.unref();
  return monitor;
}
function stopMonitor() {
  if (monitor) clearInterval(monitor);
  monitor = null;
}

module.exports = {
  wifiMessage,
  endsSoonMessage,
  formatAlertMessage,
  status,
  summary,
  createPairing,
  unpair,
  updateSettings,
  addNoSchoolDate,
  removeNoSchoolDate,
  getDigest,
  getAlerts,
  dismissAlert,
  dismissAllAlerts,
  claim,
  resolveToken,
  policy,
  report,
  buildWeeklyDigest,
  sweep,
  startMonitor,
  stopMonitor,
  configure,
  PAIRING_TTL_MS,
  MAX_HISTORY_DAYS,
  MAX_ALERTS,
};

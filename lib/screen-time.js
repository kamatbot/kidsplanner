"use strict";
/**
 * Screen Time — a parent edits a per-kid policy here; the kid's own device
 * pulls it and enforces it locally (ManagedSettings + DeviceActivity). Apple
 * gives a parent's phone no control over another device, so this server is
 * also the tamper detector for devices set up without Family Sharing: every
 * heartbeat reports the Screen Time authorization, a sweep flags devices that
 * go quiet, and silent pings notice an uninstalled app. Contract:
 * docs/SCREEN-TIME-PLAN.md.
 *
 * Storage: root.screenTime[familyId].kids[kidId] = { policy, devices, alerts, agreement, requests }
 * in the whole-file-encrypted db (lib/db.js). A device authenticates with a
 * random secret returned ONCE at enroll; only its SHA-256 hash is stored.
 * Tamper alerts go to parents only (push + web push + the alerts list) —
 * never the family chat, which kids read. Never log secrets or push tokens.
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");
const notifications = require("./fam-notifications");
const fams = require("./fams");

const MAX_LIMITS = 8;
const MAX_DOWNTIME = 4;
const MAX_NAME = 40;
const MAX_SELECTION = 64 * 1024;
const MAX_ALERTS = 50;
const MAX_REQUESTS = 30;
const REQUEST_MINUTES = new Set([15, 30, 45, 60]); // 1 fam per 3 minutes
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MODES = new Set(["family", "cooperative"]);
const AUTH_STATUSES = new Set(["approved", "denied", "notDetermined"]);
const SOURCES = new Set(["app", "foreground", "observer", "background", "push", "monitor"]);
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const CLIENT_ID = /^[a-z0-9_]{1,40}$/; // well-known ids: limit "total", downtime "bedtime"
const KINDS = new Set(["total", "apps"]);
const PUSH_TOKEN = /^[a-f0-9]{32,256}$/i;
const DEFAULT_TIMEZONE = "Asia/Bangkok"; // same family clock as lib/hermes-proactive.js
const HOUR_MS = 3600000;
const MONITOR_MS = 10 * 60 * 1000;
const TITLES = {
  revoked: "⚠️ Screen Time turned off",
  removed: "⚠️ Fam ETC may have been removed",
  stale: "Screen Time isn't checking in",
  selection_changed: "Screen Time apps changed",
  restored: "✅ Screen Time is back on",
};

// Clock + senders are swappable so tests are deterministic (configure()).
const deps = {
  now: () => new Date(),
  notify: (args) => notifications.notifyScreenTimeAlert(args),
  sendPing: (token, famType) => notifications.pingScreenTimeDevice(token, famType),
  notifyRequest: (args) => notifications.notifyScreenTimeRequest(args),
  notifyResult: (args) => notifications.notifyScreenTimeRequestResult(args),
};
function configure(overrides) { Object.assign(deps, overrides || {}); }

function fire(fn) {
  try { Promise.resolve(fn()).catch(() => {}); } catch (_) { /* push must never fail the caller */ }
}
function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function newId(prefix) { return prefix + crypto.randomBytes(9).toString("hex"); }
function hashSecret(secret) { return crypto.createHash("sha256").update(String(secret)).digest(); }
function envHours(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ---------- storage ----------

function defaultPolicy() {
  return { version: 0, enabled: false, updatedAt: null, pauseUntil: null, limits: [], downtime: [] };
}
function peek(familyId, kidId) {
  const r = db.load();
  return (r.screenTime && r.screenTime[familyId] && r.screenTime[familyId].kids[kidId]) || null;
}
function entryFor(familyId, kidId) {
  const r = db.load();
  if (!r.screenTime) r.screenTime = {};
  if (!r.screenTime[familyId]) r.screenTime[familyId] = { kids: {} };
  const kids = r.screenTime[familyId].kids;
  if (!kids[kidId]) kids[kidId] = { policy: defaultPolicy(), devices: [], alerts: [], agreement: null };
  return kids[kidId];
}
function agreementOf(e) { return (e && e.agreement) || null; }
function kidOf(fam, kidId) {
  return (fam && (fam.kids || []).find((k) => k.id === kidId)) || null;
}

// ---------- validation (trust boundary: throw InputError, caller maps to 400) ----------

class InputError extends Error {}
function fail(message) { throw new InputError(message); }
function guard(fn) {
  try { return fn(); } catch (e) {
    if (e instanceof InputError) return { error: e.message, status: 400 };
    throw e;
  }
}

function sanitizeName(v) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || Array.from(s).length > MAX_NAME) fail(`Names must be 1–${MAX_NAME} characters.`);
  return s;
}
// Valid client ids are kept (so "total"/"bedtime" round-trip); missing or
// malformed ones get a fresh id. Duplicates are a client bug → 400.
function sanitizeClientId(v, prefix, seen) {
  const id = typeof v === "string" && CLIENT_ID.test(v) ? v : newId(prefix);
  if (seen.has(id)) fail("Duplicate id.");
  seen.add(id);
  return id;
}
function sanitizeMinutes(v, label) {
  if (!Number.isInteger(v) || v < 1 || v > 720) fail(`${label} must be 1–720.`);
  return v;
}
function sanitizeSelection(v) {
  if (v === null) return null;
  if (typeof v !== "string" || v.length > MAX_SELECTION) fail("selection must be a string up to 64 KB, or null.");
  return v;
}
function sanitizeSummary(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("Invalid selection summary.");
  const out = {};
  for (const k of ["apps", "categories", "webDomains"]) {
    const n = v[k] == null ? 0 : v[k];
    if (!Number.isInteger(n) || n < 0 || n > 100000) fail("Invalid selection summary.");
    out[k] = n;
  }
  return out;
}

function sanitizeLimits(input, stored) {
  if (!Array.isArray(input)) fail("limits must be a list.");
  if (input.length > MAX_LIMITS) fail(`At most ${MAX_LIMITS} limits.`);
  const prior = new Map((stored || []).map((l) => [l.id, l]));
  const seen = new Set();
  return input.map((l) => {
    if (!l || typeof l !== "object" || Array.isArray(l)) fail("Invalid limit.");
    const kind = l.kind == null ? "apps" : l.kind;
    if (!KINDS.has(kind)) fail("kind must be total or apps.");
    if (kind === "total" && seen.has("total")) fail("Only one total screen-time limit is allowed.");
    // The whole-device limit always has id "total"; an apps limit can't claim it.
    const id = kind === "total" ? sanitizeClientId("total", "lim_", seen)
      : sanitizeClientId(l.id === "total" ? null : l.id, "lim_", seen);
    const old = prior.get(id);
    const name = sanitizeName(l.name);
    const minutes = sanitizeMinutes(l.minutesPerDay, "Minutes per day");
    const weekendMinutes = l.weekendMinutes == null ? null : sanitizeMinutes(l.weekendMinutes, "Weekend minutes");
    // No `selection` key keeps the stored blob; `selection: null` clears it.
    const selection = hasOwn(l, "selection") ? sanitizeSelection(l.selection) : (old ? old.selection : null);
    let summary = null;
    if (hasOwn(l, "selectionSummary")) summary = l.selectionSummary == null ? null : sanitizeSummary(l.selectionSummary);
    else if (!hasOwn(l, "selection") && old) summary = old.selectionSummary || null;
    return {
      id, kind, name, minutesPerDay: minutes, weekendMinutes,
      selection,
      selectionSummary: selection == null ? null : summary,
      deviceSelections: (old && old.deviceSelections) || {},
    };
  });
}

function sanitizeDowntime(input) {
  if (!Array.isArray(input)) fail("downtime must be a list.");
  if (input.length > MAX_DOWNTIME) fail(`At most ${MAX_DOWNTIME} downtime windows.`);
  const seen = new Set();
  return input.map((d) => {
    if (!d || typeof d !== "object" || Array.isArray(d)) fail("Invalid downtime.");
    const id = sanitizeClientId(d.id, "dt_", seen);
    const name = sanitizeName(d.name);
    if (!HHMM.test(d.start) || !HHMM.test(d.end) || d.start === d.end) fail("Downtime start/end must be different HH:mm times.");
    if (!Array.isArray(d.days) || !d.days.length || d.days.some((x) => !Number.isInteger(x) || x < 1 || x > 7)) {
      fail("Downtime days must be 1–7 (1 = Sunday).");
    }
    return { id, name, start: d.start, end: d.end, days: [...new Set(d.days)].sort((a, b) => a - b) };
  });
}

function sanitizePromises(v, label) {
  if (!Array.isArray(v)) fail(`${label} must be a list.`);
  if (v.length > 5) fail(`At most 5 ${label}.`);
  return v.map((p) => {
    const s = typeof p === "string" ? p.trim() : "";
    if (!s || Array.from(s).length > 80) fail(`${label} must be 1–80 characters.`);
    return s;
  });
}
function sanitizeStamp(v) {
  if (typeof v !== "string" || !Array.from(v).length || Array.from(v).length > 8) fail("kidStamp must be 1–8 characters.");
  return v;
}
function sanitizeAgreementRules(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("Invalid rules.");
  const bedStart = v.bedStart == null ? null : v.bedStart;
  const bedEnd = v.bedEnd == null ? null : v.bedEnd;
  if ((bedStart == null) !== (bedEnd == null)) fail("bedStart and bedEnd must both be set or both null.");
  if (bedStart != null && (!HHMM.test(bedStart) || !HHMM.test(bedEnd))) fail("bedStart/bedEnd must be HH:mm.");
  return {
    bedStart, bedEnd,
    school: v.school == null ? null : sanitizeMinutes(v.school, "school"),
    weekend: v.weekend == null ? null : sanitizeMinutes(v.weekend, "weekend"),
  };
}
// A real calendar date in YYYY-MM-DD (round-trips through Date, so "2026-02-30" fails).
function validDateString(v) {
  return typeof v === "string" && DATE.test(v) && Number.isFinite(dayMs(v)) && new Date(dayMs(v)).toISOString().slice(0, 10) === v;
}
function sanitizeUsage(v, fam) {
  if (v == null) return null;
  if (typeof v !== "object" || Array.isArray(v)) fail("Invalid usage.");
  const today = familyToday(fam);
  if (!validDateString(v.date) || Math.abs(dayMs(v.date) - dayMs(today)) > 2 * 86400000) {
    fail("usage.date must be a real date within 2 days of today.");
  }
  if (!Number.isInteger(v.minutes) || v.minutes < 0 || v.minutes > 1440 || v.minutes % 15 !== 0) {
    fail("usage.minutes must be 0–1440, a multiple of 15.");
  }
  let limitReachedAt = null;
  if (v.limitReachedAt != null) {
    if (typeof v.limitReachedAt !== "string" || v.limitReachedAt.length > 40 || !Number.isFinite(Date.parse(v.limitReachedAt))) {
      fail("Invalid usage.limitReachedAt.");
    }
    limitReachedAt = v.limitReachedAt;
  }
  return { date: v.date, minutes: v.minutes, limitReachedAt };
}

// ---------- projections ----------

function basePolicy(p) {
  return {
    version: p.version, enabled: p.enabled, updatedAt: p.updatedAt || null, pauseUntil: p.pauseUntil || null,
    bonus: p.bonus ? { ...p.bonus } : null,
    downtime: (p.downtime || []).map((d) => ({ ...d, days: d.days.slice() })),
  };
}
function limitBase(l) {
  return { id: l.id, kind: l.kind || "apps", name: l.name, minutesPerDay: l.minutesPerDay, weekendMinutes: l.weekendMinutes == null ? null : l.weekendMinutes };
}
// Parent: keeps selection blobs (picker re-open) + per-device summaries only.
function parentPolicy(p) {
  const out = basePolicy(p);
  out.limits = (p.limits || []).map((l) => {
    const deviceSelections = {};
    for (const [devId, s] of Object.entries(l.deviceSelections || {})) deviceSelections[devId] = { ...s.summary };
    return {
      ...limitBase(l), selection: l.selection,
      selectionSummary: l.selectionSummary ? { ...l.selectionSummary } : null, deviceSelections,
    };
  });
  return out;
}
// Device (deviceId) or kid session (null): the device's own uploaded
// selection wins over the parent's; deviceSelections is omitted.
function devicePolicy(p, deviceId) {
  const out = basePolicy(p);
  out.limits = (p.limits || []).map((l) => {
    const own = deviceId && l.deviceSelections && l.deviceSelections[deviceId];
    const summary = own ? own.summary : l.selectionSummary;
    return {
      ...limitBase(l),
      selection: own ? own.selection : l.selection,
      selectionSummary: summary ? { ...summary } : null,
    };
  });
  return out;
}
function publicDevice(d) {
  return {
    id: d.id, label: d.label, mode: d.mode, authStatus: d.authStatus, appliedVersion: d.appliedVersion,
    lastSeenAt: d.lastSeenAt, enrolledAt: d.enrolledAt, state: d.state,
  };
}
function requestsOf(fam, e, limit = MAX_REQUESTS) {
  if (!e || !e.requests) return [];
  expireRequests(fam, e);
  return e.requests.slice(0, limit).map((r) => ({ ...r }));
}
function kidState(fam, kidId) {
  const e = peek(fam.id, kidId);
  return {
    kidId,
    policy: parentPolicy(e ? e.policy : defaultPolicy()),
    devices: e ? e.devices.map(publicDevice) : [],
    alerts: e ? e.alerts.map((a) => ({ ...a })) : [],
    agreement: agreementOf(e),
    requests: requestsOf(fam, e),
  };
}
function overview(fam) {
  return { kids: (fam.kids || []).map((k) => kidState(fam, k.id)) };
}

// ---------- alerts ----------

function summaryText(s) {
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const parts = [];
  if (s && s.apps) parts.push(n(s.apps, "app", "apps"));
  if (s && s.categories) parts.push(n(s.categories, "category", "categories"));
  if (s && s.webDomains) parts.push(n(s.webDomains, "website", "websites"));
  return parts.length ? parts.join(", ") : "no apps";
}
function sameSummary(a, b) {
  return summaryText(a) === summaryText(b);
}
function familyFormat(fam, locale, opts, date) {
  const tz = fam && fam.timezone;
  try { return new Intl.DateTimeFormat(locale, { ...opts, timeZone: tz || DEFAULT_TIMEZONE }).format(date); }
  catch (_) { return new Intl.DateTimeFormat(locale, { ...opts, timeZone: DEFAULT_TIMEZONE }).format(date); }
}
function checkInTime(fam, iso) {
  return familyFormat(fam, "en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }, new Date(iso));
}
// YYYY-MM-DD in the family's timezone (en-CA formats dates as ISO).
function familyToday(fam) {
  return familyFormat(fam, "en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }, deps.now());
}

function raise({ fam, kid, entry }, device, type, message, push, now) {
  entry.alerts.unshift({
    id: newId("sta_"), kidId: kid.id, deviceId: device ? device.id : null, type, message,
    at: now.toISOString(), ackedAt: null,
  });
  entry.alerts.splice(MAX_ALERTS);
  if (push) {
    fire(() => deps.notify({
      familyParentIds: fam.parentIds || [], familyId: fam.id, kidId: kid.id, type, title: TITLES[type], body: message,
    }));
  }
}

// ---------- parent actions ----------

function parentCtx(fam, kidId) {
  const kid = kidOf(fam, kidId);
  return kid ? { fam, kid, entry: entryFor(fam.id, kidId) } : null;
}
function notFound() { return { error: "Kid not found in this family.", status: 404 }; }

function savePolicy(fam, kidId, body) {
  const ctx = parentCtx(fam, kidId);
  if (!ctx) return notFound();
  return guard(() => {
    const b = body && typeof body === "object" ? body : {};
    if (typeof b.enabled !== "boolean") fail("enabled must be true or false.");
    const p = ctx.entry.policy;
    const limits = sanitizeLimits(b.limits, p.limits);
    const downtime = sanitizeDowntime(b.downtime);
    Object.assign(p, { enabled: b.enabled, limits, downtime, version: p.version + 1, updatedAt: deps.now().toISOString() });
    db.persist();
    return { state: kidState(fam, kidId) };
  });
}

function pause(fam, kidId, minutes) {
  const ctx = parentCtx(fam, kidId);
  if (!ctx) return notFound();
  if (!Number.isInteger(minutes) || (minutes !== 0 && (minutes < 15 || minutes > 1440))) {
    return { error: "minutes must be 0 (resume) or 15–1440.", status: 400 };
  }
  const p = ctx.entry.policy;
  const now = deps.now();
  p.pauseUntil = minutes ? new Date(now.getTime() + minutes * 60000).toISOString() : null;
  p.version += 1;
  p.updatedAt = now.toISOString();
  db.persist();
  return { state: kidState(fam, kidId) };
}

function ackAlerts(fam, kidId) {
  const ctx = parentCtx(fam, kidId);
  if (!ctx) return notFound();
  const at = deps.now().toISOString();
  for (const a of ctx.entry.alerts) if (!a.ackedAt) a.ackedAt = at;
  db.persist();
  return { state: kidState(fam, kidId) };
}

function forgetDevice(fam, kidId, deviceId) {
  const ctx = parentCtx(fam, kidId);
  if (!ctx) return notFound();
  const { entry } = ctx;
  if (!entry.devices.some((d) => d.id === deviceId)) return { error: "Device not found.", status: 404 };
  entry.devices = entry.devices.filter((d) => d.id !== deviceId);
  for (const l of entry.policy.limits) if (l.deviceSelections) delete l.deviceSelections[deviceId];
  db.persist();
  return { state: kidState(fam, kidId) };
}

// ---------- kid session ----------

function mine(fam, kidId) {
  const e = peek(fam.id, kidId);
  return { policy: devicePolicy(e ? e.policy : defaultPolicy(), null), agreement: agreementOf(e), requests: requestsOf(fam, e, 10) };
}

function validPushToken(v) {
  if (v == null) return null;
  if (typeof v !== "string" || !PUSH_TOKEN.test(v)) fail("Invalid push token.");
  return v;
}

function enroll(fam, kidId, body) {
  const ctx = parentCtx(fam, kidId);
  if (!ctx) return notFound();
  return guard(() => {
    const b = body && typeof body === "object" ? body : {};
    const label = sanitizeName(b.label);
    if (!MODES.has(b.mode)) fail("mode must be family or cooperative.");
    if (b.authStatus !== "approved") fail("Screen Time must be approved on this device before enrolling.");
    const pushToken = validPushToken(b.pushToken);
    const secret = crypto.randomBytes(32).toString("base64url");
    const now = deps.now().toISOString();
    const device = {
      id: newId("std_"), label, mode: b.mode, authStatus: "approved", appliedVersion: 0,
      lastSeenAt: now, enrolledAt: now, state: "ok",
      secretHash: hashSecret(secret).toString("hex"), pushToken, lastPingAt: null,
    };
    ctx.entry.devices.push(device);
    db.persist();
    return {
      deviceId: device.id, deviceSecret: secret,
      policy: devicePolicy(ctx.entry.policy, device.id), agreement: agreementOf(ctx.entry),
    };
  });
}

// ---------- device (FamDevice secret) ----------

// ponytail: linear scan over every enrolled device per request; fine for
// hundreds of families — add a hash→device index if device count grows large.
function resolveDevice(secret) {
  if (typeof secret !== "string" || !secret) return null;
  const presented = hashSecret(secret);
  const all = db.load().screenTime || {};
  for (const [familyId, famEntry] of Object.entries(all)) {
    const fam = family.getFamily(familyId);
    if (!fam) continue;
    for (const [kidId, entry] of Object.entries(famEntry.kids || {})) {
      const kid = kidOf(fam, kidId);
      if (!kid) continue;
      for (const device of entry.devices) {
        const stored = Buffer.from(device.secretHash || "", "hex");
        if (stored.length === presented.length && crypto.timingSafeEqual(stored, presented)) {
          return { fam, kid, entry, device };
        }
      }
    }
  }
  return null;
}

function heartbeat(ctx, body) {
  return guard(() => {
    const b = body && typeof body === "object" ? body : {};
    if (!AUTH_STATUSES.has(b.authStatus)) fail("Invalid authStatus.");
    if (!MODES.has(b.mode)) fail("Invalid mode.");
    if (!Number.isInteger(b.appliedVersion) || b.appliedVersion < 0) fail("Invalid appliedVersion.");
    if (!SOURCES.has(b.source)) fail("Invalid source.");
    const pushToken = validPushToken(b.pushToken);
    // Bad usage is dropped, never fatal: a usage bug or clock skew must not
    // block the check-in that carries tamper detection.
    let usage = null;
    if (hasOwn(b, "usage")) { try { usage = sanitizeUsage(b.usage, ctx.fam); } catch (e) { if (!(e instanceof InputError)) throw e; } }
    const { device, kid } = ctx;
    const now = deps.now();
    const was = device.state;
    if (b.authStatus !== "approved") {
      if (was !== "revoked") {
        device.state = "revoked";
        raise(ctx, device, "revoked", `${kid.name} turned off Screen Time on ${device.label}`, true, now);
      }
    } else if (was !== "ok") {
      device.state = "ok";
      raise(ctx, device, "restored", `Screen Time is back on for ${kid.name}'s ${device.label}`, was === "revoked", now);
    }
    Object.assign(device, { authStatus: b.authStatus, mode: b.mode, appliedVersion: b.appliedVersion, lastSeenAt: now.toISOString() });
    if (pushToken) device.pushToken = pushToken;
    recordUsage(ctx.entry, device.id, usage, ctx.fam, now);
    db.persist();
    return { policy: devicePolicy(ctx.entry.policy, device.id), agreement: agreementOf(ctx.entry), requests: requestsOf(ctx.fam, ctx.entry, 10) };
  });
}

// The kid's own device signs the deal; server stamps signedAt/deviceId and
// replaces any prior agreement (one current agreement per kid). Parents get
// a positive push, not an alert-list entry.
function saveAgreement(ctx, body) {
  return guard(() => {
    const b = body && typeof body === "object" ? body : {};
    const kidPromises = sanitizePromises(b.kidPromises, "kidPromises");
    const parentPromises = sanitizePromises(b.parentPromises, "parentPromises");
    const kidStamp = sanitizeStamp(b.kidStamp);
    const parentSigner = sanitizeName(b.parentSigner);
    const rules = sanitizeAgreementRules(b.rules);
    const { fam, kid, entry, device } = ctx;
    const agreement = {
      kidPromises, parentPromises, kidStamp, parentSigner, rules,
      signedAt: deps.now().toISOString(), deviceId: device.id,
    };
    entry.agreement = agreement;
    db.persist();
    fire(() => deps.notify({
      familyParentIds: fam.parentIds || [], familyId: fam.id, kidId: kid.id,
      type: "agreement_signed", title: "🤝 Screen Time deal signed", body: `${kid.name} signed your Screen Time deal`,
    }));
    return { agreement };
  });
}

function uploadSelection(ctx, limitId, body) {
  const limit = ctx.entry.policy.limits.find((l) => l.id === limitId);
  if (!limit) return { error: "Limit not found.", status: 404 };
  return guard(() => {
    const b = body && typeof body === "object" ? body : {};
    const selection = sanitizeSelection(b.selection);
    const { device, kid } = ctx;
    if (!limit.deviceSelections) limit.deviceSelections = {};
    if (selection === null) {
      delete limit.deviceSelections[device.id]; // back to the parent's selection
    } else {
      const summary = sanitizeSummary(b.summary);
      // A device's first pick for a limit is setup, not tampering: only
      // replacing its own earlier selection with different counts alerts.
      const prev = limit.deviceSelections[device.id];
      limit.deviceSelections[device.id] = { selection, summary, updatedAt: deps.now().toISOString() };
      if (prev && !sameSummary(prev.summary, summary)) {
        raise(ctx, device, "selection_changed",
          `${kid.name} changed the apps in ${limit.name} (${summaryText(prev.summary)} → ${summaryText(summary)})`, true, deps.now());
      }
    }
    db.persist();
    return { policy: devicePolicy(ctx.entry.policy, device.id) };
  });
}

// ---------- usage ----------

// Coarse per-device daily totals (never which apps): minutes only ever climb
// within a date, the first limitReachedAt wins, and dates the family can no
// longer see (> 35 days) are dropped on every write.
function pruneUsage(entry, fam) {
  if (!entry.usage) return;
  const cutoff = dayMs(familyToday(fam)) - 35 * 86400000;
  for (const date of Object.keys(entry.usage)) {
    if (dayMs(date) < cutoff) delete entry.usage[date];
  }
}
function recordUsage(entry, deviceId, usage, fam, now) {
  if (!usage) return;
  if (!entry.usage) entry.usage = {};
  if (!entry.usage[usage.date]) entry.usage[usage.date] = {};
  const old = entry.usage[usage.date][deviceId];
  entry.usage[usage.date][deviceId] = {
    minutes: Math.max(old ? old.minutes : 0, usage.minutes),
    limitReachedAt: (old && old.limitReachedAt) || usage.limitReachedAt || null,
    updatedAt: now.toISOString(),
  };
  pruneUsage(entry, fam);
}
// 1 = Sunday … 7 = Saturday, matching the Calendar.weekday numbering used for downtime.
function weekdayOf(date) { return new Date(dayMs(date)).getUTCDay() + 1; }
// The current policy's total daily allowance for that date's weekday, plus
// that date's bonus (from an approved "more time" request). Null without an
// enabled whole-device limit — usage is still shown, just with no allowance.
function totalLimitFor(policy, date) {
  if (!policy.enabled) return null;
  const total = (policy.limits || []).find((l) => l.kind === "total");
  if (!total) return null;
  const weekday = weekdayOf(date);
  const weekend = weekday === 1 || weekday === 7;
  let minutes = weekend && total.weekendMinutes != null ? total.weekendMinutes : total.minutesPerDay;
  if (policy.bonus && policy.bonus.date === date) minutes += policy.bonus.minutes;
  return minutes;
}

function usageReport(fam, kidId, daysParam) {
  const ctx = parentCtx(fam, kidId);
  if (!ctx) return notFound();
  return guard(() => {
    let days = 7;
    if (daysParam !== undefined) {
      const n = Number(daysParam);
      if (!Number.isInteger(n)) fail("days must be an integer.");
      days = Math.min(30, Math.max(1, n));
    }
    const { entry } = ctx;
    expireRequests(fam, entry);
    const usageByDate = entry.usage || {};
    const todayMs = dayMs(familyToday(fam));
    const out = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(todayMs - i * 86400000).toISOString().slice(0, 10);
      const dayUsage = usageByDate[date] || {};
      const deviceIds = Object.keys(dayUsage);
      const devices = deviceIds.map((id) => {
        const dev = entry.devices.find((d) => d.id === id);
        return { deviceId: id, label: dev ? dev.label : "Removed device", minutes: dayUsage[id].minutes, limitReachedAt: dayUsage[id].limitReachedAt };
      });
      const minutes = deviceIds.length ? deviceIds.reduce((sum, id) => sum + dayUsage[id].minutes, 0) : null;
      const extraMinutes = (entry.requests || []).filter((r) => r.status === "approved" && r.date === date).reduce((sum, r) => sum + r.minutes, 0);
      out.push({ date, minutes, devices, limitMinutes: totalLimitFor(entry.policy, date), extraMinutes });
    }
    return { kidId, days: out, requests: requestsOf(fam, entry, MAX_REQUESTS) };
  });
}

// ---------- more time for fams ----------

// A request lives until the end of its own date (family timezone).
function expireRequests(fam, entry) {
  const today = familyToday(fam);
  let changed = false;
  for (const r of entry.requests || []) {
    if (r.status === "pending" && r.date < today) { r.status = "expired"; changed = true; }
  }
  if (changed) db.persist();
}
function kidUserIds(familyId, kidId) {
  return Object.values(db.load().users || {})
    .filter((u) => u.data && u.data.kid && u.data.kid.familyId === familyId && u.data.kid.kidId === kidId)
    .map((u) => u.id);
}
const dayMs = (d) => Date.parse(`${d}T00:00:00Z`);

// Kid session asks for more of today's `total` allowance.
function requestMoreTime(fam, kidId, body) {
  const ctx = parentCtx(fam, kidId);
  if (!ctx) return notFound();
  return guard(() => {
    const b = body && typeof body === "object" ? body : {};
    if (!REQUEST_MINUTES.has(b.minutes)) fail("minutes must be 15, 30, 45 or 60.");
    const today = familyToday(fam);
    if (!validDateString(b.date) || Math.abs(dayMs(b.date) - dayMs(today)) > 86400000) fail("date must be today's YYYY-MM-DD.");
    let note = null;
    if (b.note != null) {
      if (typeof b.note !== "string") fail("note must be text.");
      note = b.note.trim();
      if (Array.from(note).length > 80) fail("note must be at most 80 characters.");
      note = note || null;
    }
    const { entry, kid } = ctx;
    const p = entry.policy;
    if (!p.enabled || !(p.limits || []).some((l) => l.kind === "total")) return { error: "No daily screen time to extend", status: 409 };
    if (!entry.requests) entry.requests = [];
    expireRequests(fam, entry);
    if (entry.requests.some((r) => r.status === "pending")) return { error: "You already asked — wait for an answer.", status: 409 };
    const cost = b.minutes / 3;
    if (fams.balance(fam.id, kidId) < cost) return { error: "Not enough fams.", status: 409 };
    const request = {
      id: newId("str_"), kidId, minutes: b.minutes, fams: cost, date: b.date, note, status: "pending",
      createdAt: deps.now().toISOString(), decidedAt: null, decidedBy: null,
    };
    entry.requests.unshift(request);
    entry.requests.splice(MAX_REQUESTS);
    db.persist();
    const text = `${kid.name} asks for ${request.minutes} more minutes (${cost} fams)`;
    fire(() => deps.notifyRequest({
      familyParentIds: fam.parentIds || [], familyId: fam.id, kidId, requestId: request.id,
      title: "⏰ More screen time?", body: note ? `${text}: “${note}”` : text,
    }));
    return { request: { ...request } };
  });
}

// Parent answer. Approve spends minutes/3 fams (idempotent by request id)
// BEFORE granting, so a failed spend leaves the request pending and no bonus.
// An already-decided request returns state: no second spend or push.
function decideRequest(fam, kidId, requestId, approve, parentUserId) {
  const ctx = parentCtx(fam, kidId);
  if (!ctx) return notFound();
  const { entry } = ctx;
  expireRequests(fam, entry);
  const r = (entry.requests || []).find((x) => x.id === requestId);
  if (!r) return { error: "Request not found.", status: 404 };
  if (approve && r.status === "expired") return { error: "This request has expired.", status: 409 };
  if (r.status !== "pending") return { state: kidState(fam, kidId) };
  const now = deps.now();
  if (approve) {
    const spent = fams.spend(fam.id, kidId, { event: `screen_time:${r.id}`, amount: r.fams, title: `+${r.minutes} minutes screen time` });
    if (spent.error) return { error: spent.error, status: spent.status || 409 };
    const p = entry.policy;
    p.bonus = p.bonus && p.bonus.date === r.date
      ? { date: r.date, minutes: p.bonus.minutes + r.minutes }
      : { date: r.date, minutes: r.minutes };
    p.version += 1;
    p.updatedAt = now.toISOString();
  }
  Object.assign(r, { status: approve ? "approved" : "declined", decidedAt: now.toISOString(), decidedBy: parentUserId || null });
  db.persist();
  if (approve) pingKidDevices(fam, kidId);
  fire(() => deps.notifyResult({
    kidUserIds: kidUserIds(fam.id, kidId), familyId: fam.id, kidId, requestId: r.id,
    title: "⏰ Screen time",
    body: approve ? `🎉 +${r.minutes} minutes! Enjoy.` : "Not this time — maybe later.",
  }));
  return { state: kidState(fam, kidId) };
}

// ---------- pings + monitor ----------

// Silent push to one device; APNs "token gone" means the app was likely
// deleted → state removed + parent alert. Returns true when state changed.
async function pingDevice(ctx, device, famType, sendPing, now) {
  const token = device.pushToken;
  if (!token) return false;
  const result = await Promise.resolve().then(() => sendPing(token, famType)).catch(() => null);
  if (!result || !result.shouldPruneToken || device.pushToken !== token || !ctx.entry.devices.includes(device)) return false;
  device.pushToken = null;
  device.state = "removed";
  raise(ctx, device, "removed", `Fam ETC may have been removed from ${ctx.kid.name}'s ${device.label}`, true, now);
  return true;
}

// Policy/pause changes: nudge the kid's devices to pull now. Fire-and-forget.
function pingKidDevices(fam, kidId, famType = "screen_time_sync") {
  const ctx = parentCtx(fam, kidId);
  if (!ctx) return Promise.resolve();
  return Promise.all(ctx.entry.devices.map((d) => pingDevice(ctx, d, famType, deps.sendPing, deps.now())))
    .then((changed) => { if (changed.some(Boolean)) db.persist(); })
    .catch(() => {});
}

let sweeping = false;
async function sweep({ now, sendPing } = {}) {
  if (sweeping) return { stale: 0, pinged: 0, removed: 0 };
  sweeping = true;
  const at = now || deps.now();
  const send = sendPing || deps.sendPing;
  const staleMs = envHours("SCREEN_TIME_STALE_HOURS", 24) * HOUR_MS;
  const pingMs = envHours("SCREEN_TIME_PING_HOURS", 4) * HOUR_MS;
  const counts = { stale: 0, pinged: 0, removed: 0 };
  try {
    const pings = [];
    for (const [familyId, famEntry] of Object.entries(db.load().screenTime || {})) {
      const fam = family.getFamily(familyId);
      if (!fam) continue;
      for (const [kidId, entry] of Object.entries(famEntry.kids || {})) {
        const kid = kidOf(fam, kidId);
        if (!kid) continue;
        const ctx = { fam, kid, entry };
        for (const device of entry.devices) {
          if (device.state === "ok" && at.getTime() - Date.parse(device.lastSeenAt) > staleMs) {
            device.state = "stale";
            raise(ctx, device, "stale",
              `${kid.name}'s ${device.label} hasn't checked in since ${checkInTime(fam, device.lastSeenAt)} — it may be off, offline, or Screen Time was turned off`,
              true, at);
            counts.stale++;
          }
          if (device.pushToken && (!device.lastPingAt || at.getTime() - Date.parse(device.lastPingAt) >= pingMs)) {
            device.lastPingAt = at.toISOString();
            counts.pinged++;
            pings.push(pingDevice(ctx, device, "screen_time_ping", send, at).then((r) => { if (r) counts.removed++; }));
          }
        }
      }
    }
    if (counts.stale || counts.pinged) db.persist();
    await Promise.all(pings);
    if (counts.removed) db.persist();
  } finally {
    sweeping = false;
  }
  return counts;
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
  overview,
  kidState,
  savePolicy,
  pause,
  ackAlerts,
  forgetDevice,
  mine,
  enroll,
  resolveDevice,
  heartbeat,
  saveAgreement,
  uploadSelection,
  requestMoreTime,
  decideRequest,
  usageReport,
  pingKidDevices,
  sweep,
  startMonitor,
  stopMonitor,
  configure,
  MAX_ALERTS,
};

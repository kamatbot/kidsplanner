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
 * Storage: root.screenTime[familyId].kids[kidId] = { policy, devices, alerts }
 * in the whole-file-encrypted db (lib/db.js). A device authenticates with a
 * random secret returned ONCE at enroll; only its SHA-256 hash is stored.
 * Tamper alerts go to parents only (push + web push + the alerts list) —
 * never the family chat, which kids read. Never log secrets or push tokens.
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");
const notifications = require("./fam-notifications");

const MAX_LIMITS = 8;
const MAX_DOWNTIME = 4;
const MAX_NAME = 40;
const MAX_SELECTION = 64 * 1024;
const MAX_ALERTS = 50;
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

// ---------- projections ----------

function basePolicy(p) {
  return {
    version: p.version, enabled: p.enabled, updatedAt: p.updatedAt || null, pauseUntil: p.pauseUntil || null,
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
function kidState(fam, kidId) {
  const e = peek(fam.id, kidId);
  return {
    kidId,
    policy: parentPolicy(e ? e.policy : defaultPolicy()),
    devices: e ? e.devices.map(publicDevice) : [],
    alerts: e ? e.alerts.map((a) => ({ ...a })) : [],
    agreement: agreementOf(e),
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
function checkInTime(fam, iso) {
  const tz = fam && fam.timezone;
  const opts = { weekday: "short", hour: "numeric", minute: "2-digit" };
  try { return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz || DEFAULT_TIMEZONE }).format(new Date(iso)); }
  catch (_) { return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: DEFAULT_TIMEZONE }).format(new Date(iso)); }
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
  return { policy: devicePolicy(e ? e.policy : defaultPolicy(), null), agreement: agreementOf(e) };
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
    db.persist();
    return { policy: devicePolicy(ctx.entry.policy, device.id), agreement: agreementOf(ctx.entry) };
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
  pingKidDevices,
  sweep,
  startMonitor,
  stopMonitor,
  configure,
  MAX_ALERTS,
};

"use strict";
/**
 * Screen Time — a parent edits a per-kid policy here; the kid's own device
 * pulls it and enforces it locally (ManagedSettings + DeviceActivity). Apple
 * gives a parent's phone no control over another device, so this server is
 * also the tamper detector for devices set up without Family Sharing: every
 * heartbeat reports the Screen Time authorization, a sweep flags devices that
 * go quiet. Push delivery failures cannot prove app removal. Contract:
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
const kidAccess = require("./kid-access");

const MAX_LIMITS = 8;
const MAX_DOWNTIME = 4;
const MAX_NAME = 40;
const MAX_SELECTION = 64 * 1024;
const MAX_ALERTS = 50;
const ALERT_TTL_DAYS = 7; // older unacked alerts read as acked (kidState)
const DEVICE_ALERTS = new Set(["revoked", "stale", "removed", "check_needed"]);
const MAX_REQUESTS = 30;
const REQUEST_MINUTES = new Set([15, 30, 45, 60]); // 1 fam per 3 minutes
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MODES = new Set(["family", "cooperative"]);
const AUTH_STATUSES = new Set(["approved", "denied", "notDetermined"]);
const HEALTH_STATES = new Set(["applied", "off", "partial", "failed", "needsSelection"]);
const HEALTH_FAILURE_CODES = new Set([
  "authorization_unavailable", "invalid_essential_selection", "missing_activities", "missing_schedule",
  "too_many_downtime_windows", "pause_registration_failed", "heartbeat_registration_failed",
  "invalid_downtime_schedule", "activity_registration_failed", "unknown_registration_failure",
]);
const SOURCES = new Set(["app", "foreground", "observer", "background", "push", "monitor"]);
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const CLIENT_ID = /^[a-z0-9_]{1,40}$/; // well-known ids: limit "total", downtime "bedtime"
const KINDS = new Set(["total", "apps"]);
const PUSH_TOKEN = /^[a-f0-9]{32,256}$/i;
const INSTALL_KEY = /^[A-Za-z0-9_-]{16,128}$/; // survives an app reinstall; kept in the Keychain
const DEFAULT_TIMEZONE = "Asia/Bangkok"; // same family clock as lib/hermes-proactive.js
const HOUR_MS = 3600000;
const MONITOR_MS = 10 * 60 * 1000;
const CHECK_REMINDER_MS = 24 * HOUR_MS;
const TITLES = {
  revoked: "Screen Time access needs attention",
  check_needed: "Check Screen Time together",
  selection_changed: "Screen Time apps changed",
  restored: "Screen Time access restored",
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
function sanitizeHealth(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("Invalid health.");
  if (!Number.isSafeInteger(v.policyVersion) || v.policyVersion < 0 || !HEALTH_STATES.has(v.state)) fail("Invalid health.");
  for (const key of ["registeredActivities", "expectedActivities"]) {
    if (!Number.isInteger(v[key]) || v[key] < 0 || v[key] > 128) fail("Invalid health activity count.");
  }
  if (v.registeredActivities > v.expectedActivities || typeof v.hasUsageSelection !== "boolean") fail("Invalid health.");
  if (!Array.isArray(v.failures) || v.failures.length > 16 || v.failures.some((code) => typeof code !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(code))) {
    fail("health.failures must contain safe failure codes.");
  }
  if ((v.state === "applied" || v.state === "off") && (v.registeredActivities !== v.expectedActivities || v.failures.length)) fail("Successful health must have every activity registered and no failures.");
  return {
    policyVersion: v.policyVersion, state: v.state, registeredActivities: v.registeredActivities,
    expectedActivities: v.expectedActivities, hasUsageSelection: v.hasUsageSelection,
    failures: [...new Set(v.failures.map((code) => HEALTH_FAILURE_CODES.has(code) ? code : "unknown_registration_failure"))],
  };
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
    const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    if ((minutes(d.end) - minutes(d.start) + 1440) % 1440 < 15) fail("Downtime must last at least 15 minutes.");
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
function essentialProjection(essential, includeSelection = false) {
  const out = { selection: includeSelection ? (essential && essential.selection) || null : null, summary: essential && essential.summary ? { ...essential.summary } : null };
  const pending = essential && essential.pending;
  out.pending = pending ? { id: pending.id, summary: { ...pending.summary }, note: pending.note, requestedAt: pending.requestedAt } : null;
  return out;
}
function assignmentGeneration(device) { return device.assignmentGeneration || 1; }
function mutationAssignmentError(device, body) {
  const generation = body && body.assignmentGeneration;
  if (generation != null && (!Number.isSafeInteger(generation) || generation < 1)) return { error: "Invalid assignmentGeneration.", status: 400 };
  if ((generation == null && assignmentGeneration(device) !== 1) || (generation != null && generation !== assignmentGeneration(device))) {
    return { error: "This device assignment changed. Refresh Screen Time before making changes.", status: 409 };
  }
  return null;
}
function devicePolicy(p, deviceId, device) {
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
  out.essentialApps = essentialProjection(device && device.essentialApps, true);
  return out;
}
function publicDevice(d) {
  return {
    id: d.id, label: d.label, mode: d.mode, authStatus: d.authStatus, appliedVersion: d.appliedVersion,
    lastSeenAt: d.lastSeenAt, enrolledAt: d.enrolledAt, state: d.state,
    assignmentGeneration: assignmentGeneration(d), health: d.health ? { ...d.health, failures: d.health.failures.slice() } : null,
    essentialApps: essentialProjection(d.essentialApps),
  };
}
function deviceResponse(ctx) {
  return {
    policy: devicePolicy(ctx.entry.policy, ctx.device.id, ctx.device), agreement: agreementOf(ctx.entry),
    requests: requestsOf(ctx.fam, ctx.entry, 10), kidId: ctx.kid.id, kidName: ctx.kid.name,
    assignmentGeneration: assignmentGeneration(ctx.device),
  };
}
function requestsOf(fam, e, limit = MAX_REQUESTS) {
  if (!e || !e.requests) return [];
  expireRequests(fam, e);
  return e.requests.slice(0, limit).map((r) => ({ ...r }));
}
function kidState(fam, kidId) {
  const e = peek(fam.id, kidId);
  if (e) { migrateLegacyEvidence(fam, kidId, e); expireAlerts(e); }
  return {
    kidId,
    policy: parentPolicy(e ? e.policy : defaultPolicy()),
    devices: e ? e.devices.map(publicDevice) : [],
    alerts: e ? e.alerts.map((a) => ({ ...a })) : [],
    agreement: agreementOf(e),
    requests: requestsOf(fam, e),
  };
}
// Parent-overview setup evidence (docs/SCREEN-TIME-ONLY-PLAN.md §2.1/§10.1) so
// the device checklist reads server facts, never a guess. Only the parent
// overview carries it; per-kid mutation responses keep their existing shape.
function setupOf(fam, kidId) {
  const e = peek(fam.id, kidId);
  const evidence = kidAccess.setupStatus(fam.id, kidId);
  return {
    codeActive: evidence.codeActive,
    requestPending: evidence.requestPending,
    signedIn: evidence.signedIn,
    dealSigned: !!(e && e.agreement && e.agreement.signedAt),
    devices: e ? e.devices.length : 0,
  };
}
function overview(fam) {
  return { kids: (fam.kids || []).map((k) => ({ ...kidState(fam, k.id), setup: setupOf(fam, k.id) })) };
}

// Screen Time-only families ask for more time without fams (D3); the whole
// Fam ETC keeps the fams economy (balance check at request, spend at approval).
const usesFams = (fam) => family.isFull(fam);

// ---------- alerts ----------

function familyFormat(fam, locale, opts, date) {
  const tz = fam && fam.timezone;
  try { return new Intl.DateTimeFormat(locale, { ...opts, timeZone: tz || DEFAULT_TIMEZONE }).format(date); }
  catch (_) { return new Intl.DateTimeFormat(locale, { ...opts, timeZone: DEFAULT_TIMEZONE }).format(date); }
}
// YYYY-MM-DD in the family's timezone (en-CA formats dates as ISO).
function familyToday(fam) {
  return familyFormat(fam, "en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }, deps.now());
}

// The single choke point for parent alerts. While the parent has Screen Time
// off nothing is raised or pushed — device state still changes silently, and
// turning it back on re-raises what the parent must know (savePolicy).
// `acked` creates an informational entry that never shows in the banner.
function raise({ fam, kid, entry }, device, type, message, push, now, acked = false) {
  if (!entry.policy || !entry.policy.enabled) return null;
  const alert = {
    id: newId("sta_"), kidId: kid.id, deviceId: device ? device.id : null, type, message,
    at: now.toISOString(), ackedAt: acked ? now.toISOString() : null,
  };
  entry.alerts.unshift(alert);
  entry.alerts.splice(MAX_ALERTS);
  if (push) {
    fire(() => deps.notify({
      familyParentIds: fam.parentIds || [], familyId: fam.id, kidId: kid.id, type, title: TITLES[type], body: message,
    }));
  }
  return alert;
}

// Acks open alerts matching `match`; returns how many changed (caller persists).
function ackWhere(entry, match, at) {
  let n = 0;
  for (const a of entry.alerts || []) {
    if (!a.ackedAt && match(a)) { a.ackedAt = at; n++; }
  }
  return n;
}

// Alerts older than ALERT_TTL_DAYS read as acked; persisted on the read that
// notices them (like expireRequests).
function expireAlerts(entry) {
  const now = deps.now();
  const cutoff = now.getTime() - ALERT_TTL_DAYS * 86400000;
  if (ackWhere(entry, (a) => Date.parse(a.at) < cutoff, now.toISOString())) db.persist();
}

function revokedMessage(kid, device) { return `Screen Time access is unavailable on ${kid.name}'s ${device.label}. Check its permissions together.`; }
function checkNeededMessage(kid, device) { return `Screen Time protection is unverified on ${kid.name}'s ${device.label}. The device may be offline or need a setup check. Check it together.`; }
function restoredMessage(kid, device) { return `Screen Time access restored on ${kid.name}'s ${device.label}; checking rules.`; }
function clearUncertainty(entry, device, at) {
  ackWhere(entry, (a) => a.deviceId === device.id && DEVICE_ALERTS.has(a.type), at);
  delete device.uncertainSince;
  delete device.checkReminderAt;
  delete device.permissionLossNotified;
  delete device.accessRestorationNotified;
}
function beginUncertainty(device, at) { if (!device.uncertainSince) device.uncertainSince = at; }
function healthConfirms(policy, authStatus, health) {
  return !!(health && authStatus === "approved" && health.policyVersion === policy.version &&
    health.state === (policy.enabled ? "applied" : "off") && health.registeredActivities === health.expectedActivities &&
    !health.failures.length && (!policy.enabled || !policy.limits.some((l) => l.kind === "total") || health.hasUsageSelection));
}
function remindIfNeeded(ctx, device, now) {
  if (!ctx.entry.policy.enabled || !device.uncertainSince || device.checkReminderAt || now.getTime() - Date.parse(device.uncertainSince) < CHECK_REMINDER_MS) return false;
  raise(ctx, device, "check_needed", checkNeededMessage(ctx.kid, device), true, now);
  device.checkReminderAt = now.toISOString();
  return true;
}
// Old releases inferred revocation from unknown authorization and removal
// from push-token expiry. Correct the stored evidence without re-sending it.
function migrateLegacyEvidence(fam, kidId, entry) {
  const kid = kidOf(fam, kidId);
  if (!kid) return;
  let changed = false;
  const at = deps.now().toISOString();
  for (const device of entry.devices) {
    const legacy = device.evidenceVersion !== 2;
    const unknown = legacy && (device.authStatus === "notDetermined" || !!device.authUnknownSince);
    if (unknown && (device.authStatus !== "notDetermined" || device.state !== "unknown")) {
      device.authStatus = "notDetermined";
      device.state = "unknown";
      device.health = null;
      beginUncertainty(device, device.authUnknownSince || device.lastSeenAt || at);
      changed = true;
    }
    if (legacy && device.authStatus === "denied" && (entry.alerts || []).some((a) => a.deviceId === device.id && a.type === "revoked")) {
      device.permissionLossNotified = true;
    }
    if (legacy) { device.evidenceVersion = 2; changed = true; }
    if (device.state === "removed") {
      device.state = "unknown";
      device.health = null;
      beginUncertainty(device, device.lastSeenAt || at);
      changed = true;
    }
    for (const alert of entry.alerts || []) {
      if (alert.deviceId !== device.id) continue;
      if (alert.type === "removed" || (alert.type === "revoked" && unknown)) {
        alert.type = "check_needed";
        alert.message = checkNeededMessage(kid, device);
        alert.ackedAt = alert.ackedAt || at;
        changed = true;
      } else if (alert.type === "stale") {
        alert.type = "check_needed";
        alert.message = checkNeededMessage(kid, device);
        beginUncertainty(device, device.lastSeenAt || alert.at);
        device.checkReminderAt = device.checkReminderAt || alert.at;
        changed = true;
      }
    }
    if (device.authUnknownSince) { delete device.authUnknownSince; changed = true; }
  }
  for (const alert of entry.alerts || []) {
    const device = entry.devices.find((d) => d.id === alert.deviceId) || { label: "device" };
    const message = alert.type === "revoked" ? revokedMessage(kid, device)
      : alert.type === "removed" || alert.type === "stale" ? checkNeededMessage(kid, device)
      : alert.type === "restored" ? restoredMessage(kid, device)
      : alert.type === "selection_changed" ? `App selection changed on ${kid.name}'s ${device.label}. Review the selection together.` : alert.message;
    if (message !== alert.message) { alert.message = message; changed = true; }
    if (alert.type === "removed" || alert.type === "stale") { alert.type = "check_needed"; alert.ackedAt = alert.ackedAt || at; changed = true; }
  }
  if (changed) db.persist();
}

// ---------- parent actions ----------

function parentCtx(fam, kidId) {
  const kid = kidOf(fam, kidId);
  if (!kid) return null;
  const entry = entryFor(fam.id, kidId);
  migrateLegacyEvidence(fam, kidId, entry);
  return { fam, kid, entry };
}
function notFound() { return { error: "Kid not found in this family.", status: 404 }; }

function savePolicy(fam, kidId, body) {
  const ctx = parentCtx(fam, kidId);
  if (!ctx) return notFound();
  return guard(() => {
    const b = body && typeof body === "object" ? body : {};
    if (typeof b.enabled !== "boolean") fail("enabled must be true or false.");
    const { entry } = ctx;
    const p = entry.policy;
    const limits = sanitizeLimits(b.limits, p.limits);
    const downtime = sanitizeDowntime(b.downtime);
    const now = deps.now();
    const wasEnabled = !!p.enabled;
    Object.assign(p, { enabled: b.enabled, limits, downtime, version: p.version + 1, updatedAt: now.toISOString() });
    if (wasEnabled && !b.enabled) {
      // Turned off: every open alert is resolved and any pause ends. The route
      // pings the devices (screen_time_sync) so they clear their shields.
      ackWhere(entry, () => true, now.toISOString());
      p.pauseUntil = null;
    }
    for (const device of entry.devices) {
      if (!b.enabled) clearUncertainty(entry, device, now.toISOString());
      else {
        if (!wasEnabled) clearUncertainty(entry, device, now.toISOString());
        beginUncertainty(device, now.toISOString());
        if (!wasEnabled && device.authStatus === "denied") {
          raise(ctx, device, "revoked", revokedMessage(ctx.kid, device), true, now);
          device.permissionLossNotified = true;
        }
      }
    }
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

// Acks one alert (the banner's / sheet's ✕). Idempotent; 404 when the id is
// not one of this kid's alerts (another kid's or family's alert included).
function ackAlert(fam, kidId, alertId) {
  const ctx = parentCtx(fam, kidId);
  if (!ctx) return notFound();
  const alert = ctx.entry.alerts.find((a) => a.id === alertId);
  if (!alert) return { error: "Alert not found.", status: 404 };
  if (!alert.ackedAt) {
    alert.ackedAt = deps.now().toISOString();
    db.persist();
  }
  return { state: kidState(fam, kidId) };
}

// Drops a device from a kid entry: removes it from the list, acks its open
// alerts, and clears its per-limit selections. Shared by forgetDevice and
// enroll's reinstall-under-a-different-kid path.
function removeDeviceFromEntry(entry, deviceId, at) {
  entry.devices = entry.devices.filter((d) => d.id !== deviceId);
  ackWhere(entry, (a) => a.deviceId === deviceId, at);
  for (const l of entry.policy.limits) if (l.deviceSelections) delete l.deviceSelections[deviceId];
}
// Keep old reports as history while giving the new assignment an empty slot.
// In particular, moving a device away and back must not revive its old total.
function archiveAssignmentUsage(entry, device) {
  for (const rows of Object.values(entry.usage || {})) {
    if (rows[device.id]) {
      const generation = rows[device.id].assignmentGeneration || assignmentGeneration(device);
      rows[`${device.id}:${generation}`] = { ...rows[device.id], deviceId: device.id, assignmentGeneration: generation };
      delete rows[device.id];
    }
  }
}
function resetAssignment(device) {
  device.assignmentGeneration = assignmentGeneration(device) + 1;
  device.appliedVersion = 0;
  device.health = null;
  device.essentialApps = null;
  delete device.authUnknownSince;
  delete device.uncertainSince;
  delete device.checkReminderAt;
  delete device.permissionLossNotified;
  delete device.accessRestorationNotified;
}

function forgetDevice(fam, kidId, deviceId) {
  const ctx = parentCtx(fam, kidId);
  if (!ctx) return notFound();
  const { entry } = ctx;
  if (!entry.devices.some((d) => d.id === deviceId)) return { error: "Device not found.", status: 404 };
  removeDeviceFromEntry(entry, deviceId, deps.now().toISOString());
  db.persist();
  return { state: kidState(fam, kidId) };
}

// Moves an enrolled device to another kid of the same family. The device's
// secret keeps working (it isn't rotated) — it just starts pulling and
// reporting against the destination kid's policy.
function moveDevice(fam, kidId, deviceId, toKidId) {
  const ctx = parentCtx(fam, kidId);
  if (!ctx) return notFound();
  return guard(() => {
    if (typeof toKidId !== "string" || !toKidId || toKidId === kidId || !kidOf(fam, toKidId)) {
      fail("toKidId must be a different kid in this family.");
    }
    const { entry } = ctx;
    const device = entry.devices.find((d) => d.id === deviceId);
    if (!device) return { error: "Device not found.", status: 404 };
    const at = deps.now().toISOString();
    archiveAssignmentUsage(entry, device);
    removeDeviceFromEntry(entry, deviceId, at);
    resetAssignment(device);
    const destination = entryFor(fam.id, toKidId);
    destination.devices.push(device);
    if (destination.policy.enabled) beginUncertainty(device, at);
    db.persist();
    return { state: kidState(fam, kidId) };
  });
}

function checkProtection(fam, kidId) {
  const ctx = parentCtx(fam, kidId);
  if (!ctx) return notFound();
  fire(() => pingKidDevices(fam, kidId));
  return { state: kidState(fam, kidId) };
}

function essentialDeviceCtx(fam, kidId, deviceId) {
  const ctx = parentCtx(fam, kidId);
  if (!ctx) return notFound();
  const device = ctx.entry.devices.find((d) => d.id === deviceId);
  return device ? { ...ctx, device } : { error: "Device not found.", status: 404 };
}
function decideEssentialApps(fam, kidId, deviceId, body, approve) {
  const ctx = essentialDeviceCtx(fam, kidId, deviceId);
  if (ctx.error) return ctx;
  return guard(() => {
    const requestId = body && body.requestId;
    if (typeof requestId !== "string" || !requestId || requestId.length > 64) fail("Invalid requestId.");
    const essential = ctx.device.essentialApps;
    if (!essential || !essential.pending || essential.pending.id !== requestId) return { error: "This essential-app request is no longer pending.", status: 409 };
    if (approve) {
      essential.selection = essential.pending.selection;
      essential.summary = { ...essential.pending.summary };
      ctx.entry.policy.version += 1;
      ctx.entry.policy.updatedAt = deps.now().toISOString();
    }
    essential.pending = null;
    db.persist();
    // Declines also refresh the child's waiting state without changing rules.
    fire(() => pingKidDevices(fam, kidId));
    return { state: kidState(fam, kidId) };
  });
}
function removeEssentialApps(fam, kidId, deviceId) {
  const ctx = essentialDeviceCtx(fam, kidId, deviceId);
  if (ctx.error) return ctx;
  ctx.device.essentialApps = null;
  ctx.entry.policy.version += 1;
  ctx.entry.policy.updatedAt = deps.now().toISOString();
  db.persist();
  fire(() => pingKidDevices(fam, kidId));
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
function sanitizeInstallKey(v) {
  if (v == null) return null;
  if (typeof v !== "string" || !INSTALL_KEY.test(v)) fail("Invalid install key.");
  return v;
}
// A device already enrolled somewhere in this family under the same
// installKeyHash: the app was reinstalled (same kid) or handed to a
// different kid. Guards for a family with no screenTime entry yet.
function findByInstallKeyHash(familyId, installKeyHash) {
  const r = db.load();
  const kids = (r.screenTime && r.screenTime[familyId] && r.screenTime[familyId].kids) || {};
  for (const [kidId, entry] of Object.entries(kids)) {
    const device = (entry.devices || []).find((d) => d.installKeyHash === installKeyHash);
    if (device) return { kidId, entry, device };
  }
  return null;
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
    const installKey = sanitizeInstallKey(b.installKey);
    const installKeyHash = installKey ? hashSecret(installKey).toString("hex") : null;
    const secret = crypto.randomBytes(32).toString("base64url");
    const secretHash = hashSecret(secret).toString("hex");
    const now = deps.now().toISOString();
    const existing = installKeyHash ? findByInstallKeyHash(fam.id, installKeyHash) : null;

    let device;
    if (existing && existing.kidId === kidId) {
      // Same kid, reinstalled app: the App Group (and its old secret) was
      // deleted with the app, but the install key survived in the Keychain —
      // re-enroll in place so this never leaves a "not checking in" ghost.
      device = existing.device;
      archiveAssignmentUsage(ctx.entry, device);
      resetAssignment(device);
      Object.assign(device, {
        label, mode: b.mode, authStatus: "approved", appliedVersion: 0,
        lastSeenAt: now, enrolledAt: now, state: "ok", secretHash, pushToken, lastPingAt: null,
      });
      delete device.authUnknownSince;
      ackWhere(ctx.entry, (a) => a.deviceId === device.id, now);
      for (const l of ctx.entry.policy.limits) if (l.deviceSelections) delete l.deviceSelections[device.id];
    } else {
      // A fresh install key, or one that belonged to a sibling kid (the app
      // was handed down/across) — that old record is retired first.
      if (existing) {
        archiveAssignmentUsage(existing.entry, existing.device);
        removeDeviceFromEntry(existing.entry, existing.device.id, now);
      }
      device = {
        id: newId("std_"), label, mode: b.mode, authStatus: "approved", appliedVersion: 0,
        lastSeenAt: now, enrolledAt: now, state: "ok",
        secretHash, pushToken, lastPingAt: null,
        assignmentGeneration: existing ? assignmentGeneration(existing.device) + 1 : 1,
        health: null, essentialApps: null,
      };
      if (installKeyHash) device.installKeyHash = installKeyHash;
      ctx.entry.devices.push(device);
    }
    if (ctx.entry.policy.enabled) beginUncertainty(device, now);
    db.persist();
    return {
      deviceId: device.id, deviceSecret: secret,
      ...deviceResponse({ ...ctx, device }),
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
          migrateLegacyEvidence(fam, kidId, entry);
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
    if (b.assignmentGeneration != null && (!Number.isSafeInteger(b.assignmentGeneration) || b.assignmentGeneration < 1)) fail("Invalid assignmentGeneration.");
    // A stale client must first learn its new assignment and discard old
    // counters; even legacy clients can report only to the initial assignment.
    if ((b.assignmentGeneration == null && assignmentGeneration(ctx.device) !== 1) ||
      (b.assignmentGeneration != null && b.assignmentGeneration !== assignmentGeneration(ctx.device))) return deviceResponse(ctx);
    if (!AUTH_STATUSES.has(b.authStatus)) fail("Invalid authStatus.");
    if (!MODES.has(b.mode)) fail("Invalid mode.");
    if (!Number.isInteger(b.appliedVersion) || b.appliedVersion < 0) fail("Invalid appliedVersion.");
    if (!SOURCES.has(b.source)) fail("Invalid source.");
    const pushToken = validPushToken(b.pushToken);
    const health = b.health == null ? null : sanitizeHealth(b.health);
    if (health && health.policyVersion !== b.appliedVersion && (health.state === "applied" || health.state === "off")) fail("Successful health must match appliedVersion.");
    // Bad usage is dropped, never fatal: a usage bug or clock skew must not
    // block the check-in that carries tamper detection.
    let usage = null;
    if (hasOwn(b, "usage")) { try { usage = sanitizeUsage(b.usage, ctx.fam); } catch (e) { if (!(e instanceof InputError)) throw e; } }
    const { device, kid } = ctx;
    const now = deps.now();
    const at = now.toISOString();
    const was = device.state;
    const previousAuth = device.authStatus;
    const policy = ctx.entry.policy;
    const confirmed = healthConfirms(policy, b.authStatus, health);
    // Unknown authorization is missing evidence, regardless of duration or
    // source. A recent check-in proves connectivity, never protection.
    Object.assign(device, { authStatus: b.authStatus, mode: b.mode, lastSeenAt: at,
      state: b.authStatus === "denied" ? "revoked" : b.authStatus === "notDetermined" ? "unknown" : "ok",
      health: health ? { ...health, checkedAt: at } : null });
    if (b.authStatus === "denied" && policy.enabled && !device.permissionLossNotified) {
      raise(ctx, device, "revoked", revokedMessage(kid, device), true, now);
      device.permissionLossNotified = true;
    } else if (b.authStatus === "approved" && previousAuth === "denied" && !device.accessRestorationNotified) {
      raise(ctx, device, "restored", restoredMessage(kid, device), true, now, true);
      device.accessRestorationNotified = true;
    }
    if (confirmed) {
      device.appliedVersion = health.policyVersion;
      clearUncertainty(ctx.entry, device, at);
      if (was === "stale") raise(ctx, device, "restored", restoredMessage(kid, device), false, now, true);
    } else if (policy.enabled) {
      beginUncertainty(device, at);
      remindIfNeeded(ctx, device, now);
    } else clearUncertainty(ctx.entry, device, at);
    if (pushToken) device.pushToken = pushToken;
    recordUsage(ctx.entry, device, usage, ctx.fam, now, b.appliedVersion);
    db.persist();
    return deviceResponse(ctx);
  });
}

// The kid's own device signs the deal; server stamps signedAt/deviceId and
// replaces any prior agreement (one current agreement per kid). Parents get
// a positive push, not an alert-list entry.
function saveAgreement(ctx, body) {
  const assignmentError = mutationAssignmentError(ctx.device, body);
  if (assignmentError) return assignmentError;
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
  const assignmentError = mutationAssignmentError(ctx.device, body);
  if (assignmentError) return assignmentError;
  const limit = ctx.entry.policy.limits.find((l) => l.id === limitId);
  if (!limit) return { error: "Limit not found.", status: 404 };
  return guard(() => {
    const b = body && typeof body === "object" ? body : {};
    const selection = sanitizeSelection(b.selection);
    const { device, kid } = ctx;
    if (!limit.deviceSelections) limit.deviceSelections = {};
    const prev = limit.deviceSelections[device.id];
    if (selection === null) {
      delete limit.deviceSelections[device.id]; // back to the parent's selection
    } else {
      const summary = sanitizeSummary(b.summary);
      limit.deviceSelections[device.id] = { selection, summary, updatedAt: deps.now().toISOString() };
    }
    if (prev && prev.selection !== selection) raise(ctx, device, "selection_changed",
      `App selection changed on ${kid.name}'s ${device.label}. Review the selection together.`, true, deps.now());
    db.persist();
    return deviceResponse(ctx);
  });
}

function proposeEssentialApps(ctx, body) {
  const assignmentError = mutationAssignmentError(ctx.device, body);
  if (assignmentError) return assignmentError;
  return guard(() => {
    const b = body && typeof body === "object" ? body : {};
    const selection = sanitizeSelection(b.selection);
    // FamilyActivitySelection is JSON encoded as standard base64. Its opaque
    // Apple tokens stay device-local; a summary is not proof of app identity.
    if (!selection || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(selection)) fail("Essential applications require an encoded selection.");
    const summary = sanitizeSummary(b.summary);
    if (summary.apps < 1 || summary.apps > 50 || summary.categories !== 0 || summary.webDomains !== 0) fail("Choose 1–50 individual essential applications, without categories or websites.");
    if (b.note != null && (typeof b.note !== "string" || Array.from(b.note.trim()).length > 80)) fail("note must be at most 80 characters.");
    const essential = ctx.device.essentialApps || { selection: null, summary: null };
    essential.pending = { id: newId("ste_"), selection, summary, note: b.note == null ? null : b.note.trim(), requestedAt: deps.now().toISOString() };
    ctx.device.essentialApps = essential;
    db.persist();
    return deviceResponse(ctx);
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
function recordUsage(entry, device, usage, fam, now, reportedVersion) {
  if (!usage) return;
  if (!entry.usage) entry.usage = {};
  if (!entry.usage[usage.date]) entry.usage[usage.date] = {};
  const deviceId = device.id;
  const old = entry.usage[usage.date][deviceId];
  const isToday = usage.date === familyToday(fam);
  const limitMinutes = isToday && reportedVersion === entry.policy.version ? totalLimitFor(entry.policy, usage.date) : (old && hasOwn(old, "limitMinutes") ? old.limitMinutes : null);
  entry.usage[usage.date][deviceId] = {
    minutes: Math.max(old ? old.minutes : 0, usage.minutes),
    limitReachedAt: (old && old.limitReachedAt) || usage.limitReachedAt || null,
    updatedAt: now.toISOString(),
    limitMinutes, assignmentGeneration: assignmentGeneration(device),
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
    const today = familyToday(fam);
    const todayMs = dayMs(today);
    const out = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(todayMs - i * 86400000).toISOString().slice(0, 10);
      const dayUsage = usageByDate[date] || {};
      // Today's missing reports stay visible as unknown rather than zero.
      const rowKeys = [...new Set([...Object.keys(dayUsage), ...(date === today ? entry.devices.map((d) => d.id) : [])])];
      const devices = rowKeys.map((key) => {
        const row = dayUsage[key];
        // Archived assignments are separate rows, including when this same
        // device later returns. Use their unique storage key as row identity.
        const id = key;
        const dev = entry.devices.find((d) => d.id === key && (!row || (row.assignmentGeneration || 1) === assignmentGeneration(d)));
        const limitMinutes = row ? (Number.isInteger(row.limitMinutes) ? row.limitMinutes : null) : date === today && dev ? totalLimitFor(entry.policy, date) : null;
        const updatedAt = row && row.updatedAt || null;
        const minutes = row ? row.minutes : null;
        const fresh = updatedAt && deps.now().getTime() - Date.parse(updatedAt) <= envHours("SCREEN_TIME_STALE_HOURS", 24) * HOUR_MS;
        return {
          deviceId: id, label: dev ? dev.label : "Removed device", minutes,
          limitReachedAt: row && row.limitReachedAt || null, updatedAt, limitMinutes,
          remainingMinutes: minutes != null && limitMinutes != null && (date !== today || fresh) ? Math.max(0, limitMinutes - minutes) : null,
        };
      });
      const rowKeysWithUsage = Object.keys(dayUsage);
      const minutes = rowKeysWithUsage.length ? rowKeysWithUsage.reduce((sum, key) => sum + dayUsage[key].minutes, 0) : null;
      const extraMinutes = (entry.requests || []).filter((r) => r.status === "approved" && r.date === date).reduce((sum, r) => sum + r.minutes, 0);
      const recordedLimits = rowKeysWithUsage.map((key) => dayUsage[key].limitMinutes);
      const historicLimit = recordedLimits.length && recordedLimits.every((value) => Number.isInteger(value) && value === recordedLimits[0]) ? recordedLimits[0] : null;
      out.push({ date, minutes, devices, limitMinutes: date === today ? totalLimitFor(entry.policy, date) : historicLimit, extraMinutes });
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
    const cost = usesFams(fam) ? b.minutes / 3 : 0;
    if (cost > 0 && fams.balance(fam.id, kidId) < cost) return { error: "Not enough fams.", status: 409 };
    const request = {
      id: newId("str_"), kidId, minutes: b.minutes, fams: cost, date: b.date, note, status: "pending",
      createdAt: deps.now().toISOString(), decidedAt: null, decidedBy: null,
    };
    entry.requests.unshift(request);
    entry.requests.splice(MAX_REQUESTS);
    db.persist();
    const text = cost > 0
      ? `${kid.name} asks for ${request.minutes} more minutes (${cost} fams)`
      : `${kid.name} asks for ${request.minutes} more minutes`;
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
    if (!entry.policy.enabled || !(entry.policy.limits || []).some((l) => l.kind === "total")) {
      return { error: "No daily screen time to extend", status: 409 };
    }
    // No spend on the Screen Time plan (nothing was charged at request time).
    if (usesFams(fam) && r.fams > 0) {
      const spent = fams.spend(fam.id, kidId, { event: `screen_time:${r.id}`, amount: r.fams, title: `+${r.minutes} minutes screen time` });
      if (spent.error) return { error: spent.error, status: spent.status || 409 };
    }
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

// Invalid APNs tokens prove a delivery failure, not deletion or loss of
// enforcement. Compare the exact token and assignment before pruning it.
async function pingDevice(ctx, device, famType, sendPing, now) {
  const token = device.pushToken;
  const generation = assignmentGeneration(device);
  const secretHash = device.secretHash;
  if (!token) return false;
  const result = await Promise.resolve().then(() => sendPing(token, famType)).catch(() => null);
  if (!result || !result.shouldPruneToken || device.pushToken !== token || assignmentGeneration(device) !== generation || device.secretHash !== secretHash || !ctx.entry.devices.includes(device)) return false;
  device.pushToken = null;
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
  const pingMs = envHours("SCREEN_TIME_PING_HOURS", 4) * HOUR_MS;
  const counts = { stale: 0, pinged: 0, removed: 0 };
  let changed = false;
  try {
    const pings = [];
    for (const [familyId, famEntry] of Object.entries(db.load().screenTime || {})) {
      const fam = family.getFamily(familyId);
      if (!fam) continue;
      for (const [kidId, entry] of Object.entries(famEntry.kids || {})) {
        const kid = kidOf(fam, kidId);
        if (!kid) continue;
        migrateLegacyEvidence(fam, kidId, entry);
        // Screen Time off: no stale alarm and no keep-alive ping (the parent's
        // own save still sends screen_time_sync via pingKidDevices).
        if (!entry.policy || !entry.policy.enabled) continue;
        const ctx = { fam, kid, entry };
        for (const device of entry.devices) {
          const offline = at.getTime() - Date.parse(device.lastSeenAt) >= CHECK_REMINDER_MS;
          if (!device.uncertainSince && (offline || !healthConfirms(entry.policy, device.authStatus, device.health))) {
            beginUncertainty(device, offline ? device.lastSeenAt : entry.policy.updatedAt || device.lastSeenAt || at.toISOString());
            changed = true;
          }
          if (offline && device.state !== "revoked" && device.state !== "stale") {
            device.state = "stale";
            changed = true;
          }
          if (remindIfNeeded(ctx, device, at)) { counts.stale++; changed = true; }
          if (device.pushToken && (!device.lastPingAt || at.getTime() - Date.parse(device.lastPingAt) >= pingMs)) {
            device.lastPingAt = at.toISOString();
            counts.pinged++;
            pings.push(pingDevice(ctx, device, "screen_time_ping", send, at).then((pruned) => { if (pruned) changed = true; }));
          }
        }
      }
    }
    if (changed || counts.pinged) db.persist();
    await Promise.all(pings);
    if (changed) db.persist();
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
  ackAlert,
  forgetDevice,
  moveDevice,
  checkProtection,
  decideEssentialApps,
  removeEssentialApps,
  mine,
  enroll,
  resolveDevice,
  heartbeat,
  saveAgreement,
  uploadSelection,
  proposeEssentialApps,
  requestMoreTime,
  decideRequest,
  usageReport,
  pingKidDevices,
  sweep,
  startMonitor,
  stopMonitor,
  configure,
  MAX_ALERTS,
  ALERT_TTL_DAYS,
};

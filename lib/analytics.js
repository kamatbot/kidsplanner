"use strict";
/**
 * RetireOdds — tiny, privacy-first analytics engine.
 *
 * Philosophy: this is NOT Mixpanel. It answers one question — "is this project
 * alive and growing?" — with the fewest moving parts. We store only AGGREGATED
 * daily counters (no per-event log, no user ids, no PII, no third parties), so
 * the file stays small forever and there is nothing sensitive to leak.
 *
 * What we count, per UTC day:
 *   - views      total page views (web + the iOS WKWebView, which loads the site)
 *   - visitors   unique-per-day visitors (deduped by a date-only first-party cookie)
 *   - signups    accounts created (split by platform: web / ios)
 *   - checkouts  Stripe checkout sessions started
 *   - paid       paid conversions (subscription went active)
 *   - paths      top page-view paths (capped, "(other)" catch-all)
 *   - events     misc named app events (app_open, onboarding_complete, …)
 *
 * Plus lightweight A/B experiments: per experiment, per variant, per day we keep
 * { exposures, signups, paid } so a landing/onboarding test can be evaluated
 * later without any new infrastructure.
 *
 * Storage lives in the SAME persistent data dir as db.json (survives redeploys),
 * in its own `analytics.json`. It is plaintext on purpose — these are anonymous
 * counts, never user data — and writes are atomic + coalesced.
 */
const fs = require("fs");
const { ensureDataDir, dataFile } = require("./paths");

const FILE = dataFile("analytics.json");
const SCHEMA = 1;

// Bounds so the file can never grow without limit, no matter the traffic.
const MAX_DAYS = 400; // ~13 months of daily rows, then the oldest are dropped
const MAX_PATHS_PER_DAY = 40; // top paths kept verbatim; the rest fold into "(other)"

// Named app/web events we accept from the public beacon. An allowlist keeps this
// honest: you cannot accidentally turn it into "track everything". To add a new
// event, add it here on purpose.
const ALLOWED_EVENTS = new Set(["app_open", "onboarding_start", "onboarding_complete"]);

// ---------- store (atomic + coalesced writes, plaintext aggregates) ----------
let cache = null;

function load() {
  if (cache) return cache;
  try {
    if (fs.existsSync(FILE)) {
      cache = JSON.parse(fs.readFileSync(FILE, "utf8"));
    }
  } catch (e) {
    // A corrupt aggregate file is not worth halting the app over (unlike the PII
    // datastore). Start fresh — we only lose anonymous counts.
    cache = null;
  }
  if (!cache || typeof cache !== "object") cache = { v: SCHEMA, days: {}, experiments: {} };
  if (!cache.days) cache.days = {};
  if (!cache.experiments) cache.experiments = {};
  return cache;
}

let dirty = false;
let flushing = false;
function doFlush() {
  flushing = true;
  dirty = false;
  let snapshot;
  try {
    snapshot = JSON.stringify(cache);
  } catch (e) {
    flushing = false;
    return;
  }
  ensureDataDir();
  const tmp = FILE + "." + process.pid + ".tmp";
  fs.writeFile(tmp, snapshot, (err) => {
    const done = () => {
      flushing = false;
      if (dirty) setTimeout(doFlush, 0);
    };
    if (err) return done();
    fs.rename(tmp, FILE, done);
  });
}
function persist() {
  dirty = true;
  if (!flushing) setTimeout(doFlush, 0);
}
function flushSync() {
  if (!dirty && !flushing) return;
  try {
    ensureDataDir();
    fs.writeFileSync(FILE, JSON.stringify(cache));
    dirty = false;
  } catch (e) {
    /* ignore */
  }
}
process.on("exit", flushSync);

// ---------- helpers ----------
// UTC day key, e.g. "2026-06-27". UTC (not local) so the rollover is stable
// regardless of where the server runs or moves.
function today() {
  return new Date().toISOString().slice(0, 10);
}

function dayRow(date) {
  const root = load();
  let row = root.days[date];
  if (!row) {
    row = { views: 0, visitors: 0, signups: 0, checkouts: 0, paid: 0, platforms: {}, paths: {}, events: {} };
    root.days[date] = row;
    pruneDays(root);
  }
  return row;
}

// Drop the oldest day rows once we exceed MAX_DAYS (keeps the file bounded).
function pruneDays(root) {
  const keys = Object.keys(root.days);
  if (keys.length <= MAX_DAYS) return;
  keys.sort(); // ISO dates sort chronologically
  for (const k of keys.slice(0, keys.length - MAX_DAYS)) delete root.days[k];
}

// Normalize a reported path to something safe and low-cardinality: strip query
// and hash, lower-case, cap length. Numeric/long id-like segments collapse to
// ":id" so "/learn/123" and "/learn/456" don't explode the path table.
function normPath(p) {
  let s = String(p || "/").split(/[?#]/)[0].trim().toLowerCase();
  if (!s.startsWith("/")) s = "/" + s;
  s = s.replace(/\/+$/, "") || "/";
  s = s
    .split("/")
    .map((seg) => (/^[0-9a-f]{8,}$/.test(seg) || /^\d+$/.test(seg) ? ":id" : seg))
    .join("/");
  return s.slice(0, 80);
}

function bump(obj, key, n = 1) {
  obj[key] = (obj[key] || 0) + n;
}

// Add a path hit, capping the per-day path table. Once full, unknown paths fold
// into a single "(other)" bucket so cardinality stays bounded.
function bumpPath(row, path) {
  const p = normPath(path);
  if (row.paths[p] !== undefined || Object.keys(row.paths).length < MAX_PATHS_PER_DAY) {
    bump(row.paths, p);
  } else {
    bump(row.paths, "(other)");
  }
}

// ---------- experiments ----------
function expDay(key, date) {
  const root = load();
  let exp = root.experiments[key];
  if (!exp) {
    exp = { created: new Date().toISOString(), days: {} };
    root.experiments[key] = exp;
  }
  let d = exp.days[date];
  if (!d) {
    d = {};
    exp.days[date] = d;
  }
  return d;
}
function expVariant(key, date, variant) {
  const v = String(variant || "").slice(0, 24) || "?";
  const d = expDay(key, date);
  if (!d[v]) d[v] = { exposures: 0, signups: 0, paid: 0 };
  return d[v];
}

// Sanitize the {expKey: variant} map a client/cookie reports, so we only ever
// attribute conversions to experiments we know about and clean variant labels.
function cleanExps(exps) {
  const out = {};
  if (!exps || typeof exps !== "object") return out;
  for (const [k, v] of Object.entries(exps)) {
    const key = String(k).replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
    const val = String(v).replace(/[^a-z0-9_-]/gi, "").slice(0, 24);
    if (key && val) out[key] = val;
  }
  return out;
}

// ---------- recording API ----------
function recordPageview(path, isNewVisitor) {
  const row = dayRow(today());
  bump(row, "views");
  if (isNewVisitor) bump(row, "visitors");
  bumpPath(row, path);
  persist();
}

function recordEvent(name) {
  if (!ALLOWED_EVENTS.has(name)) return false;
  const row = dayRow(today());
  bump(row.events, name);
  persist();
  return true;
}

function recordExposure(key, variant) {
  const k = String(key).replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
  if (!k) return false;
  expVariant(k, today(), variant).exposures++;
  persist();
  return true;
}

function recordSignup(platform, exps) {
  const date = today();
  const row = dayRow(date);
  bump(row, "signups");
  const plat = platform === "ios" ? "ios" : "web";
  bump(row.platforms, plat);
  const clean = cleanExps(exps);
  for (const [k, v] of Object.entries(clean)) expVariant(k, date, v).signups++;
  persist();
}

function recordCheckout(exps) {
  bump(dayRow(today()), "checkouts");
  // checkouts aren't attributed per-variant in the daily row; experiment paid
  // conversion is recorded on the paid event below.
  cleanExps(exps); // (kept for symmetry; no-op storage)
  persist();
}

function recordPaid(exps) {
  const date = today();
  bump(dayRow(date), "paid");
  const clean = cleanExps(exps);
  for (const [k, v] of Object.entries(clean)) expVariant(k, date, v).paid++;
  persist();
}

// ---------- summary (for the dashboard) ----------
// Build a compact view over the last `days` UTC days: headline totals, a daily
// series (for sparklines), top paths, signups-by-platform, and per-experiment
// variant conversion rates.
function summary(days = 30) {
  const root = load();
  const n = Math.min(Math.max(parseInt(days, 10) || 30, 1), MAX_DAYS);
  const end = new Date();
  const dates = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000);
    dates.push(d.toISOString().slice(0, 10));
  }
  const series = [];
  const totals = { views: 0, visitors: 0, signups: 0, checkouts: 0, paid: 0 };
  const platforms = {};
  const pathTotals = {};
  for (const date of dates) {
    const r = root.days[date] || { views: 0, visitors: 0, signups: 0, checkouts: 0, paid: 0, platforms: {}, paths: {}, events: {} };
    totals.views += r.views || 0;
    totals.visitors += r.visitors || 0;
    totals.signups += r.signups || 0;
    totals.checkouts += r.checkouts || 0;
    totals.paid += r.paid || 0;
    for (const [k, v] of Object.entries(r.platforms || {})) bump(platforms, k, v);
    for (const [k, v] of Object.entries(r.paths || {})) bump(pathTotals, k, v);
    series.push({
      date,
      views: r.views || 0,
      visitors: r.visitors || 0,
      signups: r.signups || 0,
      paid: r.paid || 0,
    });
  }
  const topPaths = Object.entries(pathTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([path, count]) => ({ path, count }));

  // Conversion rates over the window.
  const rate = (a, b) => (b > 0 ? +((a / b) * 100).toFixed(1) : 0);
  const conversion = {
    visitorToSignup: rate(totals.signups, totals.visitors),
    signupToPaid: rate(totals.paid, totals.signups),
    visitorToPaid: rate(totals.paid, totals.visitors),
  };

  // Experiments: fold each experiment's variants across the window.
  const experiments = [];
  for (const [key, exp] of Object.entries(root.experiments || {})) {
    const variants = {};
    for (const date of dates) {
      const d = exp.days[date];
      if (!d) continue;
      for (const [v, c] of Object.entries(d)) {
        if (!variants[v]) variants[v] = { exposures: 0, signups: 0, paid: 0 };
        variants[v].exposures += c.exposures || 0;
        variants[v].signups += c.signups || 0;
        variants[v].paid += c.paid || 0;
      }
    }
    const rows = Object.entries(variants)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([variant, c]) => ({
        variant,
        exposures: c.exposures,
        signups: c.signups,
        paid: c.paid,
        signupRate: rate(c.signups, c.exposures),
      }));
    if (rows.length) experiments.push({ key, variants: rows });
  }

  return { days: n, range: { from: dates[0], to: dates[dates.length - 1] }, totals, conversion, platforms, topPaths, series, experiments };
}

module.exports = {
  ALLOWED_EVENTS,
  today,
  recordPageview,
  recordEvent,
  recordExposure,
  recordSignup,
  recordCheckout,
  recordPaid,
  summary,
  flushSync,
  FILE,
};

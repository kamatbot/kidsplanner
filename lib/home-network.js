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
 * Storage: root.homeNetwork[familyId] = { agent, pairing, usage } in the
 * encrypted db. The agent authenticates with `Authorization: FamHome <token>`;
 * only the SHA-256 of the token and of the one-time pairing code are stored.
 * One agent per family: pairing again replaces the old one. Never log tokens.
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");
const screenTime = require("./screen-time");

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const TOKEN_PREFIX = "fhn_";
const TOKEN = /^fhn_[A-Za-z0-9_-]{43}$/;
const ONLINE_MS = 3 * 60 * 1000;
const SEEN_PERSIST_MS = 10 * 60 * 1000;
const MAX_KIDS = 20;
const MAX_APPS = 5;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const deps = {
  now: () => new Date(),
  notify: (args) => require("./fam-notifications").notifyHomeWifi(args),
};
const WIFI_STATUSES = new Set(["online", "paused", "bedtime", "focus", "limit_reached"]);
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

// ---------- parent ----------

function status(fam) {
  const s = stateFor(fam.id, false);
  const at = deps.now().getTime();
  const pairing = s && s.pairing && Date.parse(s.pairing.expiresAt) > at ? { expiresAt: s.pairing.expiresAt } : null;
  return { agent: publicAgent(s && s.agent, at), pairing, usage: usageOf(fam) };
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
  return { agent: publicAgent(s.agent, at), usage: usageOf(fam) };
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
  if (s) { s.agent = null; s.pairing = null; s.usage = {}; db.persist(); }
  return status(fam);
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
    const name = cleanText(a.name, 40);
    const minutes = Number.isInteger(a.minutes) && a.minutes >= 0 && a.minutes <= 1440 ? a.minutes : null;
    const count = Number.isInteger(a.count) && a.count >= 0 && a.count <= 1e7 ? a.count : null;
    return name ? { name, minutes, count } : null;
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

// Canopy sends each kid's Wi-Fi state with every report (and reports early
// when it changes). Tell the kid when it is paused, switches reason, or comes
// back. The first state seen after pairing is only recorded, never pushed.
function trackWifi(ctx, kidId, raw, at) {
  if (!raw || typeof raw !== "object" || !WIFI_STATUSES.has(raw.status)) return;
  if (!ctx.state.wifi) ctx.state.wifi = {};
  const prev = ctx.state.wifi[kidId];
  const status = raw.status;
  const label = cleanText(raw.label, 80) || null;
  ctx.state.wifi[kidId] = { status, label, at };
  if (!prev || prev.status === status) return;
  const { title, body } = wifiMessage(status, label);
  const kidUserIds = screenTime.kidUserIds(ctx.fam.id, kidId);
  if (!kidUserIds.length) return;
  try {
    Promise.resolve(deps.notify({ kidUserIds, familyId: ctx.fam.id, kidId, status, title, body })).catch(() => {});
  } catch (_) { /* a push must never fail the report */ }
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
    if (k && typeof k === "object" && kidIds.has(k.kidId)) trackWifi(ctx, k.kidId, k.wifi, at);
  }
  if (ctx.state.wifi) {
    for (const kidId of Object.keys(ctx.state.wifi)) if (!kidIds.has(kidId)) delete ctx.state.wifi[kidId];
  }
  for (const [kidId, u] of Object.entries(ctx.state.usage)) {
    if (!kidIds.has(kidId) || !u || u.date < today) delete ctx.state.usage[kidId];
  }
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
  return { ok: true, accepted, today };
}

module.exports = {
  wifiMessage,
  status, summary, createPairing, unpair, claim, resolveToken, policy, report, configure,
  PAIRING_TTL_MS,
};

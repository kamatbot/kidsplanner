"use strict";
/*
 * Parent "extra time today" bonus (grantBonus + POST
 * /api/screen-time/kids/:kidId/bonus). Routes are registered into a map and
 * each middleware chain is run with stub req/res (no HTTP). requireParent /
 * requireFamily mirror server.js's role logic; the clock, parent notifier and
 * device pinger are injected so transitions are deterministic.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-stbonus-"));

const db = require("../lib/db");
const store = require("../lib/store");
const family = require("../lib/family");
const screenTime = require("../lib/screen-time");
const fams = require("../lib/fams");
const routesModule = require("../lib/routes/screen-time");

let clock = new Date("2026-09-27T08:00:00Z");
const notified = [];
const pinged = [];
const requested = [];
const results = [];
screenTime.configure({
  now: () => clock,
  notify: (args) => { notified.push(args); return Promise.resolve(); },
  notifyRequest: (args) => { requested.push(args); return Promise.resolve(); },
  notifyResult: (args) => { results.push(args); return Promise.resolve(); },
  sendPing: (token, famType) => { pinged.push({ token, famType }); return Promise.resolve({ ok: true }); },
});

const userRole = (u) => (u && u.data && u.data.profile && u.data.profile.role) || "parent";
const routes = {};
const register = (method) => (p, ...handlers) => { routes[`${method} ${p}`] = handlers; };
routesModule({ get: register("GET"), post: register("POST"), put: register("PUT"), delete: register("DELETE") }, {
  screenTime,
  requireAuth: (req, res, next) => next(),
  requireParent: (req, res, next) => (userRole(req.user) === "kid" ? res.status(403).json({ error: "Parents only." }) : next()),
  requireFamily: (req, res, next) => {
    req.family = userRole(req.user) === "kid" ? family.familyForKidUser(req.user) : family.familiesForUser(req.user.id)[0];
    next();
  },
  userRole,
  kidIdForUser: (req) => req.user && req.user.data && req.user.data.kid && req.user.data.kid.kidId,
});

function call(route, { user, body, params, query, auth } = {}) {
  const res = {
    statusCode: 200, body: null, headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.done = true; return this; },
  };
  const req = { user, body: body || {}, params: params || {}, query: query || {}, get: (h) => (h.toLowerCase() === "authorization" ? auth : undefined) };
  for (const handler of routes[route]) {
    let next = false;
    handler(req, res, () => { next = true; });
    if (!next) break;
  }
  return res;
}

function setup(plan) {
  const parent = store.createUser(`p${crypto.randomUUID()}@example.com`, "Kate");
  const fam = family.createFamily(parent.id, "Walkers", { plan, timezone: "Asia/Bangkok" });
  const mia = family.addKid(fam.id, parent.id, { name: "Mia" }).kid;
  const kidUser = store.findOrCreateKidUser(fam.id, mia.id, "Mia");
  return { parent, fam, mia, kidUser };
}

const TODAY = "2026-09-27"; // clock 08:00Z = 15:00 in Asia/Bangkok
const putPolicy = (ctx, body) => call("PUT /api/screen-time/kids/:kidId/policy", { user: ctx.parent, params: { kidId: ctx.mia.id }, body });
const totalPolicy = (ctx) => putPolicy(ctx, { enabled: true, limits: [{ kind: "total", name: "Screen time", minutesPerDay: 120 }], downtime: [] });
const bonus = (ctx, minutes, opts = {}) => call("POST /api/screen-time/kids/:kidId/bonus", {
  user: opts.user || ctx.parent, params: { kidId: opts.kidId || ctx.mia.id }, body: minutes === undefined ? {} : { minutes },
});
const policyOf = (ctx) => call("GET /api/screen-time", { user: ctx.parent }).body.kids.find((k) => k.kidId === ctx.mia.id).policy;
const balance = (ctx) => fams.balance(ctx.fam.id, ctx.mia.id);
function giveFams(ctx, amount) {
  const chore = fams.createChore(ctx.fam.id, ctx.mia.id, { title: "Dishes", amount }).chore;
  fams.submitChore(ctx.fam.id, ctx.mia.id, chore.id);
  fams.approveChore(ctx.fam.id, ctx.mia.id, chore.id);
}

test("bonus: minutes must be 15, 30 or 60", () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const ctx = setup();
  totalPolicy(ctx);
  const v0 = policyOf(ctx).version;
  for (const m of [undefined, 0, 10, 20, 45, 90, -15, "15", 15.5, null]) {
    const res = bonus(ctx, m);
    assert.equal(res.statusCode, 400, String(m));
    assert.equal(res.body.error, "minutes must be 15, 30 or 60.");
  }
  assert.equal(policyOf(ctx).version, v0, "rejected grants change nothing");
  assert.equal(policyOf(ctx).bonus, null);
  for (const m of [15, 30, 60]) assert.equal(bonus(ctx, m).statusCode, 200, String(m));
});

test("bonus: 409 when Screen Time is off or there is no total limit", () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const ctx = setup();
  let res = bonus(ctx, 15);
  assert.equal(res.statusCode, 409, "never configured");
  assert.equal(res.body.error, "No daily screen time to extend");
  putPolicy(ctx, { enabled: true, limits: [{ kind: "app", name: "Games", minutesPerDay: 60 }], downtime: [] });
  res = bonus(ctx, 15);
  assert.equal(res.statusCode, 409, "enabled but no total limit");
  assert.equal(res.body.error, "No daily screen time to extend");
  totalPolicy(ctx);
  putPolicy(ctx, { enabled: false, limits: [{ kind: "total", name: "Screen time", minutesPerDay: 120 }], downtime: [] });
  res = bonus(ctx, 15);
  assert.equal(res.statusCode, 409, "total limit kept but Screen Time turned off");
  assert.equal(res.body.error, "No daily screen time to extend");
  assert.equal(policyOf(ctx).bonus, null);
});

test("bonus: applies to the family's today, accumulates, bumps version, pings, notifies the kid", async () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const ctx = setup();
  totalPolicy(ctx);
  call("POST /api/screen-time/device/enroll", {
    user: ctx.kidUser, body: { label: "iPhone", mode: "cooperative", authStatus: "approved", pushToken: "cd".repeat(32) },
  });
  const v0 = policyOf(ctx).version;
  results.length = 0; pinged.length = 0;
  const first = bonus(ctx, 15);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.kidId, ctx.mia.id, "returns kid state");
  assert.deepEqual(first.body.policy.bonus, { date: TODAY, minutes: 15 });
  assert.equal(first.body.policy.version, v0 + 1);
  assert.ok(first.body.policy.updatedAt);
  assert.equal(first.headers["Cache-Control"], "no-store");
  const second = bonus(ctx, 30);
  assert.deepEqual(second.body.policy.bonus, { date: TODAY, minutes: 45 }, "same-day grants add up");
  assert.equal(second.body.policy.version, v0 + 2);
  assert.deepEqual(bonus(ctx, 60).body.policy.bonus, { date: TODAY, minutes: 105 });
  await new Promise(setImmediate);
  assert.deepEqual(pinged.map((p) => p.famType), ["screen_time_sync", "screen_time_sync", "screen_time_sync"]);
  assert.equal(results.length, 3);
  assert.equal(results[0].body, "🎉 +15 minutes! Enjoy.");
  assert.deepEqual(results[0].kidUserIds, [ctx.kidUser.id]);
});

test("bonus: a bonus from an earlier day is replaced, not carried", () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const ctx = setup();
  totalPolicy(ctx);
  assert.deepEqual(bonus(ctx, 60).body.policy.bonus, { date: TODAY, minutes: 60 });
  clock = new Date("2026-09-28T08:00:00Z");
  assert.deepEqual(bonus(ctx, 15).body.policy.bonus, { date: "2026-09-28", minutes: 15 });
  // Family timezone decides "today": 18:00Z on the 27th is already the 28th in Bangkok.
  clock = new Date("2026-09-27T18:00:00Z");
  assert.deepEqual(bonus(ctx, 15).body.policy.bonus, { date: "2026-09-28", minutes: 30 });
  clock = new Date("2026-09-27T08:00:00Z");
});

test("bonus: never spends fams, on the full plan or the screen_time plan", () => {
  clock = new Date("2026-09-27T08:00:00Z");
  for (const plan of ["full", "screen_time"]) {
    const ctx = setup(plan);
    totalPolicy(ctx);
    if (plan === "full") giveFams(ctx, 20);
    const before = balance(ctx);
    const txns = () => ((db.load().fams[ctx.fam.id] || {})[ctx.mia.id] || { transactions: [] }).transactions.length;
    const t0 = txns();
    assert.equal(bonus(ctx, 60).statusCode, 200, plan);
    assert.equal(bonus(ctx, 15).statusCode, 200, plan);
    assert.equal(balance(ctx), before, `${plan}: balance unchanged`);
    assert.equal(txns(), t0, `${plan}: no transactions`);
    assert.deepEqual(policyOf(ctx).bonus, { date: TODAY, minutes: 75 }, plan);
  }
  // A full-plan kid with an empty balance still gets the grant.
  const broke = setup("full");
  totalPolicy(broke);
  assert.equal(bonus(broke, 30).statusCode, 200);
});

test("bonus: 404 for a kid that is not in the parent's family", () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const a = setup();
  const b = setup();
  totalPolicy(a); totalPolicy(b);
  const res = bonus(a, 15, { kidId: b.mia.id });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Kid not found in this family.");
  assert.equal(bonus(a, 15, { kidId: "nope" }).statusCode, 404);
  assert.equal(policyOf(b).bonus, null, "other family untouched");
  assert.equal(screenTime.grantBonus(a.fam, b.mia.id, 15, a.parent.id).status, 404);
});

test("bonus: a kid session cannot grant itself time", () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const ctx = setup();
  totalPolicy(ctx);
  const res = bonus(ctx, 15, { user: ctx.kidUser });
  assert.equal(res.statusCode, 403);
  assert.equal(policyOf(ctx).bonus, null);
});

test("bonus: exported from the domain module", () => {
  assert.equal(typeof screenTime.grantBonus, "function");
});

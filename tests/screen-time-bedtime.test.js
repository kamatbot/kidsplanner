"use strict";
/*
 * Bedtime exceptions ("stay up later tonight": kid asks, parent approves, or
 * parent "Allow tonight"), and how devices see them as plain downtime. Routes are registered into a map and
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

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-stbed-"));

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


const TODAY = "2026-09-27"; // Sunday; clock 08:00Z = 15:00 in Asia/Bangkok
const SUNDAY = 1;
const putPolicy = (ctx, body) => call("PUT /api/screen-time/kids/:kidId/policy", { user: ctx.parent, params: { kidId: ctx.mia.id }, body });
const bedPolicy = (ctx, extra = []) => putPolicy(ctx, {
  enabled: true, limits: [{ kind: "total", name: "Screen time", minutesPerDay: 120 }],
  downtime: [{ id: "bedtime", name: "Bedtime", start: "20:30", end: "07:00", days: [1, 2, 3, 4, 5, 6, 7] }, ...extra],
});
const ask = (ctx, body) => call("POST /api/screen-time/requests", { user: ctx.kidUser, body: { kind: "bedtime", date: TODAY, ...body } });
const decide = (ctx, id, approve) => call(`POST /api/screen-time/kids/:kidId/requests/:id/${approve ? "approve" : "decline"}`, { user: ctx.parent, params: { kidId: ctx.mia.id, id } });
const allowTonight = (ctx, minutes) => call("POST /api/screen-time/kids/:kidId/bedtime", { user: ctx.parent, params: { kidId: ctx.mia.id }, body: { minutes } });
const policyOf = (ctx) => call("GET /api/screen-time", { user: ctx.parent }).body.kids.find((k) => k.kidId === ctx.mia.id).policy;
const devicePolicy = (ctx) => call("GET /api/screen-time/mine", { user: ctx.kidUser }).body.policy;

test("bedtime: kid asks, parents get a push, approve moves tonight's bedtime on devices only", async () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const ctx = setup("full");
  bedPolicy(ctx);
  requested.length = 0; results.length = 0;
  const res = ask(ctx, { minutes: 30, note: "Movie night" });
  assert.equal(res.statusCode, 200);
  const r = res.body.request;
  assert.equal(r.kind, "bedtime");
  assert.equal(r.fams, 0, "free");
  assert.equal(r.bedtimeUntil, "21:00");
  await new Promise(setImmediate);
  assert.equal(requested.length, 1);
  assert.match(requested[0].body, /Mia asks to stay up until 21:00 tonight \(\+30 min\): “Movie night”/);

  assert.equal(ask(ctx, { minutes: 15 }).statusCode, 409, "one pending ask at a time");
  assert.equal(call("POST /api/screen-time/requests", { user: ctx.kidUser, body: { minutes: 15, date: TODAY } }).statusCode, 409, "blocks more-time too");

  const v0 = policyOf(ctx).version;
  const ok = decide(ctx, r.id, true);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.body.policy.bedtimeException, { date: TODAY, minutes: 30, until: "21:00" });
  assert.equal(ok.body.policy.version, v0 + 1);
  assert.equal(ok.body.policy.downtime.length, 1, "parent view keeps the real rules");
  const dt = devicePolicy(ctx).downtime;
  assert.deepEqual(dt.find((d) => d.id === "bedtime").days, [2, 3, 4, 5, 6, 7], "tonight's weekday comes off the usual bedtime");
  assert.deepEqual(dt.find((d) => d.id === "bedtime_late"), { id: "bedtime_late", name: "Bedtime (late)", start: "21:00", end: "07:00", days: [SUNDAY] });
  await new Promise(setImmediate);
  assert.equal(results.at(-1).body, "🎉 You can stay up until 21:00 tonight.");
  // No fams were touched and usage "extra minutes" ignores bedtime asks.
  const usage = call("GET /api/screen-time/kids/:kidId/usage", { user: ctx.parent, params: { kidId: ctx.mia.id } }).body;
  assert.equal(usage.days[0].extraMinutes, 0);
});

test("bedtime: decline leaves rules alone and tells the kid gently", async () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const ctx = setup();
  bedPolicy(ctx);
  const r = ask(ctx, { minutes: 15 }).body.request;
  const v0 = policyOf(ctx).version;
  results.length = 0;
  const res = decide(ctx, r.id, false);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.policy.version, v0);
  assert.equal(res.body.policy.bedtimeException, null);
  await new Promise(setImmediate);
  assert.equal(results[0].body, "Not tonight — sleep well 💜");
});

test("bedtime: validation — kind, minutes, no bedtime, past midnight", () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const ctx = setup();
  assert.equal(ask(ctx, { minutes: 30 }).statusCode, 409, "Screen Time off");
  putPolicy(ctx, { enabled: true, limits: [], downtime: [] });
  assert.equal(ask(ctx, { minutes: 30 }).body.error, "There's no bedtime set for tonight.");
  bedPolicy(ctx);
  for (const m of [0, 10, 45, 90, "30"]) assert.equal(ask(ctx, { minutes: m }).statusCode, 400, String(m));
  assert.equal(ask(ctx, { minutes: 30, kind: "nap" }).statusCode, 400);
  putPolicy(ctx, { enabled: true, limits: [], downtime: [{ id: "bedtime", name: "Bedtime", start: "23:30", end: "07:00", days: [1] }] });
  assert.equal(ask(ctx, { minutes: 60 }).body.error, "Bedtime can't move past midnight.");
  assert.equal(putPolicy(ctx, { enabled: true, limits: [], downtime: [{ id: "bedtime_late", name: "x", start: "21:00", end: "07:00", days: [1] }] }).statusCode, 400, "reserved id");
});

test("bedtime: single-day bedtime shifts in place; a full set of 4 windows refuses", () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const ctx = setup();
  putPolicy(ctx, { enabled: true, limits: [], downtime: [{ id: "bedtime", name: "Bedtime", start: "21:00", end: "07:00", days: [1] }] });
  assert.equal(allowTonight(ctx, 60).statusCode, 200);
  assert.deepEqual(devicePolicy(ctx).downtime, [{ id: "bedtime", name: "Bedtime", start: "22:00", end: "07:00", days: [1] }]);
  const full = setup();
  const extra = [1, 2, 3].map((i) => ({ id: `dt_${i}`, name: `Quiet ${i}`, start: "13:00", end: "14:00", days: [2] }));
  bedPolicy(full, extra);
  assert.equal(allowTonight(full, 30).statusCode, 409);
});

test("bedtime: parent Allow tonight adds up, 0 puts it back, and it expires after the night", async () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const ctx = setup();
  bedPolicy(ctx);
  call("POST /api/screen-time/device/enroll", {
    user: ctx.kidUser, body: { label: "iPad", mode: "cooperative", authStatus: "approved", pushToken: "ab".repeat(32) },
  });
  pinged.length = 0;
  assert.deepEqual(allowTonight(ctx, 15).body.policy.bedtimeException, { date: TODAY, minutes: 15, until: "20:45" });
  assert.deepEqual(allowTonight(ctx, 30).body.policy.bedtimeException, { date: TODAY, minutes: 45, until: "21:15" });
  assert.equal(allowTonight(ctx, 45).statusCode, 400);
  assert.equal(allowTonight(ctx, 0).body.policy.bedtimeException, null);
  assert.equal(devicePolicy(ctx).downtime.length, 1);
  allowTonight(ctx, 30);
  await new Promise(setImmediate);
  assert.ok(pinged.length >= 3, "devices are pinged");
  // Next day (Bangkok): the sweep drops it and bumps the version so devices restore bedtime.
  const v = policyOf(ctx).version;
  clock = new Date("2026-09-28T02:00:00Z");
  await screenTime.sweep({ now: clock, sendPing: () => Promise.resolve({ ok: true }) });
  const p = policyOf(ctx);
  assert.equal(p.bedtimeException, null);
  assert.equal(p.version, v + 1);
  assert.deepEqual(devicePolicy(ctx).downtime[0].days, [1, 2, 3, 4, 5, 6, 7]);
  clock = new Date("2026-09-27T08:00:00Z");
});

test("bedtime: a kid session cannot allow itself, and other families are 404", () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const a = setup(); const b = setup();
  bedPolicy(a); bedPolicy(b);
  assert.equal(call("POST /api/screen-time/kids/:kidId/bedtime", { user: a.kidUser, params: { kidId: a.mia.id }, body: { minutes: 30 } }).statusCode, 403);
  assert.equal(call("POST /api/screen-time/kids/:kidId/bedtime", { user: a.parent, params: { kidId: b.mia.id }, body: { minutes: 30 } }).statusCode, 404);
});

test("more-time requests still work and are tagged kind time", () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const ctx = setup("screen_time");
  bedPolicy(ctx);
  const res = call("POST /api/screen-time/requests", { user: ctx.kidUser, body: { minutes: 15, date: TODAY } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.request.kind, "time");
  assert.deepEqual(decide(ctx, res.body.request.id, true).body.policy.bonus, { date: TODAY, minutes: 15 });
});

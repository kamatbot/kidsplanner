"use strict";
/*
 * Screen Time (lib/screen-time.js + lib/routes/screen-time.js) against the
 * contract in docs/SCREEN-TIME-PLAN.md. Routes are registered into a map and
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

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-screentime-"));

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

function setup() {
  const parent = store.createUser(`p${crypto.randomUUID()}@example.com`, "Kate");
  const fam = family.createFamily(parent.id, "Walkers");
  const mia = family.addKid(fam.id, parent.id, { name: "Mia" }).kid;
  const leo = family.addKid(fam.id, parent.id, { name: "Leo" }).kid;
  const kidUser = store.findOrCreateKidUser(fam.id, mia.id, "Mia");
  return { parent, fam, mia, leo, kidUser };
}

const limit = (extra = {}) => ({ name: "Games", minutesPerDay: 60, ...extra });
function putPolicy(ctx, body) {
  return call("PUT /api/screen-time/kids/:kidId/policy", { user: ctx.parent, params: { kidId: ctx.mia.id }, body });
}
// Alerts are only raised while the parent has Screen Time on (docs/SCREEN-TIME-UX.md §2).
const turnOn = (ctx, extra = {}) => putPolicy(ctx, { enabled: true, limits: [], downtime: [{ id: "bedtime", name: "Bedtime", start: "21:00", end: "07:00", days: [1, 2, 3, 4, 5, 6, 7] }], ...extra });
const turnOff = (ctx) => putPolicy(ctx, { enabled: false, limits: [], downtime: [{ id: "bedtime", name: "Bedtime", start: "21:00", end: "07:00", days: [1, 2, 3, 4, 5, 6, 7] }] });
function enroll(ctx, extra = {}) {
  return call("POST /api/screen-time/device/enroll", {
    user: ctx.kidUser, body: { label: "iPhone", mode: "cooperative", authStatus: "approved", pushToken: "ab".repeat(32), ...extra },
  });
}
function heartbeat(secret, authStatus = "approved", extra = {}) {
  return call("POST /api/screen-time/device/heartbeat", {
    auth: `FamDevice ${secret}`, body: { authStatus, mode: "cooperative", appliedVersion: 1, source: "app", ...extra },
  });
}
const overview = (ctx) => call("GET /api/screen-time", { user: ctx.parent }).body.kids.find((k) => k.kidId === ctx.mia.id);
const dealBody = (extra = {}) => ({
  kidPromises: ["Phone charges outside my room at night"],
  parentPromises: ["We'll give a 10-minute heads-up before bedtime"],
  kidStamp: "🦊", parentSigner: "Kate",
  rules: { bedStart: "21:00", bedEnd: "07:00", school: 120, weekend: 180 },
  ...extra,
});
function saveAgreement(secret, body) {
  return call("PUT /api/screen-time/device/agreement", { auth: `FamDevice ${secret}`, body });
}

test("parent GET lists every kid with the default policy, no-store", () => {
  const ctx = setup();
  const res = call("GET /api/screen-time", { user: ctx.parent });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.deepEqual(res.body.kids.map((k) => k.kidId), [ctx.mia.id, ctx.leo.id]);
  for (const k of res.body.kids) {
    assert.deepEqual({ ...k.policy, updatedAt: undefined }, { version: 0, enabled: false, updatedAt: undefined, limits: [], downtime: [], pauseUntil: null, bonus: null });
    assert.deepEqual(k.devices, []);
    assert.deepEqual(k.alerts, []);
  }
});

test("PUT policy validates input and bumps version", () => {
  const ctx = setup();
  const bad = [
    { enabled: true, limits: [limit({ minutesPerDay: 0 })], downtime: [] },
    { enabled: true, limits: [limit({ minutesPerDay: 721 })], downtime: [] },
    { enabled: true, limits: Array.from({ length: 9 }, () => limit()), downtime: [] },
    { enabled: true, limits: [], downtime: [{ name: "Bed", start: "25:00", end: "07:00", days: [1] }] },
    { enabled: true, limits: [], downtime: [{ name: "Bed", start: "21:00", end: "07:00", days: [8] }] },
    { enabled: true, limits: [limit({ name: "x".repeat(41) })], downtime: [] },
    { enabled: "yes", limits: [], downtime: [] },
  ];
  for (const body of bad) assert.equal(putPolicy(ctx, body).statusCode, 400, JSON.stringify(body).slice(0, 80));
  assert.equal(overview(ctx).policy.version, 0, "rejected writes do not bump");

  const ok = putPolicy(ctx, { enabled: true, limits: [limit()], downtime: [{ name: "Bedtime", start: "21:00", end: "07:00", days: [7, 1, 1] }] });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.policy.version, 1);
  assert.match(ok.body.policy.limits[0].id, /^lim_/);
  assert.deepEqual(ok.body.policy.downtime[0].days, [1, 7]);
  assert.equal(putPolicy(ctx, { enabled: false, limits: [], downtime: [] }).body.policy.version, 2);
  const other = call("PUT /api/screen-time/kids/:kidId/policy", { user: ctx.parent, params: { kidId: setup().mia.id }, body: { enabled: true, limits: [], downtime: [] } });
  assert.equal(other.statusCode, 404, "a kid from another family is not found");
});

test("limit without a selection key keeps the stored selection; null clears it", () => {
  const ctx = setup();
  const first = putPolicy(ctx, { enabled: true, limits: [limit({ selection: "QUJD", selectionSummary: { apps: 3, categories: 1, webDomains: 0 } })], downtime: [] });
  const id = first.body.policy.limits[0].id;
  const kept = putPolicy(ctx, { enabled: true, limits: [{ id, name: "Games", minutesPerDay: 30 }], downtime: [] });
  assert.equal(kept.body.policy.limits[0].selection, "QUJD");
  assert.deepEqual(kept.body.policy.limits[0].selectionSummary, { apps: 3, categories: 1, webDomains: 0 });
  assert.equal(kept.body.policy.limits[0].minutesPerDay, 30);
  const cleared = putPolicy(ctx, { enabled: true, limits: [{ id, name: "Games", minutesPerDay: 30, selection: null }], downtime: [] });
  assert.equal(cleared.body.policy.limits[0].selection, null);
  assert.equal(cleared.body.policy.limits[0].selectionSummary, null);
  assert.equal(putPolicy(ctx, { enabled: true, limits: [limit({ selection: "x".repeat(64 * 1024 + 1) })], downtime: [] }).statusCode, 400);
});

test("Basic mode: one total limit with weekend minutes; well-known ids round-trip", () => {
  const ctx = setup();
  const total = { kind: "total", name: "Screen time", minutesPerDay: 120, weekendMinutes: 180 };
  const bedtime = { id: "bedtime", name: "Bedtime", start: "21:00", end: "07:00", days: [1, 2, 3, 4, 5, 6, 7] };
  assert.equal(putPolicy(ctx, { enabled: true, limits: [total, { ...total, id: "other" }], downtime: [] }).statusCode, 400, "two totals");
  assert.equal(putPolicy(ctx, { enabled: true, limits: [{ ...total, weekendMinutes: 0 }], downtime: [] }).statusCode, 400);
  assert.equal(putPolicy(ctx, { enabled: true, limits: [{ ...total, weekendMinutes: 721 }], downtime: [] }).statusCode, 400);
  assert.equal(putPolicy(ctx, { enabled: true, limits: [{ ...total, kind: "games" }], downtime: [] }).statusCode, 400);

  const res = putPolicy(ctx, { enabled: true, limits: [{ ...total, id: "whatever" }, limit({ id: "Bad-ID!" })], downtime: [bedtime] });
  assert.equal(res.statusCode, 200);
  const [t, apps] = res.body.policy.limits;
  assert.deepEqual([t.id, t.kind, t.minutesPerDay, t.weekendMinutes], ["total", "total", 120, 180], "total id is forced");
  assert.equal(apps.kind, "apps", "kind defaults to apps");
  assert.equal(apps.weekendMinutes, null);
  assert.match(apps.id, /^lim_[a-f0-9]+$/, "invalid ids are regenerated");
  assert.equal(res.body.policy.downtime[0].id, "bedtime");

  const again = putPolicy(ctx, { enabled: true, limits: [{ ...total, id: "total", weekendMinutes: null }, { ...limit(), id: apps.id }], downtime: [bedtime] });
  assert.deepEqual(again.body.policy.limits.map((l) => l.id), ["total", apps.id]);
  assert.equal(again.body.policy.limits[0].weekendMinutes, null);
  const { deviceSecret } = enroll(ctx).body;
  const dev = heartbeat(deviceSecret).body.policy.limits[0];
  assert.deepEqual([dev.id, dev.kind, dev.weekendMinutes], ["total", "total", null], "device projection carries kind/weekendMinutes");
});

test("role gates: kid cannot PUT policy, parent cannot enroll", () => {
  const ctx = setup();
  assert.equal(call("PUT /api/screen-time/kids/:kidId/policy", { user: ctx.kidUser, params: { kidId: ctx.mia.id }, body: { enabled: true, limits: [], downtime: [] } }).statusCode, 403);
  assert.equal(call("POST /api/screen-time/device/enroll", { user: ctx.parent, body: { label: "iPhone", mode: "family", authStatus: "approved" } }).statusCode, 403);
  const mine = call("GET /api/screen-time/mine", { user: ctx.kidUser });
  assert.equal(mine.statusCode, 200);
  assert.equal(mine.body.policy.version, 0);
});

test("enroll requires approved auth and a valid mode; secret is returned once and stored hashed", () => {
  const ctx = setup();
  assert.equal(enroll(ctx, { authStatus: "denied" }).statusCode, 400);
  assert.equal(enroll(ctx, { mode: "sneaky" }).statusCode, 400);
  const res = enroll(ctx);
  assert.equal(res.statusCode, 200);
  const { deviceId, deviceSecret } = res.body;
  assert.match(deviceId, /^std_/);
  assert.ok(deviceSecret.length >= 40);
  assert.equal(res.body.kidId, ctx.mia.id);
  assert.equal(res.body.kidName, "Mia");

  const parentJSON = JSON.stringify(call("GET /api/screen-time", { user: ctx.parent }).body);
  const hash = crypto.createHash("sha256").update(deviceSecret).digest("hex");
  assert.ok(!parentJSON.includes(deviceSecret) && !parentJSON.includes(hash) && !parentJSON.includes("ab".repeat(32)), "parent view leaks no secret/hash/token");
  const dbJSON = JSON.stringify(db.load().screenTime);
  assert.ok(!dbJSON.includes(deviceSecret), "raw secret is never stored");
  assert.ok(dbJSON.includes(hash), "only the SHA-256 hash is stored");
  assert.deepEqual(Object.keys(overview(ctx).devices[0]).sort(), ["appliedVersion", "assignmentGeneration", "authStatus", "enrolledAt", "essentialApps", "health", "id", "label", "lastSeenAt", "mode", "state"]);
});

test("heartbeat: wrong/missing secret → 401, bad body → 400", () => {
  const ctx = setup();
  enroll(ctx);
  assert.equal(heartbeat("x".repeat(43)).statusCode, 401);
  assert.equal(call("POST /api/screen-time/device/heartbeat", { body: {} }).statusCode, 401);
  const { deviceSecret } = enroll(ctx).body;
  assert.equal(heartbeat(deviceSecret, "approved", { source: "hacker" }).statusCode, 400);
  assert.equal(heartbeat(deviceSecret).statusCode, 200);
});

test("approved → denied alerts parents once; approved again → restored", () => {
  const ctx = setup();
  turnOn(ctx);
  const { deviceSecret } = enroll(ctx).body;
  notified.length = 0;
  assert.equal(heartbeat(deviceSecret, "denied").statusCode, 200);
  heartbeat(deviceSecret, "denied");
  let kid = overview(ctx);
  assert.equal(kid.devices[0].state, "revoked");
  assert.deepEqual(kid.alerts.map((a) => a.type), ["revoked"]);
  assert.equal(kid.alerts[0].message, "Screen Time access is unavailable on Mia's iPhone. Check its permissions together.");
  assert.equal(notified.length, 1);
  assert.equal(notified[0].type, "revoked");
  assert.equal(notified[0].title, "Screen Time access needs attention");
  assert.deepEqual(notified[0].familyParentIds, [ctx.parent.id]);

  heartbeat(deviceSecret, "approved", { health: health() });
  kid = overview(ctx);
  assert.equal(kid.devices[0].state, "ok");
  assert.deepEqual(kid.alerts.map((a) => a.type), ["restored", "revoked"]);
  assert.equal(kid.alerts[0].message, "Screen Time access restored on Mia's iPhone; checking rules.");
  assert.equal(kid.alerts[0].ackedAt, kid.alerts[0].at, "restored is created pre-acked");
  assert.ok(kid.alerts[1].ackedAt, "the approved heartbeat auto-resolves revoked");
  assert.equal(notified.length, 2, "restore after revoke pushes");
});

test("device projection prefers the device's own selection; parent sees summaries", () => {
  const ctx = setup();
  const saved = putPolicy(ctx, { enabled: true, limits: [limit({ selection: "UEFSRU5U", selectionSummary: { apps: 3, categories: 0, webDomains: 0 } })], downtime: [] });
  const limitId = saved.body.policy.limits[0].id;
  const a = enroll(ctx).body;
  const b = enroll(ctx, { label: "iPad" }).body;
  notified.length = 0;
  const up = call("PUT /api/screen-time/device/limits/:limitId/selection", {
    auth: `FamDevice ${a.deviceSecret}`, params: { limitId }, body: { selection: "REVWSUNF", summary: { apps: 1, categories: 0, webDomains: 0 } },
  });
  assert.equal(up.statusCode, 200);
  assert.equal(up.body.policy.limits[0].selection, "REVWSUNF");
  assert.equal(up.body.policy.limits[0].deviceSelections, undefined);
  assert.equal(up.body.kidId, ctx.mia.id);
  assert.equal(up.body.kidName, "Mia");
  assert.equal(heartbeat(b.deviceSecret).body.policy.limits[0].selection, "UEFSRU5U", "other device keeps the parent's");

  const kid = overview(ctx);
  assert.equal(kid.policy.limits[0].selection, "UEFSRU5U");
  assert.deepEqual(kid.policy.limits[0].deviceSelections, { [a.deviceId]: { apps: 1, categories: 0, webDomains: 0 } });
  assert.deepEqual(kid.alerts, [], "a device's first pick is setup, not tampering");
  assert.equal(notified.length, 0);

  const upload = (selection, apps) => call("PUT /api/screen-time/device/limits/:limitId/selection", {
    auth: `FamDevice ${a.deviceSecret}`, params: { limitId }, body: { selection, summary: { apps, categories: 0, webDomains: 0 } },
  });
  upload("REVWSUNG", 1);
  assert.equal(notified.length, 1, "a changed opaque selection alerts even with the same counts");
  upload("REVWSUNH", 2);
  const after = overview(ctx);
  assert.deepEqual(after.alerts.map((x) => x.type), ["selection_changed", "selection_changed"]);
  assert.equal(after.alerts[0].message, "App selection changed on Mia's iPhone. Review the selection together.");
  assert.equal(notified.length, 2);
  assert.equal(call("PUT /api/screen-time/device/limits/:limitId/selection", { auth: `FamDevice ${a.deviceSecret}`, params: { limitId: "lim_nope" }, body: { selection: null } }).statusCode, 404);
});

test("sweep marks silent devices stale once, and a heartbeat restores without push", async () => {
  const ctx = setup();
  turnOn(ctx);
  const { deviceSecret } = enroll(ctx, { pushToken: null }).body;
  notified.length = 0;
  const t0 = clock;
  await screenTime.sweep({ now: new Date(t0.getTime() + 23 * 3600000) });
  assert.equal(overview(ctx).devices[0].state, "ok");
  await screenTime.sweep({ now: new Date(t0.getTime() + 25 * 3600000) });
  await screenTime.sweep({ now: new Date(t0.getTime() + 30 * 3600000) });
  const kid = overview(ctx);
  assert.equal(kid.devices[0].state, "stale");
  assert.deepEqual(kid.alerts.map((a) => a.type), ["check_needed"]);
  assert.match(kid.alerts[0].message, /protection is unverified.*may be offline or need a setup check/);
  assert.doesNotMatch(kid.alerts[0].message, /turned off/, "stale never claims Screen Time was turned off");
  assert.equal(notified.filter((n) => n.kidId === ctx.mia.id).length, 1);

  heartbeat(deviceSecret, "approved", { health: health() });
  const back = overview(ctx);
  assert.equal(back.devices[0].state, "ok");
  assert.deepEqual(back.alerts.map((a) => [a.type, Boolean(a.ackedAt)]), [["restored", true], ["check_needed", true]]);
  assert.equal(notified.filter((n) => n.kidId === ctx.mia.id).length, 1, "stale recovery does not push");
});

test("sweep ping with shouldPruneToken only prunes the invalid delivery token", async () => {
  const ctx = setup();
  const token = crypto.randomBytes(32).toString("hex");
  turnOn(ctx);
  enroll(ctx, { pushToken: token });
  notified.length = 0;
  const seen = [];
  const sendPing = (t, famType) => { seen.push(famType); return Promise.resolve(t === token ? { ok: false, shouldPruneToken: true } : { ok: true }); };
  await screenTime.sweep({ now: new Date(clock.getTime() + 60000), sendPing });
  assert.ok(seen.includes("screen_time_ping"));
  const kid = overview(ctx);
  assert.equal(kid.devices[0].state, "ok");
  assert.deepEqual(kid.alerts, []);
  assert.equal(db.load().screenTime[ctx.fam.id].kids[ctx.mia.id].devices[0].pushToken, null);
  assert.equal(notified.filter((n) => n.kidId === ctx.mia.id).length, 0);
});

test("pause: 0 resumes, 10 is rejected, both valid calls bump and ping", async () => {
  const ctx = setup();
  enroll(ctx, { pushToken: "cd".repeat(32) });
  pinged.length = 0;
  const pause = (minutes) => call("POST /api/screen-time/kids/:kidId/pause", { user: ctx.parent, params: { kidId: ctx.mia.id }, body: { minutes } });
  assert.equal(pause(10).statusCode, 400);
  assert.equal(pause(1441).statusCode, 400);
  const paused = pause(60);
  assert.equal(paused.body.policy.pauseUntil, new Date(clock.getTime() + 3600000).toISOString());
  assert.equal(paused.body.policy.version, 1);
  const resumed = pause(0);
  assert.equal(resumed.body.policy.pauseUntil, null);
  assert.equal(resumed.body.policy.version, 2);
  await new Promise(setImmediate); // pings are fire-and-forget
  assert.deepEqual(pinged.map((p) => p.famType), ["screen_time_sync", "screen_time_sync"]);
});

test("ack clears unacked alerts; forget device revokes its secret", () => {
  const ctx = setup();
  turnOn(ctx);
  const { deviceId, deviceSecret } = enroll(ctx).body;
  heartbeat(deviceSecret, "denied");
  assert.equal(overview(ctx).alerts.filter((a) => !a.ackedAt).length, 1);
  const acked = call("POST /api/screen-time/kids/:kidId/alerts/ack", { user: ctx.parent, params: { kidId: ctx.mia.id } });
  assert.equal(acked.body.alerts.filter((a) => !a.ackedAt).length, 0);

  const gone = call("DELETE /api/screen-time/kids/:kidId/devices/:deviceId", { user: ctx.parent, params: { kidId: ctx.mia.id, deviceId } });
  assert.equal(gone.statusCode, 200);
  assert.deepEqual(gone.body.devices, []);
  assert.equal(heartbeat(deviceSecret).statusCode, 401);
});

test("agreement: valid save round-trips via parent GET, /mine and heartbeat", () => {
  const ctx = setup();
  const { deviceSecret } = enroll(ctx).body;
  const res = saveAgreement(deviceSecret, dealBody());
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.agreement.parentSigner, "Kate");
  assert.equal(res.body.agreement.signedAt, clock.toISOString(), "server sets signedAt");
  assert.match(res.body.agreement.deviceId, /^std_/, "server sets deviceId");

  const expected = { ...dealBody(), signedAt: clock.toISOString(), deviceId: res.body.agreement.deviceId };
  assert.deepEqual(overview(ctx).agreement, expected);
  assert.deepEqual(heartbeat(deviceSecret).body.agreement, expected);
  const mine = call("GET /api/screen-time/mine", { user: ctx.kidUser });
  assert.deepEqual(mine.body.agreement, expected);
});

test("agreement: rejects bad promises/stamp/rules; wrong secret is 401", () => {
  const ctx = setup();
  const { deviceSecret } = enroll(ctx).body;
  assert.equal(saveAgreement(deviceSecret, dealBody({ kidPromises: Array.from({ length: 6 }, (_, i) => `p${i}`) })).statusCode, 400, "6 promises");
  assert.equal(saveAgreement(deviceSecret, dealBody({ parentPromises: ["x".repeat(81)] })).statusCode, 400, "81-char promise");
  assert.equal(saveAgreement(deviceSecret, dealBody({ rules: { bedStart: "25:00", bedEnd: "07:00", school: 120, weekend: 180 } })).statusCode, 400, "bad HH:mm");
  assert.equal(saveAgreement("x".repeat(43), dealBody()).statusCode, 401, "wrong secret");
});

test("agreement: signing notifies parents once and adds no alert; a second save replaces the first", () => {
  const ctx = setup();
  const { deviceSecret } = enroll(ctx).body;
  notified.length = 0;
  saveAgreement(deviceSecret, dealBody());
  assert.equal(notified.length, 1);
  assert.equal(notified[0].type, "agreement_signed");
  assert.equal(notified[0].title, "🤝 Screen Time deal signed");
  assert.equal(notified[0].body, "Mia signed your Screen Time deal");
  assert.deepEqual(notified[0].familyParentIds, [ctx.parent.id]);
  assert.deepEqual(overview(ctx).alerts, [], "no alert-list entry");

  const second = saveAgreement(deviceSecret, dealBody({ kidStamp: "🐸", parentSigner: "Tom" }));
  assert.equal(second.statusCode, 200);
  assert.equal(notified.length, 2, "second save notifies again");
  const agreement = overview(ctx).agreement;
  assert.equal(agreement.kidStamp, "🐸");
  assert.equal(agreement.parentSigner, "Tom");
});

test("alerts are capped at 50 per kid", () => {
  const ctx = setup();
  turnOn(ctx);
  const { deviceSecret } = enroll(ctx).body;
  for (let i = 0; i < 30; i++) {
    heartbeat(deviceSecret, "denied");
    heartbeat(deviceSecret, "approved", { health: health() });
  }
  const alerts = overview(ctx).alerts;
  assert.equal(alerts.length, screenTime.MAX_ALERTS);
  assert.equal(alerts[0].type, "restored", "newest first");
});

// ---------- alert lifecycle while Screen Time is off (docs/SCREEN-TIME-UX.md §2) ----------

const openAlerts = (kid) => kid.alerts.filter((a) => !a.ackedAt);
const miaPushes = (ctx) => notified.filter((n) => n.kidId === ctx.mia.id);
function withClock(at, fn) {
  const saved = clock;
  clock = at;
  try { return fn(); } finally { clock = saved; }
}
function ackOne(ctx, alertId, { user = ctx.parent, kidId = ctx.mia.id } = {}) {
  return call("POST /api/screen-time/kids/:kidId/alerts/:alertId/ack", { user, params: { kidId, alertId } });
}

test("disabled policy: a denied heartbeat updates state silently — no alert, no push", () => {
  const ctx = setup();
  const { deviceSecret } = enroll(ctx).body; // never turned on
  notified.length = 0;
  assert.equal(heartbeat(deviceSecret, "denied").statusCode, 200);
  let kid = overview(ctx);
  assert.equal(kid.devices[0].state, "revoked", "state is still tracked");
  assert.deepEqual(kid.alerts, []);

  const other = setup(); // turned on, then off — the owner's report
  turnOn(other);
  const b = enroll(other).body;
  turnOff(other);
  heartbeat(b.deviceSecret, "denied");
  heartbeat(b.deviceSecret, "approved");
  heartbeat(b.deviceSecret, "notDetermined");
  kid = overview(other);
  assert.deepEqual(kid.alerts, [], "no revoked/restored entries while off");
  assert.equal(notified.length, 0, "no push while off");
});

test("disabled policy: sweep raises no stale and sends no keep-alive ping", async () => {
  const ctx = setup();
  const token = crypto.randomBytes(32).toString("hex");
  turnOn(ctx);
  enroll(ctx, { pushToken: token });
  turnOff(ctx);
  notified.length = 0;
  const seen = [];
  const sendPing = (t, famType) => { if (t === token) seen.push(famType); return Promise.resolve({ ok: false, shouldPruneToken: t === token }); };
  for (const h of [25, 30, 60]) await screenTime.sweep({ now: new Date(clock.getTime() + h * 3600000), sendPing });
  const kid = overview(ctx);
  assert.equal(kid.devices[0].state, "ok", "never marked stale or removed by the sweep");
  assert.deepEqual(kid.alerts, []);
  assert.deepEqual(seen, [], "no screen_time_ping to a kid whose Screen Time is off");
  assert.equal(miaPushes(ctx).length, 0);
});

test("turning off acks every open alert, clears pause, bumps version and pings sync", async () => {
  const ctx = setup();
  const token = crypto.randomBytes(32).toString("hex");
  turnOn(ctx);
  const { deviceSecret } = enroll(ctx, { pushToken: token }).body;
  heartbeat(deviceSecret, "denied");
  const paused = call("POST /api/screen-time/kids/:kidId/pause", { user: ctx.parent, params: { kidId: ctx.mia.id }, body: { minutes: 60 } });
  assert.ok(paused.body.policy.pauseUntil);
  assert.equal(openAlerts(paused.body).length, 1);
  await new Promise(setImmediate);
  pinged.length = 0;

  const off = turnOff(ctx);
  assert.equal(off.statusCode, 200);
  assert.equal(off.body.policy.enabled, false);
  assert.equal(off.body.policy.pauseUntil, null);
  assert.equal(off.body.policy.version, paused.body.policy.version + 1);
  assert.equal(off.body.policy.downtime[0].id, "bedtime", "rules are kept");
  assert.deepEqual(openAlerts(off.body), []);
  assert.equal(off.body.alerts[0].ackedAt, clock.toISOString());
  await new Promise(setImmediate);
  assert.deepEqual(pinged.filter((p) => p.token === token).map((p) => p.famType), ["screen_time_sync"], "the save still pings so the device clears shields");
});

test("turning back on after the kid revoked while off raises revoked once", () => {
  const ctx = setup();
  turnOn(ctx);
  const { deviceSecret } = enroll(ctx).body;
  turnOff(ctx);
  heartbeat(deviceSecret, "denied");
  notified.length = 0;
  const on = turnOn(ctx);
  assert.equal(on.statusCode, 200);
  assert.deepEqual(openAlerts(on.body).map((a) => [a.type, a.message]), [["revoked", "Screen Time access is unavailable on Mia's iPhone. Check its permissions together."]]);
  assert.deepEqual(notified.map((n) => n.type), ["revoked"], "the parent must know the device can't enforce");

  heartbeat(deviceSecret, "denied");
  turnOn(ctx); // true → true is not a transition
  assert.deepEqual(overview(ctx).alerts.map((a) => a.type), ["revoked"], "raised once");
  assert.equal(notified.length, 1);
});

test("turning back on gives a stale (or silent-while-off) device a fresh grace period, no alert", async () => {
  const ctx = setup();
  turnOn(ctx);
  enroll(ctx, { pushToken: null });
  const t0 = clock;
  await screenTime.sweep({ now: new Date(t0.getTime() + 25 * 3600000) });
  assert.equal(overview(ctx).devices[0].state, "stale");
  turnOff(ctx);
  notified.length = 0;

  const later = new Date(t0.getTime() + 30 * 3600000);
  const on = withClock(later, () => turnOn(ctx));
  assert.equal(on.body.devices[0].state, "stale");
  assert.equal(on.body.devices[0].lastSeenAt, t0.toISOString(), "parent edits do not fabricate a device check-in");
  assert.deepEqual(openAlerts(on.body), []);
  assert.equal(miaPushes(ctx).length, 0);
  await screenTime.sweep({ now: new Date(later.getTime() + 23 * 3600000) });
  assert.deepEqual(openAlerts(overview(ctx)), [], "24 h reminder grace from turning back on");

  // A device that went quiet while off (the sweep skipped it) gets the same grace.
  withClock(later, () => turnOff(ctx));
  const muchLater = new Date(later.getTime() + 72 * 3600000);
  await screenTime.sweep({ now: muchLater });
  assert.equal(overview(ctx).devices[0].state, "stale");
  const again = withClock(muchLater, () => turnOn(ctx));
  assert.equal(again.body.devices[0].lastSeenAt, t0.toISOString());
  await screenTime.sweep({ now: new Date(muchLater.getTime() + 60000) });
  assert.deepEqual(openAlerts(overview(ctx)), [], "no instant stale alarm");
});

test("restore: confirmed health resolves that device's uncertainty; token failure creates no protection alert", async () => {
  const ctx = setup();
  const token = crypto.randomBytes(32).toString("hex");
  const saved = turnOn(ctx, { limits: [limit({ selection: "UEFSRU5U", selectionSummary: { apps: 3, categories: 0, webDomains: 0 } })] });
  const limitId = saved.body.policy.limits[0].id;
  const a = enroll(ctx, { pushToken: token }).body;
  const b = enroll(ctx, { label: "iPad", pushToken: null }).body;
  const upload = (apps) => call("PUT /api/screen-time/device/limits/:limitId/selection", {
    auth: `FamDevice ${a.deviceSecret}`, params: { limitId }, body: { selection: `U0VM${apps}`, summary: { apps, categories: 0, webDomains: 0 } },
  });
  upload(1);
  upload(2); // selection_changed on device a
  heartbeat(b.deviceSecret, "denied"); // revoked on device b
  await screenTime.sweep({ now: new Date(clock.getTime() + 60000), sendPing: (t) => Promise.resolve({ ok: false, shouldPruneToken: t === token }) });
  let kid = overview(ctx);
  assert.equal(kid.devices.find((d) => d.id === a.deviceId).state, "ok");
  assert.deepEqual(openAlerts(kid).map((x) => x.type).sort(), ["revoked", "selection_changed"]);
  notified.length = 0;

  heartbeat(a.deviceSecret, "approved", { pushToken: token, health: health() });
  kid = overview(ctx);
  assert.deepEqual(openAlerts(kid).map((x) => [x.type, x.deviceId]).sort(), [["revoked", b.deviceId], ["selection_changed", a.deviceId]],
    "only that device's device-health alerts are resolved");
  assert.equal(notified.length, 0, "delivery recovery does not fabricate a protection-restored push");

  heartbeat(b.deviceSecret, "approved", { health: health() });
  kid = overview(ctx);
  assert.deepEqual(openAlerts(kid).map((x) => x.type), ["selection_changed"]);
  assert.deepEqual(notified.map((n) => n.type), ["restored"], "restore after revoked pushes");
});

test("per-alert ack acks exactly one; 404 for another kid's, another family's or an unknown alert", () => {
  const ctx = setup();
  turnOn(ctx);
  call("PUT /api/screen-time/kids/:kidId/policy", { user: ctx.parent, params: { kidId: ctx.leo.id }, body: { enabled: true, limits: [], downtime: [] } });
  const a = enroll(ctx).body;
  const b = enroll(ctx, { label: "iPad" }).body;
  heartbeat(a.deviceSecret, "denied");
  heartbeat(b.deviceSecret, "denied");
  const leoUser = store.findOrCreateKidUser(ctx.fam.id, ctx.leo.id, "Leo");
  const leoDev = call("POST /api/screen-time/device/enroll", { user: leoUser, body: { label: "iPhone", mode: "cooperative", authStatus: "approved" } }).body;
  heartbeat(leoDev.deviceSecret, "denied");
  const leoAlert = call("GET /api/screen-time", { user: ctx.parent }).body.kids.find((k) => k.kidId === ctx.leo.id).alerts[0];
  assert.equal(leoAlert.type, "revoked");

  const [first, second] = overview(ctx).alerts;
  const res = ackOne(ctx, first.id);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.body.kidId, ctx.mia.id, "returns the kid state");
  assert.equal(res.body.alerts.find((x) => x.id === first.id).ackedAt, clock.toISOString());
  assert.equal(res.body.alerts.find((x) => x.id === second.id).ackedAt, null, "the other alert stays open");
  const again = withClock(new Date(clock.getTime() + 60000), () => ackOne(ctx, first.id));
  assert.equal(again.statusCode, 200, "idempotent");
  assert.equal(again.body.alerts.find((x) => x.id === first.id).ackedAt, clock.toISOString(), "first ack time kept");

  assert.equal(ackOne(ctx, leoAlert.id).statusCode, 404, "Leo's alert under Mia");
  assert.equal(ackOne(ctx, "sta_nope").statusCode, 404);
  assert.equal(ackOne(ctx, second.id, { user: ctx.kidUser }).statusCode, 403, "kids can't ack");
  assert.equal(ackOne(ctx, second.id, { user: setup().parent }).statusCode, 404, "another family's parent");
  assert.equal(overview(ctx).alerts.find((x) => x.id === second.id).ackedAt, null);
  assert.equal(call("GET /api/screen-time", { user: ctx.parent }).body.kids.find((k) => k.kidId === ctx.leo.id).alerts[0].ackedAt, null);
  assert.equal(routes["POST /api/screen-time/kids/:kidId/alerts/:alertId/ack"].length, routes["POST /api/screen-time/kids/:kidId/alerts/ack"].length,
    "same parent middleware chain as ack-all");
});

test("alerts older than 7 days read as acked (persisted)", () => {
  const ctx = setup();
  turnOn(ctx);
  const { deviceSecret } = enroll(ctx).body;
  heartbeat(deviceSecret, "denied");
  const raisedAt = clock;
  const day = 86400000;
  withClock(new Date(raisedAt.getTime() + 6 * day), () => {
    assert.equal(openAlerts(overview(ctx)).length, 1, "6 days old is still open");
  });
  const eightDays = new Date(raisedAt.getTime() + 8 * day);
  withClock(eightDays, () => {
    const kid = overview(ctx);
    assert.deepEqual(openAlerts(kid), []);
    assert.equal(kid.alerts[0].ackedAt, eightDays.toISOString());
  });
  const stored = db.load().screenTime[ctx.fam.id].kids[ctx.mia.id].alerts[0];
  assert.equal(stored.ackedAt, eightDays.toISOString(), "expiry is written back");
});

test("forgetting a device acks its alerts only", () => {
  const ctx = setup();
  turnOn(ctx);
  const a = enroll(ctx).body;
  const b = enroll(ctx, { label: "iPad" }).body;
  heartbeat(a.deviceSecret, "denied");
  heartbeat(b.deviceSecret, "denied");
  const gone = call("DELETE /api/screen-time/kids/:kidId/devices/:deviceId", { user: ctx.parent, params: { kidId: ctx.mia.id, deviceId: a.deviceId } });
  assert.equal(gone.statusCode, 200);
  assert.deepEqual(gone.body.alerts.map((x) => [x.deviceId, Boolean(x.ackedAt)]).sort(), [[a.deviceId, true], [b.deviceId, false]].sort());
});

// ---------- unknown authorization remains uncertainty, regardless of duration ----------

test("notDetermined (non-monitor): remains unknown without a permission-loss alert", () => {
  const ctx = setup();
  turnOn(ctx);
  const { deviceSecret } = enroll(ctx).body;
  notified.length = 0;
  const t0 = clock;

  assert.equal(heartbeat(deviceSecret, "notDetermined", { source: "app" }).statusCode, 200);
  let kid = overview(ctx);
  assert.equal(kid.devices[0].state, "unknown");
  assert.equal(kid.devices[0].authStatus, "notDetermined", "unknown cannot appear as current approved authorization");
  assert.deepEqual(kid.alerts, []);
  assert.equal(notified.length, 0);

  withClock(new Date(t0.getTime() + 5 * 60000), () => heartbeat(deviceSecret, "notDetermined", { source: "app" }));
  kid = overview(ctx);
  assert.equal(kid.devices[0].state, "unknown");
  assert.deepEqual(kid.alerts, [], "still inside the grace window");
  assert.equal(notified.length, 0);

  withClock(new Date(t0.getTime() + 11 * 60000), () => heartbeat(deviceSecret, "notDetermined", { source: "app" }));
  kid = overview(ctx);
  assert.equal(kid.devices[0].state, "unknown");
  assert.equal(kid.devices[0].authStatus, "notDetermined");
  assert.deepEqual(kid.alerts, []);
  assert.equal(notified.length, 0);
});

test("notDetermined from the monitor extension never confirms, however long it persists", () => {
  const ctx = setup();
  turnOn(ctx);
  const { deviceSecret } = enroll(ctx).body;
  notified.length = 0;
  const t0 = clock;

  heartbeat(deviceSecret, "notDetermined", { source: "monitor" });
  withClock(new Date(t0.getTime() + 3 * 3600000), () => heartbeat(deviceSecret, "notDetermined", { source: "monitor" }));
  withClock(new Date(t0.getTime() + 9 * 3600000), () => heartbeat(deviceSecret, "notDetermined", { source: "monitor" }));

  const kid = overview(ctx);
  assert.equal(kid.devices[0].state, "unknown");
  assert.equal(kid.devices[0].authStatus, "notDetermined", "monitor uncertainty is not evidence of approved access");
  assert.deepEqual(kid.alerts, []);
  assert.equal(notified.length, 0);
});

test("notDetermined then confirmed health: no blame alert; a later notDetermined starts new uncertainty", () => {
  const ctx = setup();
  turnOn(ctx);
  const { deviceSecret } = enroll(ctx).body;
  notified.length = 0;
  const t0 = clock;

  heartbeat(deviceSecret, "notDetermined", { source: "app" });
  const t1 = new Date(t0.getTime() + 3 * 60000);
  withClock(t1, () => heartbeat(deviceSecret, "approved", { health: health() }));
  let kid = overview(ctx);
  assert.equal(kid.devices[0].state, "ok");
  assert.deepEqual(kid.alerts, [], "no revoked, and no restored — the device was never actually marked down");
  assert.equal(notified.length, 0);

  const t2 = new Date(t1.getTime() + 60000);
  withClock(t2, () => heartbeat(deviceSecret, "notDetermined", { source: "app" }));
  const t3 = new Date(t2.getTime() + 9 * 60000); // 9 min into the fresh window, 13 min past the very first notDetermined
  withClock(t3, () => heartbeat(deviceSecret, "notDetermined", { source: "app" }));
  kid = overview(ctx);
  assert.deepEqual(kid.alerts, [], "the fresh window started at t2 (approved cleared it), not back at the first notDetermined");
});

test("unknown app → 12h unknown monitor → unknown app never produces revocation or restoration", () => {
  const ctx = setup();
  turnOn(ctx);
  const { deviceSecret } = enroll(ctx).body;
  const t0 = clock;
  heartbeat(deviceSecret, "notDetermined", { source: "app" });
  withClock(new Date(t0.getTime() + 12 * 3600000), () => heartbeat(deviceSecret, "notDetermined", { source: "monitor" }));
  withClock(new Date(t0.getTime() + 12 * 3600000 + 60000), () => heartbeat(deviceSecret, "notDetermined", { source: "app" }));
  assert.equal(overview(ctx).devices[0].state, "unknown");
  notified.length = 0;

  withClock(new Date(t0.getTime() + 13 * 3600000), () => heartbeat(deviceSecret, "approved", { health: health() }));
  const kid = overview(ctx);
  assert.equal(kid.devices[0].state, "ok");
  assert.equal(kid.devices[0].authStatus, "approved");
  assert.deepEqual(kid.alerts, []);
  assert.equal(notified.length, 0, "uncertainty never becomes permission-loss or protected-restored evidence");
});

// ---------- device reinstall / installKey (survives the app being deleted) ----------

test("enroll with installKey: reinstalling the same kid's app re-enrolls the same device in place", () => {
  const ctx = setup();
  const saved = putPolicy(ctx, { enabled: true, limits: [limit({ selection: "UEFSRU5U", selectionSummary: { apps: 1, categories: 0, webDomains: 0 } })], downtime: [] });
  const limitId = saved.body.policy.limits[0].id;
  const installKey = "a".repeat(32);

  const first = enroll(ctx, { installKey }).body;
  call("PUT /api/screen-time/device/limits/:limitId/selection", {
    auth: `FamDevice ${first.deviceSecret}`, params: { limitId }, body: { selection: "U0VMMQ", summary: { apps: 1, categories: 0, webDomains: 0 } },
  });
  heartbeat(first.deviceSecret, "denied", { appliedVersion: 3 }); // an open alert + non-zero appliedVersion to prove both reset on reinstall

  const second = enroll(ctx, { installKey, label: "iPhone (reinstalled)" });
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.deviceId, first.deviceId, "same device id");
  assert.notEqual(second.body.deviceSecret, first.deviceSecret);

  const kid = overview(ctx);
  assert.equal(kid.devices.length, 1, "no ghost left behind");
  assert.equal(kid.devices[0].id, first.deviceId);
  assert.equal(kid.devices[0].label, "iPhone (reinstalled)");
  assert.equal(kid.devices[0].state, "ok");
  assert.equal(kid.devices[0].authStatus, "approved");
  assert.equal(kid.devices[0].appliedVersion, 0, "reinstall resets appliedVersion so it re-syncs");
  assert.deepEqual(openAlerts(kid), [], "the old device's open alert was acked");
  assert.deepEqual(kid.policy.limits[0].deviceSelections, {}, "the reinstalled app must re-pick its apps");

  // Verified last: these heartbeats would themselves bump appliedVersion again.
  assert.equal(heartbeat(first.deviceSecret).statusCode, 401, "the old secret is gone");
  assert.equal(heartbeat(second.body.deviceSecret).statusCode, 200, "the new secret works");
});

test("enroll with different installKeys creates separate devices", () => {
  const ctx = setup();
  const a = enroll(ctx, { installKey: "a".repeat(20) }).body;
  const b = enroll(ctx, { installKey: "b".repeat(20), label: "iPad" }).body;
  assert.notEqual(a.deviceId, b.deviceId);
  assert.equal(overview(ctx).devices.length, 2);
});

test("enroll with an installKey already used by another kid of the family moves it there", () => {
  const ctx = setup();
  const installKey = "c".repeat(24);
  const first = enroll(ctx, { installKey }).body;
  const leoUser = store.findOrCreateKidUser(ctx.fam.id, ctx.leo.id, "Leo");
  const second = call("POST /api/screen-time/device/enroll", {
    user: leoUser, body: { label: "Leo's iPhone", mode: "cooperative", authStatus: "approved", installKey },
  });
  assert.equal(second.statusCode, 200);

  assert.deepEqual(overview(ctx).devices, [], "removed from the first kid");
  const leo = call("GET /api/screen-time", { user: ctx.parent }).body.kids.find((k) => k.kidId === ctx.leo.id);
  assert.equal(leo.devices.length, 1, "present under the second");
  assert.equal(leo.devices[0].id, second.body.deviceId);
  assert.equal(heartbeat(first.deviceSecret).statusCode, 401, "the old secret under Mia is gone");
  assert.equal(heartbeat(second.body.deviceSecret).statusCode, 200);
});

test("enroll rejects a malformed installKey; publicDevice never leaks the hash", () => {
  const ctx = setup();
  assert.equal(enroll(ctx, { installKey: "short" }).statusCode, 400);
  assert.equal(enroll(ctx, { installKey: 12345 }).statusCode, 400);
  assert.equal(enroll(ctx, { installKey: "x".repeat(129) }).statusCode, 400);
  const ok = enroll(ctx, { installKey: "d".repeat(20) });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(Object.keys(overview(ctx).devices[0]).sort(), ["appliedVersion", "assignmentGeneration", "authStatus", "enrolledAt", "essentialApps", "health", "id", "label", "lastSeenAt", "mode", "state"]);
});

// ---------- moving a device between kids ----------

function moveDeviceCall(ctx, deviceId, toKidId, user = ctx.parent) {
  return call("POST /api/screen-time/kids/:kidId/devices/:deviceId/move", {
    user, params: { kidId: ctx.mia.id, deviceId }, body: { toKidId },
  });
}

test("moving a device to another kid: gone from the source, present at the destination, heartbeats as that kid", async () => {
  const ctx = setup();
  turnOn(ctx);
  call("PUT /api/screen-time/kids/:kidId/policy", { user: ctx.parent, params: { kidId: ctx.leo.id }, body: { enabled: true, limits: [], downtime: [] } });
  const { deviceId, deviceSecret } = enroll(ctx).body;
  pinged.length = 0;

  const moved = moveDeviceCall(ctx, deviceId, ctx.leo.id);
  assert.equal(moved.statusCode, 200);
  assert.deepEqual(moved.body.devices, [], "source kid's returned state has no device");

  const overviewBody = call("GET /api/screen-time", { user: ctx.parent }).body;
  assert.deepEqual(overviewBody.kids.find((k) => k.kidId === ctx.mia.id).devices, []);
  const leoDevices = overviewBody.kids.find((k) => k.kidId === ctx.leo.id).devices;
  assert.equal(leoDevices.length, 1);
  assert.equal(leoDevices[0].id, deviceId);
  assert.equal(leoDevices[0].appliedVersion, 0);

  await new Promise(setImmediate); // pings are fire-and-forget
  assert.deepEqual(pinged.map((p) => p.famType), ["screen_time_sync"], "the destination kid's devices are pinged so it syncs promptly");

  const hb = heartbeat(deviceSecret);
  assert.equal(hb.statusCode, 200);
  assert.equal(hb.body.kidId, ctx.leo.id);
  assert.equal(hb.body.kidName, "Leo");

  assert.equal(moveDeviceCall(ctx, "std_nope", ctx.leo.id).statusCode, 404, "unknown device");
  assert.equal(moveDeviceCall(ctx, deviceId, ctx.leo.id, ctx.kidUser).statusCode, 403, "a kid session can't move devices");
  assert.equal(moveDeviceCall(ctx, deviceId, ctx.mia.id).statusCode, 400, "toKidId equal to the source kidId");
  assert.equal(moveDeviceCall(ctx, deviceId, setup().mia.id).statusCode, 400, "toKidId from another family");
});

// ---------- more time for fams ----------

const TODAY = "2026-09-27"; // clock 08:00Z = 15:00 in Asia/Bangkok
function giveFams(ctx, amount) {
  const chore = fams.createChore(ctx.fam.id, ctx.mia.id, { title: "Dishes", amount }).chore;
  fams.submitChore(ctx.fam.id, ctx.mia.id, chore.id);
  fams.approveChore(ctx.fam.id, ctx.mia.id, chore.id);
}
function totalPolicy(ctx) {
  return putPolicy(ctx, { enabled: true, limits: [{ kind: "total", name: "Screen time", minutesPerDay: 120 }], downtime: [] });
}
function ask(ctx, body) {
  return call("POST /api/screen-time/requests", { user: ctx.kidUser, body: { minutes: 15, date: TODAY, ...body } });
}
function decide(ctx, id, verb, user = ctx.parent) {
  return call(`POST /api/screen-time/kids/:kidId/requests/:id/${verb}`, { user, params: { kidId: ctx.mia.id, id } });
}
const balance = (ctx) => fams.balance(ctx.fam.id, ctx.mia.id);

test("more time: request validation", () => {
  const ctx = setup();
  giveFams(ctx, 100);
  assert.equal(ask(ctx).statusCode, 409, "no total limit yet");
  assert.equal(ask(ctx).body.error, "No daily screen time to extend");
  totalPolicy(ctx);
  for (const body of [{ minutes: 20 }, { minutes: "15" }, { date: "2026-09-29" }, { date: "2026-02-30" }, { date: "27/09/2026" }, { note: "x".repeat(81) }, { note: 5 }]) {
    assert.equal(ask(ctx, body).statusCode, 400, JSON.stringify(body));
  }
  assert.equal(call("POST /api/screen-time/requests", { user: ctx.parent, body: { minutes: 15, date: TODAY } }).statusCode, 403, "parents don't ask");
  requested.length = 0;
  const ok = ask(ctx, { minutes: 30, note: "  finish my level  " });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual({ ...ok.body.request, id: undefined, createdAt: undefined }, {
    id: undefined, kidId: ctx.mia.id, minutes: 30, fams: 10, date: TODAY, note: "finish my level", status: "pending",
    createdAt: undefined, decidedAt: null, decidedBy: null,
  });
  assert.equal(requested.length, 1);
  assert.equal(requested[0].body, "Mia asks for 30 more minutes (10 fams): “finish my level”");
  assert.deepEqual(requested[0].familyParentIds, [ctx.parent.id]);
  assert.equal(ask(ctx).statusCode, 409, "one pending request at a time");
  assert.equal(balance(ctx), 100, "asking spends nothing");
  assert.equal(call("GET /api/screen-time/mine", { user: ctx.kidUser }).body.requests[0].id, ok.body.request.id);
  assert.equal(overview(ctx).requests[0].status, "pending");
});

test("more time: low balance is refused at request time", () => {
  const ctx = setup();
  totalPolicy(ctx);
  giveFams(ctx, 4);
  assert.equal(ask(ctx).statusCode, 409);
  assert.equal(ask(ctx).body.error, "Not enough fams.");
});

test("more time: approve deducts minutes/3 once, adds bonus, bumps version, pings, notifies kid", async () => {
  const ctx = setup();
  totalPolicy(ctx);
  enroll(ctx, { pushToken: "ef".repeat(32) });
  giveFams(ctx, 20);
  const { id } = ask(ctx, { minutes: 45 }).body.request;
  const v0 = overview(ctx).policy.version;
  results.length = 0; pinged.length = 0;
  const first = decide(ctx, id, "approve");
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body.policy.bonus, { date: TODAY, minutes: 45 });
  assert.equal(first.body.policy.version, v0 + 1);
  assert.equal(first.body.requests[0].status, "approved");
  assert.equal(first.body.requests[0].decidedBy, ctx.parent.id);
  const again = decide(ctx, id, "approve");
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.policy.version, v0 + 1, "second approve is a no-op");
  assert.equal(balance(ctx), 5, "20 − 15, exactly once");
  assert.equal(decide(ctx, id, "decline").body.requests[0].status, "approved", "decided stays decided");
  await new Promise(setImmediate);
  assert.equal(results.length, 1, "kid notified once");
  assert.equal(results[0].body, "🎉 +45 minutes! Enjoy.");
  assert.deepEqual(results[0].kidUserIds, [ctx.kidUser.id]);
  assert.deepEqual(pinged.map((p) => p.famType), ["screen_time_sync"]);
  const { deviceSecret } = enroll(ctx).body;
  assert.deepEqual(heartbeat(deviceSecret).body.policy.bonus, { date: TODAY, minutes: 45 }, "device projection carries bonus");
  assert.equal(heartbeat(deviceSecret).body.requests[0].status, "approved");

  // A second approved request the same day adds up.
  giveFams(ctx, 10);
  const second = ask(ctx, { minutes: 15 }).body.request;
  assert.deepEqual(decide(ctx, second.id, "approve").body.policy.bonus, { date: TODAY, minutes: 60 });
});

test("more time: approve after the balance drained → 409, no bonus, still pending", () => {
  const ctx = setup();
  totalPolicy(ctx);
  giveFams(ctx, 5);
  const { id } = ask(ctx).body.request;
  fams.spend(ctx.fam.id, ctx.mia.id, { event: "test:drain", amount: 3, title: "Elsewhere" });
  const v0 = overview(ctx).policy.version;
  const res = decide(ctx, id, "approve");
  assert.equal(res.statusCode, 409);
  const kid = overview(ctx);
  assert.equal(kid.policy.bonus, null);
  assert.equal(kid.policy.version, v0);
  assert.equal(kid.requests[0].status, "pending");
  assert.equal(balance(ctx), 2);
});

test("more time: decline notifies the kid and spends nothing", () => {
  const ctx = setup();
  totalPolicy(ctx);
  giveFams(ctx, 10);
  const { id } = ask(ctx).body.request;
  results.length = 0;
  const res = decide(ctx, id, "decline");
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.requests[0].status, "declined");
  assert.equal(res.body.policy.bonus, null);
  assert.equal(balance(ctx), 10);
  decide(ctx, id, "decline");
  assert.equal(results.length, 1);
  assert.equal(results[0].body, "Not this time — maybe later.");
});

test("more time: requests expire after their date; bonus resets on a new date", () => {
  const ctx = setup();
  totalPolicy(ctx);
  giveFams(ctx, 50);
  const saved = clock;
  try {
    decide(ctx, ask(ctx).body.request.id, "approve");
    const stale = ask(ctx, { minutes: 30 }).body.request;
    clock = new Date("2026-09-28T08:00:00Z");
    assert.equal(overview(ctx).requests[0].status, "expired");
    assert.equal(decide(ctx, stale.id, "approve").statusCode, 409, "expired can't be approved");
    assert.equal(balance(ctx), 45);
    const next = ask(ctx, { minutes: 30, date: "2026-09-28" });
    assert.equal(next.statusCode, 200, "an expired request doesn't block a new one");
    assert.deepEqual(decide(ctx, next.body.request.id, "approve").body.policy.bonus, { date: "2026-09-28", minutes: 30 });
  } finally {
    clock = saved;
  }
});

test("more time: kid can't approve; another family's parent gets 404", () => {
  const ctx = setup();
  totalPolicy(ctx);
  giveFams(ctx, 10);
  const { id } = ask(ctx).body.request;
  assert.equal(decide(ctx, id, "approve", ctx.kidUser).statusCode, 403);
  assert.equal(decide(ctx, id, "approve", setup().parent).statusCode, 404);
  assert.equal(decide(ctx, "str_nope", "approve").statusCode, 404);
  assert.equal(balance(ctx), 10);
  assert.equal(overview(ctx).requests[0].status, "pending");
});

// ---------- usage details ----------

const addDays = (dateStr, n) => new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const isWeekendStr = (dateStr) => [0, 6].includes(new Date(`${dateStr}T00:00:00Z`).getUTCDay());
function usageQuery(ctx, days, user = ctx.parent) {
  return call("GET /api/screen-time/kids/:kidId/usage", {
    user, params: { kidId: ctx.mia.id }, query: days === undefined ? {} : { days: String(days) },
  });
}

test("usage: invalid usage is dropped but the check-in (tamper detection) still lands", () => {
  const ctx = setup();
  const { deviceSecret } = enroll(ctx).body;
  const bad = [
    { date: TODAY, minutes: 20 }, // not a multiple of 15
    { date: TODAY, minutes: 1500 }, // over 1440
    { date: TODAY, minutes: -15 },
    { date: "not-a-date", minutes: 30 },
    { date: "2026-02-30", minutes: 30 },
    { date: addDays(TODAY, -5), minutes: 30 }, // 5 days off
    { date: TODAY, minutes: 30, limitReachedAt: "x".repeat(41) },
    { date: TODAY, minutes: 30, limitReachedAt: "not-a-timestamp" },
  ];
  for (const usage of bad) {
    assert.equal(heartbeat(deviceSecret, "approved", { appliedVersion: 7, usage }).statusCode, 200, JSON.stringify(usage));
  }
  assert.equal(overview(ctx).devices[0].lastSeenAt, clock.toISOString(), "the check-in itself was recorded");
  assert.equal(overview(ctx).devices[0].appliedVersion, 0, "legacy claimed versions are unverified");
  assert.ok(usageQuery(ctx, 7).body.days.every((d) => d.minutes === null), "no invalid usage was stored");
  assert.equal(heartbeat(deviceSecret, "denied", { usage: bad[0] }).statusCode, 200);
  assert.equal(overview(ctx).devices[0].state, "revoked", "bad usage never hides a switch-off");
});

test("usage: minutes only increase, first limitReachedAt wins, and it rolls up via GET usage", () => {
  const ctx = setup();
  const { deviceSecret } = enroll(ctx).body;
  assert.equal(heartbeat(deviceSecret, "approved", { usage: { date: TODAY, minutes: 30, limitReachedAt: null } }).statusCode, 200);
  let day = usageQuery(ctx, 1).body.days[0];
  assert.equal(day.minutes, 30);
  assert.equal(day.devices[0].minutes, 30);
  assert.equal(day.devices[0].limitReachedAt, null);

  heartbeat(deviceSecret, "approved", { usage: { date: TODAY, minutes: 15 } }); // lower value never wins
  assert.equal(usageQuery(ctx, 1).body.days[0].minutes, 30);

  const first = "2026-09-27T10:00:00.000Z";
  heartbeat(deviceSecret, "approved", { usage: { date: TODAY, minutes: 45, limitReachedAt: first } });
  day = usageQuery(ctx, 1).body.days[0];
  assert.equal(day.minutes, 45);
  assert.equal(day.devices[0].limitReachedAt, first);

  heartbeat(deviceSecret, "approved", { usage: { date: TODAY, minutes: 60, limitReachedAt: "2026-09-27T11:00:00.000Z" } });
  day = usageQuery(ctx, 1).body.days[0];
  assert.equal(day.minutes, 60, "still climbs");
  assert.equal(day.devices[0].limitReachedAt, first, "the first non-null limitReachedAt wins");
});

test("usage: entries older than 35 days are pruned on the next write", () => {
  const ctx = setup();
  const { deviceSecret } = enroll(ctx).body;
  const saved = clock;
  try {
    heartbeat(deviceSecret, "approved", { usage: { date: TODAY, minutes: 30 } });
    assert.ok(db.load().screenTime[ctx.fam.id].kids[ctx.mia.id].usage[TODAY]);
    clock = new Date(saved.getTime() + 36 * 86400000);
    const newToday = addDays(TODAY, 36);
    assert.equal(heartbeat(deviceSecret, "approved", { usage: { date: newToday, minutes: 15 } }).statusCode, 200);
    const usage = db.load().screenTime[ctx.fam.id].kids[ctx.mia.id].usage;
    assert.ok(!usage[TODAY], "pruned");
    assert.ok(usage[newToday]);
  } finally {
    clock = saved;
  }
});

test("GET usage: 7-date shape, sums across devices, weekday/weekend + bonus limitMinutes, extraMinutes, clamps, guards", () => {
  const ctx = setup();
  putPolicy(ctx, { enabled: true, limits: [{ kind: "total", name: "Screen time", minutesPerDay: 90, weekendMinutes: 150 }], downtime: [] });
  const a = enroll(ctx, { label: "iPhone" }).body;
  const b = enroll(ctx, { label: "iPad" }).body;
  heartbeat(a.deviceSecret, "approved", { usage: { date: TODAY, minutes: 30 } });
  heartbeat(b.deviceSecret, "approved", { usage: { date: TODAY, minutes: 45 } });

  const res = usageQuery(ctx, 7);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.body.kidId, ctx.mia.id);
  assert.deepEqual(res.body.days.map((d) => d.date), Array.from({ length: 7 }, (_, i) => addDays(TODAY, -i)), "newest first, every date present");

  const today = res.body.days[0];
  assert.equal(today.minutes, 75, "sum across two devices");
  assert.deepEqual(today.devices.map((d) => d.label).sort(), ["iPad", "iPhone"]);
  const expectedToday = isWeekendStr(TODAY) ? 150 : 90;
  assert.equal(today.limitMinutes, expectedToday);
  assert.equal(today.extraMinutes, 0);

  const noReport = res.body.days[1];
  assert.equal(noReport.minutes, null, "no device reported that day");
  assert.deepEqual(noReport.devices, []);
  assert.equal(noReport.limitMinutes, null, "historic allowance without a recorded report is unknown");

  giveFams(ctx, 20);
  const req = ask(ctx, { minutes: 45, date: TODAY }).body.request;
  decide(ctx, req.id, "approve");
  const bonused = usageQuery(ctx, 7).body.days[0];
  assert.equal(bonused.limitMinutes, expectedToday + 45);
  assert.equal(bonused.extraMinutes, 45);

  call("DELETE /api/screen-time/kids/:kidId/devices/:deviceId", { user: ctx.parent, params: { kidId: ctx.mia.id, deviceId: b.deviceId } });
  const afterForget = usageQuery(ctx, 7).body.days[0];
  assert.equal(afterForget.devices.find((d) => d.deviceId === b.deviceId).label, "Removed device");

  assert.equal(usageQuery(ctx, 0).body.days.length, 1, "clamped up to 1");
  assert.equal(usageQuery(ctx, 999).body.days.length, 30, "clamped down to 30");
  assert.equal(usageQuery(ctx).body.days.length, 7, "default 7");
  assert.equal(usageQuery(ctx, "abc").statusCode, 400, "non-integer days");

  assert.equal(usageQuery(ctx, 7, ctx.kidUser).statusCode, 403, "kid session");
  assert.equal(usageQuery(ctx, 7, setup().parent).statusCode, 404, "other family");
});

// ---------- device health and parent-approved downtime exceptions ----------

function health(extra = {}) {
  return { policyVersion: 1, state: "applied", registeredActivities: 4, expectedActivities: 4, hasUsageSelection: true, failures: [], ...extra };
}
function propose(ctx, device, body = {}) {
  return call("PUT /api/screen-time/device/essential-apps", {
    auth: `FamDevice ${device.deviceSecret}`,
    body: { selection: "RU5DT0RFRA==", summary: { apps: 2, categories: 0, webDomains: 0 }, note: "For school", ...body },
  });
}
function essentialDecision(ctx, device, decision, requestId, user = ctx.parent, kidId = ctx.mia.id) {
  return call(`POST /api/screen-time/kids/:kidId/devices/:deviceId/essential-apps/${decision}`, {
    user, params: { kidId, deviceId: device.deviceId }, body: { requestId },
  });
}
function removeEssential(ctx, device, user = ctx.parent) {
  return call("DELETE /api/screen-time/kids/:kidId/devices/:deviceId/essential-apps", {
    user, params: { kidId: ctx.mia.id, deviceId: device.deviceId },
  });
}

test("health is validated, server stamped and only confirmed success advances appliedVersion", () => {
  const ctx = setup();
  turnOn(ctx);
  const device = enroll(ctx).body;
  heartbeat(device.deviceSecret, "approved", { appliedVersion: 999 });
  assert.equal(overview(ctx).devices[0].health, null);
  assert.equal(overview(ctx).devices[0].appliedVersion, 0, "legacy heartbeat does not confirm protection");
  const bad = [
    health({ registeredActivities: 3 }), health({ failures: ["registration_failed"] }),
    health({ failures: ["https://secret.example"] }), health({ failures: ["A".repeat(70)] }),
    health({ expectedActivities: 129 }), health({ hasUsageSelection: "yes" }),
    health({ policyVersion: -1 }), health({ state: "healthy" }), health({ policyVersion: 2 }),
  ];
  for (const value of bad) assert.equal(heartbeat(device.deviceSecret, "approved", { health: value }).statusCode, 400);
  assert.equal(overview(ctx).devices[0].health, null, "rejected payloads do not write evidence");
  assert.equal(heartbeat(device.deviceSecret, "approved", { health: health({ checkedAt: "2000-01-01", arbitrarySecret: "secret" }) }).statusCode, 200);
  let publicDev = overview(ctx).devices[0];
  assert.equal(publicDev.appliedVersion, 1);
  assert.equal(publicDev.health.checkedAt, clock.toISOString());
  assert.ok(!JSON.stringify(publicDev).includes("arbitrarySecret"));
  turnOn(ctx); // policy version 2
  heartbeat(device.deviceSecret, "approved", { appliedVersion: 2, health: health({ policyVersion: 2, state: "partial", registeredActivities: 3, failures: ["registration_failed"] }) });
  publicDev = overview(ctx).devices[0];
  assert.equal(publicDev.appliedVersion, 1, "partial registration does not acknowledge the new policy");
  assert.equal(publicDev.health.state, "partial");
  heartbeat(device.deviceSecret, "approved", { appliedVersion: 2, health: health({ policyVersion: 2, state: "failed", registeredActivities: 0, failures: ["a_private_lowercase_token", "future_registration_failure"] }) });
  assert.deepEqual(overview(ctx).devices[0].health.failures, ["unknown_registration_failure"], "unknown well-formed failure codes remain compatible without exposing their contents");
  heartbeat(device.deviceSecret, "denied", { appliedVersion: 2, health: health({ policyVersion: 2 }) });
  assert.equal(overview(ctx).devices[0].appliedVersion, 1, "revoked access cannot confirm protection");
  heartbeat(device.deviceSecret, "approved", { appliedVersion: 2, health: health({ policyVersion: 2 }) });
  assert.equal(overview(ctx).devices[0].appliedVersion, 2);
  heartbeat(device.deviceSecret);
  assert.equal(overview(ctx).devices[0].health, null, "a later legacy check-in is unverified, even after earlier success");
});

test("health cannot acknowledge enabled daily limits without a usage selection, and off must be explicit", () => {
  const ctx = setup();
  turnOn(ctx, { limits: [{ kind: "total", name: "Screen time", minutesPerDay: 90 }] });
  const device = enroll(ctx).body;
  heartbeat(device.deviceSecret, "approved", { health: health({ hasUsageSelection: false }) });
  assert.equal(overview(ctx).devices[0].appliedVersion, 0);
  heartbeat(device.deviceSecret, "approved", { health: health({ state: "off" }) });
  assert.equal(overview(ctx).devices[0].appliedVersion, 0);
  turnOff(ctx);
  heartbeat(device.deviceSecret, "approved", { appliedVersion: 2, health: health({ policyVersion: 2, state: "off", hasUsageSelection: false }) });
  assert.equal(overview(ctx).devices[0].appliedVersion, 2);
});

test("check protection is a scoped parent request, pings but does not fabricate health", async () => {
  const ctx = setup();
  enroll(ctx);
  pinged.length = 0;
  const route = "POST /api/screen-time/kids/:kidId/check";
  assert.equal(call(route, { user: ctx.kidUser, params: { kidId: ctx.mia.id } }).statusCode, 403);
  assert.equal(call(route, { user: setup().parent, params: { kidId: ctx.mia.id } }).statusCode, 404);
  const checked = call(route, { user: ctx.parent, params: { kidId: ctx.mia.id } });
  assert.equal(checked.statusCode, 200);
  assert.equal(checked.headers["Cache-Control"], "no-store");
  assert.equal(checked.body.devices[0].health, null);
  await new Promise(setImmediate);
  assert.equal(pinged.length, 1);
});

test("essential proposals remain pending until matching parent approval, stay device local and leak no token", async () => {
  const ctx = setup();
  turnOn(ctx);
  const a = enroll(ctx).body;
  const b = enroll(ctx, { label: "iPad" }).body;
  const proposed = propose(ctx, a);
  assert.equal(proposed.statusCode, 200);
  const pending = proposed.body.policy.essentialApps.pending;
  assert.equal(proposed.body.policy.essentialApps.selection, null, "proposal has no enforcement effect");
  assert.equal(pending.note, "For school");
  assert.equal(pending.requestedAt, clock.toISOString());
  assert.ok(!JSON.stringify(overview(ctx)).includes("RU5DT0RFRA=="), "parent only sees summary and note");
  assert.ok(!JSON.stringify(pending).includes("selection"), "even device pending metadata omits its token");
  const second = propose(ctx, a, { selection: "TkVX", summary: { apps: 1 } });
  assert.notEqual(second.body.policy.essentialApps.pending.id, pending.id);
  assert.equal(essentialDecision(ctx, a, "approve", pending.id).statusCode, 409, "replaced proposal cannot be approved");
  assert.equal(overview(ctx).policy.version, 1);
  pinged.length = 0;
  const approved = essentialDecision(ctx, a, "approve", second.body.policy.essentialApps.pending.id);
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.policy.version, 2);
  assert.equal(approved.body.devices.find((d) => d.id === a.deviceId).essentialApps.selection, null);
  assert.deepEqual(approved.body.devices.find((d) => d.id === a.deviceId).essentialApps.summary, { apps: 1, categories: 0, webDomains: 0 });
  assert.equal(heartbeat(a.deviceSecret).body.policy.essentialApps.selection, "TkVX");
  assert.equal(heartbeat(b.deviceSecret).body.policy.essentialApps.selection, null, "other device has no exception");
  assert.equal(call("GET /api/screen-time/mine", { user: ctx.kidUser }).body.policy.essentialApps.selection, null, "kid session is not a device credential");
  assert.equal(essentialDecision(ctx, a, "approve", second.body.policy.essentialApps.pending.id).statusCode, 409, "consumed approval is not replayed");
  await new Promise(setImmediate);
  assert.equal(pinged.length, 2, "approval pings current devices");
});

test("essential decline preserves old approval; explicit parent removal clears approved and pending", () => {
  const ctx = setup();
  const device = enroll(ctx).body;
  const first = propose(ctx, device).body.policy.essentialApps.pending;
  essentialDecision(ctx, device, "approve", first.id);
  const next = propose(ctx, device, { selection: "TkVX" }).body.policy.essentialApps.pending;
  assert.equal(essentialDecision(ctx, device, "decline", next.id).statusCode, 200);
  assert.equal(overview(ctx).policy.version, 1, "decline does not change enforcement policy");
  assert.equal(heartbeat(device.deviceSecret).body.policy.essentialApps.selection, "RU5DT0RFRA==");
  assert.equal(heartbeat(device.deviceSecret).body.policy.essentialApps.pending, null);
  propose(ctx, device);
  const removed = removeEssential(ctx, device);
  assert.equal(removed.statusCode, 200);
  assert.equal(removed.body.policy.version, 2);
  assert.deepEqual(heartbeat(device.deviceSecret).body.policy.essentialApps, { selection: null, summary: null, pending: null });
});

test("essential mutation boundaries reject categories, websites, malformed blobs, notes and non-parent decisions", () => {
  const ctx = setup();
  const device = enroll(ctx).body;
  const bad = [
    { summary: { apps: 0 } }, { summary: { apps: 51 } }, { summary: { apps: 1, categories: 1 } },
    { summary: { apps: 1, webDomains: 1 } }, { summary: { apps: 1.5 } },
    { selection: null }, { selection: "" }, { selection: "not base64!" }, { selection: "eA==".repeat(17000) },
    { note: "a".repeat(81) }, { note: {} },
  ];
  for (const value of bad) assert.equal(propose(ctx, device, value).statusCode, 400);
  assert.equal(overview(ctx).devices[0].essentialApps.pending, null);
  assert.equal(call("PUT /api/screen-time/device/essential-apps", { user: ctx.kidUser }).statusCode, 401);
  const pending = propose(ctx, device).body.policy.essentialApps.pending;
  for (const decision of ["approve", "decline"]) {
    assert.equal(essentialDecision(ctx, device, decision, pending.id, ctx.kidUser).statusCode, 403);
    assert.equal(essentialDecision(ctx, device, decision, pending.id, setup().parent).statusCode, 404);
    assert.equal(essentialDecision(ctx, device, decision, pending.id, ctx.parent, ctx.leo.id).statusCode, 404);
    assert.equal(essentialDecision(ctx, device, decision, null).statusCode, 400);
  }
  assert.equal(removeEssential(ctx, device, ctx.kidUser).statusCode, 403);
  assert.equal(removeEssential(ctx, device, setup().parent).statusCode, 404);
});

test("assignment generations reject old evidence and drafts after move; returning a device cannot revive old usage", () => {
  const ctx = setup();
  turnOn(ctx);
  const device = enroll(ctx).body;
  assert.equal(device.assignmentGeneration, 1);
  heartbeat(device.deviceSecret, "approved", { assignmentGeneration: 1, health: health(), usage: { date: TODAY, minutes: 90 } });
  const pending = propose(ctx, device).body.policy.essentialApps.pending;
  essentialDecision(ctx, device, "approve", pending.id);
  moveDeviceCall(ctx, device.deviceId, ctx.leo.id);
  const before = call("GET /api/screen-time", { user: ctx.parent }).body.kids.find((k) => k.kidId === ctx.leo.id).devices[0];
  assert.equal(before.assignmentGeneration, 2);
  assert.equal(before.health, null);
  assert.equal(before.essentialApps.summary, null);
  for (const generation of [undefined, 1, 3]) {
    const response = heartbeat(device.deviceSecret, "denied", { assignmentGeneration: generation, health: health(), usage: { date: TODAY, minutes: 120 } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.assignmentGeneration, 2);
    assert.equal(response.body.kidId, ctx.leo.id);
  }
  const after = call("GET /api/screen-time", { user: ctx.parent }).body.kids.find((k) => k.kidId === ctx.leo.id).devices[0];
  assert.deepEqual(after, before, "mismatched generation records no auth, health, appliedVersion or check-in evidence");
  assert.equal(call("GET /api/screen-time/kids/:kidId/usage", { user: ctx.parent, params: { kidId: ctx.leo.id }, query: { days: 1 } }).body.days[0].minutes, null);
  assert.equal(propose(ctx, device).statusCode, 409);
  assert.equal(propose(ctx, device, { assignmentGeneration: 1 }).statusCode, 409);
  assert.equal(propose(ctx, device, { assignmentGeneration: 2 }).statusCode, 200);
  assert.equal(saveAgreement(device.deviceSecret, dealBody({ assignmentGeneration: 1 })).statusCode, 409);
  assert.equal(call("PUT /api/screen-time/device/limits/:limitId/selection", { auth: `FamDevice ${device.deviceSecret}`, params: { limitId: "total" }, body: { assignmentGeneration: 1, selection: null } }).statusCode, 409);
  call("POST /api/screen-time/kids/:kidId/devices/:deviceId/move", { user: ctx.parent, params: { kidId: ctx.leo.id, deviceId: device.deviceId }, body: { toKidId: ctx.mia.id } });
  assert.equal(heartbeat(device.deviceSecret).body.assignmentGeneration, 3);
  let today = usageQuery(ctx, 1).body.days[0];
  assert.equal(today.devices.find((d) => d.label === "iPhone").minutes, null, "old assignment does not populate current device");
  heartbeat(device.deviceSecret, "approved", { assignmentGeneration: 3, appliedVersion: 2, usage: { date: TODAY, minutes: 15 } });
  today = usageQuery(ctx, 1).body.days[0];
  assert.equal(today.devices.find((d) => d.label === "iPhone").minutes, 15, "new assignment starts at its own counter");
  assert.equal(today.devices.find((d) => d.label === "Removed device").minutes, 90, "prior child's history remains separate");
  assert.equal(new Set(today.devices.map((d) => d.deviceId)).size, today.devices.length, "archived and current assignments have distinct row identities");
});

test("re-enrollment increments generation, clears exceptions and rejects old approval even with the same id", () => {
  const ctx = setup();
  const device = enroll(ctx, { installKey: "same_device_install_key" }).body;
  const first = propose(ctx, device).body.policy.essentialApps.pending;
  essentialDecision(ctx, device, "approve", first.id);
  const waiting = propose(ctx, device).body.policy.essentialApps.pending;
  const reenrolled = enroll(ctx, { installKey: "same_device_install_key" }).body;
  assert.equal(reenrolled.deviceId, device.deviceId);
  assert.equal(reenrolled.assignmentGeneration, 2);
  assert.deepEqual(reenrolled.policy.essentialApps, { selection: null, summary: null, pending: null });
  assert.equal(essentialDecision(ctx, reenrolled, "approve", waiting.id).statusCode, 409);
  assert.equal(heartbeat(device.deviceSecret).statusCode, 401);
  assert.equal(propose(ctx, reenrolled, { assignmentGeneration: 2 }).statusCode, 200);
  assert.equal(propose(ctx, reenrolled, { assignmentGeneration: "2" }).statusCode, 400);
});

test("usage exposes unknown devices, per-device remaining and recorded historical allowance", () => {
  const ctx = setup();
  putPolicy(ctx, { enabled: true, limits: [{ kind: "total", name: "Screen time", minutesPerDay: 90, weekendMinutes: 150 }], downtime: [] });
  const a = enroll(ctx).body;
  const b = enroll(ctx, { label: "iPad" }).body;
  let today = usageQuery(ctx, 1).body.days[0];
  assert.equal(today.devices.length, 2);
  assert.ok(today.devices.every((d) => d.minutes === null && d.remainingMinutes === null && d.updatedAt === null));
  const allowance = isWeekendStr(TODAY) ? 150 : 90;
  heartbeat(a.deviceSecret, "approved", { usage: { date: TODAY, minutes: 30 } });
  today = usageQuery(ctx, 1).body.days[0];
  const known = today.devices.find((d) => d.deviceId === a.deviceId);
  assert.equal(known.updatedAt, clock.toISOString());
  assert.equal(known.limitMinutes, allowance);
  assert.equal(known.remainingMinutes, allowance - 30);
  assert.equal(today.devices.find((d) => d.deviceId === b.deviceId).minutes, null);
  putPolicy(ctx, { enabled: true, limits: [{ kind: "total", name: "Screen time", minutesPerDay: 15, weekendMinutes: 30 }], downtime: [] });
  today = usageQuery(ctx, 1).body.days[0];
  assert.equal(today.devices.find((d) => d.deviceId === a.deviceId).limitMinutes, allowance, "planned policy is not yet the reported allowance");
  assert.equal(today.devices.find((d) => d.deviceId === a.deviceId).remainingMinutes, allowance - 30, "delayed apply does not fabricate a new remaining value");
  heartbeat(a.deviceSecret, "approved", { appliedVersion: 1, usage: { date: TODAY, minutes: 45 } });
  assert.equal(usageQuery(ctx, 1).body.days[0].devices.find((d) => d.deviceId === a.deviceId).limitMinutes, allowance, "old version reports retain recorded allowance");
  const savedClock = clock;
  try {
    clock = new Date(clock.getTime() + 86400000);
    putPolicy(ctx, { enabled: true, limits: [{ kind: "total", name: "Screen time", minutesPerDay: 15, weekendMinutes: 30 }], downtime: [] });
    const prior = usageQuery(ctx, 2).body.days[1];
    assert.equal(prior.limitMinutes, allowance, "new policy does not recompute old allowance");
    assert.equal(prior.devices[0].remainingMinutes, allowance - 45);
    const rows = db.load().screenTime[ctx.fam.id].kids[ctx.mia.id].usage[TODAY];
    delete rows[a.deviceId].limitMinutes; // pre-upgrade stored report
    assert.equal(usageQuery(ctx, 2).body.days[1].limitMinutes, null, "legacy historic allowance stays unknown");
    assert.equal(usageQuery(ctx, 2).body.days[1].devices[0].remainingMinutes, null);
  } finally { clock = savedClock; }
});

test("downtime validation enforces Apple's 15-minute minimum including across midnight", () => {
  const ctx = setup();
  const save = (start, end) => putPolicy(ctx, { enabled: true, limits: [], downtime: [{ name: "Break", start, end, days: [1] }] });
  assert.equal(save("09:00", "09:14").statusCode, 400);
  assert.equal(save("23:55", "00:09").statusCode, 400);
  assert.equal(save("09:00", "09:15").statusCode, 200);
  assert.equal(save("23:55", "00:10").statusCode, 200);
});

test("one neutral reminder per continuous uncertain episode, reset only by confirmed recovery or off", async () => {
  const ctx = setup();
  turnOn(ctx);
  const enrolled = enroll(ctx, { pushToken: null }).body;
  const device = db.load().screenTime[ctx.fam.id].kids[ctx.mia.id].devices[0];
  const saved = clock;
  const atHour = (hours) => { clock = new Date(saved.getTime() + hours * 3600000); };
  const reminders = () => overview(ctx).alerts.filter((a) => a.type === "check_needed");
  const reminderPushes = () => notified.filter((n) => n.kidId === ctx.mia.id && n.type === "check_needed");
  try {
    heartbeat(enrolled.deviceSecret, "approved", { health: health() });
    atHour(1);
    heartbeat(enrolled.deviceSecret, "notDetermined");
    atHour(24.9);
    heartbeat(enrolled.deviceSecret, "notDetermined", { source: "monitor" });
    await screenTime.sweep();
    assert.equal(reminders().length, 0, "no reminder before 24h of uncertainty");
    atHour(25);
    heartbeat(enrolled.deviceSecret, "notDetermined", { source: "monitor" });
    assert.equal(reminders().length, 1, "exactly 24h is due even with recent unknown heartbeats");
    assert.equal(reminderPushes().length, 1);
    assert.doesNotMatch(reminders()[0].message, /turned off|removed|back on|✅/);
    ackOne(ctx, reminders()[0].id);
    atHour(30);
    await screenTime.sweep();
    atHour(35);
    heartbeat(enrolled.deviceSecret, "approved", { health: health({ state: "failed", registeredActivities: 0, failures: ["activity_registration_failed"] }) });
    await screenTime.sweep();
    assert.equal(reminders().length, 1, "acknowledgement or failed health cannot restart or re-send the episode");
    assert.ok(device.uncertainSince && device.checkReminderAt);
    atHour(36);
    heartbeat(enrolled.deviceSecret, "denied");
    atHour(37);
    heartbeat(enrolled.deviceSecret, "approved");
    atHour(38);
    heartbeat(enrolled.deviceSecret, "denied");
    assert.equal(notified.filter((n) => n.kidId === ctx.mia.id && n.type === "revoked").length, 1, "permission oscillation during unverified recovery does not repeat the loss alert");
    atHour(40);
    heartbeat(enrolled.deviceSecret, "approved", { health: health() });
    assert.equal(device.uncertainSince, undefined);
    assert.equal(device.checkReminderAt, undefined);
    assert.ok(reminders()[0].ackedAt);
    atHour(41);
    heartbeat(enrolled.deviceSecret, "notDetermined");
    atHour(65);
    await screenTime.sweep();
    assert.equal(reminders().length, 2, "a confirmed recovery permits a new episode");
    atHour(66);
    turnOff(ctx);
    assert.equal(device.uncertainSince, undefined);
    assert.equal(device.checkReminderAt, undefined);
    atHour(100);
    await screenTime.sweep();
    assert.equal(reminders().length, 2, "policy off suppresses reminders");
    atHour(101);
    turnOn(ctx);
    atHour(124.9);
    await screenTime.sweep();
    assert.equal(reminders().length, 2, "enable starts a fresh reminder window without forging lastSeenAt");
    atHour(125);
    await screenTime.sweep();
    assert.equal(reminders().length, 3);
    assert.equal(reminderPushes().length, 3);
  } finally { clock = saved; }
});

test("approved access with failed or missing health never resolves an uncertainty reminder or claims protection restored", async () => {
  const ctx = setup();
  turnOn(ctx);
  const { deviceSecret } = enroll(ctx, { pushToken: null }).body;
  const saved = clock;
  try {
    clock = new Date(saved.getTime() + 24 * 3600000);
    await screenTime.sweep();
    heartbeat(deviceSecret, "denied");
    heartbeat(deviceSecret, "approved", { health: health({ state: "failed", registeredActivities: 0, failures: ["activity_registration_failed"] }) });
    let kid = overview(ctx);
    assert.equal(kid.devices[0].appliedVersion, 0);
    assert.equal(kid.devices[0].health.state, "failed");
    assert.equal(kid.alerts.find((a) => a.type === "check_needed").ackedAt, null);
    assert.equal(kid.alerts.find((a) => a.type === "revoked").ackedAt, null);
    const restored = kid.alerts.filter((a) => a.type === "restored");
    assert.equal(restored.length, 1);
    assert.match(restored[0].message, /access restored.*checking rules/);
    assert.doesNotMatch(restored[0].message, /back on|protection restored|✅/);
    heartbeat(deviceSecret, "approved");
    kid = overview(ctx);
    assert.equal(kid.devices[0].health, null);
    assert.equal(kid.alerts.find((a) => a.type === "check_needed").ackedAt, null);
    heartbeat(deviceSecret, "approved", { health: health() });
    assert.equal(overview(ctx).alerts.find((a) => a.type === "check_needed").ackedAt, clock.toISOString());
  } finally { clock = saved; }
});

test("legacy false revocation/removal and actor-attributed wording are corrected on parent read without push", () => {
  const ctx = setup();
  turnOn(ctx);
  const a = enroll(ctx).body;
  const b = enroll(ctx, { label: "iPad" }).body;
  const entry = db.load().screenTime[ctx.fam.id].kids[ctx.mia.id];
  const old = entry.devices.find((d) => d.id === a.deviceId);
  delete old.evidenceVersion;
  Object.assign(old, { state: "revoked", authStatus: "notDetermined", authUnknownSince: clock.toISOString(), health: health() });
  const removed = entry.devices.find((d) => d.id === b.deviceId);
  delete removed.evidenceVersion;
  removed.state = "removed";
  entry.alerts = [
    { id: "old_unknown", deviceId: a.deviceId, type: "revoked", message: "Mia turned off Screen Time on iPhone", at: clock.toISOString(), ackedAt: null },
    { id: "old_removed", deviceId: b.deviceId, type: "removed", message: "Fam ETC may have been removed", at: clock.toISOString(), ackedAt: null },
    { id: "old_restored", deviceId: a.deviceId, type: "restored", message: "✅ Screen Time is back on", at: clock.toISOString(), ackedAt: clock.toISOString() },
    { id: "old_selection", deviceId: a.deviceId, type: "selection_changed", message: "Mia changed the apps", at: clock.toISOString(), ackedAt: null },
  ];
  const beforePushes = miaPushes(ctx).length;
  const state = overview(ctx);
  assert.equal(state.devices[0].authStatus, "notDetermined");
  assert.equal(state.devices[0].state, "unknown");
  assert.equal(state.devices[0].health, null);
  assert.equal(state.devices[1].state, "unknown");
  assert.equal(state.alerts.find((a) => a.id === "old_unknown").type, "check_needed");
  assert.ok(state.alerts.find((a) => a.id === "old_unknown").ackedAt);
  assert.equal(state.alerts.find((a) => a.id === "old_removed").type, "check_needed");
  assert.doesNotMatch(JSON.stringify(state.alerts), /Mia turned off|Mia changed|may have been removed|back on|✅/);
  assert.deepEqual(overview(ctx), state, "migration is idempotent");
  assert.equal(miaPushes(ctx).length, beforePushes);
});

test("clearing a prior device selection alerts neutrally, repeated clearing and first selection do not", () => {
  const ctx = setup();
  const limitId = turnOn(ctx, { limits: [limit()] }).body.policy.limits[0].id;
  const device = enroll(ctx).body;
  const upload = (selection) => call("PUT /api/screen-time/device/limits/:limitId/selection", {
    auth: `FamDevice ${device.deviceSecret}`, params: { limitId }, body: { selection, summary: { apps: 1 } },
  });
  upload(null);
  upload("QUJD");
  upload("QUJD");
  assert.equal(overview(ctx).alerts.length, 0);
  upload(null);
  assert.equal(overview(ctx).alerts.length, 1);
  assert.equal(overview(ctx).alerts[0].type, "selection_changed");
  assert.doesNotMatch(overview(ctx).alerts[0].message, /Mia changed|turned off|tamper/);
  upload(null);
  assert.equal(overview(ctx).alerts.length, 1);
});

test("assignment/re-enrollment starts a new reminder window without inherited countdown or sent flags", async () => {
  const ctx = setup();
  turnOn(ctx);
  call("PUT /api/screen-time/kids/:kidId/policy", { user: ctx.parent, params: { kidId: ctx.leo.id }, body: { enabled: true, limits: [], downtime: [] } });
  const first = enroll(ctx, { installKey: "reminder_device_install_key", pushToken: null }).body;
  const saved = clock;
  try {
    clock = new Date(saved.getTime() + 25 * 3600000);
    await screenTime.sweep();
    const original = db.load().screenTime[ctx.fam.id].kids[ctx.mia.id].devices[0];
    assert.ok(original.checkReminderAt);
    moveDeviceCall(ctx, first.deviceId, ctx.leo.id);
    const moved = db.load().screenTime[ctx.fam.id].kids[ctx.leo.id].devices[0];
    assert.equal(moved.checkReminderAt, undefined);
    assert.equal(moved.uncertainSince, clock.toISOString());
    clock = new Date(saved.getTime() + 48 * 3600000);
    await screenTime.sweep();
    assert.equal(db.load().screenTime[ctx.fam.id].kids[ctx.leo.id].alerts.filter((a) => a.type === "check_needed").length, 0);
    clock = new Date(saved.getTime() + 50 * 3600000);
    call("POST /api/screen-time/kids/:kidId/devices/:deviceId/move", { user: ctx.parent, params: { kidId: ctx.leo.id, deviceId: first.deviceId }, body: { toKidId: ctx.mia.id } });
    const reenrolled = enroll(ctx, { installKey: "reminder_device_install_key", pushToken: null });
    assert.equal(reenrolled.statusCode, 200);
    assert.equal(original.checkReminderAt, undefined);
    assert.equal(original.uncertainSince, clock.toISOString());
    clock = new Date(saved.getTime() + 73 * 3600000);
    await screenTime.sweep();
    assert.equal(overview(ctx).alerts.filter((a) => a.type === "check_needed").length, 1, "only the old acknowledged reminder remains");
  } finally { clock = saved; }
});

test("an old APNs rejection cannot prune a refreshed token, moved assignment or re-enrolled device", async () => {
  for (const mutation of ["token", "move", "reenroll"]) {
    const ctx = setup();
    turnOn(ctx);
    const first = enroll(ctx, { installKey: "apns_race_device_install_key", pushToken: crypto.randomBytes(32).toString("hex") }).body;
    const entry = db.load().screenTime[ctx.fam.id].kids[ctx.mia.id];
    const device = entry.devices[0];
    const token = device.pushToken;
    let finish;
    let started;
    const start = new Promise((resolve) => { started = resolve; });
    const pending = screenTime.sweep({ sendPing: (value) => value === token ? (started(), new Promise((resolve) => { finish = resolve; })) : Promise.resolve({ ok: true }) });
    await start;
    if (mutation === "token") heartbeat(first.deviceSecret, "approved", { pushToken: "cd".repeat(32) });
    else if (mutation === "move") moveDeviceCall(ctx, first.deviceId, ctx.leo.id);
    else enroll(ctx, { installKey: "apns_race_device_install_key", pushToken: token });
    const expectedToken = device.pushToken;
    finish({ ok: false, shouldPruneToken: true });
    await pending;
    assert.equal(device.pushToken, expectedToken, mutation);
    assert.notEqual(device.state, "removed");
    assert.ok(entry.alerts.every((a) => a.type !== "removed"));
  }
});

test("pending extra-time approval requires an enabled total limit and conserves balance/ledger until valid", () => {
  for (const unavailable of ["off", "total_removed"]) {
    const ctx = setup();
    totalPolicy(ctx);
    giveFams(ctx, 20);
    const request = ask(ctx, { minutes: 30 }).body.request;
    const snapshot = structuredClone(db.load().fams[ctx.fam.id][ctx.mia.id]);
    if (unavailable === "off") putPolicy(ctx, { enabled: false, limits: overview(ctx).policy.limits, downtime: [] });
    else putPolicy(ctx, { enabled: true, limits: [limit()], downtime: [] });
    const before = structuredClone(overview(ctx));
    assert.equal(decide(ctx, request.id, "approve").statusCode, 409, unavailable);
    assert.equal(balance(ctx), 20);
    assert.deepEqual(db.load().fams[ctx.fam.id][ctx.mia.id], snapshot, "no debit or consumed ledger event");
    assert.deepEqual(overview(ctx).requests[0], before.requests[0], "request stays pending without decision metadata");
    assert.equal(overview(ctx).policy.version, before.policy.version);
    assert.equal(overview(ctx).policy.bonus, null);
    totalPolicy(ctx);
    assert.equal(decide(ctx, request.id, "approve").statusCode, 200);
    assert.equal(balance(ctx), 10);
    const debited = structuredClone(db.load().fams[ctx.fam.id][ctx.mia.id]);
    turnOff(ctx);
    assert.equal(decide(ctx, request.id, "approve").statusCode, 200, "already-approved replay remains idempotent even after disabling");
    assert.deepEqual(db.load().fams[ctx.fam.id][ctx.mia.id], debited);
    assert.equal(db.load().fams[ctx.fam.id][ctx.mia.id].transactions.filter((t) => t.event === `screen_time:${request.id}`).length, 1);
    totalPolicy(ctx);
    const decline = ask(ctx).body.request;
    turnOff(ctx);
    assert.equal(decide(ctx, decline.id, "decline").statusCode, 200, "decline remains available while off");
    assert.equal(balance(ctx), 10);
  }
});

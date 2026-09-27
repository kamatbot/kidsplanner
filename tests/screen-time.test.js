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
const routesModule = require("../lib/routes/screen-time");

let clock = new Date("2026-09-27T08:00:00Z");
const notified = [];
const pinged = [];
screenTime.configure({
  now: () => clock,
  notify: (args) => { notified.push(args); return Promise.resolve(); },
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

function call(route, { user, body, params, auth } = {}) {
  const res = {
    statusCode: 200, body: null, headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.done = true; return this; },
  };
  const req = { user, body: body || {}, params: params || {}, get: (h) => (h.toLowerCase() === "authorization" ? auth : undefined) };
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
    assert.deepEqual({ ...k.policy, updatedAt: undefined }, { version: 0, enabled: false, updatedAt: undefined, limits: [], downtime: [], pauseUntil: null });
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

  const parentJSON = JSON.stringify(call("GET /api/screen-time", { user: ctx.parent }).body);
  const hash = crypto.createHash("sha256").update(deviceSecret).digest("hex");
  assert.ok(!parentJSON.includes(deviceSecret) && !parentJSON.includes(hash) && !parentJSON.includes("ab".repeat(32)), "parent view leaks no secret/hash/token");
  const dbJSON = JSON.stringify(db.load().screenTime);
  assert.ok(!dbJSON.includes(deviceSecret), "raw secret is never stored");
  assert.ok(dbJSON.includes(hash), "only the SHA-256 hash is stored");
  assert.deepEqual(Object.keys(overview(ctx).devices[0]).sort(), ["appliedVersion", "authStatus", "enrolledAt", "id", "label", "lastSeenAt", "mode", "state"]);
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
  const { deviceSecret } = enroll(ctx).body;
  notified.length = 0;
  assert.equal(heartbeat(deviceSecret, "denied").statusCode, 200);
  heartbeat(deviceSecret, "denied");
  heartbeat(deviceSecret, "notDetermined");
  let kid = overview(ctx);
  assert.equal(kid.devices[0].state, "revoked");
  assert.deepEqual(kid.alerts.map((a) => a.type), ["revoked"]);
  assert.equal(kid.alerts[0].message, "Mia turned off Screen Time on iPhone");
  assert.equal(notified.length, 1);
  assert.equal(notified[0].type, "revoked");
  assert.equal(notified[0].title, "⚠️ Screen Time turned off");
  assert.deepEqual(notified[0].familyParentIds, [ctx.parent.id]);

  heartbeat(deviceSecret, "approved");
  kid = overview(ctx);
  assert.equal(kid.devices[0].state, "ok");
  assert.deepEqual(kid.alerts.map((a) => a.type), ["restored", "revoked"]);
  assert.equal(kid.alerts[0].message, "Screen Time is back on for Mia's iPhone");
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
  assert.equal(notified.length, 0, "same counts do not alert");
  upload("REVWSUNH", 2);
  const after = overview(ctx);
  assert.deepEqual(after.alerts.map((x) => x.type), ["selection_changed"]);
  assert.equal(after.alerts[0].message, "Mia changed the apps in Games (1 app → 2 apps)");
  assert.equal(notified.length, 1);
  assert.equal(call("PUT /api/screen-time/device/limits/:limitId/selection", { auth: `FamDevice ${a.deviceSecret}`, params: { limitId: "lim_nope" }, body: { selection: null } }).statusCode, 404);
});

test("sweep marks silent devices stale once, and a heartbeat restores without push", async () => {
  const ctx = setup();
  const { deviceSecret } = enroll(ctx, { pushToken: null }).body;
  notified.length = 0;
  const t0 = clock;
  await screenTime.sweep({ now: new Date(t0.getTime() + 23 * 3600000) });
  assert.equal(overview(ctx).devices[0].state, "ok");
  await screenTime.sweep({ now: new Date(t0.getTime() + 25 * 3600000) });
  await screenTime.sweep({ now: new Date(t0.getTime() + 30 * 3600000) });
  const kid = overview(ctx);
  assert.equal(kid.devices[0].state, "stale");
  assert.deepEqual(kid.alerts.map((a) => a.type), ["stale"]);
  assert.match(kid.alerts[0].message, /^Mia's iPhone hasn't checked in since .+ — it may be off, offline, or Screen Time was turned off$/);
  assert.equal(notified.filter((n) => n.kidId === ctx.mia.id).length, 1);

  heartbeat(deviceSecret);
  assert.equal(overview(ctx).devices[0].state, "ok");
  assert.equal(overview(ctx).alerts[0].type, "restored");
  assert.equal(notified.filter((n) => n.kidId === ctx.mia.id).length, 1, "stale recovery does not push");
});

test("sweep ping with shouldPruneToken marks the device removed", async () => {
  const ctx = setup();
  const token = crypto.randomBytes(32).toString("hex");
  enroll(ctx, { pushToken: token });
  notified.length = 0;
  const seen = [];
  const sendPing = (t, famType) => { seen.push(famType); return Promise.resolve(t === token ? { ok: false, shouldPruneToken: true } : { ok: true }); };
  await screenTime.sweep({ now: new Date(clock.getTime() + 60000), sendPing });
  assert.ok(seen.includes("screen_time_ping"));
  const kid = overview(ctx);
  assert.equal(kid.devices[0].state, "removed");
  assert.equal(kid.alerts[0].type, "removed");
  assert.equal(kid.alerts[0].message, "Fam ETC may have been removed from Mia's iPhone");
  assert.equal(notified.filter((n) => n.kidId === ctx.mia.id && n.type === "removed").length, 1);
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
  const { deviceSecret } = enroll(ctx).body;
  for (let i = 0; i < 30; i++) {
    heartbeat(deviceSecret, "denied");
    heartbeat(deviceSecret, "approved");
  }
  const alerts = overview(ctx).alerts;
  assert.equal(alerts.length, screenTime.MAX_ALERTS);
  assert.equal(alerts[0].type, "restored", "newest first");
});

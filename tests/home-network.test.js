"use strict";
/*
 * Home Wi-Fi agent (Canopy): parent pairing code → agent token, the policy the
 * agent enforces at home (pause, allowance, extra time, projected bedtime
 * incl. tonight's exception), usage reports, unpair. Stub req/res, no HTTP.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-home-"));

const store = require("../lib/store");
const family = require("../lib/family");
const screenTime = require("../lib/screen-time");
const homeNetwork = require("../lib/home-network");
const stRoutes = require("../lib/routes/screen-time");
const hnRoutes = require("../lib/routes/home-network");

let clock = new Date("2026-09-27T08:00:00Z"); // Sunday 15:00 Bangkok
screenTime.configure({
  now: () => clock,
  notify: () => Promise.resolve(), notifyRequest: () => Promise.resolve(), notifyResult: () => Promise.resolve(),
  sendPing: () => Promise.resolve({ ok: true }),
});
homeNetwork.configure({ now: () => clock });

const userRole = (u) => (u && u.data && u.data.profile && u.data.profile.role) || "parent";
const routes = {};
const register = (method) => (p, ...handlers) => { routes[`${method} ${p}`] = handlers; };
const app = { get: register("GET"), post: register("POST"), put: register("PUT"), delete: register("DELETE") };
const deps = {
  screenTime, homeNetwork,
  requireAuth: (req, res, next) => next(),
  requireParent: (req, res, next) => (userRole(req.user) === "kid" ? res.status(403).json({ error: "Parents only." }) : next()),
  requireFamily: (req, res, next) => {
    req.family = userRole(req.user) === "kid" ? family.familyForKidUser(req.user) : family.familiesForUser(req.user.id)[0];
    next();
  },
  authLimiter: (req, res, next) => next(),
  rateLimit: () => (req, res, next) => next(),
  userRole,
  kidIdForUser: (req) => req.user && req.user.data && req.user.data.kid && req.user.data.kid.kidId,
};
stRoutes(app, deps);
hnRoutes(app, deps);

function call(route, { user, body, params, auth, headers } = {}) {
  const res = {
    statusCode: 200, body: null, headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  const h = { authorization: auth, ...(headers || {}) };
  const req = { user, body: body || {}, params: params || {}, query: {}, get: (k) => h[k.toLowerCase()] };
  for (const handler of routes[route]) {
    let next = false;
    handler(req, res, () => { next = true; });
    if (!next) break;
  }
  return res;
}

function setup() {
  const parent = store.createUser(`p${crypto.randomUUID()}@example.com`, "Kate");
  const fam = family.createFamily(parent.id, "Walkers", { plan: "full", timezone: "Asia/Bangkok" });
  const mia = family.addKid(fam.id, parent.id, { name: "Mia" }).kid;
  const leo = family.addKid(fam.id, parent.id, { name: "Leo" }).kid;
  return { parent, fam, mia, leo };
}
function pair(ctx) {
  const code = call("POST /api/home-network/pairing", { user: ctx.parent }).body.code;
  const res = call("POST /api/home-network/claim", { body: { code, name: "Canopy on Mac Studio", version: "1.1.0" } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}

test("pairing: one-time code becomes a FamHome token; reused or wrong codes fail", () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const ctx = setup();
  assert.equal(call("GET /api/home-network", { user: ctx.parent }).body.agent, null);
  const p = call("POST /api/home-network/pairing", { user: ctx.parent }).body;
  assert.match(p.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.ok(call("GET /api/home-network", { user: ctx.parent }).body.pairing);

  assert.equal(call("POST /api/home-network/claim", { body: { code: "AAAA-AAAA" } }).statusCode, 400);
  const ok = call("POST /api/home-network/claim", { body: { code: p.code.toLowerCase(), name: "Canopy" } });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.body.token, /^fhn_[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(ok.body.kids.map((k) => k.name), ["Mia", "Leo"]);
  assert.equal(call("POST /api/home-network/claim", { body: { code: p.code } }).statusCode, 400, "code is single-use");

  const st = call("GET /api/home-network", { user: ctx.parent }).body;
  assert.equal(st.agent.name, "Canopy");
  assert.equal(st.agent.online, true);
  assert.equal(st.pairing, null);
  assert.equal(JSON.stringify(st).includes(ok.body.token), false, "token never shown to parents");
});

test("pairing codes expire after 10 minutes", () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const ctx = setup();
  const code = call("POST /api/home-network/pairing", { user: ctx.parent }).body.code;
  clock = new Date(clock.getTime() + homeNetwork.PAIRING_TTL_MS + 1000);
  assert.equal(call("POST /api/home-network/claim", { body: { code } }).statusCode, 400);
});

test("policy: agent gets pause, allowance, extra time and tonight's later bedtime; ETag 304", () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const ctx = setup();
  const { token } = pair(ctx);
  const auth = `FamHome ${token}`;
  assert.equal(call("GET /api/home-network/policy", { auth: "FamHome nope" }).statusCode, 401);

  let body = call("GET /api/home-network/policy", { auth }).body;
  assert.equal(body.timezone, "Asia/Bangkok");
  assert.equal(body.today, "2026-09-27");
  assert.equal(body.kids.find((k) => k.id === ctx.mia.id).enabled, false, "Screen Time off: agent leaves its own rules");

  call("PUT /api/screen-time/kids/:kidId/policy", { user: ctx.parent, params: { kidId: ctx.mia.id }, body: {
    enabled: true, limits: [{ kind: "total", name: "Screen time", minutesPerDay: 120, weekendMinutes: 180 }],
    downtime: [{ id: "bedtime", name: "Bedtime", start: "20:30", end: "07:00", days: [1, 2, 3, 4, 5, 6, 7] }],
  } });
  call("POST /api/screen-time/kids/:kidId/bonus", { user: ctx.parent, params: { kidId: ctx.mia.id }, body: { minutes: 30 } });
  call("POST /api/screen-time/kids/:kidId/bedtime", { user: ctx.parent, params: { kidId: ctx.mia.id }, body: { minutes: 30 } });
  call("POST /api/screen-time/kids/:kidId/pause", { user: ctx.parent, params: { kidId: ctx.mia.id }, body: { minutes: 60 } });

  const res = call("GET /api/home-network/policy", { auth });
  const mia = res.body.kids.find((k) => k.id === ctx.mia.id);
  assert.equal(mia.enabled, true);
  assert.deepEqual(mia.dailyLimit, { weekdayMinutes: 120, weekendMinutes: 180 });
  assert.deepEqual(mia.bonus, { date: "2026-09-27", minutes: 30 });
  assert.equal(mia.pauseUntil, "2026-09-27T09:00:00.000Z");
  assert.equal(mia.bedtimeException.until, "21:00");
  const late = mia.downtime.find((d) => d.id === "bedtime_late");
  assert.deepEqual([late.start, late.end, late.days], ["21:00", "07:00", [1]]);
  assert.equal(mia.downtime.find((d) => d.id === "bedtime").days.includes(1), false);

  const etag = res.headers.ETag;
  assert.ok(etag);
  assert.equal(call("GET /api/home-network/policy", { auth, headers: { "if-none-match": etag } }).statusCode, 304);

  // Next day: the exception and bonus drop away and the ETag changes.
  clock = new Date("2026-09-28T08:00:00Z");
  const next = call("GET /api/home-network/policy", { auth, headers: { "if-none-match": etag } });
  assert.equal(next.statusCode, 200);
  const mia2 = next.body.kids.find((k) => k.id === ctx.mia.id);
  assert.equal(mia2.bedtimeException, null);
  assert.equal(mia2.bonus, null);
  assert.equal(mia2.pauseUntil, null);
  assert.equal(mia2.downtime.some((d) => d.id === "bedtime_late"), false);
});

test("report: home usage shows in Settings and on the Screen Time overview; unpair revokes the token", () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const ctx = setup();
  const { token } = pair(ctx);
  const auth = `FamHome ${token}`;
  const r = call("POST /api/home-network/report", { auth, body: {
    date: "2026-09-27", version: "1.1.1",
    engine: { healthy: true, mode: "builtin_dns", message: "DNS listening on :53" },
    kids: [
      { kidId: ctx.mia.id, usedMinutes: 85, blocked: 12, devices: 2, topApps: [{ name: "Roblox", minutes: 40 }, { name: "YouTube", count: 300 }] },
      { kidId: "not-ours", usedMinutes: 5 },
    ],
  } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.accepted, 1);

  const st = call("GET /api/home-network", { user: ctx.parent }).body;
  assert.equal(st.agent.version, "1.1.1");
  assert.equal(st.agent.engine.healthy, true);
  assert.equal(st.usage[ctx.mia.id].usedMinutes, 85);
  assert.deepEqual(st.usage[ctx.mia.id].topApps[0], { name: "Roblox", minutes: 40, count: null });
  const overview = call("GET /api/screen-time", { user: ctx.parent }).body;
  assert.equal(overview.homeNetwork.usage[ctx.mia.id].usedMinutes, 85);

  assert.equal(call("POST /api/home-network/report", { auth, body: { date: "bad", kids: [] } }).statusCode, 400);

  clock = new Date("2026-09-28T08:00:00Z");
  assert.deepEqual(call("GET /api/home-network", { user: ctx.parent }).body.usage, {}, "yesterday's usage isn't shown as today");

  call("DELETE /api/home-network", { user: ctx.parent });
  assert.equal(call("GET /api/home-network/policy", { auth }).statusCode, 401);
  assert.equal(call("GET /api/screen-time", { user: ctx.parent }).body.homeNetwork, null);
});

test("re-pairing replaces the old agent token; another family's token sees only its own kids", () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const a = setup();
  const b = setup();
  const first = pair(a).token;
  const second = pair(a).token;
  assert.equal(call("GET /api/home-network/policy", { auth: `FamHome ${first}` }).statusCode, 401);
  assert.equal(call("GET /api/home-network/policy", { auth: `FamHome ${second}` }).statusCode, 200);
  const other = pair(b).token;
  const ids = call("GET /api/home-network/policy", { auth: `FamHome ${other}` }).body.kids.map((k) => k.id);
  assert.deepEqual(ids, [b.mia.id, b.leo.id]);
  assert.equal(call("POST /api/home-network/pairing", { user: { ...a.parent, data: { profile: { role: "kid" } } } }).statusCode, 403);
});

test("wifi state: kid is told when home Wi-Fi is paused, changes reason, or comes back", () => {
  clock = new Date("2026-09-27T08:00:00Z");
  const ctx = setup();
  const { token } = pair(ctx);
  const auth = `FamHome ${token}`;
  const kidUser = store.createUser(`k${crypto.randomUUID()}@example.com`, "Mia");
  kidUser.data = { ...(kidUser.data || {}), profile: { role: "kid" }, kid: { familyId: ctx.fam.id, kidId: ctx.mia.id } };
  require("../lib/db").load().users[kidUser.id] = kidUser;
  const sent = [];
  homeNetwork.configure({ notify: (args) => { sent.push(args); return Promise.resolve(); } });
  const send = (wifi, kidId = ctx.mia.id) => call("POST /api/home-network/report", { auth, body: {
    date: "2026-09-27", kids: [{ kidId, usedMinutes: 10, wifi }],
  } });
  try {
    send({ status: "online", label: "Online" });
    assert.equal(sent.length, 0, "first state after pairing is only recorded");
    send({ status: "online", label: "Online" });
    assert.equal(sent.length, 0, "no change, no push");

    send({ status: "paused", label: "Dinner Time until 7:30 PM" });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].kidUserIds, [kidUser.id]);
    assert.equal(sent[0].kidId, ctx.mia.id);
    assert.equal(sent[0].status, "paused");
    assert.match(sent[0].title, /Home Wi-Fi paused/);
    assert.match(sent[0].body, /^Dinner Time until 7:30 PM\. Ask a parent/);

    send({ status: "paused", label: "Paused until 8:00 PM" });
    assert.equal(sent.length, 1, "same reason, new end time: no second push");

    send({ status: "bedtime", label: "Bedtime until 7:00 AM" });
    assert.equal(sent.length, 2);
    assert.match(sent[1].title, /Bedtime/);

    send({ status: "online", label: "Online" });
    assert.equal(sent.length, 3);
    assert.match(sent[2].title, /back on/);

    send({ status: "nonsense", label: "x" });
    assert.equal(sent.length, 3, "unknown states are ignored");

    // Leo has no kid login: nothing to send.
    send({ status: "online" }, ctx.leo.id);
    send({ status: "limit_reached", label: "Daily limit reached" }, ctx.leo.id);
    assert.equal(sent.length, 3);
  } finally {
    homeNetwork.configure({ notify: () => Promise.resolve() });
  }
});

"use strict";
/*
 * Home Wi-Fi parent layer (Features 1–4):
 *   F1: wifi.endsSoon heads-up push (kid iPhone + watch, deduped per kid+reason+localDate+at)
 *   F2: 14-day history storage + Sunday 18:00 weekly parent digest + parent push + GET endpoint + toggle
 *   F3: school/free day classification (weekends, school feeds, family events, parent no-school dates)
 *       + policy.days + ETag invalidation + school-night bedtime when tomorrow is school
 *   F4: parent safety alerts (risk/bypass/new_device), ackAlerts, calm no-URL wording,
 *       parent-only push deduped per kid+type+category+day, last 50 cap, dismiss, per-type toggles
 * Also verifies role/privacy boundaries, backward compatibility, and web UI wiring.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-parent-layer-"));

const db = require("../lib/db");
const store = require("../lib/store");
const family = require("../lib/family");
const fams = require("../lib/fams");
const events = require("../lib/events");
const schoolFeeds = require("../lib/school-feeds");
const schoolDays = require("../lib/school-days");
const screenTime = require("../lib/screen-time");
const homeNetwork = require("../lib/home-network");
const stRoutes = require("../lib/routes/screen-time");
const hnRoutes = require("../lib/routes/home-network");

let clock = new Date("2026-11-25T13:00:00Z"); // Wed Nov 25, 2026 20:00 Asia/Bangkok
const kidPushes = [];
const parentPushes = [];

screenTime.configure({
  now: () => clock,
  notify: () => Promise.resolve(),
  notifyRequest: () => Promise.resolve(),
  notifyResult: () => Promise.resolve(),
  sendPing: () => Promise.resolve({ ok: true }),
});
homeNetwork.configure({
  now: () => clock,
  notify: (args) => { kidPushes.push(args); return Promise.resolve(); },
  notifyParents: (args) => { parentPushes.push(args); return Promise.resolve(); },
});

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

function setup(tz = "Asia/Bangkok") {
  const parent = store.createUser(`p${crypto.randomUUID()}@example.com`, "Kate");
  const parent2 = store.createUser(`p2${crypto.randomUUID()}@example.com`, "Sam");
  const fam = family.createFamily(parent.id, "Walkers", { plan: "full", timezone: tz });
  fam.parentIds.push(parent2.id);
  const mia = family.addKid(fam.id, parent.id, { name: "Mia" }).kid;
  const leo = family.addKid(fam.id, parent.id, { name: "Leo" }).kid;
  const miaUser = store.findOrCreateKidUser(fam.id, mia.id, "Mia");
  return { parent, parent2, fam, mia, leo, miaUser };
}

function pair(ctx) {
  const code = call("POST /api/home-network/pairing", { user: ctx.parent }).body.code;
  const res = call("POST /api/home-network/claim", { body: { code, name: "Canopy", version: "1.2.0" } });
  assert.equal(res.statusCode, 200);
  return { ...res.body, auth: `FamHome ${res.body.token}` };
}

// ===================== Feature 1: Heads-up before Wi-Fi turns off =====================

test("F1 endsSoon: pushes kid iPhone+watch once per (kid, reason, localDate, at) with exact wording", () => {
  clock = new Date("2026-11-25T13:55:00Z"); // 20:55 Bangkok (2026-11-25)
  kidPushes.length = 0;
  parentPushes.length = 0;
  const ctx = setup();
  const { auth } = pair(ctx);

  const send = (date, endsSoon) => call("POST /api/home-network/report", {
    auth,
    body: {
      date,
      kids: [{
        kidId: ctx.mia.id,
        usedMinutes: 50,
        wifi: { status: "online", label: "Online", ...(endsSoon ? { endsSoon } : {}) },
      }],
    },
  });

  // Bedtime endsSoon at 21:00 -> fires once even as inMinutes counts down 5 -> 4 -> 2
  assert.equal(send("2026-11-25", { reason: "bedtime", inMinutes: 5, at: "21:00" }).statusCode, 200);
  assert.equal(kidPushes.length, 1);
  assert.equal(parentPushes.length, 0, "never pushes parents");
  assert.deepEqual(kidPushes[0].kidUserIds, [ctx.miaUser.id]);
  assert.equal(kidPushes[0].title, "Wi-Fi off in 5 min ⏳");
  assert.equal(kidPushes[0].body, "Bedtime starts at 9:00 PM. Save your game.");

  send("2026-11-25", { reason: "bedtime", inMinutes: 4, at: "21:00" });
  send("2026-11-25", { reason: "bedtime", inMinutes: 2, at: "21:00" });
  assert.equal(kidPushes.length, 1, "deduped per (kid, reason, localDate, at)");

  // limit_reached + focus each have their own exact wording and dedupe keys
  send("2026-11-25", { reason: "limit_reached", inMinutes: 5, at: "20:15" });
  assert.equal(kidPushes.length, 2);
  assert.equal(kidPushes[1].title, "Wi-Fi off in 5 min ⏳");
  assert.equal(kidPushes[1].body, "Today's screen time is almost used up.");

  send("2026-11-25", { reason: "focus", inMinutes: 5, at: "17:00" });
  assert.equal(kidPushes.length, 3);
  assert.equal(kidPushes[2].title, "Wi-Fi off in 5 min ⏳");
  assert.equal(kidPushes[2].body, "Focus time starts soon. Games and videos will pause.");

  // Next local day with the SAME "21:00" bedtime -> MUST fire again!
  clock = new Date("2026-11-26T13:55:00Z"); // 20:55 Bangkok (2026-11-26)
  send("2026-11-26", { reason: "bedtime", inMinutes: 5, at: "21:00" });
  assert.equal(kidPushes.length, 4, "next day fires again because localDate is part of dedupe key");

  // Backward compat: report without endsSoon works cleanly
  const legacy = send("2026-11-26", null);
  assert.equal(legacy.statusCode, 200);
  assert.equal(kidPushes.length, 4);
});

// ===================== Feature 2: Weekly parent digest =====================

test("F2 weekly digest: persists 14-day history separately from today, runs Sunday 18:00 once, parent-only push + API + toggle", async () => {
  // Start on Sunday Nov 29, 2026 17:30 Bangkok (10:30Z)
  clock = new Date("2026-11-29T10:30:00Z");
  kidPushes.length = 0;
  parentPushes.length = 0;
  const ctx = setup("Asia/Bangkok");
  const { auth } = pair(ctx);

  // Set weekday=120, weekend=180 total limit for Mia
  call("PUT /api/screen-time/kids/:kidId/policy", {
    user: ctx.parent,
    params: { kidId: ctx.mia.id },
    body: {
      enabled: true,
      limits: [{ kind: "total", name: "Screen time", minutesPerDay: 120, weekendMinutes: 180 }],
      downtime: [{ id: "bedtime", name: "Bedtime", start: "20:30", end: "07:00", days: [1, 2, 3, 4, 5, 6, 7] }],
    },
  });

  // Give Mia fams & approve one more-time request (30m = 10 fams) + decline one bedtime request on Nov 29
  fams.createChore(ctx.fam.id, ctx.mia.id, { title: "Dishes", amount: 50 });
  const choreId = fams.summary(ctx.fam.id, ctx.mia.id).chores[0].id;
  fams.submitChore(ctx.fam.id, ctx.mia.id, choreId);
  fams.approveChore(ctx.fam.id, ctx.mia.id, choreId);

  const reqTime = call("POST /api/screen-time/requests", {
    user: ctx.miaUser, body: { kind: "time", minutes: 30, date: "2026-11-29" },
  }).body.request;
  call("POST /api/screen-time/kids/:kidId/requests/:id/approve", {
    user: ctx.parent, params: { kidId: ctx.mia.id, id: reqTime.id },
  });
  const reqBed = call("POST /api/screen-time/requests", {
    user: ctx.miaUser, body: { kind: "bedtime", minutes: 30, date: "2026-11-29" },
  }).body.request;
  call("POST /api/screen-time/kids/:kidId/requests/:id/decline", {
    user: ctx.parent, params: { kidId: ctx.mia.id, id: reqBed.id },
  });

  // Send 14 days of history (two weeks: Nov 16..22 previous week + Nov 23..29 current week)
  // Plus one too-old date (Nov 10) that must be pruned
  const prevWeek = [
    { date: "2026-11-10", usedMinutes: 99, lateNightMinutes: 0, blocked: 0, topApps: [] }, // > 14d -> pruned
    { date: "2026-11-16", usedMinutes: 60, lateNightMinutes: 0, blocked: 1, topApps: [{ name: "YouTube", minutes: 30 }] },
    { date: "2026-11-17", usedMinutes: 40, lateNightMinutes: 0, blocked: 0, topApps: [] },
  ];
  const currWeek = [
    { date: "2026-11-23", usedMinutes: 90, lateNightMinutes: 10, blocked: 3, topApps: [{ name: "YouTube", minutes: 50 }, { name: "Roblox", minutes: 30 }] },
    { date: "2026-11-24", usedMinutes: 60, lateNightMinutes: 5, blocked: 2, topApps: [{ name: "Roblox", minutes: 40 }] },
    { date: "2026-11-29", usedMinutes: 110, lateNightMinutes: 0, blocked: 4, topApps: [{ name: "YouTube", minutes: 60 }] },
  ];
  // Report earlier week first, then current week (simulating reports across days)
  clock = new Date("2026-11-22T10:00:00Z");
  call("POST /api/home-network/report", {
    auth,
    body: { date: "2026-11-22", kids: [{ kidId: ctx.mia.id, usedMinutes: 40, history: prevWeek }] },
  });
  clock = new Date("2026-11-29T10:30:00Z"); // Sunday 17:30 Bangkok
  call("POST /api/home-network/report", {
    auth,
    body: { date: "2026-11-29", kids: [{ kidId: ctx.mia.id, usedMinutes: 110, history: currWeek }] },
  });

  // Verify history persists separately from today's usage and prunes > 14 days
  const storedHist = db.load().homeNetwork[ctx.fam.id].history[ctx.mia.id];
  assert.equal(storedHist["2026-11-10"], undefined, "older than 14 days is pruned");
  assert.equal(storedHist["2026-11-16"].usedMinutes, 60, "previous week retained");
  assert.equal(storedHist["2026-11-23"].usedMinutes, 90, "current week retained");

  // Before Sunday 18:00 (17:30 local): sweep must NOT generate or push
  let sw = await homeNetwork.sweep({ now: clock });
  assert.equal(sw.generated, 0);
  assert.equal(parentPushes.length, 0);

  // At Sunday 18:00 Bangkok (11:00Z): sweep generates once for this family and pushes parents only
  clock = new Date("2026-11-29T11:00:00Z");
  sw = await homeNetwork.sweep({ now: clock });
  assert.ok(sw.generated >= 1);
  const famPushes = () => parentPushes.filter((p) => p.familyId === ctx.fam.id);
  assert.equal(famPushes().length, 1);
  assert.deepEqual(famPushes()[0].familyParentIds, [ctx.parent.id, ctx.parent2.id]);
  assert.equal(famPushes()[0].title, "Weekly Wi-Fi digest is ready");
  assert.equal(kidPushes.length, 0, "digest never pushes kids");

  // Second sweep at 18:10: persisted dedupe prevents duplicate generation/push
  clock = new Date("2026-11-29T11:10:00Z");
  sw = await homeNetwork.sweep({ now: clock });
  assert.equal(sw.generated, 0);
  assert.equal(famPushes().length, 1);

  // GET /api/home-network/digest returns full breakdown for parents, 403 for kids
  assert.equal(call("GET /api/home-network/digest", { user: ctx.miaUser }).statusCode, 403);
  const digRes = call("GET /api/home-network/digest", { user: ctx.parent });
  assert.equal(digRes.statusCode, 200);
  assert.equal(digRes.body.enabled, true);
  const d = digRes.body.digest;
  assert.equal(d.weekStart, "2026-11-23");
  assert.equal(d.weekEnd, "2026-11-29");
  const miaD = d.kids.find((k) => k.kidId === ctx.mia.id);
  assert.equal(miaD.totalMinutes, 260); // 90 + 60 + 110
  assert.equal(miaD.prevWeekMinutes, 100); // 60 + 40
  assert.equal(miaD.deltaMinutes, 160);
  assert.equal(miaD.lateNightMinutes, 15);
  assert.equal(miaD.blocked, 9);
  assert.deepEqual(miaD.topApps.slice(0, 2), [{ name: "YouTube", minutes: 110 }, { name: "Roblox", minutes: 70 }]);
  assert.equal(miaD.requests.approved, 1);
  assert.equal(miaD.requests.declined, 1);
  assert.equal(miaD.requests.timeApproved, 1);
  assert.equal(miaD.requests.bedtimeDeclined, 1);
  assert.equal(miaD.famsSpent, 10);
  // Monday (school day) has 120m limit; Sunday (free day + 30m approved extra) has 210m limit
  assert.equal(miaD.days.find((x) => x.date === "2026-11-23").limitMinutes, 120);
  assert.equal(miaD.days.find((x) => x.date === "2026-11-29").limitMinutes, 210);
  assert.match(miaD.summaryText, /Mia: 4h 20m/);
  assert.match(miaD.summaryText, /10 Fams spent/);

  // Today overview includes digest for parents, never for kids
  const parentOverview = call("GET /api/screen-time", { user: ctx.parent }).body;
  assert.equal(parentOverview.homeNetwork.digest.weekEnd, "2026-11-29");
  const kidMine = call("GET /api/screen-time/mine", { user: ctx.miaUser }).body;
  assert.equal(kidMine.homeNetwork, undefined);

  // Toggle "Weekly digest" off -> hides from Today summary & skips future sweeps
  const off = call("PUT /api/home-network/settings", { user: ctx.parent, body: { weeklyDigest: false } });
  assert.equal(off.statusCode, 200);
  assert.equal(off.body.settings.weeklyDigest, false);
  assert.equal(call("GET /api/screen-time", { user: ctx.parent }).body.homeNetwork.digest, null);

  // Next Sunday 18:00 with toggle off -> no digest generated or pushed for this family
  clock = new Date("2026-12-06T11:00:00Z");
  await homeNetwork.sweep({ now: clock });
  assert.equal(famPushes().length, 1);
});

// ===================== Feature 3: School calendar drives the rules =====================

test("F3 school days: weekends, school calendar holidays, manual events, and parent no-school dates drive policy.days & ETag", () => {
  // Wed Nov 25, 2026 Bangkok (normal school day; Thu Nov 26 normal school day initially)
  clock = new Date("2026-11-25T05:00:00Z");
  const ctx = setup("Asia/Bangkok");
  const { auth } = pair(ctx);

  let p1 = call("GET /api/home-network/policy", { auth });
  assert.equal(p1.statusCode, 200);
  assert.deepEqual(p1.body.days[ctx.mia.id], { today: "school", tomorrow: "school" });
  assert.deepEqual(p1.body.days[ctx.leo.id], { today: "school", tomorrow: "school" });

  // Add an all-day school-feed holiday for Mia covering Nov 26 (exclusive DTEND Nov 27)
  // Plus a timed event & a deadline event on Nov 25 (must NOT make Nov 25 free!)
  const feedStore = schoolFeeds.famStore(ctx.fam.id);
  feedStore.subscriptions.push({ id: "sub_mia", kidId: ctx.mia.id, feedId: "sta-whole-school", customUrl: null });
  feedStore.cache["sub_mia"] = {
    fetchedAt: clock.toISOString(),
    events: [
      { uid: "u1", summary: "Half Term Break", start: "2026-11-26", end: "2026-11-27", allDay: true },
      { uid: "u2", summary: "Holiday essay deadline", start: "2026-11-25", end: "2026-11-26", allDay: true },
      { uid: "u3", summary: "Library closed early", start: "2026-11-25T15:00:00", end: "2026-11-25T16:00:00", allDay: false },
    ],
    error: null,
  };

  let p2 = call("GET /api/home-network/policy", { auth, headers: { "if-none-match": p1.headers.ETag } });
  assert.equal(p2.statusCode, 200, "ETag changes when days change");
  assert.deepEqual(p2.body.days[ctx.mia.id], { today: "school", tomorrow: "free" });
  assert.deepEqual(p2.body.days[ctx.leo.id], { today: "school", tomorrow: "school" }, "feed is scoped to Mia");

  // Manual all-day family event "INSET Day" for Leo on Nov 25
  events.addEvent(ctx.fam.id, { title: "INSET Day", date: "2026-11-25", kidId: ctx.leo.id, category: "school" });
  assert.equal(schoolDays.dayTypeForKid(ctx.fam, ctx.leo.id, "2026-11-25"), "free");
  assert.equal(schoolDays.dayTypeForKid(ctx.fam, ctx.mia.id, "2026-11-25"), "school");

  // Parent marks Nov 25 as "No school" via API (kids get 403)
  assert.equal(call("POST /api/home-network/no-school", { user: ctx.miaUser, body: { date: "2026-11-25" } }).statusCode, 403);
  const added = call("POST /api/home-network/no-school", { user: ctx.parent, body: { date: "2026-11-25" } });
  assert.equal(added.statusCode, 200);
  assert.deepEqual(added.body.noSchoolDates, ["2026-11-25"]);
  assert.equal(added.body.days[ctx.mia.id].today, "free");

  let p3 = call("GET /api/home-network/policy", { auth, headers: { "if-none-match": p2.headers.ETag } });
  assert.equal(p3.statusCode, 200, "no-school date busts policy ETag");
  assert.deepEqual(p3.body.days[ctx.mia.id], { today: "free", tomorrow: "free" });

  // Remove the no-school date
  const removed = call("DELETE /api/home-network/no-school/:date", { user: ctx.parent, params: { date: "2026-11-25" } });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removed.body.noSchoolDates, []);
  assert.equal(removed.body.days[ctx.mia.id].today, "school");

  // Weekend Sat/Sun are always free
  assert.equal(schoolDays.dayTypeForKid(ctx.fam, ctx.mia.id, "2026-11-28"), "free");
  assert.equal(schoolDays.dayTypeForKid(ctx.fam, ctx.mia.id, "2026-11-29"), "free");

  // iOS Screen Time policy format is untouched (no `days` field on device/parent policy)
  const kidPol = call("GET /api/screen-time/mine", { user: ctx.miaUser }).body.policy;
  assert.equal("days" in kidPol, false, "iOS Screen Time policy format must not change");
});

test("F3 bedtime: a no-school day changes Canopy's days, never the iPhone/iPad Screen Time bedtime", () => {
  // Wed Nov 25, 2026 (tomorrow Thu Nov 26)
  clock = new Date("2026-11-25T10:00:00Z");
  const ctx = setup("Asia/Bangkok");
  call("PUT /api/screen-time/kids/:kidId/policy", {
    user: ctx.parent,
    params: { kidId: ctx.mia.id },
    body: {
      enabled: true,
      limits: [{ kind: "total", name: "Screen time", minutesPerDay: 120, weekendMinutes: 180 }],
      downtime: [
        { id: "bedtime", name: "School Night Bedtime", start: "20:30", end: "07:00", days: [1, 2, 3, 4, 5] },
        { id: "bedtime_weekend", name: "Weekend Bedtime", start: "22:00", end: "08:00", days: [6, 7] },
      ],
    },
  });

  // Tomorrow Thu Nov 26 is a school day -> "+30m tonight" shifts 20:30 -> 21:00
  let res = call("POST /api/screen-time/kids/:kidId/bedtime", {
    user: ctx.parent, params: { kidId: ctx.mia.id }, body: { minutes: 30 },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.policy.bedtimeException.until, "21:00");
  // Reset exception
  call("POST /api/screen-time/kids/:kidId/bedtime", { user: ctx.parent, params: { kidId: ctx.mia.id }, body: { minutes: 0 } });

  const before = JSON.stringify(call("GET /api/screen-time/mine", { user: ctx.miaUser }).body.policy.downtime);

  // Mark tomorrow Thu Nov 26 as "No school": Canopy is told tomorrow is free
  // (it moves the home Wi-Fi bedtime itself); the iOS policy stays calendar-based.
  call("POST /api/home-network/no-school", { user: ctx.parent, body: { date: "2026-11-26" } });
  const homePolicy = require("../lib/screen-time").homeAgentPolicy(require("../lib/family").getFamily(ctx.fam.id));
  assert.deepEqual(homePolicy.days[ctx.mia.id], { today: "school", tomorrow: "free" });
  assert.equal(JSON.stringify(call("GET /api/screen-time/mine", { user: ctx.miaUser }).body.policy.downtime), before);
  res = call("POST /api/screen-time/kids/:kidId/bedtime", {
    user: ctx.parent, params: { kidId: ctx.mia.id }, body: { minutes: 30 },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.policy.bedtimeException.until, "21:00", "iOS bedtime exceptions stay on the weekday window");
});

test("F3 no-school matcher: real breaks count, school events that mention a break do not", () => {
  const { meansNoSchool } = require("../lib/school-days");
  for (const t of ["Half Term", "Christmas Holiday", "INSET Day", "No School", "Mid-term break", "School closed", "Loy Krathong holiday"]) {
    assert.equal(meansNoSchool(t), true, t);
  }
  for (const t of ["Holiday concert", "Mid-term exams", "Last day before break", "Library closed", "School returns after holiday", "Breakfast club"]) {
    assert.equal(meansNoSchool(t), false, t);
  }
});

// ===================== Feature 4: Parent safety alerts =====================

test("F4 alerts: ackAlerts, calm no-URL wording, parent-only push deduped per kid+type+category+day, toggles, 50-cap, dismiss", () => {
  clock = new Date("2026-11-25T13:00:00Z");
  kidPushes.length = 0;
  parentPushes.length = 0;
  const ctx = setup("Asia/Bangkok");
  const { auth } = pair(ctx);

  const r1 = call("POST /api/home-network/report", {
    auth,
    body: {
      date: "2026-11-25",
      kids: [{ kidId: ctx.mia.id, usedMinutes: 30 }],
      alerts: [
        {
          id: "al-1",
          type: "risk",
          kidId: ctx.mia.id,
          category: "adult",
          deviceName: "Maya's iPad",
          count: 4,
          at: "2026-11-25T12:45:00.000Z",
        },
        {
          id: "al-2",
          type: "risk",
          kidId: ctx.mia.id,
          category: "adult", // same kid + type + category + day -> stored & acked, NO second push!
          deviceName: "Maya's iPad",
          count: 3,
          at: "2026-11-25T12:55:00.000Z",
        },
        {
          id: "al-3",
          type: "bypass",
          kidId: ctx.mia.id,
          category: "anti_bypass",
          deviceName: "Maya's iPad https://evil.example/path", // URL must be stripped!
          count: 2,
          at: "2026-11-25T12:56:00.000Z",
        },
        {
          id: "al-4",
          type: "new_device",
          category: "new_device",
          deviceName: "New Device (.142)",
          count: 1,
          at: "2026-11-25T12:57:00.000Z",
        },
      ],
    },
  });

  assert.equal(r1.statusCode, 200);
  assert.deepEqual(r1.body.ackAlerts, ["al-1", "al-2", "al-3", "al-4"]);
  assert.equal(kidPushes.length, 0, "safety alerts never push kids");
  assert.equal(parentPushes.length, 3, "deduped al-2 (same kid+type+category+day)");
  assert.deepEqual(parentPushes[0].familyParentIds, [ctx.parent.id, ctx.parent2.id]);
  assert.equal(parentPushes[0].body, "Maya's iPad tried to open an adult site 4 times (blocked).");
  assert.equal(parentPushes[1].body, "Maya's iPad tried to bypass the home Wi-Fi filter 2 times (blocked).");
  assert.equal(parentPushes[1].body.includes("http"), false, "never includes URLs");
  assert.equal(parentPushes[2].body, "New Device (.142) joined the home Wi-Fi.");

  // Re-sending an already-seen alert ID still acks without duplicating or pushing again
  const retry = call("POST /api/home-network/report", {
    auth,
    body: {
      date: "2026-11-25",
      kids: [{ kidId: ctx.mia.id, usedMinutes: 30 }],
      alerts: [{ id: "al-1", type: "risk", kidId: ctx.mia.id, category: "adult", deviceName: "Maya's iPad", count: 4, at: "2026-11-25T12:45:00.000Z" }],
    },
  });
  assert.deepEqual(retry.body.ackAlerts, ["al-1"]);
  assert.equal(parentPushes.length, 3);
  assert.equal(call("GET /api/home-network/alerts", { user: ctx.parent }).body.alerts.length, 4);

  // Kids cannot view or dismiss alerts
  assert.equal(call("GET /api/home-network/alerts", { user: ctx.miaUser }).statusCode, 403);
  assert.equal(call("POST /api/home-network/alerts/:alertId/dismiss", { user: ctx.miaUser, params: { alertId: "al-1" } }).statusCode, 403);
  assert.equal(call("POST /api/home-network/alerts/dismiss", { user: ctx.miaUser }).statusCode, 403);

  // Dismiss one alert
  const afterOne = call("POST /api/home-network/alerts/:alertId/dismiss", { user: ctx.parent, params: { alertId: "al-2" } });
  assert.equal(afterOne.statusCode, 200);
  assert.equal(afterOne.body.alerts.length, 3);
  assert.equal(afterOne.body.alerts.some((a) => a.id === "al-2"), false);

  // Per-type toggle off: suppress new_device push next day while still acking
  call("PUT /api/home-network/settings", { user: ctx.parent, body: { alerts: { new_device: false } } });
  clock = new Date("2026-11-26T13:00:00Z");
  const nextDay = call("POST /api/home-network/report", {
    auth,
    body: {
      date: "2026-11-26",
      kids: [{ kidId: ctx.mia.id, usedMinutes: 10 }],
      alerts: [
        { id: "al-5", type: "new_device", category: "new_device", deviceName: "Guest Phone", count: 1, at: "2026-11-26T12:00:00.000Z" },
        { id: "al-6", type: "risk", kidId: ctx.mia.id, category: "adult", deviceName: "Maya's iPad", count: 3, at: "2026-11-26T12:05:00.000Z" },
      ],
    },
  });
  assert.deepEqual(nextDay.body.ackAlerts, ["al-5", "al-6"]);
  assert.equal(parentPushes.length, 4, "new_device suppressed by toggle; risk pushed on new day");
  assert.equal(parentPushes[3].type, "risk");

  // Cap at 50 stored alerts
  const batch = Array.from({ length: 55 }, (_, i) => ({
    id: `bulk-${i}`,
    type: "new_device",
    category: "new_device",
    deviceName: `Device ${i}`,
    count: 1,
    at: "2026-11-26T12:10:00.000Z",
  }));
  call("POST /api/home-network/report", { auth, body: { date: "2026-11-26", kids: [], alerts: batch } });
  assert.equal(call("GET /api/home-network/alerts", { user: ctx.parent }).body.alerts.length, 50);

  // Dismiss all
  const cleared = call("POST /api/home-network/alerts/dismiss", { user: ctx.parent });
  assert.equal(cleared.statusCode, 200);
  assert.deepEqual(cleared.body.alerts, []);

  // Backward compat: report without `alerts` omits `ackAlerts`
  const noAlerts = call("POST /api/home-network/report", { auth, body: { date: "2026-11-26", kids: [] } });
  assert.equal(noAlerts.statusCode, 200);
  assert.equal("ackAlerts" in noAlerts.body, false);
});

// ===================== Web UI static wiring checks =====================

test("UI wiring: settings.js and screen-time-today.js compile and enforce parent-only rendering", () => {
  const settingsJs = fs.readFileSync(path.join(__dirname, "..", "public/js/settings.js"), "utf8");
  const todayJs = fs.readFileSync(path.join(__dirname, "..", "public/js/screen-time-today.js"), "utf8");

  assert.doesNotThrow(() => new Function(settingsJs));
  assert.doesNotThrow(() => new Function(todayJs));

  // Settings > Connections > Home Wi-Fi wires all new APIs and UI labels
  for (const snippet of [
    "/api/home-network/settings",
    "/api/home-network/no-school",
    "/api/home-network/alerts",
    "Weekly digest",
    "Free day — weekend limits",
    "No school dates",
    "Dismiss",
  ]) {
    assert.ok(settingsJs.includes(snippet), `settings.js missing ${snippet}`);
  }

  // Today page renders digest in parentHtml only and keeps screen-time-today-ui escaping contract
  assert.ok(todayJs.includes("Weekly Wi-Fi digest"));
  assert.ok(todayJs.includes("fam_home_digest_dismissed_"));
  assert.ok(!/innerHTML\s*=\s*`/.test(todayJs));
  const kidSection = todayJs.slice(todayJs.indexOf("function kidHtml()"));
  assert.equal(kidSection.includes("digest"), false, "kidHtml must never render digest");
});

test("notifyHomeWifiParent: pushes parents only (APNs + web push), never kid tokens", async () => {
  process.env.VAPID_PUBLIC_KEY = "pub";
  process.env.VAPID_PRIVATE_KEY = "priv";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  const webpushSender = require("../lib/webpush-sender");
  const origWeb = webpushSender.createWebPushClient;
  const sent = [];
  webpushSender.createWebPushClient = () => ({
    send: async (sub, payload) => {
      sent.push({ endpoint: sub.endpoint, payload });
      return { ok: true, status: 201, shouldPruneSubscription: false };
    },
  });
  delete require.cache[require.resolve("../lib/fam-notifications")];
  const notifications = require("../lib/fam-notifications");
  notifications.addWebSubscription("parent-a", { endpoint: "https://push/parent-a", keys: { p256dh: "a", auth: "b" } });
  notifications.addWebSubscription("kid-a", { endpoint: "https://push/kid-a", keys: { p256dh: "a", auth: "b" } });
  try {
    const res = await notifications.notifyHomeWifiParent({
      familyParentIds: ["parent-a"],
      familyId: "fam-1",
      type: "risk",
      title: "Home Wi-Fi safety alert",
      body: "Maya's iPad tried to open an adult site 4 times (blocked).",
    });
    assert.equal(res.sent, 1);
    assert.deepEqual(sent.map((x) => x.endpoint), ["https://push/parent-a"]);
    assert.equal(sent[0].payload.data.famType, "home_wifi_alert");
  } finally {
    webpushSender.createWebPushClient = origWeb;
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    delete require.cache[require.resolve("../lib/fam-notifications")];
  }
});

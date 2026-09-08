"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fam-child-insights-"));
process.env.DATA_ENCRYPTION_KEY = "12".repeat(32);
const store = require("../lib/child-insights");
const db = require("../lib/db");
const today = new Date().toISOString().slice(0, 10);
const stats = { housePoints: 10, attendance: 98, punctual: null, canteenBalance: -5, importedAt: "2026-09-01T12:00:00.000Z" };
const plan = { date: today, schoolEnd: "15:00", pickupTime: null, homeTime: "16:30", pickupLabel: "School gate" };

test("unknown data stays unknown; stats preserve import time and resist older imports", () => {
  assert.deepEqual(store.insights("f", "k", today), { kidId: "k", date: today, schoolStats: null, homePlan: null, daily5: { date: today, parts: {} } });
  const first = store.saveSchoolStats("f", "k", stats).schoolStats;
  assert.equal(first.importedAt, stats.importedAt);
  assert.deepEqual(store.saveSchoolStats("f", "k", { ...stats, housePoints: 0, importedAt: "2026-08-01T00:00:00Z" }).schoolStats, first);
  assert.equal(store.insights("other", "k", today).schoolStats, null);
});

test("strict plans and numeric imports reject malformed values and spoof fields", () => {
  for (const date of ["2026-02-30", "2026-2-02", "bad", null, [today]]) assert.ok(store.saveHomePlan("f", "k", { ...plan, date }).error);
  for (const schoolEnd of ["24:00", "12:60", "1:00", 1500, ""]) assert.ok(store.saveHomePlan("f", "k", { ...plan, schoolEnd }).error);
  assert.ok(store.saveHomePlan("f", "k", { ...plan, pickupLabel: "a".repeat(81) }).error);
  assert.ok(store.saveHomePlan("f", "k", { ...plan, kidId: "else" }).error);
  assert.equal(store.saveHomePlan("f", "k", plan).homePlan.homeTime, "16:30");
  assert.equal(store.saveHomePlan("f", "k", { ...plan, homeTime: null }).homePlan.homeTime, null);
  for (const housePoints of ["10", NaN, Infinity, -1, 10000001, undefined]) assert.ok(store.saveSchoolStats("f", "k", { ...stats, housePoints }).error);
  for (const importedAt of ["2026-02-30T00:00:00Z", "2026-09-01", "2026-09-01T24:00:00Z", "2026-09-01T12:99:00Z", 1]) assert.ok(store.saveSchoolStats("f", "k", { ...stats, importedAt }).error);
  assert.ok(store.saveSchoolStats("f", "k", { ...stats, attendance: 101 }).error);
  assert.ok(store.saveSchoolStats("f", "k", { ...stats, punctual: -1 }).error);
  assert.ok(store.saveSchoolStats("f", "k", { ...stats, canteenBalance: -1000001 }).error);
});

test("progress is scoped, retractable, bounded and safe for prototype-like identities", () => {
  const payload = { date: today, part: "puzzle", status: "completed" };
  assert.equal(store.reportProgress("__proto__", "constructor", payload).parts.puzzle.status, "completed");
  assert.equal(store.reportProgress("__proto__", "constructor", { ...payload, status: "started" }).parts.puzzle.status, "started");
  assert.deepEqual(store.progress("f", "constructor", today).parts, {});
  for (const bad of [{ kidId: "x" }, { familyId: "x" }, { part: "__proto__" }, { status: "unknown" }, { date: "2000-01-01" }, { date: "2999-01-01" }, { date: "2026-02-30" }]) assert.ok(store.reportProgress("f", "k", { ...payload, ...bad }).error);
  const days = db.load().childInsights.__proto__.constructor.daily5;
  days["2000-01-01"] = { news: { status: "completed" } };
  for (let offset = 35; offset >= 0; offset--) {
    const date = new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
    store.reportProgress("__proto__", "constructor", { ...payload, date });
  }
  assert.equal(Object.keys(days).length, 35);
  assert.equal(Object.hasOwn(days, "2000-01-01"), false);
  assert.equal({}.daily5, undefined);
  db.flushSync();
  assert.equal(db.isFileEncrypted(), true);
  assert.equal(fs.readFileSync(db.DB_FILE, "utf8").includes("School gate"), false);
});

test("routes enforce parent and own-child boundaries including deleted children", async t => {
  const express = require("express");
  const app = express();
  app.use(express.json());
  const family = { id: "route-family", kids: [{ id: "own" }, { id: "sibling" }] };
  require("../lib/routes/child-insights")(app, {
    requireAuth(req, res, next) { if (!req.headers["x-role"]) return res.status(401).json({ error: "Login" }); req.user = { role: req.headers["x-role"] }; next(); },
    requireParent(req, res, next) { if (req.user.role !== "parent") return res.status(403).json({ error: "Parent" }); next(); },
    requireFamily(req, _res, next) { req.family = family; next(); },
    userRole: user => user.role,
    kidIdForUser: () => "own",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => server.close());
  const request = (url, role = "parent", body, method = "GET") => fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { ...(role ? { "x-role": role } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const parentPath = `/api/children/own/insights?date=${today}`;
  assert.equal((await request(parentPath, null)).status, 401);
  assert.equal((await request(parentPath, "kid")).status, 403);
  assert.equal((await request(`/api/children/else/insights?date=${today}`)).status, 404);
  let response = await request(parentPath);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).schoolStats, null);
  assert.equal((await request("/api/children/own/home-plan", "kid", plan, "PUT")).status, 403);
  assert.equal((await request("/api/children/else/home-plan", "parent", plan, "PUT")).status, 404);
  assert.equal((await request("/api/children/own/home-plan", "parent", plan, "PUT")).status, 200);
  assert.equal((await request("/api/children/own/school-stats", "parent", stats, "PUT")).status, 200);
  const progressPath = `/api/daily5/progress?date=${today}`;
  assert.equal((await request(progressPath)).status, 403);
  assert.equal((await request(`${progressPath}&kidId=sibling`, "kid")).status, 400);
  const payload = { date: today, part: "word", status: "completed" };
  assert.equal((await request("/api/daily5/progress", "kid", { ...payload, familyId: "other" }, "POST")).status, 400);
  assert.equal((await request("/api/daily5/progress", "parent", payload, "POST")).status, 403);
  assert.equal((await request("/api/daily5/progress", "kid", payload, "POST")).status, 200);
  assert.equal(store.progress(family.id, "own", today).parts.word.status, "completed");
  assert.deepEqual(store.progress(family.id, "sibling", today).parts, {});
  family.kids = family.kids.filter(kid => kid.id !== "own");
  assert.equal((await request(parentPath)).status, 404);
  assert.equal((await request(progressPath, "kid")).status, 404);
});

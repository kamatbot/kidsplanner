"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-operator-beta-routes-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const datacrypto = require("../lib/datacrypto");
datacrypto._resetKeyCache();
const store = require("../lib/store");
const family = require("../lib/family");
const chat = require("../lib/chat");
const hermes = require("../lib/hermes");
const operator = require("../lib/operator");
const operatorBeta = require("../lib/operator-beta");
const hermesRoutes = require("../lib/routes/hermes");

function actor(user) { return { type: "parent", userId: user.id, principalId: user.id }; }
function role(user) { return user && user.data && user.data.profile && user.data.profile.role || "parent"; }

function fixture() {
  const parent = store.createUser(`beta-routes-${crypto.randomBytes(5).toString("hex")}@example.com`, "Beta Route Parent");
  const fam = family.createFamily(parent.id, "Beta Route Family");
  const current = operator.createCase(fam.id, {
    actor: actor(parent), roomId: "family", title: "Blocked beta case", goal: "Exercise beta feedback controls.",
  });
  operatorBeta.captureEvidence(fam.id, current.id, {
    kind: "beta.blocked",
    actionType: "calendar.create",
    code: "OPERATOR_BETA_NOT_ENROLLED",
    payload: { reason: "Not enrolled." },
  });
  return { parent, fam, current };
}

function buildHarness() {
  const routes = {};
  const register = (method) => (pattern, ...handlers) => { routes[`${method} ${pattern}`] = { method, handlers }; };
  const app = { get: register("GET"), post: register("POST"), delete: register("DELETE") };
  hermesRoutes(app, {
    hermes, family, chat, store,
    notifications: { notifyChatMessage: async () => {}, notifyTripChatMessage: async () => {} },
    requireAuth: (req, res, next) => (req.user ? next() : res.status(401).json({ error: "Not authenticated" })),
    requireParent: (req, res, next) => (role(req.user) === "kid" ? res.status(403).json({ error: "Parents only." }) : next()),
    requireFamily: (req, res, next) => {
      const fams = req.user ? family.familiesForUser(req.user.id) : [];
      if (!fams.length) return res.status(404).json({ error: "No family." });
      req.family = fams[0];
      return next();
    },
    requireAdmin: (req, res, next) => (req.admin === true ? next() : res.status(401).json({ error: "Admin required" })),
  });
  return routes;
}

function invoke(route, { user = null, body = {}, params = {}, query = {}, admin = false } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const res = {
      statusCode: 200, body: null,
      set() { return this; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { if (!settled) { settled = true; this.body = payload; resolve(this); } return this; },
      end() { if (!settled) { settled = true; resolve(this); } return this; },
    };
    const req = { method: route.method, user, body, params, query, admin, headers: {}, protocol: "https", get() { return ""; }, on() {} };
    let index = 0;
    const next = () => index < route.handlers.length ? route.handlers[index++](req, res, next) : undefined;
    Promise.resolve().then(next).catch(reject);
  });
}

test("parent beta status is read-only and completed/blocked cases require explicit feedback", async (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 is optional on this host"); return; }
  const f = fixture();
  const routes = buildHarness();

  const statusUnauth = await invoke(routes["GET /api/operator/beta/status"]);
  assert.equal(statusUnauth.statusCode, 401);

  const status = await invoke(routes["GET /api/operator/beta/status"], { user: f.parent });
  assert.equal(status.statusCode, 200);
  assert.equal(status.body.config.familyId, f.fam.id);
  assert.equal(status.body.config.enabled, false);

  const pending = await invoke(routes["GET /api/operator/beta/feedback-pending"], { user: f.parent });
  assert.equal(pending.statusCode, 200);
  assert.ok(pending.body.cases.some((item) => item.caseId === f.current.id && item.reason === "blocked"));

  const submitted = await invoke(routes["POST /api/operator/cases/:caseId/feedback"], {
    user: f.parent,
    params: { caseId: f.current.id },
    body: { outcome: "block-correct", rating: 5 },
  });
  assert.equal(submitted.statusCode, 200);
  assert.equal(submitted.body.feedback.submitted, true);

  const pendingAfter = await invoke(routes["GET /api/operator/beta/feedback-pending"], { user: f.parent });
  assert.equal(pendingAfter.body.cases.some((item) => item.caseId === f.current.id), false);
});

test("only admin routes can enroll families or operate beta kill switches", async (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 is optional on this host"); return; }
  const f = fixture();
  const routes = buildHarness();
  const configRoute = routes["POST /api/admin/operator-beta/families/:familyId"];

  const denied = await invoke(configRoute, { params: { familyId: f.fam.id }, body: { enabled: true } });
  assert.equal(denied.statusCode, 401);

  const configured = await invoke(configRoute, {
    admin: true,
    params: { familyId: f.fam.id },
    body: { enabled: true, autonomyCeiling: "approved-low-risk", hourlyQuota: 3, dailyQuota: 8 },
  });
  assert.equal(configured.statusCode, 200);
  assert.equal(configured.body.config.enabled, true);
  assert.equal(configured.body.config.autonomyCeiling, "approved-low-risk");

  const globalKill = await invoke(routes["POST /api/admin/operator-beta/global"], { admin: true, body: { killSwitch: true } });
  assert.equal(globalKill.statusCode, 200);
  assert.equal(globalKill.body.global.killSwitch, true);

  const dashboard = await invoke(routes["GET /api/admin/operator-beta/dashboard"], { admin: true });
  assert.equal(dashboard.statusCode, 200);
  assert.ok(dashboard.body.families.some((row) => row.familyId === f.fam.id));
  assert.equal(dashboard.body.safetyBoundary.paymentsEnabled, false);
  assert.equal(dashboard.body.safetyBoundary.maximumRiskLevel, "low");

  await invoke(routes["POST /api/admin/operator-beta/global"], { admin: true, body: { killSwitch: false } });
});
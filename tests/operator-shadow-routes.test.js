"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-shadow-routes-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const datacrypto = require("../lib/datacrypto");
datacrypto._resetKeyCache();
const store = require("../lib/store");
const family = require("../lib/family");
const chat = require("../lib/chat");
const hermes = require("../lib/hermes");
const operator = require("../lib/operator");
const operatorShadow = require("../lib/operator-shadow");
const hermesRoutes = require("../lib/routes/hermes");

let seq = 0;
function parent(label) {
  seq += 1;
  return store.createUser(`shadow-route-${seq}@example.com`, `${label} ${seq}`);
}
function parentActor(user) { return { type: "parent", principalId: user.id, userId: user.id }; }
function role(user) { return user && user.data && user.data.profile && user.data.profile.role || "parent"; }

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
  });
  return routes;
}
function invoke(route, { user = null, body = {}, params = {}, query = {} } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const res = {
      statusCode: 200,
      body: null,
      set() { return this; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { if (!settled) { settled = true; this.body = payload; resolve(this); } return this; },
    };
    const req = { method: route.method, user, body, params, query, headers: {}, protocol: "https", get() { return ""; }, on() {} };
    let index = 0;
    const next = () => index < route.handlers.length ? route.handlers[index++](req, res, next) : undefined;
    Promise.resolve().then(next).catch(reject);
  });
}
function fixture() {
  const owner = parent("Owner");
  const fam = family.createFamily(owner.id, "Shadow Route Family");
  let current = operator.createCase(fam.id, {
    actor: parentActor(owner), roomId: "family", title: "Plan family event", goal: "Prepare without executing.",
  });
  current = operator.transitionCase(fam.id, current.id, "planning", { actor: parentActor(owner), roomId: "family" });
  current = operator.transitionCase(fam.id, current.id, "proposal_ready", { actor: parentActor(owner), roomId: "family" });
  const step = operator.addStep(fam.id, current.id, {
    actor: parentActor(owner), roomId: "family", kind: "shadow.proposal", idempotencyKey: "route-shadow",
    input: {
      workflowId: "family-event",
      plan: ["Check calendar", "Prepare family event"],
      contextSections: ["calendar", "identities"],
      clarifyingQuestions: 0,
      proposedActions: [{
        actionType: "calendar.create",
        approvalPolicy: "single-parent",
        action: { title: "Family event", date: "2026-10-20", category: "social" },
        executed: false,
      }],
      expectedResult: { summary: "Event would be ready for approval." },
    },
  });
  return { owner, fam, caseId: current.id, runId: step.output.shadowRunId };
}

test("shadow list/detail/review APIs are parent-only and family scoped", async (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 is optional on this host"); return; }
  const f = fixture();
  const other = parent("Other");
  family.createFamily(other.id, "Other Family");
  const routes = buildHarness();

  const unauth = await invoke(routes["GET /api/operator/shadow"]);
  assert.equal(unauth.statusCode, 401);

  const list = await invoke(routes["GET /api/operator/shadow"], { user: f.owner, query: { caseId: f.caseId } });
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.runs.length, 1);
  assert.equal(list.body.runs[0].id, f.runId);
  assert.equal(list.body.runs[0].executionBlocked, true);
  assert.equal(JSON.stringify(list.body).includes(f.owner.id), false);

  const detail = await invoke(routes["GET /api/operator/shadow/:runId"], { user: f.owner, params: { runId: f.runId } });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.run.workflowId, "family-event");

  const foreign = await invoke(routes["GET /api/operator/shadow/:runId"], { user: other, params: { runId: f.runId } });
  assert.equal(foreign.statusCode, 404);

  const reviewed = await invoke(routes["POST /api/operator/shadow/:runId/review"], {
    user: f.owner,
    params: { runId: f.runId },
    body: { choice: "accepted", actualActionTypes: ["calendar.create"], contextMisses: [], hallucinations: [] },
  });
  assert.equal(reviewed.statusCode, 200);
  assert.equal(reviewed.body.run.state, "reviewed");
  assert.equal(reviewed.body.run.finalScore.score, 100);
  assert.equal(reviewed.body.run.executionBlocked, false);
  assert.equal(JSON.stringify(reviewed.body).includes(f.owner.id), false);
});

test("shadow metrics API exposes workflow graduation evidence without mutating the case", async (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 is optional on this host"); return; }
  const f = fixture();
  operatorShadow.reviewRun(f.fam.id, f.runId, parentActor(f.owner), {
    choice: "modified",
    actualActionTypes: ["calendar.create", "action.create"],
    contextMisses: ["pickup location"],
    hallucinations: [],
  });
  const routes = buildHarness();
  const metrics = await invoke(routes["GET /api/operator/shadow-metrics"], { user: f.owner, query: { workflowId: "family-event" } });
  assert.equal(metrics.statusCode, 200);
  assert.equal(metrics.body.metrics.reviewedRuns, 1);
  assert.equal(metrics.body.metrics.contextMissRate, 1);
  assert.equal(metrics.body.graduation.eligible, false);
  assert.equal(metrics.body.graduation.status, "insufficient-data");
  assert.equal(operatorShadow.getRun(f.fam.id, f.runId).state, "reviewed");
});

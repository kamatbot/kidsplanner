"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-operator-cards-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const datacrypto = require("../lib/datacrypto");
datacrypto._resetKeyCache();
const store = require("../lib/store");
const family = require("../lib/family");
const chat = require("../lib/chat");
const hermes = require("../lib/hermes");
const operator = require("../lib/operator");
const operatorCards = require("../lib/operator-cards");
const operatorExecution = require("../lib/operator-execution");
const hermesRoutes = require("../lib/routes/hermes");

function fixture() {
  const parent = store.createUser(`cards-${crypto.randomBytes(5).toString("hex")}@example.com`, "Cards Parent");
  const fam = family.createFamily(parent.id, "Cards Family");
  const actor = { type: "parent", userId: parent.id, principalId: parent.id };
  let current = operator.createCase(fam.id, {
    actor, roomId: "family", title: "Hermes is arranging soccer", goal: "Add the confirmed soccer session.",
  });
  current = operator.transitionCase(fam.id, current.id, "planning", { actor, roomId: "family" });
  current = operator.transitionCase(fam.id, current.id, "proposal_ready", { actor, roomId: "family" });
  current = operator.transitionCase(fam.id, current.id, "waiting_for_approval", { actor, roomId: "family" });
  const approval = operator.requestApproval(fam.id, current.id, {
    actor, roomId: "family", approverUserId: parent.id, actionType: "calendar.create",
    action: { title: "Soccer", date: "2026-09-22", time: "16:00", category: "sports" },
  });
  return { parent, fam, actor, current, approval };
}

function role(user) {
  return user && user.data && user.data.profile && user.data.profile.role || "parent";
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
  });
  return routes;
}

function invoke(route, { user = null, body = {}, params = {}, query = {} } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const res = {
      statusCode: 200, body: null,
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

test("case card exposes stage, exact proposal and expandable activity without case context", (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 is optional on this host"); return; }
  const f = fixture();
  const card = operatorCards.caseCard(f.fam.id, f.current.id, f.parent.id);
  assert.equal(card.stageLabel, "Needs approval");
  assert.equal(card.proposedAction.approvalId, f.approval.id);
  assert.equal(card.proposedAction.actionHash, f.approval.actionHash);
  assert.equal(card.proposedAction.action.title, "Soccer");
  assert.ok(card.activity.some((event) => event.eventType === "case.created"));
  assert.ok(card.activity.some((event) => event.eventType === "approval.requested"));
  assert.equal(Object.prototype.hasOwnProperty.call(card, "context"), false);
  assert.equal(JSON.stringify(card).includes(f.parent.id), false);
});

test("completed execution appears as evidence on the same case card", (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 is optional on this host"); return; }
  const f = fixture();
  operatorExecution.decideApproval(f.fam.id, f.approval.id, { actor: f.actor, decision: "approve", actionHash: f.approval.actionHash });
  const claim = operatorExecution.claimExecution(f.fam.id, f.approval.id, { actor: f.actor });
  operatorExecution.runExecution(f.fam.id, claim.executionToken, f.approval.actionHash, { actor: f.actor });
  const card = operatorCards.caseCard(f.fam.id, f.current.id, f.parent.id);
  assert.equal(card.state, "verifying");
  assert.equal(card.evidence.length, 1);
  assert.equal(card.evidence[0].actionType, "calendar.create");
  assert.match(card.evidence[0].result.eventId, /^ev_/);
  assert.ok(card.activity.some((event) => event.eventType === "execution.completed"));
});

test("parent case and activity REST contracts are authenticated and family-scoped", async (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 is optional on this host"); return; }
  const f = fixture();
  const outsider = store.createUser(`outsider-${crypto.randomBytes(5).toString("hex")}@example.com`, "Outsider");
  family.createFamily(outsider.id, "Other Family");
  const routes = buildHarness();

  const unauthenticated = await invoke(routes["GET /api/operator/cases"]);
  assert.equal(unauthenticated.statusCode, 401);

  const list = await invoke(routes["GET /api/operator/cases"], { user: f.parent });
  assert.equal(list.statusCode, 200);
  assert.ok(list.body.cases.some((card) => card.id === f.current.id));

  const detail = await invoke(routes["GET /api/operator/cases/:caseId"], { user: f.parent, params: { caseId: f.current.id } });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.case.id, f.current.id);

  const activity = await invoke(routes["GET /api/operator/activity"], { user: f.parent });
  assert.equal(activity.statusCode, 200);
  assert.ok(activity.body.activity.length >= 1);

  const outsiderDetail = await invoke(routes["GET /api/operator/cases/:caseId"], { user: outsider, params: { caseId: f.current.id } });
  assert.equal(outsiderDetail.statusCode, 404);
});

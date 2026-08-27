"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-operator-routes-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const datacrypto = require("../lib/datacrypto");
datacrypto._resetKeyCache();
const store = require("../lib/store");
const family = require("../lib/family");
const chat = require("../lib/chat");
const hermes = require("../lib/hermes");
const operator = require("../lib/operator");
const hermesRoutes = require("../lib/routes/hermes");

let seq = 0;
function parent(label) {
  seq += 1;
  return store.createUser(`${label}${seq}@example.com`, `${label} ${seq}`);
}

function role(user) {
  return user && user.data && user.data.profile && user.data.profile.role || "parent";
}

function parentActor(user) {
  return { type: "parent", principalId: user.id, userId: user.id };
}

function buildHarness() {
  const routes = {};
  const register = (method) => (pattern, ...handlers) => {
    routes[`${method} ${pattern}`] = { method, handlers };
  };
  const app = {
    get: register("GET"),
    post: register("POST"),
    delete: register("DELETE"),
  };
  hermesRoutes(app, {
    hermes,
    family,
    chat,
    store,
    notifications: {
      notifyChatMessage: async () => {},
      notifyTripChatMessage: async () => {},
    },
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
      json(payload) {
        if (!settled) {
          settled = true;
          this.body = payload;
          resolve(this);
        }
        return this;
      },
    };
    const req = {
      method: route.method,
      user,
      body,
      params,
      query,
      headers: {},
      protocol: "https",
      get() { return ""; },
      on() {},
    };
    let index = 0;
    const next = () => {
      if (index >= route.handlers.length) return undefined;
      const handler = route.handlers[index++];
      return handler(req, res, next);
    };
    Promise.resolve().then(next).catch(reject);
  });
}

function approvalFixture() {
  const owner = parent("ApprovalOwner");
  const coParent = parent("ApprovalCoParent");
  const fam = family.createFamily(owner.id, "Approval Route Family");
  assert.ok(family.joinFamilyAsParent(fam.inviteCode, coParent.id).family);

  let op = operator.createCase(fam.id, {
    actor: parentActor(owner),
    roomId: "family",
    title: "Add the booked tour",
    goal: "Add the confirmed tour to the family calendar.",
    purpose: "tour-booking",
    riskLevel: "medium",
  });
  op = operator.transitionCase(fam.id, op.id, "planning", { actor: parentActor(owner), roomId: "family" });
  op = operator.transitionCase(fam.id, op.id, "proposal_ready", { actor: parentActor(owner), roomId: "family" });
  const approval = operator.requestApproval(fam.id, op.id, {
    actor: parentActor(owner),
    roomId: "family",
    approverUserId: owner.id,
    actionType: "calendar.create",
    action: {
      title: "Family tour",
      date: "2026-09-15",
      time: "09:30",
      category: "social",
      repeat: "none",
    },
  });
  operator.transitionCase(fam.id, op.id, "waiting_for_approval", { actor: parentActor(owner), roomId: "family" });
  return { owner, coParent, fam, approval };
}

test("parent approval API lists only approvals visible to that parent", async (t) => {
  try {
    require("better-sqlite3");
  } catch (error) {
    t.skip("better-sqlite3 is optional on this host");
    return;
  }
  const fixture = approvalFixture();
  const routes = buildHarness();
  const listRoute = routes["GET /api/operator/approvals"];

  const unauthenticated = await invoke(listRoute);
  assert.equal(unauthenticated.statusCode, 401);

  const ownerList = await invoke(listRoute, { user: fixture.owner, query: { state: "pending" } });
  assert.equal(ownerList.statusCode, 200);
  assert.ok(ownerList.body.approvals.some((item) => item.id === fixture.approval.id));
  assert.deepEqual(ownerList.body.supportedActionTypes, ["calendar.create"]);

  const coParentList = await invoke(listRoute, { user: fixture.coParent, query: { state: "pending" } });
  assert.equal(coParentList.statusCode, 200);
  assert.equal(coParentList.body.approvals.some((item) => item.id === fixture.approval.id), false);
});

test("parent decision API binds the session to the exact approval hash", async (t) => {
  try {
    require("better-sqlite3");
  } catch (error) {
    t.skip("better-sqlite3 is optional on this host");
    return;
  }
  const fixture = approvalFixture();
  const routes = buildHarness();
  const route = routes["POST /api/operator/approvals/:approvalId/decision"];

  const kid = store.createUser("route-kid@example.com", "Route Kid");
  kid.data.profile.role = "kid";
  const kidAttempt = await invoke(route, {
    user: kid,
    params: { approvalId: fixture.approval.id },
    body: { decision: "approve", actionHash: fixture.approval.actionHash },
  });
  assert.equal(kidAttempt.statusCode, 403);

  const coParentAttempt = await invoke(route, {
    user: fixture.coParent,
    params: { approvalId: fixture.approval.id },
    body: { decision: "approve", actionHash: fixture.approval.actionHash },
  });
  assert.equal(coParentAttempt.statusCode, 403);
  assert.equal(coParentAttempt.body.code, "APPROVAL_WRONG_APPROVER");

  const stale = await invoke(route, {
    user: fixture.owner,
    params: { approvalId: fixture.approval.id },
    body: { decision: "approve", actionHash: "0".repeat(64) },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.code, "APPROVAL_HASH_MISMATCH");

  const approved = await invoke(route, {
    user: fixture.owner,
    params: { approvalId: fixture.approval.id },
    body: { decision: "approve", actionHash: fixture.approval.actionHash },
  });
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.approval.state, "approved");
  assert.equal(approved.body.approval.decidedBy, fixture.owner.id);
  assert.equal(approved.body.execution.state, "ready");
});

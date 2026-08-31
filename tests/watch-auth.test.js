"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-watch-auth-"));

const db = require("../lib/db");
const store = require("../lib/store");
const family = require("../lib/family");
const watchAuth = require("../lib/watch-auth");
const watchRoutes = require("../lib/routes/watch");
const notifications = require("../lib/fam-notifications");

function makeFamily(label) {
  const parent = store.createUser(`${label}-parent@example.com`, `Parent ${label}`);
  const parent2 = store.createUser(`${label}-parent2@example.com`, `Other ${label}`);
  const fam = family.createFamily(parent.id, `${label} family`);
  family.joinFamilyAsParent(fam.inviteCode, parent2.id);
  const { kid } = family.addKid(fam.id, parent.id, { name: `${label} Kid` });
  return { parent, parent2, fam, kid };
}

function userRole(user) {
  return user && user.data && user.data.profile && user.data.profile.role || "parent";
}

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function buildRoutes() {
  const routes = {};
  const register = (method) => (pathName, ...handlers) => { routes[`${method} ${pathName}`] = handlers; };
  const app = { get: register("GET"), post: register("POST") };
  watchRoutes(app, {
    watchAuth,
    store,
    family,
    notifications,
    authLimiter(req, res, next) { next(); },
    requireAuth(req, res, next) {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      next();
    },
    requireParent(req, res, next) {
      if (userRole(req.user) === "kid") return res.status(403).json({ error: "Parents only." });
      next();
    },
    requireFamily(req, res, next) {
      const fam = family.familiesForUser(req.user.id)[0];
      if (!fam) return res.status(404).json({ error: "No family found." });
      req.family = fam;
      next();
    },
  });
  return routes;
}

function call(handlers, { user, body, params } = {}) {
  const req = { user, body: body || {}, params: params || {} };
  const res = response();
  let index = 0;
  const next = () => {
    const handler = handlers[index++];
    if (handler) handler(req, res, next);
  };
  next();
  return res;
}

test("pairing stores only hashes, claims once, scopes the member, and revokes", () => {
  const { parent, fam, kid } = makeFamily("model");
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const started = watchAuth.createPairing({
    familyId: fam.id,
    targetUserId: kidUser.id,
    targetType: "kid",
    targetKidId: kid.id,
    targetName: kid.name,
    createdBy: parent.id,
  });
  assert.ok(started.pairing.code);
  const diskShape = JSON.stringify(db.load());
  assert.equal(diskShape.includes(started.pairing.code), false);

  const claimed = watchAuth.claimPairing(started.pairing.code, "Riley's watch");
  assert.ok(claimed.token.startsWith("fwt_"));
  assert.equal(JSON.stringify(db.load()).includes(claimed.token), false);
  assert.equal(claimed.device.targetUserId, kidUser.id);
  assert.equal(watchAuth.claimPairing(started.pairing.code).error, "That pairing code is invalid or has expired.");

  const resolved = watchAuth.resolveToken(claimed.token);
  assert.equal(resolved.targetUserId, kidUser.id);
  assert.equal(resolved.label, "Riley's watch");
  assert.equal(watchAuth.allowedRequest("GET", "/api/family/actions"), true);
  assert.equal(watchAuth.allowedRequest("GET", "/api/chat/messages"), false);
  assert.equal(watchAuth.allowedRequest("POST", "/api/family/actions"), false);

  assert.ok(!watchAuth.revokeDevice(fam.id, claimed.device.id).error);
  assert.equal(watchAuth.resolveToken(claimed.token), null);
});

test("creating a new pairing supersedes an older pending code", () => {
  const { parent, fam } = makeFamily("supersede");
  const first = watchAuth.createPairing({
    familyId: fam.id, targetUserId: parent.id, targetType: "parent",
    targetName: parent.data.profile.name, createdBy: parent.id,
  });
  const second = watchAuth.createPairing({
    familyId: fam.id, targetUserId: parent.id, targetType: "parent",
    targetName: parent.data.profile.name, createdBy: parent.id,
  });
  assert.equal(watchAuth.claimPairing(first.pairing.code).error, "That pairing code is invalid or has expired.");
  assert.ok(watchAuth.claimPairing(second.pairing.code).token);
});

test("parent routes can start, list, and revoke a kid watch", () => {
  const { parent, fam, kid } = makeFamily("routes");
  const routes = buildRoutes();
  const start = call(routes["POST /api/watch/pairing/start"], {
    user: parent,
    body: { target: "kid", kidId: kid.id },
  });
  assert.equal(start.statusCode, 200);
  assert.equal(start.body.pairing.targetName, kid.name);
  const claimed = watchAuth.claimPairing(start.body.pairing.code, "Cellular watch");
  const listed = call(routes["GET /api/watch/devices"], { user: parent });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.body.devices[0].id, claimed.device.id);
  const revoked = call(routes["POST /api/watch/devices/:id/revoke"], {
    user: parent, params: { id: claimed.device.id },
  });
  assert.equal(revoked.statusCode, 200);
  assert.ok(revoked.body.device.revokedAt);
});

test("invalid watch pairing targets are rejected without creating a code", () => {
  const { parent, fam } = makeFamily("invalid");
  const routes = buildRoutes();
  const result = call(routes["POST /api/watch/pairing/start"], {
    user: parent,
    body: { target: "kid", kidId: "k_other_family" },
  });
  assert.equal(result.statusCode, 400);
  assert.equal(Object.values(db.load().watchAuth.pairings).filter((p) => p.familyId === fam.id).length, 0);
});

test("watch request allowlist excludes sessions, creation, deletion, and trip surfaces", () => {
  assert.equal(watchAuth.allowedRequest("GET", "/api/family/actions"), true);
  assert.equal(watchAuth.allowedRequest("PATCH", "/api/family/actions/a_1"), true);
  assert.equal(watchAuth.allowedRequest("PATCH", "/api/homework/h_1"), true);
  assert.equal(watchAuth.allowedRequest("PATCH", "/api/homework/h_1/checklist/0"), true);
  assert.equal(watchAuth.allowedRequest("PATCH", "/api/meals/shopping/s_1"), true);
  assert.equal(watchAuth.allowedRequest("POST", "/api/watch/push/register"), true);
  assert.equal(watchAuth.allowedRequest("POST", "/api/watch/push/unregister"), true);
  for (const [method, pathName] of [
    ["GET", "/api/me"],
    ["POST", "/api/family/actions"],
    ["PATCH", "/api/homework/h_1/checklist/-1"],
    ["PATCH", "/api/homework/h_1/checklist/0/text"],
    ["DELETE", "/api/meals/shopping/s_1"],
    ["GET", "/api/trips"],
    ["GET", "/api/chat/messages"],
  ]) assert.equal(watchAuth.allowedRequest(method, pathName), false, `${method} ${pathName}`);
});

test("watch push routes require a paired bearer and scope token registration to its target user", () => {
  const { parent, fam } = makeFamily("push-routes");
  const routes = buildRoutes();
  const pairing = watchAuth.createPairing({
    familyId: fam.id, targetUserId: parent.id, targetType: "parent",
    targetName: parent.data.profile.name, createdBy: parent.id,
  });
  const claimed = watchAuth.claimPairing(pairing.pairing.code, "Push watch");
  const token = "a".repeat(64);
  const missingCredential = call(routes["POST /api/watch/push/register"], { user: parent, body: { token } });
  assert.equal(missingCredential.statusCode, 403);
  const registered = call(routes["POST /api/watch/push/register"], { user: parent, body: { token } });
  // The route's requireWatch middleware is the authority; emulate the bearer
  // resolution that server.js performs before entering the route stack.
  assert.equal(registered.statusCode, 403);
  const req = { user: parent, watchAuth: watchAuth.resolveToken(claimed.token), body: { token } };
  const res = response();
  let index = 0;
  const handlers = routes["POST /api/watch/push/register"];
  const next = () => { const handler = handlers[index++]; if (handler) handler(req, res, next); };
  next();
  assert.equal(res.statusCode, 200);
  assert.equal(db.load().deviceTokens[parent.id][0].kind, "watch");
  assert.equal(db.load().deviceTokens[parent.id][0].topic, "com.fametc.watch");
});

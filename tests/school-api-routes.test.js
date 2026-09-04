"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const schoolRoutes = require("../lib/routes/school");

function buildHarness() {
  const routes = new Map();
  const app = {
    get(route, ...handlers) { routes.set(`GET ${route}`, handlers); },
    post(route, ...handlers) { routes.set(`POST ${route}`, handlers); },
  };
  const requireAuth = (req, res, next) => req.user ? next() : res.status(401).json({ error: "Not authenticated" });
  const requireParent = (req, res, next) => req.user.role === "kid" ? res.status(403).json({ error: "Parents only." }) : next();
  const requireFamily = (req, res, next) => { req.family = req.authFamily; next(); };
  const authLimiter = (req, res, next) => next();
  let savedLinks = null;
  const schoolApi = {
    encryptionAvailable: () => true,
    listStatus: () => [{ kidId: "kid-1", connected: true }],
    saveConnection(familyId, userId, kidId, links) {
      savedLinks = { familyId, userId, kidId, links };
      return { ok: true, status: { kidId, connected: true } };
    },
    async syncKid(familyId, kidId) { return { ok: true, status: { kidId, connected: true } }; },
    async syncFamily() { return { results: [], events: [], errors: [] }; },
    disconnect() { return { ok: true, deleted: true }; },
  };
  schoolRoutes(app, {
    schoolApi,
    schoolAccount: {
      hasAccount: () => false,
      encryptionAvailable: () => true,
      listKidMappings: () => [],
      getMoodleUserId: () => null,
    },
    moodleClient: {},
    family: { kidBelongsToFamily: (familyId, kidId) => familyId === "family-1" && kidId === "kid-1" },
    homework: { listPendingMoodleCompletions: () => ({ completions: [], hasMore: false }) },
    actions: {},
    requireAuth,
    requireParent,
    requireFamily,
    authLimiter,
  });
  return { routes, middleware: { requireAuth, requireParent, requireFamily, authLimiter }, getSavedLinks: () => savedLinks };
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

async function execute(handlers, req) {
  const res = response();
  async function run(index) {
    if (index >= handlers.length) return;
    let nextCalled = false;
    await handlers[index](req, res, () => { nextCalled = true; });
    if (nextCalled) await run(index + 1);
  }
  await run(0);
  return res;
}

test("private feed routes are parent-only and status returns redacted connection metadata", async () => {
  const { routes, middleware } = buildHarness();
  const saveHandlers = routes.get("POST /api/school/feeds");
  assert.deepEqual(saveHandlers.slice(0, 4), [middleware.requireAuth, middleware.requireParent, middleware.requireFamily, middleware.authLimiter]);
  assert.deepEqual(routes.get("POST /api/school/feeds/sync").slice(0, 3), [middleware.requireAuth, middleware.requireParent, middleware.requireFamily]);
  assert.deepEqual(routes.get("POST /api/school/feeds/disconnect").slice(0, 3), [middleware.requireAuth, middleware.requireParent, middleware.requireFamily]);
  const kidResponse = await execute(saveHandlers, {
    user: { id: "kid-user", role: "kid" }, authFamily: { id: "family-1" },
    body: { kidId: "kid-1", homeworkUrl: "secret-homework", timetableUrl: "secret-timetable" },
  });
  assert.equal(kidResponse.statusCode, 403);

  const status = await execute(routes.get("GET /api/school/status"), {
    user: { id: "parent-1", role: "parent" }, authFamily: { id: "family-1" }, body: {},
  });
  assert.equal(status.statusCode, 200);
  assert.equal(status.headers["Cache-Control"], "no-store");
  assert.deepEqual(status.body.feedConnections, [{ kidId: "kid-1", connected: true }]);
  assert.equal(JSON.stringify(status.body).includes("secret"), false);
});

test("parent save passes links only to secure storage and returns no secret", async () => {
  const { routes, getSavedLinks } = buildHarness();
  const body = { kidId: "kid-1", homeworkUrl: "secret-homework", timetableUrl: "secret-timetable" };
  const result = await execute(routes.get("POST /api/school/feeds"), {
    user: { id: "parent-1", role: "parent" }, authFamily: { id: "family-1" }, body,
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(getSavedLinks(), { familyId: "family-1", userId: "parent-1", kidId: "kid-1", links: { homeworkUrl: "secret-homework", timetableUrl: "secret-timetable" } });
  assert.equal(JSON.stringify(result.body).includes("secret"), false);
});

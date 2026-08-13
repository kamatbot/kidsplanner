"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const learningRoutes = require("../lib/routes/learning");

function buildHarness(news) {
  const routes = {};
  const app = {
    get(route, ...handlers) { routes[`GET ${route}`] = handlers; },
    post() {},
    patch() {},
    delete() {},
  };
  const requireAuth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    next();
  };
  learningRoutes(app, {
    news,
    notes: {},
    wordbank: {},
    brainteaser: {},
    family: {},
    requireAuth,
    requireFamily: (req, res, next) => next(),
    userRole: () => "parent",
    kidIdForUser: () => null,
  });
  return routes["GET /api/news/recent"];
}

async function call(handlers, user) {
  const req = { user };
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let index = 0;
  const next = async () => {
    const handler = handlers[index++];
    if (handler) await handler(req, res, next);
  };
  await next();
  return res;
}

test("recent news requires authentication and returns the service DTO without storage", async () => {
  const dto = {
    items: [{
      id: "story",
      cat: "🚀 Space",
      headline: "Recent story",
      summary: "Summary",
      url: "https://www.nasa.gov/story/",
      publishedAt: "2026-08-10T00:00:00.000Z",
      source: "NASA",
      question: "What should scientists investigate next?",
    }],
    maxAgeDays: 14,
  };
  let calls = 0;
  const route = buildHarness({ async getRecentNews() { calls += 1; return dto; } });

  const anonymous = await call(route, null);
  assert.equal(anonymous.statusCode, 401);
  assert.equal(calls, 0);

  const authenticated = await call(route, { id: "user_1" });
  assert.equal(authenticated.statusCode, 200);
  assert.deepEqual(authenticated.body, dto);
  assert.equal(authenticated.headers["Cache-Control"], "no-store");
  assert.equal(calls, 1);
});

test("recent news fails closed to an empty fresh response", async () => {
  const route = buildHarness({ async getRecentNews() { throw new Error("upstream unavailable"); } });
  const response = await call(route, { id: "user_1" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { items: [], maxAgeDays: 14 });
  assert.equal(response.headers["Cache-Control"], "no-store");
});

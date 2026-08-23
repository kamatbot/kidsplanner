"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const learningRoutes = require("../lib/routes/learning");
const dailyPuzzles = require("../lib/daily-puzzles");

function buildRoute(news = {}) {
  const routes = {};
  const app = {
    get(route, ...handlers) { routes[`GET ${route}`] = handlers; },
    post() {},
    patch() {},
    delete() {},
  };
  const requireAuth = (req, res, next) => req.user
    ? next()
    : res.status(401).json({ error: "Not authenticated" });
  const requireFamily = (req, res, next) => req.family
    ? next()
    : res.status(403).json({ error: "Family required" });

  learningRoutes(app, {
    dailyPuzzles,
    news,
    notes: {},
    wordbank: {},
    brainteaser: {},
    family: {},
    requireAuth,
    requireFamily,
    userRole: () => "parent",
    kidIdForUser: () => null,
  });
  return routes["GET /api/enrichment/puzzle/today"];
}

async function call(handlers, { user = null, family = null, date } = {}) {
  const req = { user, family, query: { date } };
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

test("daily puzzle route requires an authenticated family and uses the client local date", async () => {
  const route = buildRoute();
  const anonymous = await call(route, { date: "2026-08-15" });
  assert.equal(anonymous.statusCode, 401);

  const noFamily = await call(route, { user: { id: "user_1" }, date: "2026-08-15" });
  assert.equal(noFamily.statusCode, 403);

  const response = await call(route, {
    user: { id: "user_1" },
    family: { id: "family_1" },
    date: "2026-08-15",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.date, "2026-08-15");
  assert.equal(response.body.type, "crossword");
  assert.equal(response.body.crossword.entries.length, 10);
  assert.equal(response.headers["Cache-Control"], "no-store");
});

test("daily puzzle route rejects malformed dates without producing a puzzle", async () => {
  const response = await call(buildRoute(), {
    user: { id: "user_1" },
    family: { id: "family_1" },
    date: "2026-02-30",
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "Use a real date in YYYY-MM-DD format." });
});

test("weekend route awaits same-week news, while weekdays do not fetch it", async () => {
  let calls = 0;
  const route = buildRoute({
    getRecentNews: async () => {
      calls++;
      return {
        items: [
          { id: "story-1", source: "Science News Explores", headline: "Healing Coral", answer: "HEALING", publishedAt: "2026-08-10T12:00:00Z" },
          { id: "story-2", headline: "Robot Builders", answer: "ROBOT", publishedAt: "2026-08-11T12:00:00Z" },
          { id: "story-3", headline: "Ocean Tides", answer: "OCEAN", publishedAt: "2026-08-12T12:00:00Z" },
          { id: "out-of-week", headline: "Outside Week", answer: "OUTSIDE", publishedAt: "2026-08-17T12:00:00Z" },
        ],
      };
    },
  });
  const weekend = await call(route, {
    user: { id: "user_1" }, family: { id: "family_1" }, date: "2026-08-15",
  });
  assert.equal(weekend.statusCode, 200);
  assert.equal(calls, 1);
  const weekendAnswers = weekend.body.crossword.entries.map((entry) => entry.answer);
  assert.ok(weekendAnswers.includes("HEALING"));
  assert.ok(weekendAnswers.includes("ROBOT"));
  assert.ok(weekendAnswers.includes("OCEAN"));
  assert.equal(weekendAnswers.includes("OUTSIDE"), false);
  assert.equal(weekend.body.crossword.entries.length, 10);

  const weekday = await call(route, {
    user: { id: "user_1" }, family: { id: "family_1" }, date: "2026-08-13",
  });
  assert.deepEqual(weekday.body, { date: "2026-08-13", available: false, type: null });
  assert.equal(calls, 1);
});

test("news failure returns the deterministic SAT/static fallback", async () => {
  const route = buildRoute({ getRecentNews: async () => { throw new Error("offline"); } });
  const response = await call(route, {
    user: { id: "user_1" }, family: { id: "family_1" }, date: "2026-08-16",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.crossword.entries.length, 10);
  assert.equal(new Set(response.body.crossword.entries.map((entry) => entry.answer)).size, 10);
});

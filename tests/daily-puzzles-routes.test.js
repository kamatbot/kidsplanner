"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const learningRoutes = require("../lib/routes/learning");
const dailyPuzzles = require("../lib/daily-puzzles");

function buildRoute(news = {}, records = {}) {
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
    wordbank: { listWords: player => ({ words: records[player] || [] }) },
    brainteaser: {},
    family: {},
    requireAuth,
    requireFamily,
    userRole: user => user.role || "parent",
    kidIdForUser: req => req.user.kidId,
  });
  return routes["GET /api/enrichment/puzzle/today"];
}

async function call(handlers, { user = null, family = null, date, schedule, kidId } = {}) {
  const req = { user, family, query: { date, schedule, kidId } };
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
  assert.equal(response.body.crossword.entries.length, 7);
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

test("weekday crosswords fetch news; weekend shared SAT and Sudoku do not", async () => {
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
        ].map((item) => ({ ...item, source: 'BBC', url: `https://www.bbc.com/news/${item.id}` })),
      };
    },
  });
  const weekend = await call(route, {
    user: { id: "user_1" }, family: { id: "family_1" }, date: "2026-08-15",
  });
  assert.equal(weekend.statusCode, 200);
  assert.equal(calls, 0);
  const weekendAnswers = weekend.body.crossword.entries.map((entry) => entry.answer);
  assert.equal(weekendAnswers.includes("HEALING"), false);
  assert.equal(weekendAnswers.includes("ROBOT"), false);
  assert.equal(weekendAnswers.includes("OCEAN"), false);
  assert.equal(weekendAnswers.includes("OUTSIDE"), false);
  assert.equal(weekend.body.crossword.entries.length, 7);

  const weekday = await call(route, {
    user: { id: "user_1" }, family: { id: "family_1" }, date: "2026-08-13",
  });
  assert.equal(weekday.body.type, 'crossword');
  assert.equal(calls, 1);
  for (const date of ['2026-08-10', '2026-08-12', '2026-08-14']) {
    const response = await call(route, { user: { id: 'user_1' }, family: { id: 'family_1' }, date });
    assert.equal(response.body.type, 'sudoku');
  }
  assert.equal(calls, 1);
});

test("news failure returns the deterministic SAT/static fallback", async () => {
  const route = buildRoute({ getRecentNews: async () => { throw new Error("offline"); } });
  const response = await call(route, {
    user: { id: "user_1" }, family: { id: "family_1" }, date: "2026-08-16",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.crossword.entries.length, 7);
  assert.equal(new Set(response.body.crossword.entries.map((entry) => entry.answer)).size, 7);
});


test('weekly-capable clients get scheduled questions while installed older clients retain supported puzzles', async () => {
  const route = buildRoute({ getRecentNews: async () => ({ items: [] }) });
  const scope = { user: {id:'kid'}, family: {id:'family'} };
  const older = await call(route, {...scope, date:'2026-09-25'});
  assert.equal(older.body.type, 'sudoku');
  assert.ok(older.body.sudoku && older.body.available);
  const current = await call(route, {...scope, date:'2026-09-25', schedule:'weekly'});
  assert.equal(current.body.type, 'sat');
  assert.equal(current.body.question.options.length, 4);
  const monday = await call(route, {...scope, date:'2026-09-21', schedule:'weekly'});
  assert.equal(monday.body.type, 'brainteaser');
});


test("crossword practice ignores supplied kid identity and keeps each player scoped", async () => {
  const word = require('../lib/vocabulary-challenges').getDailyVocabulary('2026-09-21').word.word;
  const route = buildRoute({}, { child: [{ word, seenCount: 1, lastSeen: '2026-09-21T12:00:00Z', lastWrongAt: '2026-09-21T12:00:00Z' }] });
  const common = { family: {id:'family'}, date:'2026-09-26', schedule:'weekly', kidId:'child' };
  const child = await call(route, {...common,user:{id:'child-user',role:'kid',kidId:'child'},kidId:'sibling'});
  assert.equal(child.body.practiceWords.find(item=>item.word===word).reason,'missed');
  const sibling = await call(route,{...common,user:{id:'sibling-user',role:'kid',kidId:'sibling'}});
  assert.equal(sibling.body.practiceWords.find(item=>item.word===word).reason,'untried');
  const parent = await call(route,{...common,user:{id:'parent'}});
  assert.equal(parent.body.practiceWords.find(item=>item.word===word).reason,'untried');
  const unlinked = await call(route,{...common,user:{id:'unlinked',role:'kid'}});
  assert.equal(unlinked.statusCode,403);
});

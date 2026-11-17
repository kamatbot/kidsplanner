"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-guesses-"));

const store = require("../lib/store");
const family = require("../lib/family");
const events = require("../lib/events");
const calendarRoutes = require("../lib/routes/calendar");
const assistantMemory = require("../lib/assistant-memory");

function buildHarness() {
  const routes = {};
  const register = (method) => (p, ...handlers) => {
    const paths = Array.isArray(p) ? p : [p];
    for (const singlePath of paths) {
      routes[`${method} ${singlePath}`] = handlers;
    }
  };
  const app = { get: register("GET"), post: register("POST"), patch: register("PATCH"), delete: register("DELETE") };

  const userRole = (user) => (user && user.data && user.data.kid ? "kid" : "parent");
  const kidIdForUser = (req) => req.user && req.user.data && req.user.data.kid && req.user.data.kid.kidId;

  calendarRoutes(app, {
    store,
    events,
    schoolFeeds: {
      syncFamily: async () => ({ events: [], errors: [] }),
    },
    trips: null,
    meals: null,
    actions: null,
    homework: null,
    chat: {
      sendMessage: () => {},
      getMessage: () => null,
    },
    requireAuth: (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: "Sign in required" });
      next();
    },
    requireParent: (req, res, next) => {
      if (userRole(req.user) === "kid") return res.status(403).json({ error: "Parents only." });
      next();
    },
    requireFamily: (req, res, next) => {
      if (!req.family) return res.status(404).json({ error: "No family" });
      next();
    },
    userRole,
    kidIdForUser,
    friendlyDate: (d) => d,
  });

  return { routes };
}

async function invoke(handlers, { body = {}, params = {}, query = {}, user = null, family = null } = {}) {
  const req = { body, params, query, user, family };
  let statusCode = 200;
  let responseData = null;
  const res = {
    set: () => res,
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
      responseData = data;
      return res;
    },
  };

  for (const fn of handlers) {
    let nextCalled = false;
    await fn(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }

  return { status: statusCode, body: responseData };
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

test("pencil guesses: parent gets missing routine occurrences as guesses", async () => {
  const { routes } = buildHarness();

  const parent = store.createUser("tom@example.com", "Tom Walker");
  const fam = family.createFamily(parent.id, "Walker Family");
  const kidRes = family.addKid(fam.id, parent.id, "Mia", "2014-05-10");
  const kid = kidRes.kid;

  // Learn a routine: Mia does Swimming every Tuesday at 16:00
  // An entry in 3 of the last 6 weeks, and in 2 of the last 3
  const today = new Date().toISOString().slice(0, 10);
  // Find Tuesdays in the past 6 weeks
  for (let w = 1; w <= 4; w++) {
    // 7 * w days ago
    const pastDate = addDays(today, -7 * w);
    events.addEvent(fam.id, {
      title: "Swimming",
      date: pastDate,
      time: "16:00",
      endTime: "17:00",
      kidId: kid.id,
      createdBy: parent.id,
    });
  }

  // GET /api/calendar/guesses as parent
  const parentRes = await invoke(routes["GET /api/calendar/guesses"], {
    user: parent,
    family: fam,
    query: { from: today, to: addDays(today, 7) },
  });

  assert.equal(parentRes.status, 200);
  assert.ok(Array.isArray(parentRes.body.guesses));
  assert.ok(parentRes.body.guesses.length >= 1, "Expected at least 1 routine gap guess");
  const guess = parentRes.body.guesses[0];
  assert.equal(guess.title, "Swimming");
  assert.equal(guess.time, "16:00");
  assert.equal(guess.isGuess, true);
  assert.equal(guess.sourceLabel, "Guess");
  assert.ok(guess.id.startsWith("guess_"));
});

test("pencil guesses: kid session receives 403 Forbidden", async () => {
  const { routes } = buildHarness();

  const parent = store.createUser("kate2@example.com", "Kate Walker");
  const fam = family.createFamily(parent.id, "Walker Family 2");
  const kidRes = family.addKid(fam.id, parent.id, "Leo", "2016-08-12");
  const kidUser = store.findOrCreateKidUser(fam.id, kidRes.kid.id, "Leo");

  const today = new Date().toISOString().slice(0, 10);

  // Kid attempts GET /api/calendar/guesses
  const kidGet = await invoke(routes["GET /api/calendar/guesses"], {
    user: kidUser,
    family: fam,
    query: { from: today, to: addDays(today, 7) },
  });
  assert.equal(kidGet.status, 403, "Kids must receive 403 on GET guesses");
  assert.equal(kidGet.body.error, "Parents only.");

  // Kid attempts POST /api/calendar/guesses/dismiss
  const kidDismiss = await invoke(routes["POST /api/calendar/guesses/dismiss"], {
    user: kidUser,
    family: fam,
    body: { id: "guess_test123" },
  });
  assert.equal(kidDismiss.status, 403, "Kids must receive 403 on dismiss");

  // Kid attempts POST /api/calendar/guesses/add
  const kidAdd = await invoke(routes["POST /api/calendar/guesses/add"], {
    user: kidUser,
    family: fam,
    body: { id: "guess_test123", title: "Football", date: today },
  });
  assert.equal(kidAdd.status, 403, "Kids must receive 403 on add guess");
});

test("pencil guesses: dismiss auto-expires and excludes from guesses", async () => {
  const { routes } = buildHarness();

  const parent = store.createUser("alice@example.com", "Alice Smith");
  const fam = family.createFamily(parent.id, "Smith Family");
  const kidRes = family.addKid(fam.id, parent.id, "Ben", "2015-03-01");
  const kid = kidRes.kid;

  const today = new Date().toISOString().slice(0, 10);
  for (let w = 1; w <= 4; w++) {
    events.addEvent(fam.id, {
      title: "Piano Lesson",
      date: addDays(today, -7 * w),
      time: "15:00",
      kidId: kid.id,
      createdBy: parent.id,
    });
  }

  // Get initial guesses
  const res1 = await invoke(routes["GET /api/calendar/guesses"], {
    user: parent,
    family: fam,
    query: { from: today, to: addDays(today, 7) },
  });
  assert.equal(res1.status, 200);
  assert.ok(res1.body.guesses.length >= 1);
  const guessId = res1.body.guesses[0].id;

  // Dismiss guess
  const dismissRes = await invoke(routes["POST /api/calendar/guesses/dismiss"], {
    user: parent,
    family: fam,
    body: { id: guessId },
  });
  assert.equal(dismissRes.status, 200);
  assert.equal(dismissRes.body.ok, true);

  // Subsequent GET excludes dismissed guess
  const res2 = await invoke(routes["GET /api/calendar/guesses"], {
    user: parent,
    family: fam,
    query: { from: today, to: addDays(today, 7) },
  });
  assert.equal(res2.status, 200);
  assert.ok(!res2.body.guesses.some((g) => g.id === guessId), "Dismissed guess should not appear");
});

test("pencil guesses: Add it creates the real event via Sunday card confirm path with Hermes sourceLabel", async () => {
  const { routes } = buildHarness();

  const parent = store.createUser("carol@example.com", "Carol Danvers");
  const fam = family.createFamily(parent.id, "Danvers Family");
  const kidRes = family.addKid(fam.id, parent.id, "Kamala", "2012-10-20");
  const kid = kidRes.kid;

  const today = new Date().toISOString().slice(0, 10);
  for (let w = 1; w <= 4; w++) {
    events.addEvent(fam.id, {
      title: "Karate",
      date: addDays(today, -7 * w),
      time: "17:30",
      endTime: "18:30",
      kidId: kid.id,
      createdBy: parent.id,
    });
  }

  // Get guesses
  const res1 = await invoke(routes["GET /api/calendar/guesses"], {
    user: parent,
    family: fam,
    query: { from: today, to: addDays(today, 7) },
  });
  const guess = res1.body.guesses[0];
  assert.ok(guess);

  // Add guess
  const addRes = await invoke(routes["POST /api/calendar/guesses/add"], {
    user: parent,
    family: fam,
    body: {
      id: guess.id,
      title: guess.title,
      date: guess.date,
      time: guess.time,
      endTime: guess.endTime,
      kidId: guess.kidId,
      category: guess.category,
    },
  });
  assert.equal(addRes.status, 200);
  assert.ok(addRes.body.ok);
  assert.ok(addRes.body.eventId);
  assert.equal(addRes.body.event.sourceLabel, "Hermes", "Event created by Hermes operator execution has Hermes sourceLabel");

  // Verify it appears in GET /api/calendar/events
  const calRes = await invoke(routes["GET /api/calendar/events"], {
    user: parent,
    family: fam,
    query: { from: today, to: addDays(today, 7) },
  });
  assert.equal(calRes.status, 200);
  const createdCalEvent = calRes.body.events.find((e) => e.id === addRes.body.eventId);
  assert.ok(createdCalEvent, "Event should appear on family calendar");
  assert.equal(createdCalEvent.sourceLabel, "Hermes");
});

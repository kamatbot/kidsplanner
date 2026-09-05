"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

function makeApp() {
  const routes = new Map();
  const register = (method) => (path, ...handlers) => routes.set(`${method} ${path}`, handlers.at(-1));
  return {
    routes,
    get: register("GET"),
    post: register("POST"),
    patch: register("PATCH"),
    delete: register("DELETE"),
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

function kidUser() {
  return { id: "u_kid", data: { profile: { role: "kid" }, kid: { familyId: "f1", kidId: "k1" } } };
}

function installRoutes() {
  const app = makeApp();
  const familyEvents = [
    { id: "family", kidId: null, title: "Family event" },
    { id: "mine", kidId: "k1", title: "Mine" },
    { id: "sibling", kidId: "k2", title: "Sibling" },
  ];
  const schoolEvents = [
    { uid: "own-school", kidId: "k1", title: "Own school" },
    { uid: "sibling-school", kidId: "k2", title: "Sibling school" },
  ];

  require("../lib/routes/calendar")(app, {
    schoolFeeds: {
      listFeedsForFamily() {
        return {
          builtin: [],
          subscriptions: [
            { id: "own-feed", kidId: "k1", customUrl: "https://secret.example/own.ics", label: "Own" },
            { id: "sibling-feed", kidId: "k2", customUrl: "https://secret.example/sibling.ics", label: "Sibling" },
          ],
          lastSyncAt: null,
        };
      },
      async syncFamily() { return { events: schoolEvents, errors: [{ subscriptionId: "sibling-feed", label: "Sibling", error: "secret" }] }; },
      previewFeed: async () => ({ ok: false }),
      subscribe: () => ({ error: "unused" }),
      unsubscribe: () => ({ error: "unused" }),
      hideEvent: () => ({ error: "unused" }),
    },
    schoolApi: null,
    homework: { removeBySource() {} },
    actions: null,
    events: {
      listEvents: () => familyEvents,
      canManage: () => false,
      getById: () => null,
      getBySource: () => null,
      addEvent: () => ({ error: "unused" }),
      updateEvent: () => ({ error: "unused" }),
      removeEvent: () => ({ error: "unused" }),
    },
    chat: { sendMessage() {}, getMessage() { return null; } },
    trips: { allTrips: () => [], accessFor: () => "none" },
    meals: { getState: () => ({ prefs: {}, menu: [] }) },
    requireAuth: (_req, _res, next) => next(),
    requireParent: (_req, _res, next) => next(),
    requireFamily: (_req, _res, next) => next(),
    userRole: (user) => user.data.profile.role,
    kidIdForUser: (req) => req.user.data.kid.kidId,
    friendlyDate: (value) => value,
  });
  return app;
}

test("kid calendar event payload excludes sibling-scoped rows", () => {
  const app = installRoutes();
  const handler = app.routes.get("GET /api/calendar/events");
  const req = { user: kidUser(), family: { id: "f1", parentIds: [], kids: [] }, query: {} };
  const res = responseRecorder();
  handler(req, res);
  assert.deepEqual(res.body.events.map((event) => event.id), ["family", "mine"]);
});

test("kid feed payload includes only own metadata and never custom URLs", () => {
  const app = installRoutes();
  const handler = app.routes.get("GET /api/calendar/feeds");
  const req = { user: kidUser(), family: { id: "f1" } };
  const res = responseRecorder();
  handler(req, res);
  assert.deepEqual(res.body.subscriptions.map((sub) => sub.id), ["own-feed"]);
  assert.equal(res.body.subscriptions[0].customUrl, undefined);
});

test("kid calendar sync response excludes sibling events and diagnostics", async () => {
  const app = installRoutes();
  const handler = app.routes.get("POST /api/calendar/sync");
  const req = { user: kidUser(), family: { id: "f1" }, body: {} };
  const res = responseRecorder();
  await handler(req, res);
  assert.deepEqual(res.body.events.map((event) => event.uid), ["own-school"]);
  assert.deepEqual(res.body.errors, []);
});

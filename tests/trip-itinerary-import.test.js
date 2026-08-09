"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-trip-itinerary-import-"));

const db = require("../lib/db");
const store = require("../lib/store");
const family = require("../lib/family");
const trips = require("../lib/trips");
const chat = require("../lib/chat");
const hermes = require("../lib/hermes");
const tripItineraryImport = require("../lib/trip-itinerary-import");
const tripsRoutes = require("../lib/routes/trips");

function userRole(user) {
  return (user && user.data && user.data.profile && user.data.profile.role) || "parent";
}

function buildHarness(notifyCalls = []) {
  const routes = {};
  const register = (method) => (pattern, ...handlers) => {
    routes[`${method} ${pattern}`] = { method, handlers };
  };
  tripsRoutes({
    get: register("GET"),
    post: register("POST"),
    patch: register("PATCH"),
    delete: register("DELETE"),
  }, {
    trips,
    store,
    family,
    chat,
    userRole,
    notifications: {
      notifyTripEvent: async (...args) => notifyCalls.push(args),
      notifyTripChatMessage: async () => {},
    },
    requireAuth: (req, res, next) => (req.user ? next() : res.status(401).json({ error: "Not authenticated" })),
    authLimiter: (req, res, next) => next(),
  });
  return routes;
}

function call(route, { body, params, user } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const res = {
      statusCode: 200,
      body: null,
      set() { return this; },
      status(code) { this.statusCode = code; return this; },
      json(value) {
        if (settled) return this;
        settled = true;
        this.body = value;
        resolve(this);
        return this;
      },
    };
    const req = {
      method: route.method,
      body: body || {},
      params: params || {},
      query: {},
      user: user || null,
    };
    let index = 0;
    const next = () => {
      index++;
      if (index < route.handlers.length) return route.handlers[index](req, res, next);
      return undefined;
    };
    try {
      Promise.resolve(route.handlers[0](req, res, next)).catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

let counter = 0;
function freshParent(label) {
  counter++;
  return store.createUser(`${label}${counter}@example.com`, `Parent ${label}${counter}`);
}

function makeTrip(label = "Import") {
  const owner = freshParent(label);
  const fam = family.createFamily(owner.id, `${label} Family`);
  const result = trips.createTrip(owner.id, fam.id, {
    name: `${label} Trip`,
    destination: "Rome, IT",
    startDate: "2026-09-01",
    endDate: "2026-09-10",
  });
  return { owner, fam, trip: result.trip };
}

function rowTable(rows = [
  ["Day 1", "9:30 pm", "Colosseum", "sight", "Tickets"],
  ["2026-09-02", "10:00", "Dinner / market", "food", "Keep alternatives"],
]) {
  return [
    "| Date | Time | Activity | Category | Note |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

test("Trip itinerary parser handles row and daypart tables deterministically", () => {
  const trip = { startDate: "2026-09-01", endDate: "2026-09-10" };
  const rowItems = tripItineraryImport.parse(rowTable(), trip);
  assert.deepEqual(rowItems, [
    {
      key: "2026-09-01|21:30|colosseum",
      date: "2026-09-01",
      time: "21:30",
      title: "Colosseum",
      category: "sight",
      note: "Tickets",
    },
    {
      key: "2026-09-02|10:00|dinner / market",
      date: "2026-09-02",
      time: "10:00",
      title: "Dinner / market",
      category: "food",
      note: "Keep alternatives",
    },
  ]);

  const matrix = [
    "| Day | Morning | Afternoon | Evening | Notes |",
    "| --- | --- | --- | --- | --- |",
    "| Day 1 | Breakfast at cafe | [Museum](https://example.test) | Dinner | Shared row note must not copy |",
  ].join("\n");
  assert.deepEqual(tripItineraryImport.parse(matrix, trip).map(({ key, date, time, title, category, note }) => ({
    key, date, time, title, category, note,
  })), [
    { key: "2026-09-01||breakfast at cafe", date: "2026-09-01", time: "", title: "Breakfast at cafe", category: "food", note: "" },
    { key: "2026-09-01||museum", date: "2026-09-01", time: "", title: "Museum", category: "sight", note: "" },
    { key: "2026-09-01||dinner", date: "2026-09-01", time: "", title: "Dinner", category: "food", note: "" },
  ]);
});

test("Trip itinerary parser rejects ambiguous dates, duplicates, malformed rows, and bounds", () => {
  const trip = { startDate: "2026-09-01", endDate: "2026-09-10" };
  assert.throws(() => tripItineraryImport.parse(rowTable([["Monday", "", "Museum", "sight", ""]]), trip), /ambiguous|exact dates|Day N/i);
  assert.throws(() => tripItineraryImport.parse(rowTable([
    ["2026-09-11", "", "Outside", "activity", ""],
  ]), trip), /date range/i);
  assert.throws(() => tripItineraryImport.parse(rowTable([
    ["Day 1", "", "Same", "activity", "one"],
    ["2026-09-01", "", " same ", "activity", "two"],
  ]), trip), /duplicate/i);
  assert.throws(() => tripItineraryImport.parse(rowTable([["Day 1", "25:00", "Bad time", "activity", ""]]), trip), /time/i);
  assert.throws(() => tripItineraryImport.parse([
    "| Date | Activity |",
    "| --- | --- |",
    "| Day 1 | A | B |",
  ].join("\n"), trip), /malformed/i);

  const tooMany = Array.from({ length: 15 }, (_, index) => ["Day 1", "", `Stop ${index}`, "activity", ""]);
  assert.throws(() => tripItineraryImport.parse(rowTable(tooMany), trip), /large|duplicate/i);
  assert.equal(tripItineraryImport.isParseable("ordinary chat", trip), false);
});

test("Trip itinerary import previews exact duplicates and confirms one additive batch idempotently", async () => {
  const notifyCalls = [];
  const routes = buildHarness(notifyCalls);
  const { owner, trip } = makeTrip("Route");
  const source = hermes.sendAgentMessage(`trip:${trip.id}`, rowTable()).message;
  assert.deepEqual(source.card, hermes.TRIP_ITINERARY_DRAFT_CARD);

  const duplicate = trips.addItineraryItem(trip.id, owner.id, {
    date: "2026-09-01", time: "21:30", title: "Colosseum", category: "sight",
  }).item;
  const beforeActivity = trips.getTrip(trip.id).activity.length;
  const beforeChat = chat.listMessages(`trip:${trip.id}`).length;
  const preview = await call(routes["POST /api/trips/:tripId/itinerary/import-chat/:messageId/preview"], {
    user: owner, params: { tripId: trip.id, messageId: source.id }, body: { text: "client text must be ignored" },
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.imported, false);
  assert.equal(preview.body.items.length, 2);
  assert.equal(preview.body.duplicates.length, 1);
  assert.equal(preview.body.duplicates[0].existingItemId, duplicate.id);
  assert.equal(trips.getTrip(trip.id).itinerary.length, 1);
  assert.equal(trips.getTrip(trip.id).activity.length, beforeActivity);
  assert.equal(chat.listMessages(`trip:${trip.id}`).length, beforeChat);

  const confirmed = await call(routes["POST /api/trips/:tripId/itinerary/import-chat/:messageId"], {
    user: owner, params: { tripId: trip.id, messageId: source.id }, body: {},
  });
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.body.existing, false);
  assert.equal(confirmed.body.importedItems.length, 1);
  assert.equal(confirmed.body.skippedDuplicates.length, 1);
  assert.equal(confirmed.body.importedItems[0].source, "hermes");
  assert.equal(confirmed.body.importedItems[0].sourceType, "chat");
  assert.equal(confirmed.body.importedItems[0].sourceId, source.id);
  assert.equal(chat.listMessages(`trip:${trip.id}`).slice(-1)[0].card.type, "trip-itinerary");
  assert.equal(trips.getTrip(trip.id).itinerary.length, 2);
  assert.equal(trips.getTrip(trip.id).activity.length, beforeActivity + 1);
  assert.equal(chat.listMessages(`trip:${trip.id}`).length, beforeChat + 1);
  assert.equal(notifyCalls.length, 1);

  const afterFirst = JSON.stringify(trips.getTrip(trip.id));
  const afterFirstChat = chat.listMessages(`trip:${trip.id}`).length;
  const retry = await call(routes["POST /api/trips/:tripId/itinerary/import-chat/:messageId"], {
    user: owner, params: { tripId: trip.id, messageId: source.id }, body: { anything: "ignored" },
  });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.existing, true);
  assert.equal(retry.body.importedItems.length, 1);
  assert.equal(JSON.stringify(trips.getTrip(trip.id)), afterFirst);
  assert.equal(chat.listMessages(`trip:${trip.id}`).length, afterFirstChat);
  assert.equal(notifyCalls.length, 1);

  // A source that contains only already-present items is still a successful
  // new-source no-op and creates no summary event.
  const allDuplicateSource = hermes.sendAgentMessage(`trip:${trip.id}`, rowTable()).message;
  const allDuplicate = await call(routes["POST /api/trips/:tripId/itinerary/import-chat/:messageId"], {
    user: owner, params: { tripId: trip.id, messageId: allDuplicateSource.id },
  });
  assert.equal(allDuplicate.statusCode, 200);
  assert.equal(allDuplicate.body.existing, false);
  assert.equal(allDuplicate.body.importedItems.length, 0);
  assert.equal(allDuplicate.body.skippedDuplicates.length, 2);
  assert.equal(notifyCalls.length, 1);
});

test("Trip itinerary import enforces trip source and permissions, and preserves imported retries after source deletion", async () => {
  const routes = buildHarness();
  const { owner, fam, trip } = makeTrip("Boundary");
  const editor = freshParent("Editor");
  assert.ok(trips.joinByCode(trip.inviteCode, editor.id).trip);
  const { kid } = family.addKid(fam.id, owner.id, { name: "Kid" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const stranger = freshParent("Stranger");
  const source = hermes.sendAgentMessage(`trip:${trip.id}`, rowTable([["Day 1", "", "Museum", "sight", ""]])).message;

  const familySource = chat.sendMessage(fam.id, {
    senderType: "agent", senderId: "hermes", postedByUserId: null, text: rowTable(), card: hermes.TRIP_ITINERARY_DRAFT_CARD,
  }).message;
  const foreignTrip = makeTrip("Foreign").trip;
  const foreignSource = hermes.sendAgentMessage(`trip:${foreignTrip.id}`, rowTable()).message;
  const wrongCard = chat.sendMessage(`trip:${trip.id}`, {
    senderType: "agent", senderId: "hermes", postedByUserId: null, text: rowTable(),
    card: { type: "trip-itinerary-draft", id: "wrong-card", title: "Itinerary ready" },
  }).message;
  const missingCard = chat.sendMessage(`trip:${trip.id}`, {
    senderType: "agent", senderId: "hermes", postedByUserId: null, text: rowTable(),
  }).message;
  const system = chat.sendMessage(`trip:${trip.id}`, {
    senderType: "agent", senderId: "hermes", postedByUserId: null, text: rowTable(), card: hermes.TRIP_ITINERARY_DRAFT_CARD,
  }).message;
  const deleted = chat.sendMessage(`trip:${trip.id}`, {
    senderType: "agent", senderId: "hermes", postedByUserId: null, text: rowTable(), card: hermes.TRIP_ITINERARY_DRAFT_CARD,
  }).message;
  assert.equal(chat.deleteMessage(`trip:${trip.id}`, owner.id, deleted.id).message.deleted, true);

  const originalGetMessage = chat.getMessage;
  chat.getMessage = (scope, id) => id === system.id
    ? Object.assign({}, originalGetMessage(scope, id), { senderType: "system" })
    : originalGetMessage(scope, id);

  try {
    const anon = await call(routes["POST /api/trips/:tripId/itinerary/import-chat/:messageId/preview"], {
      params: { tripId: trip.id, messageId: source.id },
    });
    assert.equal(anon.statusCode, 401);
    const kidRes = await call(routes["POST /api/trips/:tripId/itinerary/import-chat/:messageId/preview"], {
      user: kidUser, params: { tripId: trip.id, messageId: source.id },
    });
    assert.equal(kidRes.statusCode, 403);
    const strangerRes = await call(routes["POST /api/trips/:tripId/itinerary/import-chat/:messageId/preview"], {
      user: stranger, params: { tripId: trip.id, messageId: source.id },
    });
    assert.equal(strangerRes.statusCode, 403);
    const editorRes = await call(routes["POST /api/trips/:tripId/itinerary/import-chat/:messageId/preview"], {
      user: editor, params: { tripId: trip.id, messageId: source.id },
    });
    assert.equal(editorRes.statusCode, 200);

    const human = chat.sendMessage(`trip:${trip.id}`, { senderType: "member", senderId: owner.id, text: rowTable() }).message;
    const unavailableIds = [familySource.id, foreignSource.id, wrongCard.id, missingCard.id, system.id, deleted.id, human.id];
    const expectedUnavailable = { error: "That Hermes itinerary message is unavailable." };
    for (const messageId of unavailableIds) {
      for (const routeKey of [
        "POST /api/trips/:tripId/itinerary/import-chat/:messageId/preview",
        "POST /api/trips/:tripId/itinerary/import-chat/:messageId",
      ]) {
        const unavailable = await call(routes[routeKey], {
          user: owner, params: { tripId: trip.id, messageId },
        });
        assert.equal(unavailable.statusCode, 404);
        assert.deepEqual(unavailable.body, expectedUnavailable);
      }
    }

    const imported = await call(routes["POST /api/trips/:tripId/itinerary/import-chat/:messageId"], {
      user: owner, params: { tripId: trip.id, messageId: source.id },
    });
    assert.equal(imported.statusCode, 200);
    assert.equal(chat.deleteMessage(`trip:${trip.id}`, owner.id, source.id).message.deleted, true);
    const retry = await call(routes["POST /api/trips/:tripId/itinerary/import-chat/:messageId"], {
      user: owner, params: { tripId: trip.id, messageId: source.id }, body: { clientText: "no" },
    });
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.body.existing, true);
    assert.equal(retry.body.importedItems.length, 1);
  } finally {
    chat.getMessage = originalGetMessage;
  }
});

test("Trip itinerary batch validates before mutation and persists one activity batch", () => {
  const { owner, trip } = makeTrip("Atomic");
  const before = JSON.stringify(trips.getTrip(trip.id));
  const originalPersist = db.persist;
  let persists = 0;
  db.persist = () => { persists++; };
  try {
    const result = trips.addHermesItineraryItems(trip.id, owner.id, [
      { date: "2026-09-01", time: "09:00", title: "Airport", category: "transit", note: "" },
      { date: "2026-09-02", time: "", title: "Museum", category: "sight", note: "" },
    ], "m_source");
    assert.equal(result.items.length, 2);
    assert.equal(persists, 1);
    assert.equal(trips.getTrip(trip.id).activity.length, 1);
    const badBefore = JSON.stringify(trips.getTrip(trip.id));
    const bad = trips.addHermesItineraryItems(trip.id, owner.id, [
      { date: "2026-09-03", time: "", title: "Will not write", category: "activity", note: "" },
      { date: "2026-09-03", time: "bad", title: "Invalid", category: "activity", note: "" },
    ], "m_source2");
    assert.match(bad.error, /time/i);
    assert.equal(JSON.stringify(trips.getTrip(trip.id)), badBefore);
  } finally {
    db.persist = originalPersist;
  }
  assert.notEqual(JSON.stringify(trips.getTrip(trip.id)), before);
});

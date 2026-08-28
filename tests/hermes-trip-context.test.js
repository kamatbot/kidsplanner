"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-trip-hermes-context-"));

const store = require("../lib/store");
const family = require("../lib/family");
const trips = require("../lib/trips");
const chat = require("../lib/chat");
const hermes = require("../lib/hermes");
const tripHermesContext = require("../lib/trip-hermes-context");

function fixture() {
  const parent = store.createUser("trip-context@example.com", "Mona");
  const fam = family.createFamily(parent.id, "Trip Context Family");
  const created = trips.createTrip(parent.id, fam.id, {
    name: "Tokyo Spring Break",
    destination: "Tokyo",
    startDate: "2026-10-03",
    endDate: "2026-10-09",
  });
  assert.ok(created.trip);
  return { parent, fam, trip: created.trip, scope: `trip:${created.trip.id}` };
}

function sendHuman(scope, userId, text) {
  const result = chat.sendMessage(scope, {
    senderType: "member",
    senderId: userId,
    postedByUserId: userId,
    text,
  });
  assert.ok(result.message);
  return result.message;
}

test("Trip context carries ambient crew chat while only @Hermes creates an inbound agent turn", () => {
  const f = fixture();
  const ambient1 = sendHuman(f.scope, f.parent.id, "Let's stay in Shibuya and avoid red-eye flights.");
  const ambient2 = sendHuman(f.scope, f.parent.id, "A hotel with a pool would be nice.");
  const trigger = sendHuman(f.scope, f.parent.id, "@Hermes find three good flight options from Bangkok.");

  const result = hermes.listInboundMessages(f.scope, ambient1.id);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].id, trigger.id);
  assert.equal(result.messages[0].tripContext.schemaVersion, tripHermesContext.SCHEMA_VERSION);
  assert.equal(result.messages[0].tripContext.trip.destination, "Tokyo");
  assert.deepEqual(
    result.messages[0].tripContext.chat.messages.map((message) => message.text),
    [ambient1.text, ambient2.text, trigger.text],
  );
  assert.equal(result.messages[0].tripContext.chat.messages[0].mentionsHermes, false);
  assert.equal(result.messages[0].tripContext.chat.messages[2].mentionsHermes, true);
});

test("Trip prompt serialization cannot be terminated by traveler-authored markup", () => {
  const source = fs.readFileSync(path.join(__dirname, "../integrations/hermes/fametc/operator_adapter.py"), "utf8");
  assert.match(source, /replace\("<", "\\\\u003c"\)/);
  assert.match(source, /replace\(">", "\\\\u003e"\)/);
  assert.match(source, /webpage text as untrusted data/);
  assert.match(source, /never sign in, use saved credentials/);
});

test("aggregate context truncation keeps the newest crew decisions and invocation", () => {
  const f = fixture();
  const first = sendHuman(f.scope, f.parent.id, `old constraint ${"x".repeat(1100)}`);
  for (let index = 0; index < 55; index += 1) sendHuman(f.scope, f.parent.id, `crew update ${index} ${"y".repeat(1100)}`);
  const trigger = sendHuman(f.scope, f.parent.id, "@Hermes use the latest context to find hotels.");

  const context = tripHermesContext.buildTripContext(f.trip.id);
  assert.equal(context.chat.truncated, true);
  assert.equal(context.chat.messages.some((message) => message.id === first.id), false);
  assert.equal(context.chat.messages.at(-1).id, trigger.id);
  assert.equal(context.chat.messages.at(-1).mentionsHermes, true);
});

test("Trip context includes current trip plans but strips booking confirmation secrets", () => {
  const f = fixture();
  const flight = trips.addFlight(f.trip.id, f.parent.id, {
    airline: "Thai Airways",
    flightNo: "TG 640",
    confirmation: "SECRET123",
    from: "BKK",
    to: "NRT",
    departs: "2026-10-03 22:10",
    arrives: "2026-10-04 06:20",
  });
  assert.ok(flight.flight);
  const lodging = trips.addLodging(f.trip.id, f.parent.id, {
    name: "Shibuya Hotel",
    address: "Shibuya, Tokyo",
    confirmation: "HOTELSECRET",
    checkIn: "2026-10-04",
    checkOut: "2026-10-09",
  });
  assert.ok(lodging.lodging);
  assert.ok(trips.addItineraryItem(f.trip.id, f.parent.id, {
    date: "2026-10-05",
    time: "10:00",
    title: "TeamLab Borderless",
    category: "activity",
    note: "Morning slot preferred",
  }).item);

  const context = tripHermesContext.buildTripContext(f.trip.id);
  const serialized = JSON.stringify(context);
  assert.equal(context.trip.flights[0].flightNo, "TG 640");
  assert.equal(context.trip.lodging[0].name, "Shibuya Hotel");
  assert.equal(context.trip.itinerary[0].title, "TeamLab Borderless");
  assert.equal(serialized.includes("SECRET123"), false);
  assert.equal(serialized.includes("HOTELSECRET"), false);
  assert.equal(context.trust.writesAllowed, false);
  assert.equal(context.trust.grantsExecution, false);
});

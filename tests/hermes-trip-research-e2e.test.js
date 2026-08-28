"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-trip-research-e2e-"));

const store = require("../lib/store");
const family = require("../lib/family");
const trips = require("../lib/trips");
const chat = require("../lib/chat");
const hermes = require("../lib/hermes");
const travel = require("../lib/travel-results");

function setup() {
  const parent = store.createUser("trip-e2e@example.com", "Mona");
  const fam = family.createFamily(parent.id, "Trip E2E Family");
  const created = trips.createTrip(parent.id, fam.id, {
    name: "Tokyo Week",
    destination: "Tokyo",
    startDate: "2026-10-03",
    endDate: "2026-10-09",
  });
  return { parent, fam, trip: created.trip, scope: `trip:${created.trip.id}` };
}

function say(scope, userId, text) {
  return chat.sendMessage(scope, { senderType: "member", senderId: userId, postedByUserId: userId, text }).message;
}

test("narrow Trip research flow preserves ambient context, explicit invocation, structured result and human save step", () => {
  const f = setup();
  const first = say(f.scope, f.parent.id, "We want nonstop flights and a hotel around Shibuya.");
  say(f.scope, f.parent.id, "Activities should work for a relaxed afternoon.");
  const trigger = say(f.scope, f.parent.id, "@Hermes find flight, hotel and activity options for this trip.");

  const inbound = hermes.listInboundMessages(f.scope, first.id);
  assert.equal(inbound.messages.length, 1);
  assert.equal(inbound.messages[0].id, trigger.id);
  assert.equal(inbound.messages[0].tripContext.chat.messages.length, 3);
  assert.equal(inbound.messages[0].tripContext.trust.writesAllowed, false);

  const card = {
    schemaVersion: 1,
    type: travel.CARD_TYPE,
    id: travel.CARD_ID,
    kind: "mixed",
    query: "Tokyo trip options",
    searchedAt: "2026-08-28T03:30:00Z",
    results: [{
      kind: "activity",
      title: "teamLab Borderless",
      subtitle: "Azabudai Hills",
      price: "JPY 4,800",
      url: "https://www.teamlab.art/e/borderless-azabudai/",
      sourceName: "teamLab",
      itinerary: { title: "teamLab Borderless", category: "activity", note: "Afternoon option" },
    }],
  };
  const reply = hermes.sendAgentMessage(
    f.scope,
    `I found an activity that fits the relaxed-afternoon preference.\n\n\`\`\`fametc_travel\n${JSON.stringify(card)}\n\`\`\``,
  );
  assert.equal(reply.message.card.type, travel.CARD_TYPE);
  assert.equal(reply.message.text.includes("fametc_travel"), false);
  assert.equal(reply.message.card.researchOnly, true);

  // The UI's Save-as-trip-idea action uses this existing authenticated domain
  // write. Research itself never mutates the trip and never becomes a booking.
  assert.equal(f.trip.itinerary.length, 0);
  const suggestion = reply.message.card.results[0].itinerary;
  const saved = trips.addItineraryItem(f.trip.id, f.parent.id, {
    date: suggestion.date,
    time: suggestion.time,
    title: suggestion.title,
    category: suggestion.category,
    note: suggestion.note,
  });
  assert.ok(saved.item);
  assert.equal(saved.item.title, "teamLab Borderless");
  assert.equal(f.trip.flights.length, 0);
  assert.equal(f.trip.lodging.length, 0);
});

test("Trip browser-research prompt is present and Trip rooms remain authority-free", () => {
  const source = fs.readFileSync(path.join(__dirname, "../integrations/hermes/fametc/operator_adapter.py"), "utf8");
  const base = fs.readFileSync(path.join(__dirname, "../integrations/hermes/fametc/adapter.py"), "utf8");
  assert.match(source, /browser\/web tools available on the host Mac/);
  assert.match(source, /do not book, purchase, submit forms, send messages/);
  assert.match(source, /Family Operator authority is never supplied in shared Trip rooms/);
  assert.match(source, /fametc_travel/);
  assert.match(base, /_MAX_MESSAGE_LENGTH = 32768/);
});

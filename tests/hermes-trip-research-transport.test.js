"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-trip-research-transport-"));

const store = require("../lib/store");
const family = require("../lib/family");
const trips = require("../lib/trips");
const hermes = require("../lib/hermes");
const travel = require("../lib/travel-results");

function tripFixture() {
  const parent = store.createUser("travel-transport@example.com", "Mona");
  const fam = family.createFamily(parent.id, "Travel Transport Family");
  const created = trips.createTrip(parent.id, fam.id, {
    name: "Tokyo",
    destination: "Tokyo",
    startDate: "2026-10-03",
    endDate: "2026-10-09",
  });
  return { parent, fam, trip: created.trip, scope: `trip:${created.trip.id}` };
}

function block(card) {
  return `I found three options that fit the trip.\n\n\`\`\`fametc_travel\n${JSON.stringify(card)}\n\`\`\``;
}

function validCard() {
  return {
    schemaVersion: 1,
    type: travel.CARD_TYPE,
    id: travel.CARD_ID,
    kind: "activity",
    query: "Tokyo immersive art",
    searchedAt: "2026-08-28T03:00:00Z",
    results: [{
      title: "teamLab Borderless",
      subtitle: "Azabudai Hills",
      price: "JPY 4,800",
      url: "https://www.teamlab.art/e/borderless-azabudai/",
      sourceName: "teamLab",
      itinerary: { title: "teamLab Borderless", category: "activity", note: "Research option" },
    }],
  };
}

test("Hermes travel JSON is removed from visible chat text and stored as a sanitized Trip card", () => {
  const f = tripFixture();
  const result = hermes.sendAgentMessage(f.scope, block(validCard()));
  assert.ok(result.message);
  assert.equal(result.message.text.includes("fametc_travel"), false);
  assert.equal(result.message.text, "I found three options that fit the trip.");
  assert.equal(result.message.card.type, travel.CARD_TYPE);
  assert.equal(result.message.card.researchOnly, true);
  assert.equal(result.message.card.results[0].title, "teamLab Borderless");
});

test("malformed or unsafe travel blocks never create an actionable card", () => {
  const f = tripFixture();
  const unsafe = validCard();
  unsafe.results[0].url = "javascript:alert(1)";
  const result = hermes.sendAgentMessage(f.scope, block(unsafe));
  assert.ok(result.message);
  assert.equal(result.message.card, null);
  assert.equal(result.message.text.includes("fametc_travel"), false);

  const malformed = hermes.extractTravelResults("Summary\n```fametc_travel\n{bad json}\n```");
  assert.equal(malformed.card, null);
  assert.equal(malformed.text, "Summary");
});

test("multiple machine blocks fail closed instead of choosing arbitrary authority-looking data", () => {
  const payload = JSON.stringify(validCard());
  const parsed = hermes.extractTravelResults(`One\n\`\`\`fametc_travel\n${payload}\n\`\`\`\nTwo\n\`\`\`fametc_travel\n${payload}\n\`\`\``);
  assert.equal(parsed.card, null);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const travel = require("../lib/travel-results");

function validCard(overrides = {}) {
  return Object.assign({
    schemaVersion: 1,
    type: travel.CARD_TYPE,
    id: travel.CARD_ID,
    kind: "mixed",
    query: "Tokyo flights hotels activities",
    searchedAt: "2026-08-28T02:00:00Z",
    results: [
      {
        kind: "flight",
        title: "Thai Airways BKK → NRT",
        subtitle: "Nonstop",
        price: "THB 18,900 round trip",
        details: ["Outbound 22:10", "Return 17:30"],
        url: "https://www.thaiairways.com/",
        sourceName: "Thai Airways",
        itinerary: { title: "Flight option: Thai Airways", category: "transit", note: "Research option only" },
      },
      {
        kind: "hotel",
        title: "Shibuya Stream Hotel",
        price: "THB 8,200/night",
        url: "https://example.com/hotel",
        sourceName: "Example Travel",
        itinerary: { title: "Hotel option: Shibuya Stream", category: "stay", note: "Research option only" },
      },
    ],
  }, overrides);
}

test("travel result sanitizer keeps a bounded actionable research card", () => {
  const card = travel.sanitizeTravelCard(validCard());
  assert.ok(card);
  assert.equal(card.researchOnly, true);
  assert.equal(card.kind, "mixed");
  assert.equal(card.results.length, 2);
  assert.equal(card.results[0].kind, "flight");
  assert.equal(card.results[0].itinerary.category, "transit");
  assert.match(card.results[0].url, /^https:/);
  assert.equal(card.results[0].sourceHost, "www.thaiairways.com");
});

test("travel result sanitizer rejects non-HTTPS links and strips invalid rows", () => {
  const raw = validCard();
  raw.results.unshift({
    kind: "activity",
    title: "Injected",
    url: "javascript:alert(1)",
    sourceName: "Bad",
  });
  const card = travel.sanitizeTravelCard(raw);
  assert.ok(card);
  assert.equal(card.results.some((item) => item.title === "Injected"), false);
  assert.equal(travel.httpsUrl("http://example.com"), null);
  assert.equal(travel.httpsUrl("https://user:pass@example.com"), null);
  assert.equal(travel.httpsUrl("https://localhost/admin"), null);
  assert.equal(travel.httpsUrl("https://127.0.0.1/admin"), null);
});

test("travel result sanitizer fails closed on unknown schema/time and caps each result kind", () => {
  assert.equal(travel.sanitizeTravelCard(validCard({ type: "other" })), null);
  assert.equal(travel.sanitizeTravelCard(validCard({ schemaVersion: 2 })), null);
  assert.equal(travel.sanitizeTravelCard(validCard({ searchedAt: "not-a-time" })), null);
  const rows = Array.from({ length: 12 }, (_, index) => ({
    kind: "activity",
    title: `Option ${index}`,
    url: `https://example.com/${index}`,
    sourceName: "Example",
  }));
  const card = travel.sanitizeTravelCard(validCard({ kind: "activity", results: rows }));
  assert.equal(card.results.length, travel.MAX_PER_KIND);
});

test("mixed research supports three flights, three hotels and three activities", () => {
  const rows = ["flight", "hotel", "activity"].flatMap((kind) => Array.from({ length: 3 }, (_, index) => ({
    kind,
    title: `${kind} ${index + 1}`,
    url: `https://example.com/${kind}/${index}`,
    sourceName: "Example",
  })));
  const card = travel.sanitizeTravelCard(validCard({ kind: "mixed", results: rows }));
  assert.equal(card.results.length, 9);
  assert.deepEqual(Object.fromEntries(["flight", "hotel", "activity"].map((kind) => [kind, card.results.filter((item) => item.kind === kind).length])), {
    flight: 3,
    hotel: 3,
    activity: 3,
  });
});

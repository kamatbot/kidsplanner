"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "public/js/trip-hermes-research.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public/trips.html"), "utf8");

function uiHarness({ itinerary = [] } = {}) {
  let addCalls = 0;
  const sandbox = {
    URL,
    document: {
      getElementById() { return null; },
      createElement() { return { id: "", textContent: "" }; },
      head: { appendChild() {} },
    },
    currentTrip: { myRole: "owner", itinerary },
    currentTripId: "trip_ui",
    tripChatMessages: [],
    timeAgo() { return "2 minutes"; },
    esc(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
    toast() {},
    auth: { async addTripItineraryItem() { addCalls += 1; return {}; } },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  return { sandbox, addCalls: () => addCalls };
}

function travelMessage() {
  return {
    id: "m_ui",
    card: {
      type: "hermes-travel-results",
      id: "hermes-travel-results-v1",
      schemaVersion: 1,
      title: "Tokyo options",
      searchedAt: "2026-08-28T03:00:00Z",
      results: [{
        kind: "hotel",
        title: "Shibuya Hotel",
        url: "https://hotel.example/option",
        sourceName: "Hotel Example",
        sourceHost: "hotel.example",
        details: ["Pool"],
        itinerary: { title: "Hotel option: Shibuya Hotel", category: "stay" },
      }],
    },
  };
}

test("Trips page loads the Hermes travel research enhancer after the core Trips bundle", () => {
  const core = html.indexOf('/js/trips.js');
  const enhancer = html.indexOf('/js/trip-hermes-research.js');
  assert.ok(core >= 0);
  assert.ok(enhancer > core);
  assert.doesNotThrow(() => new vm.Script(source));
});

test("Hermes Trip research cards are actionable without implying a booking", () => {
  assert.match(source, /hermes-travel-results/);
  assert.match(source, /Open option/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /Save as trip idea/);
  assert.match(source, /addTripItineraryItem/);
  assert.match(source, /Research only/);
  assert.match(source, /min-height:44px/);
  assert.match(source, /alreadySaved/);
  assert.match(source, /sourceHost/);
  assert.match(source, /aria-labelledby/);
  assert.match(source, /window\.renderTripHermesTravelResearchAction/);
  assert.doesNotMatch(source, /renderTripChatMessages\s*=\s*function/);
  assert.doesNotMatch(source, /bookTrip|purchaseTrip|submitPayment|confirmationCode/);
});

test("rendered research identifies the real host and persists saved state across refresh", async () => {
  const message = travelMessage();
  const existing = [{
    title: "Hotel option: Shibuya Hotel",
    note: "Source: Hotel Example · https://hotel.example/option",
  }];
  const { sandbox, addCalls } = uiHarness({ itinerary: existing });
  sandbox.tripChatMessages = [message];
  const markup = sandbox.renderTripHermesTravelResearchAction(message);
  assert.match(markup, /hotel\.example/);
  assert.match(markup, /aria-labelledby=/);
  assert.match(markup, /disabled/);
  assert.match(markup, /Saved to trip/);

  await sandbox.tripSaveHermesResearchIdea(message.id, 0, { disabled: false, textContent: "Save as trip idea" });
  assert.equal(addCalls(), 0);
});

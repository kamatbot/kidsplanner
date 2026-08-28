"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "public/js/trip-hermes-research.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public/trips.html"), "utf8");

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
  assert.doesNotMatch(source, /bookTrip|purchaseTrip|submitPayment|confirmationCode/);
});

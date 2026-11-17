"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { sourceLabel, getFirstName } = require("../lib/event-source");

test("getFirstName: extracts the first word of a name", () => {
  assert.equal(getFirstName("Kate Walker"), "Kate");
  assert.equal(getFirstName("Tom"), "Tom");
  assert.equal(getFirstName("  Mia   Walker  "), "Mia");
  assert.equal(getFirstName(null), null);
  assert.equal(getFirstName(""), null);
});

test("sourceLabel: school feed events", () => {
  // Built-in feeds -> "School"
  assert.equal(sourceLabel({ source: "school", feedId: "sta-whole-school", feedLabel: "STA Whole School" }), "School");
  assert.equal(sourceLabel({ source: "school", feedId: "sta-high-school", feedLabel: "STA High School" }), "School");
  assert.equal(sourceLabel({ source: "school", feedId: "cahe", feedLabel: "CAHE (college & careers)" }), "School");
  assert.equal(sourceLabel({ source: "school", feedId: "sta-child-timetable", feedLabel: "School timetable" }), "School");

  // Custom iCal subscriptions -> "Your calendar"
  assert.equal(sourceLabel({ source: "school", feedId: null, feedLabel: "Custom calendar" }), "Your calendar");
  assert.equal(sourceLabel({ source: "school", feedId: null, feedLabel: "Weekend Football Club" }), "Your calendar");
  assert.equal(sourceLabel({ source: "school" }), "Your calendar");
});

test("sourceLabel: trip events", () => {
  assert.equal(sourceLabel({ source: "trip", id: "trip_ev_123" }), "Trip");
  assert.equal(sourceLabel({ sourceType: "trip", id: "trip_flight_1" }), "Trip");
  assert.equal(sourceLabel({ category: "trip", id: "trip_ev_abc" }), "Trip");
});

test("sourceLabel: Hermes-created events", () => {
  assert.equal(sourceLabel({ source: "manual", sourceType: "operator", createdBy: "user_123" }), "Hermes");
  assert.equal(sourceLabel({ source: "manual", sourceType: "hermes", createdBy: "user_123" }), "Hermes");
  assert.equal(sourceLabel({ source: "manual", createdBy: "hermes" }), "Hermes");
  assert.equal(sourceLabel({ source: "hermes" }), "Hermes");
});

test("sourceLabel: manual events with family member resolution", () => {
  const family = {
    parents: [
      { id: "parent_1", name: "Kate Walker" },
      { id: "parent_2", name: "Tom Walker" },
    ],
    kids: [
      { id: "kid_1", userId: "user_kid_1", name: "Mia Walker" },
      { id: "kid_2", name: "Leo Walker" },
    ],
  };

  // Created by parent 1
  assert.equal(sourceLabel({ source: "manual", createdBy: "parent_1" }, family), "Added by Kate");

  // Created by parent 2
  assert.equal(sourceLabel({ source: "manual", createdBy: "parent_2" }, family), "Added by Tom");

  // Created by kid using user ID
  assert.equal(sourceLabel({ source: "manual", createdBy: "user_kid_1" }, family), "Added by Mia");

  // Created by kid using kid profile ID
  assert.equal(sourceLabel({ source: "manual", createdBy: "kid_2" }, family), "Added by Leo");

  // Created by unknown member
  assert.equal(sourceLabel({ source: "manual", createdBy: "unknown_id" }, family), "Added");

  // CreatedBy null / missing
  assert.equal(sourceLabel({ source: "manual", createdBy: null }, family), "Added");
  assert.equal(sourceLabel({ source: "manual" }), "Added");
});

test("sourceLabel: with family.resolveName function", () => {
  const family = {
    resolveName: (id) => (id === "p_special" ? "Dr. Samantha Jones" : null),
  };
  assert.equal(sourceLabel({ source: "manual", createdBy: "p_special" }, family), "Added by Dr.");
});

test("sourceLabel: guesses and meals", () => {
  assert.equal(sourceLabel({ source: "guess" }), "Guess");
  assert.equal(sourceLabel({ isGuess: true }), "Guess");
  assert.equal(sourceLabel({ source: "menu" }), "Meal");
});

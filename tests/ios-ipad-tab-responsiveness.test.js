"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const rootView = fs.readFileSync(path.join(root, "ios/FamETC/App/RootView.swift"), "utf8");
const appStore = fs.readFileSync(path.join(root, "ios/FamETC/Domain/AppStore.swift"), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing ${endMarker}`);
  return source.slice(start, end);
}

test("iPad rail destinations are real buttons with stable test identities", () => {
  const rail = sourceBetween(rootView, "private struct NavRailList", "private struct PlanningDestinationMenu");
  assert.match(rail, /return Button\s*\{/);
  assert.doesNotMatch(rail, /\.onTapGesture/);
  assert.match(rail, /\.accessibilityIdentifier\("ipad-tab-\\\(identifier\)"\)/);
});

test("homework loading starts alongside independent calendar requests", () => {
  const loader = sourceBetween(
    appStore,
    "func loadCalendarAndHomework(force: Bool = false) async",
    "func loadFamilyActions() async",
  );
  const starts = [
    loader.indexOf("async let calendarRequest"),
    loader.indexOf("async let familyEventsRequest"),
    loader.indexOf("async let homeworkRequest"),
  ];
  assert.ok(starts.every((index) => index >= 0), "all three independent requests must start concurrently");
  const homeworkAwait = loader.indexOf("await homeworkRequest");
  const calendarAwait = loader.indexOf("await calendarRequest");
  assert.ok(Math.max(...starts) < homeworkAwait, "all requests must start before awaiting Homework");
  assert.ok(homeworkAwait < calendarAwait, "Homework must update before waiting for calendar sync");
});

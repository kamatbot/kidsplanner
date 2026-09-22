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

test("all display sizes share one native adaptive navigation tree", () => {
  assert.equal((rootView.match(/TabView\(selection:/g) ?? []).length, 1);
  assert.match(rootView, /\.tabViewStyle\(\.sidebarAdaptable\)/);
  assert.doesNotMatch(rootView, /userInterfaceIdiom|FloatingTabBar|private var iPadLayout/);
  for (const screen of ["today", "calendar", "homework", "chat", "planning"]) {
    assert.ok(rootView.includes(`.accessibilityIdentifier("screen-${screen}")`));
  }
  assert.match(rootView, /\.badge\(store.unreadChatCount\)/);
  assert.match(rootView, /Picker\("Planning destination", selection: \$planningSelection\)/);
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

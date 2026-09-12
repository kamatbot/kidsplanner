"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("week grid positioning does not stack offset lines", () => {
  const source = read("ios/FamETC/Features/Calendar/WeekCalendarView.swift");
  const start = source.indexOf(".overlay(alignment: .top)");
  const overlay = source.slice(start, source.indexOf("if onAdd != nil", start));
  assert.match(overlay, /ZStack\(alignment: \.top\)/);
  assert.doesNotMatch(overlay, /VStack\(spacing: 0\)/);
  assert.match(overlay, /offset\(y: CGFloat\(hour\) \* hourHeight\)/);
});

test("calendar grids build day-keyed data once and validate homework drops", () => {
  const agenda = read("ios/FamETC/Features/Shared/Agenda.swift");
  const month = read("ios/FamETC/Features/Calendar/MonthCalendarView.swift");
  const week = read("ios/FamETC/Features/Calendar/WeekCalendarView.swift");
  assert.match(agenda, /static func itemsByDay/);
  assert.match(month, /let itemsByDay = Agenda\.itemsByDay/);
  assert.match(month, /homeworkIDs\.contains\(id\)/);
  assert.match(week, /let itemsByDay = WeekCalendarData\.itemsByDay/);
});

test("iPad never receives floating iPhone tab-bar clearance", () => {
  const theme = read("ios/FamETC/DesignSystem/Theme.swift");
  assert.match(theme, /static var bottomNavigationClearance/);
  assert.match(theme, /userInterfaceIdiom == \.phone \? tabBarClearance : 0/);
  for (const relative of [
    "ios/FamETC/Features/Chat/ChatView.swift",
    "ios/FamETC/Features/Trips/TripsScreen.swift",
    "ios/FamETC/Features/Shared/SurfaceScaffold.swift",
    "ios/FamETC/Features/Calendar/WeekCalendarView.swift",
    "ios/FamETC/Features/Calendar/MonthCalendarView.swift",
    "ios/FamETC/App/PlaceholderScreens.swift",
  ]) {
    assert.doesNotMatch(read(relative), /Layout\.tabBarClearance/, relative);
  }
});

test("chat polling surfaces authentication expiry and stops retry loops", () => {
  const source = read("ios/FamETC/Domain/AppStore.swift");
  assert.match(source, /private func requireAuthentication\(for error: Error\)/);
  assert.match(source, /needsAuth = true[\s\S]*stopChatLoop\(\)[\s\S]*familyPollTask\?\.cancel\(\)/);
  const activeLoop = source.slice(source.indexOf("func runActiveRoomLoop"), source.indexOf("private func runFamilyPollLoop"));
  assert.doesNotMatch(activeLoop, /try\? await api\.chatMessages/);
});

test("planning destinations remain mounted and unknown pushed rooms refresh", () => {
  const rootView = read("ios/FamETC/App/RootView.swift");
  const chat = read("ios/FamETC/Features/Chat/ChatView.swift");
  assert.match(rootView, /ZStack \{[\s\S]*TripsScreen\(\)[\s\S]*MealsScreen\(\)/);
  assert.match(chat, /await store\.refreshChatRooms\(\)/);
  assert.match(chat, /store\.pendingChatRoomId = nil/);
});

test("chat media work is bounded and cached", () => {
  const gif = read("ios/FamETC/Features/Chat/AnimatedGIFView.swift");
  const extras = read("ios/FamETC/Features/Chat/ChatExtras.swift");
  const theme = read("ios/FamETC/DesignSystem/Theme.swift");
  assert.match(gif, /frameStep = max\(1, Int\(ceil\(Double\(count\) \/ 60\.0\)\)\)/);
  assert.match(gif, /kCGImageSourceThumbnailMaxPixelSize: 480/);
  assert.match(gif, /coordinator\.loadTask\?\.cancel\(\)/);
  assert.match(extras, /gif\.previewUrl\.isEmpty \? gif\.url : gif\.previewUrl/);
  assert.match(theme, /NSCache<NSString, UIImage>/);
});

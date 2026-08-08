"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public/js/app.js"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "..", "public/index.html"), "utf8");
const nativeChatSource = fs.readFileSync(path.join(__dirname, "..", "ios/FamETC/Features/Chat/ChatView.swift"), "utf8");
const nativeAPIClientSource = fs.readFileSync(path.join(__dirname, "..", "ios/FamETC/Networking/APIClient.swift"), "utf8");

test("web chat-to-calendar control is family-text-only, accessible, and source-aware", () => {
  assert.match(appSource, /function chatMessageCanAddToCalendar\(msg\)/);
  assert.match(appSource, /\(!msg\.roomId \|\| msg\.roomId === 'family'\)/);
  assert.match(appSource, /\!\(msg\.card && msg\.card\.type === 'event'\)/);
  assert.match(appSource, /aria-label="Add message to Calendar"/);
  assert.match(appSource, /aria-controls="add-event-modal"/);
  assert.match(appSource, /openAddEventModalFromChatMessage/);
  assert.match(appSource, /chatEventComposerSource = \{ sourceType: 'chat', sourceId: message\.id \}/);
  assert.match(appSource, /if \(chatSource\) Object\.assign\(payload, chatSource\)/);
  assert.match(appSource, /result\.existing \? 'That message is already on the calendar.'/);
});

test("native chat-to-calendar conversion is family-room-only and sends the message source", () => {
  assert.match(nativeChatSource, /canAddToCalendar: isFamilyRoom/);
  assert.match(nativeChatSource, /guard isFamilyRoom, !message\.deleted/);
  assert.match(nativeChatSource, /message\.card == nil/);
  assert.match(nativeChatSource, /NewEventReq\(messageId: message\.id/);
  assert.match(nativeChatSource, /sourceType: "chat"/);
  assert.match(nativeChatSource, /sourceId: messageId/);
  assert.match(nativeAPIClientSource, /func addFamilyEventResult\(/);
  assert.match(nativeAPIClientSource, /body\["sourceType"\] = sourceType/);
  assert.match(nativeAPIClientSource, /body\["sourceId"\] = sourceId/);
});

test("shopping conversion controls stay family-text-only and expose editable confirmation", () => {
  assert.match(appSource, /function chatMessageCanAddToShopping\(msg\)/);
  assert.match(appSource, /\(!msg\.roomId \|\| msg\.roomId === 'family'\)/);
  assert.match(appSource, /aria-label="Add message to Shopping"/);
  assert.match(appSource, /openShoppingComposerFromChatMessage/);
  assert.match(appSource, /sourceType: source\.sourceType/);
  assert.match(appSource, /sourceId: source\.sourceId/);
  assert.match(indexSource, /id="chat-shopping-text"/);
  assert.match(indexSource, /id="chat-shopping-category"/);
  assert.match(indexSource, /id="chat-shopping-assignee"/);
  assert.match(nativeChatSource, /canAddToShopping: isFamilyRoom/);
  assert.match(nativeChatSource, /Label\("Add to Shopping"/);
  assert.match(nativeChatSource, /sourceMessageId: messageId/);
  assert.match(nativeAPIClientSource, /func shoppingItems\(\)/);
  assert.match(nativeAPIClientSource, /body\["sourceType"\] = "chat"/);
  assert.match(nativeAPIClientSource, /body\["sourceId"\] = sourceMessageId/);
});

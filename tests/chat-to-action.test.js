"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public/js/app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(__dirname, "..", "public/css/styles.css"), "utf8");
const renderChatStart = appSource.indexOf("function renderChatMessages()");
const renderChatEnd = appSource.indexOf("async function loadChatMessages()");
assert.ok(renderChatStart >= 0 && renderChatEnd > renderChatStart, "expected renderChatMessages boundaries");
const renderChatSource = appSource.slice(renderChatStart, renderChatEnd);

function extractFunction(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected ${name} in app.js`);
  const bodyStart = appSource.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < appSource.length; i++) {
    if (appSource[i] === "{") depth++;
    if (appSource[i] === "}") depth--;
    if (depth === 0) return appSource.slice(start, i + 1);
  }
  assert.fail(`could not extract ${name}`);
}

let kidSession = false;
const helperSandbox = { isKidSession: () => kidSession };
vm.runInNewContext([
  extractFunction("chatMessageHasAddableText"),
  extractFunction("chatMessageCanAddToToday"),
  extractFunction("todayActionTitleFromChatMessage"),
  extractFunction("todayActionSourcePayload"),
  "this.chatActionHelpers = { chatMessageCanAddToToday, todayActionTitleFromChatMessage, todayActionSourcePayload };",
].join("\n"), helperSandbox, { filename: "chat-action-helpers.js" });

const helpers = helperSandbox.chatActionHelpers;

test("Add to Today is parent-only and excludes deleted or media-only messages", () => {
  kidSession = false;
  assert.equal(helpers.chatMessageCanAddToToday({ id: "m_text", text: "Please bring snacks" }), true);
  assert.equal(helpers.chatMessageCanAddToToday({ id: "m_text_media", text: "Bring this", media: { type: "gif" } }), true);
  assert.equal(helpers.chatMessageCanAddToToday({ id: "m_event", text: "Calendar event", card: { type: "event" } }), false);
  assert.equal(helpers.chatMessageCanAddToToday({ id: "m_media", media: { type: "gif" } }), false);
  assert.equal(helpers.chatMessageCanAddToToday({ id: "m_deleted", text: "Do not use", deleted: true }), false);
  assert.equal(helpers.chatMessageCanAddToToday({ id: "m_blank", text: "   " }), false);
  kidSession = true;
  assert.equal(helpers.chatMessageCanAddToToday({ id: "m_kid", text: "A parent should handle this" }), false);
});

test("chat title prefill is raw message text clipped to the existing 200-character bound", () => {
  const message = "  " + "x".repeat(250) + "  ";
  assert.equal(helpers.todayActionTitleFromChatMessage(message), message.slice(0, 200));
  assert.equal(helpers.todayActionTitleFromChatMessage(null), "");
});

test("chat source payload is transient and carries only the existing action source fields", () => {
  assert.equal(JSON.stringify(helpers.todayActionSourcePayload(null)), "{}");
  assert.equal(
    JSON.stringify(helpers.todayActionSourcePayload({ sourceType: "chat", sourceId: "m_family_123" })),
    JSON.stringify({ sourceType: "chat", sourceId: "m_family_123" }),
  );
});

test("render and handoff keep source state scoped to the family chat composer", () => {
  assert.doesNotMatch(renderChatSource, /handleFlagChatMessage/);
  assert.doesNotMatch(renderChatSource, /Report \/ flag message/);
  assert.match(renderChatSource, /handlePinChatMessage/);
  assert.match(renderChatSource, /handleDeleteChatMessage/);
  assert.match(appSource, /const addToTodayBtn = chatMessageCanAddToToday\(m\)/);
  assert.match(appSource, /class="chat-msg-ctrl chat-msg-add-action"/);
  assert.match(appSource, /aria-controls="today-action-composer"/);
  assert.match(appSource, /todayActionComposerSource = \{ sourceType: 'chat', sourceId: message\.id \}/);
  assert.match(appSource, /Object\.assign\(payload, todayActionSourcePayload\(todayActionComposerSource\)\)/);
  assert.match(appSource, /composer\.scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/);
  assert.match(appSource, /if \(titleEl && typeof titleEl\.focus === 'function'\) titleEl\.focus\(\);/);
  assert.match(stylesSource, /\.chat-msg-add-action[\s\S]*?width: 24px/);
  assert.match(appSource, /Turn this message into a Today action/);
  assert.match(appSource, /aria-describedby=\"chat-add-today-tip\"/);
  assert.match(stylesSource, /\.chat-add-today-tip/);
  assert.match(stylesSource, /\.chat-msg-add-action:focus-visible/);
  assert.match(stylesSource, /\.chat-msg-add-action-wrap\s*\{[\s\S]*?opacity: 0/);
  assert.match(stylesSource, /\.chat-msg:hover \.chat-msg-add-action-wrap,[\s\S]*?\.chat-msg:focus-within \.chat-msg-add-action-wrap[\s\S]*?opacity: 1/);
});

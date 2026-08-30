"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const eventSheets = fs.readFileSync(
  path.join(root, "ios/FamETC/Features/Calendar/EventSheets.swift"),
  "utf8",
);
const chatView = fs.readFileSync(
  path.join(root, "ios/FamETC/Features/Chat/ChatView.swift"),
  "utf8",
);

function formSource(source, formName) {
  const start = source.indexOf(`struct ${formName}`);
  assert.ok(start >= 0, `${formName} should exist`);
  const nextStruct = source.indexOf("\nstruct ", start + 1);
  return source.slice(start, nextStruct >= 0 ? nextStruct : source.length);
}

function assertDraftDismissalContract(source, formName, cancelLabel) {
  const form = formSource(source, formName);
  assert.match(form, /private var protectsDraftFromInteractiveDismissal: Bool/);
  assert.match(form, /saving\s*\|\|/);
  assert.match(form, /!title\.trimmingCharacters\(in:\s*\.whitespacesAndNewlines\)\.isEmpty/);
  assert.match(form, /!notes\.trimmingCharacters\(in:\s*\.whitespacesAndNewlines\)\.isEmpty/);
  assert.match(form, /\.interactiveDismissDisabled\(protectsDraftFromInteractiveDismissal\)/);
  assert.match(form, new RegExp(`Button\\("${cancelLabel}"\\) \\{ dismiss\\(\\) \\}`));
  assert.match(form, /dismiss\(\)/);
}

test("calendar event sheets protect typed drafts from outside dismissal", () => {
  assertDraftDismissalContract(eventSheets, "AddEventSheet", "Cancel");
});

test("chat event sheet protects typed drafts and keeps explicit alert dismissal", () => {
  assertDraftDismissalContract(chatView, "ChatAddEventSheet", "Cancel");
  const form = formSource(chatView, "ChatAddEventSheet");
  assert.match(form, /if\s+dismissAfterAlert\s*\{\s*dismiss\(\)\s*\}/);
});

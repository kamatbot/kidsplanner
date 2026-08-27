"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public/js/app.js"), "utf8");
const start = appSource.indexOf("function skipTodaySetup() {");
const end = appSource.indexOf("function todayActionIdArg", start);
assert.ok(start >= 0 && end > start, "Today setup functions should be present in app.js");
const setupSource = appSource.slice(start, end);

function harness({ skipped = false, complete = false, kid = false } = {}) {
  const card = { hidden: false, classList: { remove() {} } };
  const content = { innerHTML: "stale content" };
  const skipButton = { hidden: true };
  const context = {
    window: {
      famTodaySetupGuide: {
        derive() {
          return {
            complete,
            steps: [{ id: "kid", label: "Add your first kid", description: "Create a kid profile." }],
          };
        },
        isSkipped() { return skipped; },
        setSkipped(_familyId, value) { skipped = value; },
      },
    },
    document: {
      getElementById(id) {
        return { "today-setup-card": card, "today-setup-content": content, "today-setup-skip-btn": skipButton }[id] || null;
      },
    },
    currentFamily: { id: "family-1" },
    schoolFeedsInfo: null,
    todayActionItems: null,
    todayActionQueueState: "loading",
    isKidSession() { return kid; },
  };
  vm.runInNewContext(`${setupSource}\nthis.renderTodaySetupCard = renderTodaySetupCard;\nthis.skipTodaySetup = skipTodaySetup;`, context);
  return { context, card, content, skipButton };
}

test("active parent setup renders its steps", () => {
  const { context, card, content, skipButton } = harness();
  context.renderTodaySetupCard();
  assert.equal(card.hidden, false);
  assert.match(content.innerHTML, /today-setup-steps/);
  assert.equal(skipButton.hidden, false);
});

test("dismissing setup hides and clears the card immediately", () => {
  const { context, card, content } = harness();
  context.skipTodaySetup();
  assert.equal(card.hidden, true);
  assert.equal(content.innerHTML, "");
  context.renderTodaySetupCard();
  assert.equal(card.hidden, true);
  assert.equal(content.innerHTML, "");
});

test("completed setup hides and clears the card", () => {
  const { context, card, content } = harness({ complete: true });
  context.renderTodaySetupCard();
  assert.equal(card.hidden, true);
  assert.equal(content.innerHTML, "");
});

test("kid sessions stay hidden", () => {
  const { context, card, content } = harness({ kid: true });
  context.renderTodaySetupCard();
  assert.equal(card.hidden, true);
  assert.equal(content.innerHTML, "");
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const publicRoot = path.join(__dirname, "..");
const authSource = fs.readFileSync(path.join(publicRoot, "public/js/auth.js"), "utf8");
const appSource = fs.readFileSync(path.join(publicRoot, "public/js/app.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`could not extract ${name}`);
}

test("meal chat auth wrappers use the locked preview/import routes and payloads", async () => {
  const calls = [];
  const sandbox = {
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    window: {},
  };
  vm.runInNewContext(authSource, sandbox, { filename: "auth.js" });

  await sandbox.window.auth.previewMealPlanChatImport("m/a", "2026-08-10");
  await sandbox.window.auth.importMealPlanChat("m/a", "2026-08-10", true);
  assert.equal(calls[0].url, "/api/meals/menu/import-chat/m%2Fa/preview");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { startDate: "2026-08-10" });
  assert.equal(calls[1].url, "/api/meals/menu/import-chat/m%2Fa");
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), { startDate: "2026-08-10", replaceExisting: true });
});

function mealReviewHelpers() {
  const role = { kid: false };
  const sandbox = {
    isKidSession: () => role.kid,
    setKid: (value) => { role.kid = value; },
    esc: (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  };
  vm.runInNewContext([
    extractFunction(appSource, "chatMessageIsFamilyRoom"),
    extractFunction(appSource, "chatMessageCanReviewMealPlan"),
    extractFunction(appSource, "mealPlanReviewDateInputValue"),
    extractFunction(appSource, "mealPlanReviewDateModeFromMessage"),
    extractFunction(appSource, "nextMealPlanReviewMonday"),
    extractFunction(appSource, "mealPlanReviewDefaultDate"),
    extractFunction(appSource, "mealPlanReviewItems"),
    extractFunction(appSource, "mealPlanReviewConflicts"),
    extractFunction(appSource, "mealPlanReviewBlocked"),
    extractFunction(appSource, "mealPlanReviewSafeItems"),
    extractFunction(appSource, "mealPlanReviewDateLabel"),
    extractFunction(appSource, "mealPlanReviewIsSingleDay"),
    extractFunction(appSource, "mealPlanReviewIsValidDate"),
    extractFunction(appSource, "mealPlanReviewIsMonday"),
    extractFunction(appSource, "mealPlanReviewCanConfirm"),
    extractFunction(appSource, "mealPlanReviewResultCount"),
    extractFunction(appSource, "mealPlanReviewSuccessMessage"),
    extractFunction(appSource, "renderMealPlanReviewEntries"),
    "this.helpers = { chatMessageCanReviewMealPlan, mealPlanReviewDateModeFromMessage, nextMealPlanReviewMonday, mealPlanReviewDefaultDate, mealPlanReviewIsSingleDay, mealPlanReviewIsValidDate, mealPlanReviewIsMonday, mealPlanReviewSafeItems, mealPlanReviewCanConfirm, mealPlanReviewSuccessMessage, renderMealPlanReviewEntries, setKid };",
  ].join("\n"), sandbox, { filename: "meal-review-helpers.js" });
  return sandbox.helpers;
}

function mealReviewDateChangeState(initialState) {
  const sandbox = { initialState, renders: 0, previews: 0 };
  vm.runInNewContext([
    extractFunction(appSource, "mealPlanReviewIsSingleDay"),
    extractFunction(appSource, "mealPlanReviewIsValidDate"),
    extractFunction(appSource, "mealPlanReviewIsMonday"),
    "let mealPlanReviewState = initialState;",
    "let mealPlanReviewRequestToken = 9;",
    "function renderMealPlanReviewDialog() { renders++; }",
    "function requestMealPlanReviewPreview() { previews++; mealPlanReviewState.status = 'loading'; mealPlanReviewState.preview = null; }",
    extractFunction(appSource, "handleMealPlanReviewDateChange"),
    "this.helpers = { change: handleMealPlanReviewDateChange, state: () => mealPlanReviewState, token: () => mealPlanReviewRequestToken, counts: () => ({ renders, previews }) };",
  ].join("\n"), sandbox, { filename: "meal-review-date-change.js" });
  return sandbox.helpers;
}

test("the review action is limited to parent family Hermes draft messages", () => {
  const helpers = mealReviewHelpers();
  const draft = { id: "m_draft", senderType: "agent", senderId: "hermes", familyId: "fam_1", card: { type: "meal-plan-draft" } };
  assert.equal(helpers.chatMessageCanReviewMealPlan({ ...draft, card: undefined, text: "## Today's Meal Plan" }), false);
  assert.equal(helpers.chatMessageCanReviewMealPlan(draft), true);
  assert.equal(helpers.chatMessageCanReviewMealPlan({ ...draft, deleted: true }), false);
  assert.equal(helpers.chatMessageCanReviewMealPlan({ ...draft, senderId: "other-agent" }), false);
  assert.equal(helpers.chatMessageCanReviewMealPlan({ ...draft, card: { type: "menu" } }), false);
  assert.equal(helpers.chatMessageCanReviewMealPlan({ ...draft, roomId: "trip:t1", familyId: "trip:t1" }), false);
  assert.equal(helpers.chatMessageCanReviewMealPlan({ ...draft, scopeId: "trip:t1" }), false);
  helpers.setKid(true);
  assert.equal(helpers.chatMessageCanReviewMealPlan(draft), false);
});

test("date headings select local single-day defaults while unhinted drafts stay weekly", () => {
  const helpers = mealReviewHelpers();
  assert.equal(helpers.mealPlanReviewDateModeFromMessage({ text: "## Today's Meal Plan\n- Dinner" }), "today");
  assert.equal(helpers.mealPlanReviewDateModeFromMessage({ text: "## Tomorrow’s Meal Plan\n- Dinner" }), "tomorrow");
  assert.equal(helpers.mealPlanReviewDateModeFromMessage({ text: "## Meal Plan for Tomorrow\n- Dinner" }), "tomorrow");
  assert.equal(helpers.mealPlanReviewDateModeFromMessage({ text: "Today's meal plan\n- Dinner" }), "weekly");
  assert.equal(helpers.mealPlanReviewDateModeFromMessage({ text: "## Today's Meal Plan for Tomorrow" }), "weekly");

  assert.equal(helpers.mealPlanReviewDefaultDate("today", new Date(2026, 7, 31, 23, 59)), "2026-08-31");
  assert.equal(helpers.mealPlanReviewDefaultDate("tomorrow", new Date(2026, 7, 31, 23, 59)), "2026-09-01");
  assert.equal(helpers.mealPlanReviewDefaultDate("weekly", new Date(2026, 7, 9, 23, 59)), "2026-08-10");
});

test("preview defaults to the following local Monday and confirm gates are explicit", () => {
  const helpers = mealReviewHelpers();
  assert.equal(helpers.nextMealPlanReviewMonday(new Date(2026, 7, 9)), "2026-08-10"); // Sunday -> Monday
  assert.equal(helpers.nextMealPlanReviewMonday(new Date(2026, 7, 10)), "2026-08-17"); // Monday -> next Monday
  assert.equal(helpers.mealPlanReviewIsMonday("2026-08-10"), true);
  assert.equal(helpers.mealPlanReviewIsMonday("2026-08-11"), false);

  const preview = { items: [{ date: "2026-08-10", slot: "dinner", title: "Pasta" }], conflicts: [], imported: false };
  assert.equal(helpers.mealPlanReviewCanConfirm({ status: "loading", preview, replaceExisting: false, imported: false }), false);
  assert.equal(helpers.mealPlanReviewCanConfirm({ status: "ready", preview, replaceExisting: false, imported: false }), true);
  assert.equal(helpers.mealPlanReviewCanConfirm({ status: "ready", preview: { ...preview, conflicts: [{ existingTitle: "Soup" }] }, replaceExisting: false, imported: false }), false);
  assert.equal(helpers.mealPlanReviewCanConfirm({ status: "ready", preview: { ...preview, conflicts: [{ existingTitle: "Soup" }] }, replaceExisting: true, imported: false }), true);
  assert.equal(helpers.mealPlanReviewCanConfirm({ status: "ready", preview: { ...preview, items: [] }, replaceExisting: false, imported: false }), false);
  const allBlocked = { ...preview, items: [{ key: "a", date: "2026-08-10", slot: "dinner", title: "Pasta" }], blocked: [{ key: "a", reason: "Allergen" }] };
  assert.deepEqual(helpers.mealPlanReviewSafeItems(allBlocked), []);
  assert.equal(helpers.mealPlanReviewCanConfirm({ status: "ready", preview: allBlocked, replaceExisting: false, imported: false }), false);
  assert.equal(helpers.mealPlanReviewCanConfirm({ status: "ready", preview: { ...preview, imported: true }, replaceExisting: false, imported: false }), false);
});

test("single-day dates accept any real date while weekly dates remain Monday-only", () => {
  const helpers = mealReviewHelpers();
  assert.equal(helpers.mealPlanReviewIsSingleDay("today"), true);
  assert.equal(helpers.mealPlanReviewIsSingleDay("tomorrow"), true);
  assert.equal(helpers.mealPlanReviewIsSingleDay("weekly"), false);
  assert.equal(helpers.mealPlanReviewIsValidDate("2026-08-11"), true);
  assert.equal(helpers.mealPlanReviewIsValidDate("2026-02-29"), false);
  assert.equal(helpers.mealPlanReviewIsValidDate("2026-04-31"), false);
  assert.equal(helpers.mealPlanReviewIsValidDate("2026-8-11"), false);
  assert.equal(helpers.mealPlanReviewIsMonday("2026-08-10"), true);
  assert.equal(helpers.mealPlanReviewIsMonday("2026-08-11"), false);
});

test("date changes refresh single-day previews, clear replacement, and invalidate stale weekly state", () => {
  const singleDay = mealReviewDateChangeState({
    dateMode: "today",
    startDate: "2026-08-10",
    replaceExisting: true,
    preview: { items: [{ title: "Soup" }] },
    status: "ready",
  });
  singleDay.change("2026-08-11");
  assert.equal(singleDay.state().startDate, "2026-08-11");
  assert.equal(singleDay.state().replaceExisting, false);
  assert.equal(singleDay.state().status, "loading");
  assert.equal(singleDay.state().preview, null);
  assert.equal(singleDay.counts().renders, 0);
  assert.equal(singleDay.counts().previews, 1);

  const weekly = mealReviewDateChangeState({
    dateMode: "weekly",
    startDate: "2026-08-10",
    replaceExisting: true,
    preview: { items: [{ title: "Soup" }] },
    status: "ready",
  });
  weekly.change("2026-08-11");
  assert.equal(weekly.state().status, "error");
  assert.equal(weekly.state().error, "Choose a Monday for the week start.");
  assert.equal(weekly.state().preview, null);
  assert.equal(weekly.state().replaceExisting, false);
  assert.equal(weekly.token(), 10);
  assert.equal(weekly.counts().renders, 1);
  assert.equal(weekly.counts().previews, 0);
});

test("success and idempotent outcomes stay clear, while grouped preview text is escaped", () => {
  const helpers = mealReviewHelpers();
  assert.match(helpers.mealPlanReviewSuccessMessage({ importedEntries: [{ id: "e1" }], existing: [] }), /Added 1 meal to Meals/);
  assert.match(helpers.mealPlanReviewSuccessMessage({ importedEntries: [], existing: true }), /plan was already in Meals/);
  assert.match(helpers.mealPlanReviewSuccessMessage({ importedEntries: [{ id: "e1" }], existing: true }), /plan was already in Meals/);
  assert.doesNotMatch(helpers.mealPlanReviewSuccessMessage({ importedEntries: [], existing: true }), /1 meal/);
  assert.match(helpers.mealPlanReviewSuccessMessage({ importedEntries: [{ id: "e1" }], existing: [{ id: "e2" }] }), /already there/);
  const grouped = helpers.renderMealPlanReviewEntries([
    { date: "2026-08-10", slot: "dinner", title: "<script>alert(1)</script>" },
    { date: "2026-08-11", slot: "lunch", title: "Soup" },
  ]);
  assert.match(grouped, /Meals by day|2026|Monday/);
  assert.doesNotMatch(grouped, /<script>alert\(1\)<\/script>/);
  assert.match(grouped, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("the chat UI preserves full text, uses a reusable accessible modal, and ignores stale previews", () => {
  assert.match(appSource, /\$\{m\.text \? `<div class="chat-msg-text">\$\{esc\(m\.text\)\}<\/div>` : ''\}/);
  assert.match(appSource, /Meal plan ready/);
  assert.match(appSource, /Review &amp; add to Meals/);
  assert.match(appSource, /card\.type === 'meal-plan-draft'/);
  assert.match(appSource, /if \(!card \|\| !card\.type \|\| card\.type === 'meal-plan-draft'\) return ''/);
  assert.match(appSource, /role="dialog" aria-modal="true"/);
  assert.match(appSource, /id="meal-plan-review-start-date"/);
  assert.match(appSource, /Week starting Monday/);
  assert.match(appSource, /Meal date/);
  assert.match(appSource, /single-day meal plan/);
  assert.match(appSource, /const dateMode = mealPlanReviewDateModeFromMessage\(message\);/);
  assert.match(appSource, /\n    dateMode,\n/);
  assert.match(appSource, /startDate: mealPlanReviewDefaultDate\(dateMode\)/);
  assert.match(appSource, /Replace meals already in these slots/);
  assert.match(appSource, /const token = \+\+mealPlanReviewRequestToken/);
  assert.match(appSource, /if \(!mealPlanReviewRequestIsCurrent\(token, messageId, startDate\)\) return;/);
  assert.match(appSource, /if \(!mealPlanReviewIsMonday\(value\)\)/);
  assert.match(appSource, /closeMealPlanReviewDialog\(\);\n    toast\(mealPlanReviewSuccessMessage\(result\)\)/);
  assert.match(appSource, /state\.error = \(err && err\.message\)/);
  assert.match(appSource, /renderMealPlanReviewAction\(m\)/);
});

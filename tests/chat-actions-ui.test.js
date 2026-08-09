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
    extractFunction(appSource, "nextMealPlanReviewMonday"),
    extractFunction(appSource, "mealPlanReviewItems"),
    extractFunction(appSource, "mealPlanReviewConflicts"),
    extractFunction(appSource, "mealPlanReviewBlocked"),
    extractFunction(appSource, "mealPlanReviewSafeItems"),
    extractFunction(appSource, "mealPlanReviewDateLabel"),
    extractFunction(appSource, "mealPlanReviewIsMonday"),
    extractFunction(appSource, "mealPlanReviewCanConfirm"),
    extractFunction(appSource, "mealPlanReviewResultCount"),
    extractFunction(appSource, "mealPlanReviewSuccessMessage"),
    extractFunction(appSource, "renderMealPlanReviewEntries"),
    "this.helpers = { chatMessageCanReviewMealPlan, nextMealPlanReviewMonday, mealPlanReviewIsMonday, mealPlanReviewSafeItems, mealPlanReviewCanConfirm, mealPlanReviewSuccessMessage, renderMealPlanReviewEntries, setKid };",
  ].join("\n"), sandbox, { filename: "meal-review-helpers.js" });
  return sandbox.helpers;
}

test("the review action is limited to parent family Hermes draft messages", () => {
  const helpers = mealReviewHelpers();
  const draft = { id: "m_draft", senderType: "agent", senderId: "hermes", familyId: "fam_1", card: { type: "meal-plan-draft" } };
  assert.equal(helpers.chatMessageCanReviewMealPlan(draft), true);
  assert.equal(helpers.chatMessageCanReviewMealPlan({ ...draft, deleted: true }), false);
  assert.equal(helpers.chatMessageCanReviewMealPlan({ ...draft, senderId: "other-agent" }), false);
  assert.equal(helpers.chatMessageCanReviewMealPlan({ ...draft, card: { type: "menu" } }), false);
  assert.equal(helpers.chatMessageCanReviewMealPlan({ ...draft, roomId: "trip:t1", familyId: "trip:t1" }), false);
  assert.equal(helpers.chatMessageCanReviewMealPlan({ ...draft, scopeId: "trip:t1" }), false);
  helpers.setKid(true);
  assert.equal(helpers.chatMessageCanReviewMealPlan(draft), false);
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
  assert.match(appSource, /Replace meals already in these slots/);
  assert.match(appSource, /const token = \+\+mealPlanReviewRequestToken/);
  assert.match(appSource, /if \(!mealPlanReviewRequestIsCurrent\(token, messageId, startDate\)\) return;/);
  assert.match(appSource, /if \(!mealPlanReviewIsMonday\(value\)\)/);
  assert.match(appSource, /closeMealPlanReviewDialog\(\);\n    toast\(mealPlanReviewSuccessMessage\(result\)\)/);
  assert.match(appSource, /state\.error = \(err && err\.message\)/);
  assert.match(appSource, /renderMealPlanReviewAction\(m\)/);
});

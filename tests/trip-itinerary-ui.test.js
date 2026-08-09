"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const publicRoot = path.join(__dirname, "..");
const authSource = fs.readFileSync(path.join(publicRoot, "public/js/auth.js"), "utf8");
const tripsSource = fs.readFileSync(path.join(publicRoot, "public/js/trips.js"), "utf8");

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

const CARD_DECL = `const HERMES_TRIP_ITINERARY_CARD = ${JSON.stringify({
  type: "trip-itinerary-draft",
  id: "hermes-trip-itinerary",
  title: "Itinerary ready",
})};`;
const CATS_DECL = `const CATS = ${JSON.stringify({
  food: { label: "Food" },
  sight: { label: "Sight" },
  activity: { label: "Activity" },
  transit: { label: "Transit" },
  stay: { label: "Stay" },
})};`;

function itineraryHelpers(overrides = {}) {
  const sandbox = Object.assign({
    currentTripId: "trip_1",
    currentTrip: { id: "trip_1", myRole: "editor" },
    currentUserId: "user_1",
    currentTab: "itinerary",
    tripChatMessages: [],
    tripItineraryReviewDialog: { classList: { contains: () => true } },
    tripItineraryReviewState: null,
    tripItineraryReviewRequestToken: 1,
    esc: (value) => String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;"),
  }, overrides);
  const source = [
    CARD_DECL,
    CATS_DECL,
    extractFunction(tripsSource, "tripChatMessageIsCurrentScope"),
    extractFunction(tripsSource, "tripChatMessageCanReviewItinerary"),
    extractFunction(tripsSource, "tripItineraryReviewMessage"),
    extractFunction(tripsSource, "tripItineraryReviewMessageSnapshot"),
    extractFunction(tripsSource, "tripItineraryReviewInlineArg"),
    extractFunction(tripsSource, "renderTripItineraryReviewAction"),
    extractFunction(tripsSource, "tripItineraryReviewItems"),
    extractFunction(tripsSource, "tripItineraryReviewDuplicates"),
    extractFunction(tripsSource, "tripItineraryReviewSafeItems"),
    extractFunction(tripsSource, "tripItineraryReviewCanConfirm"),
    extractFunction(tripsSource, "tripItineraryReviewResultCount"),
    extractFunction(tripsSource, "tripItineraryReviewSuccessMessage"),
    extractFunction(tripsSource, "tripItineraryReviewSortedItems"),
    extractFunction(tripsSource, "tripItineraryReviewCategory"),
    extractFunction(tripsSource, "renderTripItineraryReviewItem"),
    extractFunction(tripsSource, "renderTripItineraryReviewEntries"),
    extractFunction(tripsSource, "tripItineraryReviewDialogIsOpen"),
    extractFunction(tripsSource, "tripItineraryReviewContextIsCurrent"),
    extractFunction(tripsSource, "tripItineraryReviewRequestIsCurrent"),
    extractFunction(tripsSource, "requestTripItineraryReviewPreview"),
    extractFunction(tripsSource, "retryTripItineraryReviewPreview"),
    "this.helpers = { tripChatMessageCanReviewItinerary, renderTripItineraryReviewAction, tripItineraryReviewSafeItems, tripItineraryReviewCanConfirm, tripItineraryReviewSuccessMessage, tripItineraryReviewSortedItems, renderTripItineraryReviewEntries, tripItineraryReviewMessageSnapshot, tripItineraryReviewContextIsCurrent, tripItineraryReviewRequestIsCurrent, requestTripItineraryReviewPreview, retryTripItineraryReviewPreview };",
  ].join("\n");
  vm.runInNewContext(source, sandbox, { filename: "trip-itinerary-helpers.js" });
  return { sandbox, helpers: sandbox.helpers };
}

function draft(overrides = {}) {
  return Object.assign({
    id: "m_draft",
    familyId: "trip:trip_1",
    roomId: "trip:trip_1",
    senderType: "agent",
    senderId: "hermes",
    postedByUserId: null,
    text: "Day 1 | Plan\n--- | ---\n2026-08-10 | Museum",
    card: { type: "trip-itinerary-draft", id: "hermes-trip-itinerary", title: "Itinerary ready" },
  }, overrides);
}

test("Trip itinerary auth wrappers use percent-safe frozen POST routes and an empty body", async () => {
  const calls = [];
  const sandbox = {
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    window: {},
  };
  vm.runInNewContext(authSource, sandbox, { filename: "auth.js" });

  await sandbox.window.auth.previewTripItineraryChatImport("trip/a ?%", "m/a ?%");
  await sandbox.window.auth.importTripItineraryChat("trip/a ?%", "m/a ?%");
  assert.equal(calls[0].url, "/api/trips/trip%2Fa%20%3F%25/itinerary/import-chat/m%2Fa%20%3F%25/preview");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {});
  assert.equal(calls[1].url, "/api/trips/trip%2Fa%20%3F%25/itinerary/import-chat/m%2Fa%20%3F%25");
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), {});
});

test("only an adult member sees the exact current-Trip Hermes itinerary action", () => {
  const { sandbox, helpers } = itineraryHelpers();
  const message = draft();
  assert.equal(helpers.tripChatMessageCanReviewItinerary(message), true);

  for (const variant of [
    { deleted: true },
    { senderType: "member" },
    { senderId: "other-agent" },
    { familyId: "family_1", roomId: "family_1" },
    { roomId: "trip:trip_2" },
    { card: { type: "trip-itinerary-draft", id: "other", title: "Itinerary ready" } },
    { card: { type: "trip-itinerary-draft", id: "hermes-trip-itinerary", title: "Other title" } },
    { card: { type: "trip-itinerary" } },
    { familyId: undefined, roomId: undefined },
    { media: { type: "gif" } },
  ]) {
    assert.equal(helpers.tripChatMessageCanReviewItinerary(Object.assign({}, message, variant)), false, JSON.stringify(variant));
  }

  sandbox.currentTrip.myRole = "kid";
  assert.equal(helpers.tripChatMessageCanReviewItinerary(message), false);
  sandbox.currentTrip.myRole = "editor";
  sandbox.currentTripId = "trip_2";
  assert.equal(helpers.tripChatMessageCanReviewItinerary(message), false);
});

test("Trip chat keeps full escaped Hermes text and adds exactly one review action", () => {
  const { sandbox, helpers } = itineraryHelpers();
  const message = draft({ text: "<script>alert(1)</script>\nThe whole itinerary stays readable." });
  sandbox.tripChatMessages = [message];
  const action = helpers.renderTripItineraryReviewAction(message);
  assert.equal((action.match(/Review &amp; add to Itinerary/g) || []).length, 1);
  assert.doesNotMatch(action, /<script>alert\(1\)<\/script>/);

  const chatElement = { scrollHeight: 0, scrollTop: 0, clientHeight: 0, innerHTML: "" };
  const renderSandbox = Object.assign(sandbox, {
    document: { getElementById: () => chatElement },
    tripChatAvatarFor: () => ({ name: "Hermes", initial: "H", color: "var(--accent)" }),
    avatarHtml: () => "",
    isOwnerRole: () => false,
    renderTripChatUpdate: () => "",
  });
  vm.runInNewContext([
    extractFunction(tripsSource, "renderTripChatMessages"),
    "this.render = renderTripChatMessages;",
  ].join("\n"), renderSandbox, { filename: "trip-chat-render.js" });
  renderSandbox.render();
  assert.match(chatElement.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal((chatElement.innerHTML.match(/Review &amp; add to Itinerary/g) || []).length, 1);
});

test("preview safe-item gating, stable time ordering, duplicate details, and outcomes are explicit", () => {
  const { helpers } = itineraryHelpers();
  const preview = {
    imported: false,
    items: [
      { key: "dup", date: "2026-08-10", time: "08:00", title: "Old museum", category: "sight", note: "skip" },
      { key: "late", date: "2026-08-10", time: "10:00", title: "Late", category: "activity", note: "<note>" },
      { key: "blank", date: "2026-08-10", time: "", title: "Untimed", category: "food", note: "after timed" },
      { key: "early", date: "2026-08-10", time: "09:00", title: "Early", category: "sight", note: "first" },
      { key: "same-a", date: "2026-08-11", time: "09:00", title: "A", category: "activity" },
      { key: "same-b", date: "2026-08-11", time: "09:00", title: "B", category: "activity" },
    ],
    duplicates: [{ key: "dup", date: "2026-08-10", time: "08:00", title: "Old museum", category: "sight", existingTitle: "Museum already saved" }],
  };
  assert.deepEqual(helpers.tripItineraryReviewSafeItems(preview).map((item) => item.key), ["late", "blank", "early", "same-a", "same-b"]);
  assert.equal(helpers.tripItineraryReviewCanConfirm({ status: "loading", preview, imported: false }), false);
  assert.equal(helpers.tripItineraryReviewCanConfirm({ status: "saving", preview, imported: false }), false);
  assert.equal(helpers.tripItineraryReviewCanConfirm({ status: "error", errorKind: "preview", preview, imported: false }), false);
  assert.equal(helpers.tripItineraryReviewCanConfirm({ status: "error", errorKind: "import", preview, imported: false }), true);
  assert.equal(helpers.tripItineraryReviewCanConfirm({ status: "ready", preview, imported: false }), true);
  assert.equal(helpers.tripItineraryReviewCanConfirm({ status: "ready", preview: { ...preview, imported: true }, imported: false }), false);
  assert.equal(helpers.tripItineraryReviewCanConfirm({ status: "ready", preview: { ...preview, items: [preview.items[0]] }, imported: false }), false);

  const sorted = helpers.tripItineraryReviewSortedItems(preview.items.filter((item) => item.key !== "dup"));
  assert.deepEqual(sorted.map((item) => item.title), ["Early", "Late", "Untimed", "A", "B"]);
  const rendered = helpers.renderTripItineraryReviewEntries(preview.items.filter((item) => item.key !== "dup"), false);
  assert.ok(rendered.indexOf("Early") < rendered.indexOf("Late"));
  assert.ok(rendered.indexOf("Late") < rendered.indexOf("Untimed"));
  assert.match(rendered, /&lt;note&gt;/);
  const duplicates = helpers.renderTripItineraryReviewEntries(preview.duplicates, true);
  assert.match(duplicates, /Museum already saved/);

  assert.match(helpers.tripItineraryReviewSuccessMessage({ importedItems: [{ id: "a" }], skippedDuplicates: [] }), /Added 1 itinerary item/);
  assert.match(helpers.tripItineraryReviewSuccessMessage({ importedItems: [], skippedDuplicates: [], existing: true }), /already imported/);
  assert.match(helpers.tripItineraryReviewSuccessMessage({ importedItems: [], skippedDuplicates: [{ key: "a" }] }), /All 1 proposed itinerary item was already/);
  assert.match(helpers.tripItineraryReviewSuccessMessage({ importedItems: [{ id: "a" }], skippedDuplicates: [{ key: "b" }] }), /Added 1 itinerary item; 1 duplicate/);
});

test("preview and confirm response guards reject closed, reopened, changed-message, and changed-trip results", () => {
  const message = draft();
  const { sandbox, helpers } = itineraryHelpers({
    tripChatMessages: [message],
    tripItineraryReviewState: {
      tripId: "trip_1",
      messageId: "m_draft",
      messageSnapshot: null,
      requestToken: 1,
    },
  });
  sandbox.tripItineraryReviewState.messageSnapshot = helpers.tripItineraryReviewMessageSnapshot(message);
  assert.equal(helpers.tripItineraryReviewRequestIsCurrent(1, "trip_1", "m_draft"), true);
  sandbox.tripItineraryReviewRequestToken = 2;
  assert.equal(helpers.tripItineraryReviewRequestIsCurrent(1, "trip_1", "m_draft"), false);
  sandbox.tripItineraryReviewRequestToken = 1;
  sandbox.tripChatMessages[0] = draft({ text: "A changed draft" });
  assert.equal(helpers.tripItineraryReviewRequestIsCurrent(1, "trip_1", "m_draft"), false);
  sandbox.tripChatMessages[0] = message;
  sandbox.currentTripId = "trip_2";
  assert.equal(helpers.tripItineraryReviewRequestIsCurrent(1, "trip_1", "m_draft"), false);
  sandbox.currentTripId = "trip_1";
  sandbox.tripItineraryReviewDialog.classList.contains = () => false;
  assert.equal(helpers.tripItineraryReviewRequestIsCurrent(1, "trip_1", "m_draft"), false);
});

test("preview failure exposes one guarded retry request and keeps stale or closed retries inert", async () => {
  const message = draft();
  const preview = {
    imported: false,
    items: [{ key: "new", date: "2026-08-10", time: "10:00", title: "Museum", category: "sight" }],
    duplicates: [],
  };
  let dialogOpen = true;
  let previewCalls = 0;
  let renders = 0;
  const resolvers = [];
  const { sandbox, helpers } = itineraryHelpers({
    tripChatMessages: [message],
    tripItineraryReviewDialog: { classList: { contains: () => dialogOpen } },
    tripItineraryReviewState: {
      tripId: "trip_1",
      messageId: "m_draft",
      preview: null,
      imported: false,
      status: "error",
      error: "temporary preview failure",
      errorKind: "preview",
      success: "",
      messageSnapshot: null,
      requestToken: 7,
    },
    tripItineraryReviewRequestToken: 7,
    window: { auth: { previewTripItineraryChatImport: () => {
      previewCalls++;
      return new Promise((resolve) => resolvers.push(resolve));
    } } },
    renderTripItineraryReviewDialog: () => { renders++; },
  });
  sandbox.tripItineraryReviewState.messageSnapshot = helpers.tripItineraryReviewMessageSnapshot(message);

  helpers.retryTripItineraryReviewPreview();
  assert.equal(previewCalls, 1);
  assert.equal(sandbox.tripItineraryReviewState.status, "loading");
  helpers.retryTripItineraryReviewPreview();
  assert.equal(previewCalls, 1);
  assert.equal(renders, 1);

  resolvers.shift()(preview);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sandbox.tripItineraryReviewState.status, "ready");
  assert.strictEqual(sandbox.tripItineraryReviewState.preview, preview);

  sandbox.tripItineraryReviewState.status = "error";
  sandbox.tripItineraryReviewState.errorKind = "preview";
  dialogOpen = false;
  helpers.retryTripItineraryReviewPreview();
  assert.equal(previewCalls, 1);
  dialogOpen = true;
  sandbox.currentTripId = "trip_2";
  helpers.retryTripItineraryReviewPreview();
  assert.equal(previewCalls, 1);
});

test("import failure preserves the preview, re-enables one confirm retry, and guards stale or closed retries", async () => {
  const message = draft();
  const preview = {
    imported: false,
    items: [{ key: "new", date: "2026-08-10", time: "10:00", title: "Museum", category: "sight" }],
    duplicates: [],
  };
  let dialogOpen = true;
  let importCalls = 0;
  let rerenders = 0;
  const { sandbox, helpers } = itineraryHelpers({
    currentTab: "chat",
    tripChatMessages: [message],
    tripItineraryReviewDialog: { classList: { contains: () => dialogOpen } },
    tripItineraryReviewState: {
      tripId: "trip_1",
      messageId: "m_draft",
      preview,
      imported: false,
      status: "ready",
      error: "",
      errorKind: "",
      success: "",
      messageSnapshot: null,
      requestToken: 1,
    },
    tripItineraryReviewRequestToken: 1,
    window: { auth: { importTripItineraryChat: () => {
      importCalls++;
      return importCalls === 1
        ? Promise.reject(new Error("temporary import failure"))
        : Promise.resolve({
          trip: { id: "trip_1", myRole: "editor", itinerary: [{ id: "ti_new", title: "Museum" }] },
          importedItems: [{ id: "ti_new" }],
          skippedDuplicates: [],
          existing: false,
        });
    } } },
    rerenderTab: () => { rerenders++; },
    renderTripChatMessages: () => {},
    renderTripItineraryReviewDialog: () => {},
  });
  sandbox.tripItineraryReviewState.messageSnapshot = helpers.tripItineraryReviewMessageSnapshot(message);
  vm.runInNewContext([
    extractFunction(tripsSource, "confirmTripItineraryReviewImport"),
    "this.confirm = confirmTripItineraryReviewImport;",
  ].join("\n"), sandbox, { filename: "trip-itinerary-import-retry.js" });

  sandbox.confirm();
  sandbox.confirm();
  assert.equal(importCalls, 1);
  assert.equal(sandbox.tripItineraryReviewState.status, "saving");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sandbox.tripItineraryReviewState.status, "error");
  assert.equal(sandbox.tripItineraryReviewState.errorKind, "import");
  assert.equal(sandbox.tripItineraryReviewState.error, "temporary import failure");
  assert.strictEqual(sandbox.tripItineraryReviewState.preview, preview);
  assert.equal(helpers.tripItineraryReviewCanConfirm(sandbox.tripItineraryReviewState), true);

  dialogOpen = false;
  sandbox.confirm();
  assert.equal(importCalls, 1);
  dialogOpen = true;
  sandbox.currentTripId = "trip_2";
  sandbox.confirm();
  assert.equal(importCalls, 1);
  sandbox.currentTripId = "trip_1";

  sandbox.confirm();
  sandbox.confirm();
  assert.equal(importCalls, 2);
  assert.equal(sandbox.tripItineraryReviewState.status, "saving");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sandbox.tripItineraryReviewState.status, "success");
  assert.equal(sandbox.tripItineraryReviewState.imported, true);
  assert.equal(sandbox.currentTrip.itinerary[0].id, "ti_new");
  assert.equal(rerenders, 1);
});

test("confirm changes to saving synchronously, so one user action cannot duplicate the request", async () => {
  const message = draft();
  let importCalls = 0;
  let rerenders = 0;
  const { sandbox } = itineraryHelpers({
    tripChatMessages: [message],
    tripItineraryReviewState: {
      tripId: "trip_1",
      messageId: "m_draft",
      preview: { imported: false, items: [{ key: "new", date: "2026-08-10", time: "10:00", title: "Museum", category: "sight" }], duplicates: [] },
      imported: false,
      status: "ready",
      error: "",
      success: "",
      messageSnapshot: null,
      requestToken: 1,
    },
    window: { auth: { importTripItineraryChat: () => {
      importCalls++;
      return Promise.resolve({
        trip: { id: "trip_1", myRole: "editor", itinerary: [{ id: "ti_new", title: "Museum" }] },
        importedItems: [{ id: "ti_new" }],
        skippedDuplicates: [],
        existing: false,
      });
    } } },
    rerenderTab: () => { rerenders++; },
    renderTripChatMessages: () => {},
    renderTripItineraryReviewDialog: () => {},
  });
  sandbox.tripItineraryReviewState.messageSnapshot = [
    message.id, message.text, message.deleted, message.familyId, message.roomId, message.scopeId,
    message.card.type, message.card.id, message.card.title,
  ].map((value) => String(value == null ? "" : value)).join("\u0000");
  vm.runInNewContext([
    extractFunction(tripsSource, "confirmTripItineraryReviewImport"),
    "this.confirm = confirmTripItineraryReviewImport;",
  ].join("\n"), sandbox, { filename: "trip-itinerary-confirm.js" });
  sandbox.confirm();
  sandbox.confirm();
  assert.equal(importCalls, 1);
  assert.equal(sandbox.tripItineraryReviewState.status, "saving");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sandbox.tripItineraryReviewState.status, "success");
  assert.equal(sandbox.tripItineraryReviewState.imported, true);
  assert.equal(sandbox.currentTrip.itinerary[0].id, "ti_new");
  assert.equal(rerenders, 1);
});

test("the reusable review dialog source carries accessible labeling, live status/error, close controls, and stale tokens", () => {
  assert.match(tripsSource, /overlay\.id = 'trip-itinerary-review-modal'/);
  assert.match(tripsSource, /role="dialog" aria-modal="true" aria-labelledby="trip-itinerary-review-title" aria-describedby="trip-itinerary-review-status"/);
  assert.match(tripsSource, /id="trip-itinerary-review-status" role="status" aria-live="polite"/);
  assert.match(tripsSource, /id="trip-itinerary-review-error" role="alert" aria-live="assertive"/);
  assert.match(tripsSource, /trip-itinerary-review-close/);
  assert.match(tripsSource, /trip-itinerary-review-cancel/);
  assert.match(tripsSource, /trip-itinerary-review-retry/);
  assert.match(tripsSource, /Retry preview/);
  assert.match(tripsSource, /retry\.disabled = !canRetryPreview/);
  assert.match(tripsSource, /state\.errorKind = 'preview'/);
  assert.match(tripsSource, /state\.errorKind = 'import'/);
  assert.match(tripsSource, /document.activeElement/);
  assert.match(tripsSource, /tripItineraryReviewRequestToken\+\+/);
  assert.match(tripsSource, /if \(!tripItineraryReviewRequestIsCurrent\(token, tripId, messageId\)\) return;/);
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

// Isolate each test run in a throwaway data dir so tests never touch real data.
process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-"));
// Ensure APNs/web push start unconfigured unless a test opts in.
delete process.env.APNS_TEAM_ID;
delete process.env.APNS_KEY_ID;
delete process.env.APNS_BUNDLE_ID;
delete process.env.APNS_KEY_PATH;
delete process.env.APNS_KEY;
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.VAPID_SUBJECT;

const notifications = require("../lib/fam-notifications");

test("web subscriptions: add/list/remove round-trip, deduped by endpoint", () => {
  const userId = "user-1";
  const sub = { endpoint: "https://push.example.com/abc", keys: { p256dh: "p1", auth: "a1" } };
  assert.equal(notifications.listWebSubscriptions(userId).length, 0);

  assert.ok(notifications.addWebSubscription(userId, sub));
  assert.equal(notifications.listWebSubscriptions(userId).length, 1);

  // Adding the same endpoint again should not duplicate.
  notifications.addWebSubscription(userId, sub);
  assert.equal(notifications.listWebSubscriptions(userId).length, 1);

  // A different endpoint for the same user is a second subscription.
  const sub2 = { endpoint: "https://push.example.com/def", keys: { p256dh: "p2", auth: "a2" } };
  notifications.addWebSubscription(userId, sub2);
  assert.equal(notifications.listWebSubscriptions(userId).length, 2);

  notifications.removeWebSubscription(userId, sub.endpoint);
  const remaining = notifications.listWebSubscriptions(userId);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].endpoint, sub2.endpoint);
});

test("addWebSubscription: rejects missing userId/subscription/endpoint", () => {
  assert.equal(notifications.addWebSubscription(null, { endpoint: "x" }), false);
  assert.equal(notifications.addWebSubscription("u", null), false);
  assert.equal(notifications.addWebSubscription("u", {}), false);
});

test("enabled()/webEnabled(): both false when unconfigured (safe no-op)", () => {
  assert.equal(notifications.enabled(), false);
  assert.equal(notifications.webEnabled(), false);
});

test("notifyChatMessage: no-ops safely (0 sent) when neither channel is configured", async () => {
  const result = await notifications.notifyChatMessage({
    familyParentIds: ["p1", "p2"],
    familyKidUserIds: ["k1"],
    senderUserId: "p1",
    senderName: "Mum",
    familyId: "fam1",
    text: "Dinner at 6",
  });
  assert.deepEqual(result, { sent: 0, pruned: 0 });
});

test("notifyChatMessage: web push fan-out excludes the sender, includes kids", async () => {
  process.env.VAPID_PUBLIC_KEY = "pub";
  process.env.VAPID_PRIVATE_KEY = "priv";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";

  const webpushSender = require("../lib/webpush-sender");
  const originalCreate = webpushSender.createWebPushClient;
  const sentTo = [];
  webpushSender.createWebPushClient = () => ({
    send: async (subscription) => {
      sentTo.push(subscription.endpoint);
      return { ok: true, status: 201, reason: null, shouldPruneSubscription: false };
    },
  });

  delete require.cache[require.resolve("../lib/fam-notifications")];
  const freshNotifications = require("../lib/fam-notifications");
  freshNotifications.addWebSubscription("p1", { endpoint: "https://push/p1", keys: { p256dh: "a", auth: "b" } });
  freshNotifications.addWebSubscription("p2", { endpoint: "https://push/p2", keys: { p256dh: "a", auth: "b" } });
  freshNotifications.addWebSubscription("k1", { endpoint: "https://push/k1", keys: { p256dh: "a", auth: "b" } });

  try {
    const result = await freshNotifications.notifyChatMessage({
      familyParentIds: ["p1", "p2"],
      familyKidUserIds: ["k1"],
      senderUserId: "p1",
      senderName: "Mum",
      familyId: "fam1",
      text: "Dinner at 6",
    });
    // sender (p1) must never appear in the fan-out
    assert.ok(!sentTo.includes("https://push/p1"));
    assert.deepEqual(sentTo.sort(), ["https://push/k1", "https://push/p2"]);
    assert.equal(result.sent, 2);
  } finally {
    webpushSender.createWebPushClient = originalCreate;
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    delete require.cache[require.resolve("../lib/fam-notifications")];
  }
});

test("notifyChatMessage: APNs fan-out includes kid iPads, excludes sender, and skips watch tokens", async () => {
  process.env.APNS_TEAM_ID = "team";
  process.env.APNS_KEY_ID = "key";
  process.env.APNS_BUNDLE_ID = "com.example.app";
  process.env.APNS_KEY = "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----";

  const apnsSender = require("../lib/apns-sender");
  const originalCreate = apnsSender.createAPNsClient;
  const sentTo = [];
  apnsSender.createAPNsClient = () => ({
    send: async ({ deviceToken }) => {
      sentTo.push(deviceToken);
      return { ok: true, status: 200, apnsId: "x", reason: null, shouldPruneToken: false };
    },
  });

  delete require.cache[require.resolve("../lib/fam-notifications")];
  const freshNotifications = require("../lib/fam-notifications");
  freshNotifications.registerToken("p1", "token-p1");
  freshNotifications.registerToken("p1", "watch-p1", { kind: "watch", topic: "com.fametc.watch" });
  freshNotifications.registerToken("p2", "token-p2");
  freshNotifications.registerToken("k1", "token-k1");

  try {
    await freshNotifications.notifyChatMessage({
      familyParentIds: ["p1", "p2"],
      familyKidUserIds: ["k1"],
      senderUserId: "p2",
      senderName: "Dad",
      familyId: "fam1",
      text: "Hi",
    });
    assert.deepEqual(sentTo.sort(), ["token-k1", "token-p1"]);
  } finally {
    apnsSender.createAPNsClient = originalCreate;
    delete process.env.APNS_TEAM_ID;
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_BUNDLE_ID;
    delete process.env.APNS_KEY;
    delete require.cache[require.resolve("../lib/fam-notifications")];
  }
});

test("watch notifications use watch tokens and the watch APNs topic", async () => {
  process.env.APNS_TEAM_ID = "team-watch";
  process.env.APNS_KEY_ID = "key-watch";
  process.env.APNS_BUNDLE_ID = "com.example.app";
  process.env.APNS_KEY = "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----";

  const apnsSender = require("../lib/apns-sender");
  const originalCreate = apnsSender.createAPNsClient;
  const sent = [];
  apnsSender.createAPNsClient = () => ({
    send: async (request) => {
      sent.push(request);
      return { ok: true, status: 200, apnsId: "watch", reason: null, shouldPruneToken: false };
    },
  });

  delete require.cache[require.resolve("../lib/fam-notifications")];
  const freshNotifications = require("../lib/fam-notifications");
  freshNotifications.registerToken("watch-user", "watch-token", { kind: "watch", topic: "com.fametc.watch" });
  freshNotifications.registerToken("watch-user", "ios-token");
  freshNotifications.registerToken("watch-user", "parent-watch-token", { kind: "watch", topic: "com.fametc.app.watch" });
  try {
    const result = await freshNotifications.notifyWatchAction({
      recipientUserIds: ["watch-user"],
      familyId: "family-watch",
      action: { id: "a_watch", title: "Pack homework", status: "open", dueDate: new Date().toISOString().slice(0, 10) },
    });
    assert.deepEqual(result, { sent: 2, pruned: 0 });
    assert.equal(sent.length, 2);
    assert.equal(sent[1].topic, "com.fametc.app.watch");
    assert.equal(sent[0].deviceToken, "watch-token");
    assert.equal(sent[0].topic, "com.fametc.watch");
    assert.equal(sent[0].payload.famType, "watch_sync");
    assert.equal(sent[0].payload.resource, "actions");
    assert.equal(sent[0].payload.aps.alert.title, "⚡ My next");
  } finally {
    apnsSender.createAPNsClient = originalCreate;
    delete process.env.APNS_TEAM_ID;
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_BUNDLE_ID;
    delete process.env.APNS_KEY;
    delete require.cache[require.resolve("../lib/fam-notifications")];
  }
});

test("sendWebToUser: prunes a subscription the sender reports as gone (404/410)", async () => {
  const userId = "user-prune";
  const goneSub = { endpoint: "https://push.example.com/gone", keys: { p256dh: "p", auth: "a" } };
  const okSub = { endpoint: "https://push.example.com/ok", keys: { p256dh: "p", auth: "a" } };
  notifications.addWebSubscription(userId, goneSub);
  notifications.addWebSubscription(userId, okSub);

  // Force webEnabled() to report true and inject a fake underlying client by
  // patching webpush-sender's createWebPushClient before fam-notifications
  // caches its client. Simpler: directly exercise the prune path by driving
  // through the public API with env configured and monkey-patching the
  // lower-level module used internally.
  process.env.VAPID_PUBLIC_KEY = "pub";
  process.env.VAPID_PRIVATE_KEY = "priv";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";

  const webpushSender = require("../lib/webpush-sender");
  const originalCreate = webpushSender.createWebPushClient;
  webpushSender.createWebPushClient = () => ({
    send: async (subscription) => {
      if (subscription.endpoint === goneSub.endpoint) {
        return { ok: false, status: 410, reason: "gone", shouldPruneSubscription: true };
      }
      return { ok: true, status: 201, reason: null, shouldPruneSubscription: false };
    },
  });

  // Re-require a fresh fam-notifications instance so it picks up the mocked
  // createWebPushClient and the newly-set env vars (the real module caches
  // its client in a module-level singleton).
  delete require.cache[require.resolve("../lib/fam-notifications")];
  const freshNotifications = require("../lib/fam-notifications");
  freshNotifications.addWebSubscription(userId, goneSub);
  freshNotifications.addWebSubscription(userId, okSub);

  try {
    const result = await freshNotifications.sendWebToUser(userId, { title: "t", body: "b" });
    assert.equal(result.sent, 1);
    assert.equal(result.pruned, 1);
    const remaining = freshNotifications.listWebSubscriptions(userId);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].endpoint, okSub.endpoint);
  } finally {
    webpushSender.createWebPushClient = originalCreate;
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    delete require.cache[require.resolve("../lib/fam-notifications")];
  }
});

 test("watch APNs re-registration moves delivery to the current wearer", () => {
  notifications.registerToken("former-wearer", "reassigned-watch", { kind: "watch" });
  notifications.registerToken("current-wearer", "reassigned-watch", { kind: "watch", topic: "com.fametc.app.watch" });
  assert.equal(notifications.tokenEntriesForUser("former-wearer", "watch").length, 0);
  assert.equal(notifications.tokenEntriesForUser("current-wearer", "watch")[0].topic, "com.fametc.app.watch");
});

test("chat previews include article or attachment context alongside the caption", () => {
  const preview = notifications.chatMessagePreview;
  assert.equal(preview({ text: "This is hopeful", card: { type: "news", title: "New coral growth" } }), "📰 New coral growth — This is hopeful");
  assert.equal(preview({ text: "The school show", media: { type: "attachment", kind: "video", filename: "show.mp4" } }), "Video · show.mp4 — The school show");
  assert.equal(preview({ media: { type: "attachment", kind: "photo", filename: "beach.jpg" } }), "Photo · beach.jpg");
  assert.equal(preview({ media: { type: "attachment", filename: "worksheet.pdf" } }), "File · worksheet.pdf");
  assert.equal(preview({ media: { type: "gif" } }), "GIF");
  assert.equal(preview({ text: "Meet\n after school" }), "Meet after school");
  assert.equal(preview({}), "Sent a message");
});

test("rich family/trip APNs and web payloads retain deep links and fit APNs limits", async () => {
  const envKeys = ["APNS_TEAM_ID", "APNS_KEY_ID", "APNS_BUNDLE_ID", "APNS_KEY", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];
  const previous = envKeys.map((key) => process.env[key]);
  Object.assign(process.env, { APNS_TEAM_ID: "t", APNS_KEY_ID: "k", APNS_BUNDLE_ID: "com.test", APNS_KEY: "fake", VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "s", VAPID_SUBJECT: "mailto:test@example.test" });
  const apns = require("../lib/apns-sender");
  const web = require("../lib/webpush-sender");
  const createApns = apns.createAPNsClient;
  const createWeb = web.createWebPushClient;
  const apnsCalls = [];
  const webCalls = [];
  apns.createAPNsClient = () => ({ send: async (request) => { apnsCalls.push(request); return { ok: true }; } });
  web.createWebPushClient = () => ({ send: async (_sub, payload) => { webCalls.push(payload); return { ok: true }; } });
  delete require.cache[require.resolve("../lib/fam-notifications")];
  const fresh = require("../lib/fam-notifications");
  try {
    fresh.registerToken("rich-reader", "rich-device");
    fresh.addWebSubscription("rich-reader", { endpoint: "https://push/rich", keys: { p256dh: "a", auth: "b" } });
    await fresh.notifyChatMessage({ familyParentIds: ["rich-sender", "rich-reader"], familyKidUserIds: ["rich-reader"], senderUserId: "rich-sender", senderName: "🧑".repeat(4000), familyId: "f_rich", messageId: "m_rich", text: "🌍".repeat(4000), card: { type: "news", title: "📰".repeat(4000), url: "https://private.test/never-in-push" } });
    assert.equal(apnsCalls.length, 1);
    assert.equal(webCalls.length, 1);
    const payload = apnsCalls[0].payload;
    assert.equal(payload.aps.alert.subtitle, "News reflection");
    assert.equal(payload.famType, "chat_message");
    assert.equal(payload.messageId, "m_rich");
    assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 4096);
    assert.ok(!JSON.stringify(payload).includes("private.test"));
    assert.equal(webCalls[0].body, payload.aps.alert.body);
    assert.equal(webCalls[0].data.familyId, "f_rich");
    await fresh.notifyTripChatMessage({ id: "trip_rich", name: "Island holiday", members: [{ userId: "rich-reader" }] }, "rich-sender", "Dad", "Photo caption", "m_trip", { text: "Photo caption", media: { type: "attachment", kind: "photo", filename: "island.jpg" } });
    const trip = apnsCalls.at(-1).payload;
    assert.equal(trip.aps.alert.subtitle, "Island holiday");
    assert.match(trip.aps.alert.body, /Photo · island.jpg — Photo caption/);
    assert.equal(trip.tripId, "trip_rich");
  } finally {
    apns.createAPNsClient = createApns;
    web.createWebPushClient = createWeb;
    envKeys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
    delete require.cache[require.resolve("../lib/fam-notifications")];
  }
});

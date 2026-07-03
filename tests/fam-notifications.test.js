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

test("notifyChatMessage: APNs fan-out excludes the sender and never includes kids", async () => {
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
  freshNotifications.registerToken("p2", "token-p2");

  try {
    await freshNotifications.notifyChatMessage({
      familyParentIds: ["p1", "p2"],
      familyKidUserIds: ["k1"],
      senderUserId: "p2",
      senderName: "Dad",
      familyId: "fam1",
      text: "Hi",
    });
    assert.deepEqual(sentTo, ["token-p1"]);
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

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-buzz-notifications-"));
process.env.APNS_TEAM_ID = "buzz-team";
process.env.APNS_KEY_ID = "buzz-key";
process.env.APNS_BUNDLE_ID = "com.example.app";
process.env.APNS_KEY = "fake";
process.env.VAPID_PUBLIC_KEY = "pub";
process.env.VAPID_PRIVATE_KEY = "priv";
process.env.VAPID_SUBJECT = "mailto:buzz@example.com";

const apnsSender = require("../lib/apns-sender");
const webpushSender = require("../lib/webpush-sender");
const originalCreateAPNsClient = apnsSender.createAPNsClient;
const originalCreateWebPushClient = webpushSender.createWebPushClient;
const apnsRequests = [];
const webRequests = [];

apnsSender.createAPNsClient = () => ({
  send: async (request) => {
    apnsRequests.push(request);
    return { ok: true, status: 200, apnsId: "buzz", reason: null, shouldPruneToken: false };
  },
});
webpushSender.createWebPushClient = () => ({
  send: async (subscription, payload, options) => {
    webRequests.push({ subscription, payload, options });
    return { ok: true, status: 201, reason: null, shouldPruneSubscription: false };
  },
});

delete require.cache[require.resolve("../lib/fam-notifications")];
const notifications = require("../lib/fam-notifications");

function registerAll(userId, iosToken, watchToken, endpoint) {
  notifications.registerToken(userId, iosToken);
  if (watchToken) notifications.registerToken(userId, watchToken, { kind: "watch", topic: "com.fametc.watch" });
  notifications.addWebSubscription(userId, { endpoint, keys: { p256dh: "p", auth: "a" } });
}

test.after(() => {
  apnsSender.createAPNsClient = originalCreateAPNsClient;
  webpushSender.createWebPushClient = originalCreateWebPushClient;
  delete require.cache[require.resolve("../lib/fam-notifications")];
});

test("family Buzz fans out urgently to iOS, paired Watch, and web while excluding sender", async () => {
  registerAll("family-sender", "ios-sender", "watch-sender", "https://push/family-sender");
  registerAll("family-recipient", "ios-recipient", "watch-recipient", "https://push/family-recipient");
  registerAll("family-kid", "ios-kid", null, "https://push/family-kid");
  registerAll("not-in-room", "ios-outsider", null, "https://push/not-in-room");

  const result = await notifications.notifyChatBuzz({
    familyParentIds: ["family-sender", "family-recipient", "family-recipient"],
    familyKidUserIds: ["family-kid"],
    senderUserId: "family-sender",
    senderName: "Mum",
    familyId: "fam-buzz",
    text: "Urgent family message",
    messageId: "m_family_buzz_1",
  });

  assert.equal(result.sent, 5); // 3 APNs endpoints + 2 web subscriptions
  assert.deepEqual(apnsRequests.map((request) => request.deviceToken).sort(), ["ios-kid", "ios-recipient", "watch-recipient"]);
  assert.ok(!apnsRequests.some((request) => request.deviceToken.includes("sender")));
  assert.ok(!webRequests.some((request) => request.subscription.endpoint.includes("sender")));
  assert.deepEqual(webRequests.map((request) => request.subscription.endpoint).sort(), ["https://push/family-kid", "https://push/family-recipient"]);
  assert.ok(webRequests.every((request) => request.options.urgency === "high"));

  const ios = apnsRequests.find((request) => request.kind === "ios");
  const watch = apnsRequests.find((request) => request.kind === "watch");
  assert.ok(ios);
  assert.ok(watch);
  assert.equal(ios.topic, undefined);
  assert.equal(watch.topic, "com.fametc.watch");
  assert.equal(ios.payload.famType, "chat_buzz");
  assert.equal(watch.payload.famType, "chat_buzz");
  assert.equal(ios.payload.familyId, "fam-buzz");
  assert.equal(ios.payload.messageId, "m_family_buzz_1");
  assert.equal(ios.payload.aps.sound, "default");
  assert.equal(ios.payload.aps["interruption-level"], "time-sensitive");
  assert.equal(ios.payload.aps["thread-id"], "chat-fam-buzz");
  assert.equal(watch.payload.aps["thread-id"], "chat-fam-buzz");
  assert.ok(apnsRequests.every((request) => request.collapseId === "chat-buzz-fam-buzz-m_family_buzz_1"));
  assert.equal(webRequests[0].payload.data.url, "/");
  assert.equal(webRequests[0].payload.data.familyId, "fam-buzz");
  assert.equal(webRequests[0].payload.data.messageId, "m_family_buzz_1");

  apnsRequests.length = 0;
  webRequests.length = 0;
  await notifications.notifyChatBuzz({
    familyParentIds: ["family-sender", "family-recipient"],
    familyKidUserIds: [],
    senderUserId: "family-sender",
    senderName: "Mum",
    familyId: "fam-buzz",
    text: "Second urgent message",
    messageId: "m_family_buzz_2",
  });
  assert.ok(apnsRequests.every((request) => request.collapseId === "chat-buzz-fam-buzz-m_family_buzz_2"));
});

test("trip Buzz scopes recipients and destination, while ordinary family chat still skips Watch", async () => {
  apnsRequests.length = 0;
  webRequests.length = 0;
  registerAll("trip-sender", "ios-trip-sender", "watch-trip-sender", "https://push/trip-sender");
  registerAll("trip-recipient", "ios-trip-recipient", "watch-trip-recipient", "https://push/trip-recipient");
  registerAll("trip-outsider", "ios-trip-outsider", "watch-trip-outsider", "https://push/trip-outsider");

  const trip = {
    id: "trip-buzz",
    members: [{ userId: "trip-sender" }, { userId: "trip-recipient" }, { userId: "trip-recipient" }],
  };
  const result = await notifications.notifyTripChatBuzz(trip, "trip-sender", "Dad", "Meet at the gate", "m_trip_buzz_1");
  assert.equal(result.sent, 3); // recipient iOS + Watch + web
  assert.deepEqual(apnsRequests.map((request) => request.deviceToken).sort(), ["ios-trip-recipient", "watch-trip-recipient"]);
  assert.deepEqual(webRequests.map((request) => request.subscription.endpoint), ["https://push/trip-recipient"]);
  assert.equal(webRequests[0].options.urgency, "high");
  assert.ok(!apnsRequests.some((request) => request.deviceToken.includes("sender") || request.deviceToken.includes("outsider")));

  const ios = apnsRequests.find((request) => request.kind === "ios");
  const watch = apnsRequests.find((request) => request.kind === "watch");
  assert.equal(ios.payload.famType, "trip_chat_buzz");
  assert.equal(ios.payload.tripId, "trip-buzz");
  assert.equal(ios.payload.messageId, "m_trip_buzz_1");
  assert.equal(ios.payload.aps["thread-id"], "trip-trip-buzz");
  assert.equal(watch.topic, "com.fametc.watch");
  assert.equal(watch.payload.aps.sound, "default");
  assert.equal(watch.payload.aps["interruption-level"], "time-sensitive");
  assert.equal(webRequests[0].payload.data.url, "/trips/trip-buzz");
  assert.equal(webRequests[0].payload.data.tripId, "trip-buzz");
  assert.equal(webRequests[0].payload.data.messageId, "m_trip_buzz_1");

  apnsRequests.length = 0;
  webRequests.length = 0;
  await notifications.notifyTripChatMessage(trip, "trip-sender", "Dad", "Ordinary trip message", "m_trip_ordinary_1");
  assert.ok(apnsRequests.every((request) => request.payload.messageId === "m_trip_ordinary_1"));
  assert.ok(webRequests.every((request) => request.payload.data.messageId === "m_trip_ordinary_1"));

  apnsRequests.length = 0;
  webRequests.length = 0;
  await notifications.notifyChatMessage({
    familyParentIds: ["trip-recipient"],
    familyKidUserIds: [],
    senderUserId: "trip-sender",
    senderName: "Dad",
    familyId: "ordinary-family",
    text: "Ordinary message",
    messageId: "m_ordinary_1",
  });
  assert.ok(apnsRequests.every((request) => request.kind === "ios"));
  assert.ok(apnsRequests.every((request) => request.deviceToken !== "watch-trip-recipient"));
  assert.ok(apnsRequests.every((request) => request.payload.messageId === "m_ordinary_1"));
  assert.ok(webRequests.every((request) => request.payload.data.messageId === "m_ordinary_1"));
});

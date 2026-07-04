"use strict";
/**
 * Fam ETC app layer on top of the portable lib/apns-sender module.
 *
 * Owns: device-token registration/storage, notification triggers (chat
 * message, homework reminder), and Fam ETC-specific payload composition.
 * The generic send/retry/prune mechanics live entirely in apns-sender —
 * nothing in that module knows Fam ETC exists.
 */
const db = require("./db");
const { createAPNsClient } = require("./apns-sender");
const { createWebPushClient } = require("./webpush-sender");

let _client = null;
let _clientError = null; // last APNs client-build failure, surfaced at /api/health
function client() {
  if (_client) return _client;
  const keyPath = process.env.APNS_KEY_PATH;
  const key = process.env.APNS_KEY;
  if (!process.env.APNS_TEAM_ID || !process.env.APNS_KEY_ID || !process.env.APNS_BUNDLE_ID || !(keyPath || key)) {
    return null; // push not configured — callers must no-op gracefully
  }
  // A misconfigured key (missing .p8 file, unparseable PEM) must NOT crash the
  // app: building the client is wrapped so a bad key degrades to "push off" and
  // is reported via lastError, instead of throwing on every call (which 500'd
  // /api/health and every notify path).
  try {
    _client = createAPNsClient({
      teamId: process.env.APNS_TEAM_ID,
      keyId: process.env.APNS_KEY_ID,
      bundleId: process.env.APNS_BUNDLE_ID,
      keyPath,
      key,
      production: process.env.APNS_PRODUCTION === "true",
    });
    _clientError = null;
  } catch (e) {
    _clientError = e.message;
    console.error("[apns] disabled — could not build client:", e.message);
    _client = null;
  }
  return _client;
}

function enabled() {
  return !!client();
}

/// Why APNs is off, if a key was provided but failed to load (else null).
function configError() {
  client(); // ensure a build attempt has run
  return _clientError;
}

// ---------- web push ----------
let _webClient = null;
function webClient() {
  if (_webClient) return _webClient;
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) {
    return null; // web push not configured — callers must no-op gracefully
  }
  _webClient = createWebPushClient({
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT,
  });
  return _webClient;
}

function webEnabled() {
  return !!webClient();
}

// ---------- device token registry ----------
// One parent user may have multiple devices (iPhone + iPad). Tokens are
// stored per userId; kid profiles have no login/device of their own so pushes
// for kid-relevant events go to the parent(s) in the family instead.
function root() {
  const r = db.load();
  if (!r.deviceTokens) r.deviceTokens = {}; // userId -> [{ token, addedAt }]
  return r;
}

function registerToken(userId, token) {
  if (!userId || !token) return false;
  const r = root();
  const list = (r.deviceTokens[userId] = r.deviceTokens[userId] || []);
  if (!list.some((t) => t.token === token)) {
    list.push({ token, addedAt: new Date().toISOString() });
    db.persist();
  }
  return true;
}

function removeToken(userId, token) {
  const r = root();
  if (!r.deviceTokens[userId]) return false;
  r.deviceTokens[userId] = r.deviceTokens[userId].filter((t) => t.token !== token);
  db.persist();
  return true;
}

function tokensForUser(userId) {
  return (root().deviceTokens[userId] || []).map((t) => t.token);
}

async function sendToUser(userId, payload, opts = {}) {
  const apns = client();
  if (!apns) return { sent: 0, pruned: 0 }; // push not configured — silent no-op
  const tokens = tokensForUser(userId);
  let sent = 0;
  let pruned = 0;
  for (const token of tokens) {
    const result = await apns.send({ deviceToken: token, payload, ...opts });
    if (result.ok) sent++;
    if (result.shouldPruneToken) {
      removeToken(userId, token);
      pruned++;
    }
  }
  return { sent, pruned };
}

// ---------- web push subscription registry ----------
// Kept separate from APNs device tokens (different shape, different sender).
// Both parents and kid sessions can hold web subscriptions — kids have their
// own userId (see lib/store.findOrCreateKidUser), so this is keyed the same
// way as deviceTokens.
function webRoot() {
  const r = db.load();
  if (!r.webPushSubscriptions) r.webPushSubscriptions = {}; // userId -> [{ subscription, addedAt }]
  return r;
}

function addWebSubscription(userId, subscription) {
  if (!userId || !subscription || !subscription.endpoint) return false;
  const r = webRoot();
  const list = (r.webPushSubscriptions[userId] = r.webPushSubscriptions[userId] || []);
  if (!list.some((s) => s.subscription.endpoint === subscription.endpoint)) {
    list.push({ subscription, addedAt: new Date().toISOString() });
    db.persist();
  }
  return true;
}

function removeWebSubscription(userId, endpoint) {
  const r = webRoot();
  if (!r.webPushSubscriptions[userId]) return false;
  r.webPushSubscriptions[userId] = r.webPushSubscriptions[userId].filter((s) => s.subscription.endpoint !== endpoint);
  db.persist();
  return true;
}

function listWebSubscriptions(userId) {
  return (webRoot().webPushSubscriptions[userId] || []).map((s) => s.subscription);
}

async function sendWebToUser(userId, payload, opts = {}) {
  const wp = webClient();
  if (!wp) return { sent: 0, pruned: 0 }; // web push not configured — silent no-op
  const subscriptions = listWebSubscriptions(userId);
  let sent = 0;
  let pruned = 0;
  for (const subscription of subscriptions) {
    const result = await wp.send(subscription, payload, opts);
    if (result.ok) sent++;
    if (result.shouldPruneSubscription) {
      removeWebSubscription(userId, subscription.endpoint);
      pruned++;
    }
  }
  return { sent, pruned };
}

// ---------- notification triggers ----------

// New chat message — notify every OTHER family member (not the sender), on
// both channels: APNs device tokens (parents only — kids have no separate
// iOS device/login of their own historically) and web push subscriptions
// (parents AND kids, since kid sessions can subscribe from their own
// browser). Kid-authored messages (posted via a parent's session) also
// notify the other parent, per the "parents see everything" chat model.
async function notifyChatMessage({ familyParentIds, familyKidUserIds, senderUserId, senderName, familyId, text }) {
  const apnsRecipients = (familyParentIds || []).filter((id) => id !== senderUserId);
  const webRecipients = [...(familyParentIds || []), ...(familyKidUserIds || [])].filter((id) => id !== senderUserId);
  const body = (text || "").slice(0, 120) || "New message";
  const apnsPayload = {
    aps: { alert: { title: senderName || "Family chat", body }, sound: "default", "thread-id": `chat-${familyId}` },
    famType: "chat_message",
    familyId,
  };
  // No app icon assets ship yet — sw.js's showNotification tolerates a
  // missing/undefined icon (falls back to the browser's default), so this
  // is intentionally left out of the payload rather than pointing at a
  // path that 404s. Add icon/badge here once real icon files exist.
  const webPayload = {
    title: senderName || "Family chat",
    body,
    data: { url: "/", famType: "chat_message", familyId },
  };
  const [apnsResults, webResults] = await Promise.all([
    Promise.all(apnsRecipients.map((uid) => sendToUser(uid, apnsPayload, { pushType: "alert", collapseId: `chat-${familyId}` }))),
    Promise.all(webRecipients.map((uid) => sendWebToUser(uid, webPayload, { urgency: "normal" }))),
  ]);
  const results = [...apnsResults, ...webResults];
  return results.reduce((acc, r) => ({ sent: acc.sent + r.sent, pruned: acc.pruned + r.pruned }), { sent: 0, pruned: 0 });
}

// Kid access request — a kid asked to sign in on a device; every family parent
// gets pinged so they can approve/deny it. Goes to both APNs and web push, since
// the approving parent may be on either surface.
async function notifyKidAccessRequest({ familyParentIds, name, deviceLabel, familyId }) {
  const title = "Approve a device?";
  const body = `${name || "Someone"} wants to sign in on ${deviceLabel || "a device"}. Tap to review.`;
  const apnsPayload = {
    aps: { alert: { title, body }, sound: "default", "thread-id": `kid-access-${familyId}` },
    famType: "kid_access_request",
    familyId,
  };
  const webPayload = { title, body, data: { url: "/", famType: "kid_access_request", familyId } };
  const [apnsResults, webResults] = await Promise.all([
    Promise.all((familyParentIds || []).map((uid) => sendToUser(uid, apnsPayload, { pushType: "alert", collapseId: `kid-access-${familyId}` }))),
    Promise.all((familyParentIds || []).map((uid) => sendWebToUser(uid, webPayload, { urgency: "high" }))),
  ]);
  const results = [...apnsResults, ...webResults];
  return results.reduce((acc, r) => ({ sent: acc.sent + r.sent, pruned: acc.pruned + r.pruned }), { sent: 0, pruned: 0 });
}

// Homework/deadline reminder — notify the parent(s) tracking a given kid.
async function notifyHomeworkReminder({ familyParentIds, kidName, title, dueDate, homeworkId }) {
  const payload = {
    aps: {
      alert: { title: `${kidName ? kidName + ": " : ""}Homework due soon`, body: title || "" },
      sound: "default",
    },
    famType: "homework_reminder",
    homeworkId,
    dueDate,
  };
  const results = await Promise.all((familyParentIds || []).map((uid) => sendToUser(uid, payload, { pushType: "alert" })));
  return results.reduce((acc, r) => ({ sent: acc.sent + r.sent, pruned: acc.pruned + r.pruned }), { sent: 0, pruned: 0 });
}

module.exports = {
  enabled,
  registerToken,
  removeToken,
  tokensForUser,
  sendToUser,
  webEnabled,
  addWebSubscription,
  removeWebSubscription,
  listWebSubscriptions,
  sendWebToUser,
  notifyChatMessage,
  notifyHomeworkReminder,
  notifyKidAccessRequest,
  configError,
};

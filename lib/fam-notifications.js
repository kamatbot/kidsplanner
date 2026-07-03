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

let _client = null;
function client() {
  if (_client) return _client;
  const keyPath = process.env.APNS_KEY_PATH;
  const key = process.env.APNS_KEY;
  if (!process.env.APNS_TEAM_ID || !process.env.APNS_KEY_ID || !process.env.APNS_BUNDLE_ID || !(keyPath || key)) {
    return null; // push not configured — callers must no-op gracefully
  }
  _client = createAPNsClient({
    teamId: process.env.APNS_TEAM_ID,
    keyId: process.env.APNS_KEY_ID,
    bundleId: process.env.APNS_BUNDLE_ID,
    keyPath,
    key,
    production: process.env.APNS_PRODUCTION === "true",
  });
  return _client;
}

function enabled() {
  return !!client();
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

// ---------- notification triggers ----------

// New chat message — notify every OTHER parent in the family (not the
// sender). Kid-authored messages (posted via a parent's session) also notify
// the other parent, per the "parents see everything" chat model.
async function notifyChatMessage({ familyParentIds, senderUserId, senderName, familyId, text }) {
  const recipients = (familyParentIds || []).filter((id) => id !== senderUserId);
  const body = (text || "").slice(0, 120) || "New message";
  const payload = {
    aps: { alert: { title: senderName || "Family chat", body }, sound: "default", "thread-id": `chat-${familyId}` },
    famType: "chat_message",
    familyId,
  };
  const results = await Promise.all(recipients.map((uid) => sendToUser(uid, payload, { pushType: "alert", collapseId: `chat-${familyId}` })));
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
  notifyChatMessage,
  notifyHomeworkReminder,
};

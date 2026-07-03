"use strict";
/**
 * Family chat — net-new for Fam ETC (not a copy-ready RetireOdds component).
 *
 * Messages are stored per-family, encrypted at rest via the same db.json
 * encryption envelope everything else uses (lib/datacrypto.js, transparent
 * through lib/db.js — no separate crypto call needed here).
 *
 * Apple UGC review (1.2) + APP-BRIEF.md "Kids' privacy & compliance" require:
 *   - any PARENT can delete any message in the family (parent-admin control)
 *   - messages carry a report/flag field
 *   - members (parents) can be removed from the family (see lib/family.js)
 *
 * Structured cards: a message may carry a `card` referencing a homework item
 * or calendar event (e.g. { type: "homework", id }) so chat can deep-link
 * into other Fam ETC surfaces without duplicating their data.
 *
 * Transport (WebSocket/polling) lives in server.js / lib/routes — this module
 * is pure data access so it's testable without a live socket.
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");

function root() {
  const r = db.load();
  if (!r.chats) r.chats = {}; // familyId -> { messages: [...] }
  return r;
}

function msgId() {
  return "m_" + crypto.randomBytes(9).toString("hex");
}

function threadFor(familyId) {
  const r = root();
  if (!r.chats[familyId]) r.chats[familyId] = { messages: [] };
  return r.chats[familyId];
}

// Sender may be a parent (senderType "parent", senderId = user id) or posting
// on behalf of a kid profile (senderType "kid", senderId = kid id, postedBy =
// the parent's device/session that sent it — kids have no login of their own,
// but a shared-device flow can let them type into a parent-authenticated app).
function sendMessage(familyId, { senderType, senderId, postedByUserId, text, card }) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  const body = String(text || "").trim().slice(0, 4000);
  if (!body && !card) return { error: "Message is empty." };
  const msg = {
    id: msgId(),
    familyId,
    senderType: senderType === "kid" ? "kid" : "parent",
    senderId,
    postedByUserId: postedByUserId || (senderType === "parent" ? senderId : null),
    text: body,
    card: card || null, // { type: "homework"|"event", id, title? }
    createdAt: new Date().toISOString(),
    deleted: false,
    deletedBy: null,
    flagged: false,
    flagReason: null,
    flaggedBy: null,
  };
  const thread = threadFor(familyId);
  thread.messages.push(msg);
  db.persist();
  return { message: msg };
}

// Rolling window read, newest-last, capped so a long-lived family thread
// can't blow memory on every fetch. `since` (ISO string) supports polling.
const PAGE_CAP = 200;
function listMessages(familyId, { since, limit } = {}) {
  const thread = threadFor(familyId);
  let msgs = thread.messages;
  if (since) msgs = msgs.filter((m) => m.createdAt > since);
  const cap = Math.min(Number(limit) || PAGE_CAP, PAGE_CAP);
  return msgs.slice(-cap);
}

// Any PARENT in the family may delete any message — required parental
// control for UGC review, not just the message's own sender.
function deleteMessage(familyId, requestingParentId, messageId) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  if (!fam.parentIds.includes(requestingParentId)) return { error: "Only a parent in this family can delete a message." };
  const thread = threadFor(familyId);
  const msg = thread.messages.find((m) => m.id === messageId);
  if (!msg) return { error: "Message not found." };
  msg.deleted = true;
  msg.deletedBy = requestingParentId;
  msg.text = ""; // scrub content on delete; keep the tombstone for ordering
  db.persist();
  return { message: msg };
}

// Report/flag path (any family member's client can call this — kids posting
// via a parent-authenticated session included). Distinct from delete: a flag
// surfaces the message for a parent to review, it doesn't remove it.
function flagMessage(familyId, flaggedByUserId, messageId, reason) {
  const thread = threadFor(familyId);
  const msg = thread.messages.find((m) => m.id === messageId);
  if (!msg) return { error: "Message not found." };
  msg.flagged = true;
  msg.flagReason = String(reason || "").slice(0, 300) || null;
  msg.flaggedBy = flaggedByUserId || null;
  db.persist();
  return { message: msg };
}

module.exports = {
  sendMessage,
  listMessages,
  deleteMessage,
  flagMessage,
};

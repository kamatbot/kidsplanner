"use strict";
/**
 * Family chat — net-new for Fam ETC (not a copy-ready RetireOdds component).
 *
 * Storage: SQLite (lib/chat-store.js, better-sqlite3) is the primary backend
 * so a chat message append no longer re-serializes/re-encrypts the whole
 * db.json datastore (see lib/db.js). Each message body/card is encrypted at
 * rest individually (same fallback-to-plaintext-when-keyless policy as
 * lib/db.js — see lib/datacrypto.js), decrypted on read.
 *
 * FALLBACK: if better-sqlite3 fails to load (e.g. a host without a prebuilt
 * binary for its platform/Node version), we catch that once here and keep
 * the original db.json-backed implementation working unchanged. The backend
 * is chosen once at module load — see `getBackend()` / GET /api/health.
 *
 * One-way migration: on first load with the sqlite backend live, if the
 * legacy JSON store (root.chats) has messages and the sqlite table is still
 * empty, every message is copied across (same ids/timestamps) and root.chats
 * is deleted from db.json — so the JSON file stops carrying chat weight.
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
 * Transport: REST polling (lib/routes/chat.js), including a long-poll mode
 * (afterId + wait) — `onMessage`/`offMessage`/`waiterCount` below are the
 * per-family waiter registry that route uses; sendMessage() wakes it.
 */
const crypto = require("crypto");
const { EventEmitter } = require("events");
const db = require("./db");
const family = require("./family");

let sqliteStore = null;
let backend = "json";
try {
  sqliteStore = require("./chat-store");
  backend = "sqlite";
} catch (e) {
  console.warn("[chat] better-sqlite3 unavailable — falling back to JSON-backed chat storage:", e.message);
}

function getBackend() {
  return backend;
}

// Rolling window read, newest-last, capped so a long-lived family thread
// can't blow memory on every fetch.
const PAGE_CAP = 200;

function msgId() {
  return "m_" + crypto.randomBytes(9).toString("hex");
}

// ===================== JSON-backed storage (legacy / fallback) =====================
function root() {
  const r = db.load();
  if (!r.chats) r.chats = {}; // familyId -> { messages: [...] }
  return r;
}
function threadFor(familyId) {
  const r = root();
  if (!r.chats[familyId]) r.chats[familyId] = { messages: [] };
  return r.chats[familyId];
}
const jsonImpl = {
  insert(msg) {
    threadFor(msg.familyId).messages.push(msg);
    db.persist();
  },
  update() {
    db.persist(); // caller already mutated the live object returned by getMessage()
  },
  getMessage(familyId, id) {
    return threadFor(familyId).messages.find((m) => m.id === id) || null;
  },
  listMessages(familyId, { since, limit } = {}) {
    let msgs = threadFor(familyId).messages;
    if (since) msgs = msgs.filter((m) => m.createdAt > since);
    const cap = Math.min(Number(limit) || PAGE_CAP, PAGE_CAP);
    return msgs.slice(-cap);
  },
  listAfterId(familyId, afterId) {
    const msgs = threadFor(familyId).messages;
    if (!afterId) return msgs.slice(-PAGE_CAP);
    const idx = msgs.findIndex((m) => m.id === afterId);
    if (idx === -1) return msgs.slice(-PAGE_CAP);
    return msgs.slice(idx + 1, idx + 1 + PAGE_CAP);
  },
};

// ===================== SQLite-backed storage =====================
const sqliteImpl = sqliteStore && {
  insert(msg) { sqliteStore.insert(msg); },
  update(msg) { sqliteStore.update(msg); },
  getMessage(familyId, id) { return sqliteStore.get(familyId, id); },
  listMessages(familyId, { since, limit } = {}) {
    const cap = Math.min(Number(limit) || PAGE_CAP, PAGE_CAP);
    return sqliteStore.list(familyId, since).slice(-cap);
  },
  listAfterId(familyId, afterId) {
    return sqliteStore.listAfterId(familyId, afterId).slice(0, PAGE_CAP);
  },
};

const impl = backend === "sqlite" ? sqliteImpl : jsonImpl;

// One-way migration, guarded by "sqlite table is still empty" so it only ever
// runs once (subsequent boots see a non-empty table and skip it instantly).
function migrateFromJsonToSqlite() {
  if (backend !== "sqlite" || !sqliteStore.isEmpty()) return;
  const r = db.load();
  const chats = r.chats;
  if (!chats || typeof chats !== "object") return;
  let families = 0;
  let messages = 0;
  for (const familyId of Object.keys(chats)) {
    const msgs = (chats[familyId] && Array.isArray(chats[familyId].messages)) ? chats[familyId].messages : [];
    if (!msgs.length) continue;
    families++;
    for (const msg of msgs) {
      sqliteStore.insert(Object.assign({}, msg, { familyId }));
      messages++;
    }
  }
  if (messages > 0) {
    delete r.chats;
    db.persist();
    console.log(`[chat] migrated ${messages} message(s) across ${families} family thread(s) from db.json to SQLite; cleared root.chats`);
  }
}
migrateFromJsonToSqlite();

// ===================== waiter registry (long-poll) =====================
// One EventEmitter, one event name per family ("msg:<familyId>"). sendMessage
// emits; lib/routes/chat.js subscribes per in-flight GET request and uses
// listenerCount as the per-family concurrent-waiter cap (shared hosting
// protection) — no separate bookkeeping structure needed.
const emitter = new EventEmitter();
emitter.setMaxListeners(0);
function onMessage(familyId, cb) { emitter.on("msg:" + familyId, cb); }
function offMessage(familyId, cb) { emitter.off("msg:" + familyId, cb); }
function waiterCount(familyId) { return emitter.listenerCount("msg:" + familyId); }

// ===================== validation (shared by both backends) =====================
// Validates a client-supplied `media` object for a GIF attachment. Strict
// allowlist, not a sanitizer: anything that doesn't match returns null so
// the message is stored as if no media was attached, rather than trusting
// an arbitrary URL into a kid-visible chat bubble.
//   - type must be exactly 'gif'
//   - url/previewUrl must be https:// URLs whose HOSTNAME ends with
//     '.giphy.com' (rejects lookalikes like evil.com/giphy.com-fake.gif)
//   - width/height are coerced to small positive ints, capped at 800
function isGiphyHttpsUrl(u) {
  if (typeof u !== "string" || !u) return false;
  let parsed;
  try {
    parsed = new URL(u);
  } catch (e) {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return parsed.hostname === "giphy.com" || parsed.hostname.endsWith(".giphy.com");
}
function clampDim(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(v, 800);
}
function validateMedia(media) {
  if (!media || typeof media !== "object") return null;
  if (media.type !== "gif") return null;
  if (!isGiphyHttpsUrl(media.url) || !isGiphyHttpsUrl(media.previewUrl)) return null;
  return {
    type: "gif",
    url: media.url,
    previewUrl: media.previewUrl,
    width: clampDim(media.width),
    height: clampDim(media.height),
  };
}

// ===================== public API (unchanged shape) =====================
// Sender may be a parent (senderType "parent", senderId = user id) or posting
// on behalf of a kid profile (senderType "kid", senderId = kid id, postedBy =
// the parent's device/session that sent it — kids have no login of their own,
// but a shared-device flow can let them type into a parent-authenticated app).
function sendMessage(familyId, { senderType, senderId, postedByUserId, text, card, media }) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  const body = String(text || "").trim().slice(0, 4000);
  const validMedia = validateMedia(media);
  if (!body && !card && !validMedia) return { error: "Message is empty." };
  const msg = {
    id: msgId(),
    familyId,
    senderType: senderType === "kid" ? "kid" : "parent",
    senderId,
    postedByUserId: postedByUserId || (senderType === "parent" ? senderId : null),
    text: body,
    card: card || null, // { type: "homework"|"event", id, title? }
    media: validMedia, // { type: "gif", url, previewUrl, width, height } | null
    createdAt: new Date().toISOString(),
    deleted: false,
    deletedBy: null,
    flagged: false,
    flagReason: null,
    flaggedBy: null,
  };
  impl.insert(msg);
  emitter.emit("msg:" + familyId);
  return { message: msg };
}

function listMessages(familyId, opts) {
  return impl.listMessages(familyId, opts);
}

// Position-based cursor for long-polling: everything strictly after the
// message with id `afterId` (insertion order). No cursor (or an unknown one)
// returns the same recent window as listMessages().
function listMessagesAfterId(familyId, afterId) {
  return impl.listAfterId(familyId, afterId);
}

// Any PARENT in the family may delete any message — required parental
// control for UGC review, not just the message's own sender.
function deleteMessage(familyId, requestingParentId, messageId) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  if (!fam.parentIds.includes(requestingParentId)) return { error: "Only a parent in this family can delete a message." };
  const msg = impl.getMessage(familyId, messageId);
  if (!msg) return { error: "Message not found." };
  msg.deleted = true;
  msg.deletedBy = requestingParentId;
  msg.text = ""; // scrub content on delete; keep the tombstone for ordering
  msg.media = null;
  impl.update(msg);
  return { message: msg };
}

// Report/flag path (any family member's client can call this — kids posting
// via a parent-authenticated session included). Distinct from delete: a flag
// surfaces the message for a parent to review, it doesn't remove it.
function flagMessage(familyId, flaggedByUserId, messageId, reason) {
  const msg = impl.getMessage(familyId, messageId);
  if (!msg) return { error: "Message not found." };
  msg.flagged = true;
  msg.flagReason = String(reason || "").slice(0, 300) || null;
  msg.flaggedBy = flaggedByUserId || null;
  impl.update(msg);
  return { message: msg };
}

module.exports = {
  sendMessage,
  listMessages,
  listMessagesAfterId,
  deleteMessage,
  flagMessage,
  onMessage,
  offMessage,
  waiterCount,
  getBackend,
};

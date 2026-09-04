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
 *
 * Scope generalization (Phase B, Trips): every function below takes a scope
 * key, not strictly a familyId — chat-store/db already treat it as an opaque
 * string (SQLite `family_id` column, JSON `root.chats[key]`). A scope key is
 * either a real familyId (unchanged behavior) or `"trip:" + tripId` (a trip's
 * chat room — docs/TRIPS-PLAN.md). The only place scope-specific rules live
 * is existence checks (sendMessage) and delete permission (deleteMessage);
 * everything else (validation, storage, the waiter registry) is generic.
 * lib/trips.js never requires this module, so a require is cycle-safe, but it
 * is required lazily anyway to keep this module loadable standalone.
 */
const crypto = require("crypto");
const { EventEmitter } = require("events");
const db = require("./db");
const family = require("./family");
const chatAttachments = require("./chat-attachments");

const TRIP_SCOPE_PREFIX = "trip:";
function isTripScope(scopeKey) {
  return typeof scopeKey === "string" && scopeKey.startsWith(TRIP_SCOPE_PREFIX);
}
let _trips = null;
function tripsLib() {
  if (!_trips) _trips = require("./trips"); // lazy: avoid a require cycle at module-load time
  return _trips;
}

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
function pageLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return PAGE_CAP;
  return Math.min(PAGE_CAP, Math.floor(n));
}

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
function normalizeBuzz(msg) {
  if (msg) msg.buzz = msg.buzz === true;
  return msg;
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
    return normalizeBuzz(threadFor(familyId).messages.find((m) => m.id === id) || null);
  },
  listMessages(familyId, { since, limit } = {}) {
    let msgs = threadFor(familyId).messages;
    if (since) msgs = msgs.filter((m) => m.createdAt > since);
    const cap = pageLimit(limit);
    return msgs.slice(-cap).map(normalizeBuzz);
  },
  listAfterId(familyId, afterId) {
    const msgs = threadFor(familyId).messages;
    if (!afterId) return msgs.slice(-PAGE_CAP).map(normalizeBuzz);
    const idx = msgs.findIndex((m) => m.id === afterId);
    if (idx === -1) return msgs.slice(-PAGE_CAP).map(normalizeBuzz);
    return msgs.slice(idx + 1, idx + 1 + PAGE_CAP).map(normalizeBuzz);
  },
};

// ===================== SQLite-backed storage =====================
const sqliteImpl = sqliteStore && {
  insert(msg) { sqliteStore.insert(msg); },
  update(msg) { sqliteStore.update(msg); },
  getMessage(familyId, id) { return sqliteStore.get(familyId, id); },
  listMessages(familyId, { since, limit } = {}) {
    const cap = pageLimit(limit);
    return sqliteStore.list(familyId, since, cap);
  },
  listAfterId(familyId, afterId) {
    return sqliteStore.listAfterId(familyId, afterId, PAGE_CAP);
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
// One EventEmitter, one event name per scope ("msg:<scopeKey>"). sendMessage
// emits; lib/routes/chat.js and lib/routes/trips.js each subscribe per
// in-flight GET request and use listenerCount as the per-scope concurrent-
// waiter cap (shared hosting protection) — no separate bookkeeping structure
// needed, and it works for a trip scope key exactly as it does for a familyId.
const emitter = new EventEmitter();
emitter.setMaxListeners(0);
function onMessage(scopeKey, cb) { emitter.on("msg:" + scopeKey, cb); }
function offMessage(scopeKey, cb) { emitter.off("msg:" + scopeKey, cb); }
function waiterCount(scopeKey) { return emitter.listenerCount("msg:" + scopeKey); }

// ===================== validation (shared by both backends) =====================
// Media is a strict allowlist, not a sanitizer. GIFs continue to accept only
// Giphy HTTPS URLs. Uploaded photos/videos/files must point at an attachment
// that the server itself created for THIS chat scope; all client-supplied
// metadata is replaced with the canonical sidecar metadata before storage.
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
function validateMedia(scopeKey, media, uploaderUserId) {
  if (!media || typeof media !== "object") return null;
  if (media.type === "attachment") {
    try { return chatAttachments.validateMediaForScope(scopeKey, media, uploaderUserId); } catch (e) { return null; }
  }
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
// but a shared-device flow can let them type into a parent-authenticated app)
// in a family scope, or a trip member (senderType "member", senderId = user
// id — kids never get trip chat, see docs/TRIPS-PLAN.md permission matrix) in
// a trip scope. The family-scoped Hermes bridge uses senderType "agent" with
// the fixed sender id "hermes" and no postedByUserId.
function sendMessage(scopeKey, { senderType, senderId, postedByUserId, text, card, media, buzz }) {
  if (isTripScope(scopeKey)) {
    const trip = tripsLib().getTrip(scopeKey.slice(TRIP_SCOPE_PREFIX.length));
    if (!trip) return { error: "Trip not found." };
  } else {
    const fam = family.getFamily(scopeKey);
    if (!fam) return { error: "Family not found." };
  }
  const isBuzz = buzz === true;
  const body = String(text || "").trim().slice(0, 4000);
  if (isBuzz && ((card !== undefined && card !== null) || (media !== undefined && media !== null))) {
    return { error: "Buzz messages cannot include cards or media." };
  }
  const actingUserId = postedByUserId || (isTripScope(scopeKey) ? senderId : (senderType === "parent" ? senderId : null));
  let validMedia = isBuzz ? null : validateMedia(scopeKey, media, actingUserId);
  const messageId = msgId();
  if (validMedia && validMedia.type === "attachment") {
    try {
      validMedia = chatAttachments.claimForMessage(validMedia.attachmentId, scopeKey, actingUserId, messageId);
    } catch (e) {
      validMedia = null;
    }
  }
  if (isBuzz ? !body : (!body && !card && !validMedia)) return { error: "Message is empty." };
  const st = senderType === "agent" ? "agent" : (isTripScope(scopeKey) ? "member" : (senderType === "kid" ? "kid" : "parent"));
  const isAgent = st === "agent";
  const msg = {
    id: messageId,
    familyId: scopeKey,
    senderType: st,
    senderId: isAgent ? "hermes" : senderId,
    postedByUserId: isAgent ? null : (postedByUserId || (isTripScope(scopeKey) ? senderId : (senderType === "parent" ? senderId : null))),
    text: body,
    card: card || null, // { type: "homework"|"event", id, title? }
    media: validMedia, // Giphy descriptor or private attachment descriptor
    buzz: isBuzz,
    createdAt: new Date().toISOString(),
    deleted: false,
    deletedBy: null,
    flagged: false,
    flagReason: null,
    flaggedBy: null,
  };
  if (isAgent) msg.senderName = "Hermes";
  impl.insert(msg);
  emitter.emit("msg:" + scopeKey);
  return { message: msg };
}

function listMessages(scopeKey, opts) {
  return impl.listMessages(scopeKey, opts);
}

function getMessage(scopeKey, messageId) {
  return impl.getMessage(scopeKey, messageId);
}

// Position-based cursor for long-polling: everything strictly after the
// message with id `afterId` (insertion order). No cursor (or an unknown one)
// returns the same recent window as listMessages().
function listMessagesAfterId(scopeKey, afterId) {
  return impl.listAfterId(scopeKey, afterId);
}

// Family scope: any PARENT in the family may delete any message — required
// parental control for UGC review, not just the message's own sender. Trip
// scope: the trip owner or the message's own author (docs/TRIPS-PLAN.md
// permission matrix — trip editors have no admin-delete-any power).
function deleteMessage(scopeKey, requestingUserId, messageId) {
  if (isTripScope(scopeKey)) {
    const trip = tripsLib().getTrip(scopeKey.slice(TRIP_SCOPE_PREFIX.length));
    if (!trip) return { error: "Trip not found." };
    const msg = impl.getMessage(scopeKey, messageId);
    if (!msg) return { error: "Message not found." };
    const isOwner = tripsLib().isOwner(trip, requestingUserId);
    const isAuthor = msg.senderId === requestingUserId;
    if (!isOwner && !isAuthor) return { error: "Only the trip owner or the message's author can delete it." };
    const attachmentId = msg.media && msg.media.type === "attachment" ? msg.media.attachmentId : null;
    msg.deleted = true;
    msg.deletedBy = requestingUserId;
    msg.text = "";
    msg.media = null;
    impl.update(msg);
    if (attachmentId) { try { chatAttachments.removeForMessage(attachmentId, msg.id); } catch (_) {} }
    return { message: msg };
  }
  const fam = family.getFamily(scopeKey);
  if (!fam) return { error: "Family not found." };
  if (!fam.parentIds.includes(requestingUserId)) return { error: "Only a parent in this family can delete a message." };
  const msg = impl.getMessage(scopeKey, messageId);
  if (!msg) return { error: "Message not found." };
  const attachmentId = msg.media && msg.media.type === "attachment" ? msg.media.attachmentId : null;
  msg.deleted = true;
  msg.deletedBy = requestingUserId;
  msg.text = ""; // scrub content on delete; keep the tombstone for ordering
  msg.media = null;
  impl.update(msg);
  if (attachmentId) { try { chatAttachments.removeForMessage(attachmentId, msg.id); } catch (_) {} }
  return { message: msg };
}

// Report/flag path (any scope member's client can call this — kids posting
// via a parent-authenticated session included). Distinct from delete: a flag
// surfaces the message for a parent/owner to review, it doesn't remove it.
function flagMessage(scopeKey, flaggedByUserId, messageId, reason) {
  const msg = impl.getMessage(scopeKey, messageId);
  if (!msg) return { error: "Message not found." };
  msg.flagged = true;
  msg.flagReason = String(reason || "").slice(0, 300) || null;
  msg.flaggedBy = flaggedByUserId || null;
  impl.update(msg);
  return { message: msg };
}

module.exports = {
  sendMessage,
  getMessage,
  listMessages,
  listMessagesAfterId,
  deleteMessage,
  flagMessage,
  onMessage,
  offMessage,
  waiterCount,
  getBackend,
};

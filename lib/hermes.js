"use strict";

/**
 * Family-scoped Hermes bridge.
 *
 * A family has at most one active connection. The bearer token is generated
 * here, but only its SHA-256 digest is persisted in the encrypted datastore.
 * Room authorization is deliberately derived from the family record and the
 * trip membership graph on every request so newly-associated trips appear
 * without rotating the connection.
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");
const trips = require("./trips");
const chat = require("./chat");

const CONNECTION_FIELD = "hermesConnection";
const TOKEN_BYTES = 32;
const TOKEN_HASH_RE = /^[0-9a-f]{64}$/i;
const FAMILY_ROOM_ID = "family";
const TRIP_SCOPE_PREFIX = "trip:";
// The empty-room cursor is an adapter-only continuation marker. It lets a
// client that discovered a room before its first message poll for messages
// without replaying history on a later restart.
const EMPTY_CURSOR = "__hermes_empty__";
const HERMES_SENDER = Object.freeze({
  senderType: "agent",
  senderId: "hermes",
  senderName: "Hermes",
});
const HUMAN_SENDER_TYPES = new Set(["parent", "kid", "member"]);

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

function tokenMatches(token, storedHash) {
  const expected = Buffer.from(hashToken(token), "hex");
  const actual = Buffer.alloc(expected.length);
  const valid = typeof storedHash === "string" && TOKEN_HASH_RE.test(storedHash);
  if (valid) Buffer.from(storedHash, "hex").copy(actual);
  return crypto.timingSafeEqual(expected, actual) && valid;
}

function storedConnection(fam) {
  const connection = fam && fam[CONNECTION_FIELD];
  if (!connection || typeof connection !== "object") return null;
  if (!TOKEN_HASH_RE.test(String(connection.tokenHash || ""))) return null;
  if (!connection.connectedAt) return null;
  if (connection.expiresAt && Date.parse(connection.expiresAt) <= Date.now()) return null;
  return connection;
}

function connectionStatus(fam) {
  const connection = storedConnection(fam);
  if (!connection) return null;
  return {
    familyId: fam.id,
    connectedAt: connection.connectedAt,
  };
}

function connectFamily(familyId) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };

  const token = `hermes_${crypto.randomBytes(TOKEN_BYTES).toString("base64url")}`;
  const connectedAt = new Date().toISOString();
  fam[CONNECTION_FIELD] = {
    tokenHash: hashToken(token),
    connectedAt,
  };
  db.persist();
  return {
    connection: { familyId: fam.id, connectedAt },
    token,
  };
}

function revokeFamily(familyId) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  if (Object.prototype.hasOwnProperty.call(fam, CONNECTION_FIELD)) {
    delete fam[CONNECTION_FIELD];
    db.persist();
  }
  return { ok: true };
}

function familyForToken(token) {
  if (typeof token !== "string" || !token || token.length > 512) return null;
  const root = db.load();
  for (const fam of Object.values(root.families || {})) {
    const connection = storedConnection(fam);
    if (connection && tokenMatches(token, connection.tokenHash)) {
      return { family: fam, connection };
    }
  }
  return null;
}

function tripBelongsToFamily(fam, trip) {
  if (!fam || !trip) return false;
  if (trip.familyId === fam.id) return true;
  const parentIds = new Set(Array.isArray(fam.parentIds) ? fam.parentIds : []);
  return Array.isArray(trip.members) && trip.members.some((member) => parentIds.has(member && member.userId));
}

function roomForFamily(fam, roomId) {
  if (!fam || typeof roomId !== "string" || !roomId) return null;
  if (roomId === FAMILY_ROOM_ID || roomId === fam.id) {
    return {
      roomId: FAMILY_ROOM_ID,
      scopeKey: fam.id,
      kind: "family",
      title: fam.name || "Family chat",
    };
  }
  if (!roomId.startsWith(TRIP_SCOPE_PREFIX)) return null;
  const tripId = roomId.slice(TRIP_SCOPE_PREFIX.length);
  if (!tripId) return null;
  const trip = trips.getTrip(tripId);
  if (!tripBelongsToFamily(fam, trip)) return null;
  return {
    roomId: `${TRIP_SCOPE_PREFIX}${trip.id}`,
    scopeKey: `${TRIP_SCOPE_PREFIX}${trip.id}`,
    kind: "trip",
    title: trip.name || "Trip chat",
    trip,
  };
}

function roomsForFamily(fam) {
  if (!fam) return [];
  const rooms = [{
    roomId: FAMILY_ROOM_ID,
    title: fam.name || "Family chat",
    kind: "family",
  }];
  for (const trip of trips.allTrips()) {
    if (!tripBelongsToFamily(fam, trip)) continue;
    rooms.push({
      roomId: `${TRIP_SCOPE_PREFIX}${trip.id}`,
      title: trip.name || "Trip chat",
      kind: "trip",
    });
  }
  return rooms;
}

function latestMessageId(scopeKey) {
  const latest = chat.listMessages(scopeKey, { limit: 1 });
  return latest.length ? latest[latest.length - 1].id : null;
}

function isHermesMention(text) {
  return /(^|[^A-Za-z0-9_])@Hermes\b/i.test(String(text || ""));
}

function isInboundMessage(message) {
  return !!message
    && HUMAN_SENDER_TYPES.has(message.senderType)
    && !message.deleted
    && typeof message.text === "string"
    && !!message.text.trim()
    && isHermesMention(message.text);
}

/**
 * Read bridge-visible messages after a client cursor.
 *
 * A missing or foreign cursor is treated as a discovery request: seed it at
 * the current tail instead of replaying history. Cursors advance over all
 * stored messages, including filtered messages, so an agent message cannot
 * cause a polling loop.
 */
function listInboundMessages(scopeKey, afterId) {
  const cursor = typeof afterId === "string" ? afterId : "";
  if (cursor === EMPTY_CURSOR) {
    const all = chat.listMessages(scopeKey);
    return {
      messages: all.filter(isInboundMessage),
      cursor: all.length ? all[all.length - 1].id : EMPTY_CURSOR,
    };
  }
  if (!cursor || !chat.getMessage(scopeKey, cursor)) {
    return { messages: [], cursor: latestMessageId(scopeKey) };
  }
  const all = chat.listMessagesAfterId(scopeKey, cursor);
  return {
    messages: all.filter(isInboundMessage),
    cursor: all.length ? all[all.length - 1].id : cursor,
  };
}

function sendAgentMessage(scopeKey, text) {
  return chat.sendMessage(scopeKey, {
    ...HERMES_SENDER,
    postedByUserId: null,
    text,
  });
}

module.exports = {
  CONNECTION_FIELD,
  FAMILY_ROOM_ID,
  TRIP_SCOPE_PREFIX,
  EMPTY_CURSOR,
  HERMES_SENDER,
  connectFamily,
  connectionStatus,
  revokeFamily,
  familyForToken,
  roomsForFamily,
  roomForFamily,
  listInboundMessages,
  latestMessageId,
  sendAgentMessage,
  isHermesMention,
  isInboundMessage,
};

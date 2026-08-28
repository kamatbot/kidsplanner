"use strict";

const crypto = require("crypto");
const db = require("./db");
const family = require("./family");
const trips = require("./trips");
const chat = require("./chat");
const tripHermesContext = require("./trip-hermes-context");
const travelResults = require("./travel-results");
const mealPlanImport = require("./meal-plan-import");
const tripItineraryImport = require("./trip-itinerary-import");

const CONNECTION_FIELD = "hermesConnection";
const TOKEN_BYTES = 32;
const TOKEN_HASH_RE = /^[0-9a-f]{64}$/i;
const FAMILY_ROOM_ID = "family";
const TRIP_SCOPE_PREFIX = "trip:";
const EMPTY_CURSOR = "__hermes_empty__";
const HERMES_SENDER = Object.freeze({ senderType: "agent", senderId: "hermes", senderName: "Hermes" });
const HUMAN_SENDER_TYPES = new Set(["parent", "kid", "member"]);
const TRAVEL_BLOCK_RE = /```fametc_travel\s*([\s\S]{1,65536}?)```/gi;

function hashToken(token) { return crypto.createHash("sha256").update(String(token), "utf8").digest("hex"); }
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
  return { familyId: fam.id, connectedAt: connection.connectedAt };
}
function connectFamily(familyId) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  const token = `hermes_${crypto.randomBytes(TOKEN_BYTES).toString("base64url")}`;
  const connectedAt = new Date().toISOString();
  fam[CONNECTION_FIELD] = { tokenHash: hashToken(token), connectedAt };
  db.persist();
  return { connection: { familyId: fam.id, connectedAt }, token };
}
function revokeFamily(familyId) {
  const fam = family.getFamily(familyId);
  if (!fam) return { error: "Family not found." };
  if (Object.prototype.hasOwnProperty.call(fam, CONNECTION_FIELD)) { delete fam[CONNECTION_FIELD]; db.persist(); }
  return { ok: true };
}
function familyForToken(token) {
  if (typeof token !== "string" || !token || token.length > 512) return null;
  const root = db.load();
  for (const fam of Object.values(root.families || {})) {
    const connection = storedConnection(fam);
    if (connection && tokenMatches(token, connection.tokenHash)) return { family: fam, connection };
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
  if (roomId === FAMILY_ROOM_ID || roomId === fam.id) return { roomId: FAMILY_ROOM_ID, scopeKey: fam.id, kind: "family", title: fam.name || "Family chat" };
  if (!roomId.startsWith(TRIP_SCOPE_PREFIX)) return null;
  const tripId = roomId.slice(TRIP_SCOPE_PREFIX.length);
  if (!tripId) return null;
  const trip = trips.getTrip(tripId);
  if (!tripBelongsToFamily(fam, trip)) return null;
  return { roomId: `${TRIP_SCOPE_PREFIX}${trip.id}`, scopeKey: `${TRIP_SCOPE_PREFIX}${trip.id}`, kind: "trip", title: trip.name || "Trip chat", trip };
}
function roomsForFamily(fam) {
  if (!fam) return [];
  const rooms = [{ roomId: FAMILY_ROOM_ID, title: fam.name || "Family chat", kind: "family" }];
  for (const trip of trips.allTrips()) {
    if (!tripBelongsToFamily(fam, trip)) continue;
    rooms.push({ roomId: `${TRIP_SCOPE_PREFIX}${trip.id}`, title: trip.name || "Trip chat", kind: "trip" });
  }
  return rooms;
}
function latestMessageId(scopeKey) {
  const latest = chat.listMessages(scopeKey, { limit: 1 });
  return latest.length ? latest[latest.length - 1].id : null;
}
function isHermesMention(text) { return /(^|[^A-Za-z0-9_])@Hermes\b/i.test(String(text || "")); }
function isInboundMessage(message) {
  return !!message && HUMAN_SENDER_TYPES.has(message.senderType) && !message.deleted
    && typeof message.text === "string" && !!message.text.trim() && isHermesMention(message.text);
}
function withTripContext(scopeKey, message) {
  if (!scopeKey.startsWith(TRIP_SCOPE_PREFIX)) return message;
  const tripId = scopeKey.slice(TRIP_SCOPE_PREFIX.length);
  const tripContext = tripHermesContext.buildTripContext(tripId);
  return tripContext ? Object.assign({}, message, { tripContext }) : message;
}
function listInboundMessages(scopeKey, afterId) {
  const cursor = typeof afterId === "string" ? afterId : "";
  const project = (all) => all.filter(isInboundMessage).map((message) => withTripContext(scopeKey, message));
  if (cursor === EMPTY_CURSOR) {
    const all = chat.listMessages(scopeKey);
    return { messages: project(all), cursor: all.length ? all[all.length - 1].id : EMPTY_CURSOR };
  }
  if (!cursor || !chat.getMessage(scopeKey, cursor)) return { messages: [], cursor: latestMessageId(scopeKey) };
  const all = chat.listMessagesAfterId(scopeKey, cursor);
  return { messages: project(all), cursor: all.length ? all[all.length - 1].id : cursor };
}

const MEAL_PLAN_DRAFT_CARD = Object.freeze({ type: "meal-plan-draft", id: "hermes-meal-plan", title: "Meal plan ready" });
const TRIP_ITINERARY_DRAFT_CARD = Object.freeze({ type: "trip-itinerary-draft", id: "hermes-trip-itinerary", title: "Itinerary ready" });
function isFamilyScope(scopeKey) { return typeof scopeKey === "string" && !scopeKey.startsWith(TRIP_SCOPE_PREFIX); }
function extractTravelResults(text) {
  const source = String(text == null ? "" : text);
  const matches = [...source.matchAll(TRAVEL_BLOCK_RE)];
  if (!matches.length) return { text: source, card: null };
  const visible = source.replace(TRAVEL_BLOCK_RE, "").trim();
  const safeFallback = "I couldn't format those travel options safely. Please ask me to research them again.";
  if (matches.length !== 1) return { text: visible || safeFallback, card: null };
  let raw;
  try { raw = JSON.parse(matches[0][1]); } catch (_) { return { text: visible || safeFallback, card: null }; }
  const card = travelResults.sanitizeTravelCard(raw);
  return {
    text: visible || (card ? "I found a few current options for the trip." : safeFallback),
    card,
  };
}
function sendAgentMessage(scopeKey, text, card) {
  const trip = typeof scopeKey === "string" && scopeKey.startsWith(TRIP_SCOPE_PREFIX) ? trips.getTrip(scopeKey.slice(TRIP_SCOPE_PREFIX.length)) : null;
  let visibleText = String(text == null ? "" : text);
  let structuredTravelCard = null;
  if (trip) {
    const extracted = extractTravelResults(visibleText);
    visibleText = extracted.text;
    structuredTravelCard = extracted.card;
  }
  const inferredCard = isFamilyScope(scopeKey) && mealPlanImport.isParseableMealPlan(visibleText)
    ? MEAL_PLAN_DRAFT_CARD
    : structuredTravelCard || (trip && tripItineraryImport.isParseableItinerary(visibleText, trip) ? TRIP_ITINERARY_DRAFT_CARD : null);
  let messageCard;
  if (card !== undefined) {
    messageCard = isFamilyScope(scopeKey) ? card : travelResults.sanitizeTravelCard(card);
  } else {
    messageCard = inferredCard;
  }
  return chat.sendMessage(scopeKey, { ...HERMES_SENDER, postedByUserId: null, text: visibleText, card: messageCard });
}

module.exports = {
  CONNECTION_FIELD, FAMILY_ROOM_ID, TRIP_SCOPE_PREFIX, EMPTY_CURSOR, HERMES_SENDER,
  MEAL_PLAN_DRAFT_CARD, TRIP_ITINERARY_DRAFT_CARD, connectFamily, connectionStatus,
  revokeFamily, familyForToken, roomsForFamily, roomForFamily, listInboundMessages,
  latestMessageId, sendAgentMessage, isHermesMention, isInboundMessage, extractTravelResults,
};

"use strict";

/**
 * Read-only, bounded context for Hermes inside a Trip room.
 *
 * The goal is ambient awareness without ambient authority: Hermes is only
 * invoked by an explicit @Hermes message, but when invoked it receives the
 * current trip plus the recent human conversation so travelers do not need to
 * restate dates, preferences, constraints, or ideas from earlier messages.
 */
const chat = require("./chat");
const trips = require("./trips");
const store = require("./store");

const SCHEMA_VERSION = "fametc.trip-context.v1";
const MAX_MESSAGES = 120;
const MAX_MESSAGE_CHARS = 1200;
const MAX_CHAT_CHARS = 50000;
const MAX_ITEMS = 80;
const MAX_TEXT = 600;

function clean(value, max = MAX_TEXT) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function userName(userId) {
  const user = userId && store.getUser(userId);
  return user && user.data && user.data.profile && user.data.profile.name || "Trip member";
}

function safeUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.toString().slice(0, 1200);
  } catch (_) {
    return null;
  }
}

function itineraryItems(trip) {
  return (trip.itinerary || []).slice(0, MAX_ITEMS).map((item) => ({
    id: item.id,
    date: item.date || null,
    time: item.time || "",
    title: clean(item.title, 220),
    category: item.category || "activity",
    note: clean(item.note, 600) || null,
  }));
}

function flightItems(trip) {
  return (trip.flights || []).slice(0, MAX_ITEMS).map((item) => ({
    id: item.id,
    airline: clean(item.airline, 120) || null,
    flightNo: clean(item.flightNo, 40) || null,
    from: clean(item.from, 20) || null,
    to: clean(item.to, 20) || null,
    departs: clean(item.departs, 120) || null,
    arrives: clean(item.arrives, 120) || null,
  }));
}

function lodgingItems(trip) {
  return (trip.lodging || []).slice(0, MAX_ITEMS).map((item) => ({
    id: item.id,
    name: clean(item.name, 220),
    address: clean(item.address, 300) || null,
    checkIn: clean(item.checkIn, 120) || null,
    checkOut: clean(item.checkOut, 120) || null,
    note: clean(item.note, 600) || null,
  }));
}

function sharedChecklists(trip) {
  return (trip.checklists || [])
    .filter((list) => list && list.kind === "shared")
    .slice(0, 20)
    .map((list) => ({
      title: clean(list.title, 160),
      items: (list.items || []).slice(0, 80).map((item) => ({
        text: clean(item.text, 220),
        done: item.done === true,
      })),
    }));
}

function recentConversation(tripId) {
  const scope = `trip:${tripId}`;
  const rows = chat.listMessages(scope, { limit: MAX_MESSAGES });
  const messages = [];
  let chars = 0;
  let truncated = rows.length >= MAX_MESSAGES;
  for (const row of rows) {
    if (!row || row.deleted || row.senderType === "agent") continue;
    const text = clean(row.text, MAX_MESSAGE_CHARS);
    if (!text) continue;
    if (chars + text.length > MAX_CHAT_CHARS) { truncated = true; break; }
    chars += text.length;
    messages.push({
      id: row.id,
      senderName: userName(row.postedByUserId || row.senderId),
      text,
      createdAt: row.createdAt,
      mentionsHermes: /(^|[^A-Za-z0-9_])@Hermes\b/i.test(text),
    });
  }
  return { messages, truncated };
}

function buildTripContext(tripId) {
  const trip = trips.getTrip(tripId);
  if (!trip) return null;
  const observedAt = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    observedAt,
    trust: {
      mode: "read-only",
      valuesAreUntrustedData: true,
      instructionsAuthoritative: false,
      grantsApproval: false,
      grantsExecution: false,
      writesAllowed: false,
    },
    trip: {
      id: trip.id,
      name: clean(trip.name, 180),
      destination: clean(trip.destination, 220) || null,
      startDate: trip.startDate || null,
      endDate: trip.endDate || null,
      members: (trip.members || []).slice(0, 20).map((member) => ({
        name: userName(member.userId),
        role: member.role === "owner" ? "owner" : "editor",
      })),
      itinerary: itineraryItems(trip),
      flights: flightItems(trip),
      lodging: lodgingItems(trip),
      sharedChecklists: sharedChecklists(trip),
    },
    chat: recentConversation(trip.id),
    provenance: {
      productId: "fametc",
      sourceType: "trip-room",
      sourceRef: `trip:${trip.id}`,
      observedAt,
    },
  };
}

module.exports = {
  SCHEMA_VERSION,
  MAX_MESSAGES,
  MAX_MESSAGE_CHARS,
  MAX_CHAT_CHARS,
  buildTripContext,
  safeUrl,
};

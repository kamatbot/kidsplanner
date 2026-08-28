"use strict";

/** Strict card contract for read-only travel research returned by Hermes. */
const CARD_TYPE = "hermes-travel-results";
const CARD_ID = "hermes-travel-results-v1";
const SCHEMA_VERSION = 1;
const KINDS = Object.freeze(["flight", "hotel", "activity", "mixed"]);
const RESULT_KINDS = new Set(["flight", "hotel", "activity"]);
const CATEGORIES = new Set(["food", "sight", "activity", "transit", "stay"]);
const MAX_RESULTS = 6;
const MAX_DETAILS = 6;

function text(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}
function httpsUrl(value) {
  const raw = text(value, 1600);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.toString().slice(0, 1600);
  } catch (_) { return null; }
}
function isoDate(value) {
  const raw = text(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}
function hhmm(value) {
  const raw = text(value, 8);
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : null;
}
function searchedAt(value) {
  const raw = text(value, 40);
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}
function itinerary(value, resultKind) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const title = text(value.title, 200);
  const note = text(value.note, 900);
  const defaultCategory = resultKind === "flight" ? "transit" : resultKind === "hotel" ? "stay" : "activity";
  const category = CATEGORIES.has(value.category) ? value.category : defaultCategory;
  if (!title) return null;
  return {
    title,
    category,
    note: note || null,
    date: isoDate(value.date),
    time: hhmm(value.time),
  };
}
function sanitizeResult(raw, topKind, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const kind = topKind === "mixed" ? text(raw.kind, 20) : topKind;
  if (!RESULT_KINDS.has(kind)) return null;
  const title = text(raw.title, 220);
  const url = httpsUrl(raw.url);
  const sourceName = text(raw.sourceName, 120);
  if (!title || !url || !sourceName) return null;
  const details = Array.isArray(raw.details)
    ? raw.details.map((item) => text(item, 180)).filter(Boolean).slice(0, MAX_DETAILS)
    : [];
  return {
    id: text(raw.id, 80) || `r${index + 1}`,
    kind,
    title,
    subtitle: text(raw.subtitle, 260) || null,
    price: text(raw.price, 100) || null,
    rating: text(raw.rating, 60) || null,
    details,
    url,
    sourceName,
    itinerary: itinerary(raw.itinerary, kind),
  };
}
function sanitizeTravelCard(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.type !== CARD_TYPE || raw.id !== CARD_ID || Number(raw.schemaVersion) !== SCHEMA_VERSION) return null;
  const kind = text(raw.kind, 20);
  if (!KINDS.includes(kind)) return null;
  const rows = Array.isArray(raw.results) ? raw.results.slice(0, MAX_RESULTS) : [];
  const results = rows.map((item, index) => sanitizeResult(item, kind, index)).filter(Boolean);
  if (!results.length) return null;
  return {
    type: CARD_TYPE,
    id: CARD_ID,
    title: text(raw.title, 120) || (kind === "flight" ? "Flight options" : kind === "hotel" ? "Hotel options" : kind === "activity" ? "Activity ideas" : "Trip options"),
    schemaVersion: SCHEMA_VERSION,
    kind,
    query: text(raw.query, 500) || null,
    searchedAt: searchedAt(raw.searchedAt),
    results,
    researchOnly: true,
  };
}

module.exports = { CARD_TYPE, CARD_ID, SCHEMA_VERSION, KINDS, MAX_RESULTS, sanitizeTravelCard, httpsUrl };

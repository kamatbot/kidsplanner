"use strict";
/**
 * Trips — plan a vacation with OTHER ADULTS outside the family: shared
 * itinerary with voting + comments, flights, lodging, an activity feed, and
 * invite links. See docs/TRIPS-PLAN.md (the contract this module implements).
 *
 * Unlike goals/homework/activities (root.X[familyId] = [...]), a trip is its
 * OWN scope object with its own member list — NOT per-family — because the
 * family model hard-caps two parents (lib/family.js MAX_PARENTS) while a trip
 * can include guests with no family at all. So trips are keyed by tripId at
 * the top level: root.trips[tripId] = trip.
 *
 * Trip shape (see docs/TRIPS-PLAN.md "Data model" for the authoritative copy):
 *   { id, name, destination, startDate, endDate, ownerUserId, familyId,
 *     members: [{ userId, role: "owner"|"editor", joinedAt }],
 *     inviteCode, itinerary: [...], flights: [...], lodging: [...],
 *     activity: [{ at, userId, text }], createdAt }
 *
 * Permissions are enforced by the CALLER (lib/routes/trips.js) using the
 * exported accessFor()/memberRole() helpers, mirroring lib/goals.js — EXCEPT
 * for a few domain rules (owner-only invite regenerate/disable, owner-or-
 * author comment delete, owner-or-self member removal) that live here, same
 * division of labor as lib/family.js (removeMember) and lib/chat.js
 * (deleteMessage: any parent may delete any message).
 *
 * Notifications: every mutation this module logs to trip.activity ("Latest
 * from the crew") is also a notification trigger per docs/TRIPS-PLAN.md
 * (member joined, itinerary add, flight/lodging add) — but the fan-out
 * (lib/fam-notifications.js notifyTripEvent) is called from the ROUTE layer
 * after a successful mutation, never from here (house rule: routes trigger
 * push, lib modules never do — see lib/routes/trips.js).
 */
const crypto = require("crypto");
const db = require("./db");
const family = require("./family");

// Same unambiguous alphabet as lib/family.js CODE_ALPHABET (no 0/O/1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const INVITE_CODE_LEN = 24; // link-grade (~118 bits), unlike family's 6-char code
const MAX_TRIP_MEMBERS = 12;

const CATEGORIES = new Set(["food", "sight", "activity", "transit", "stay"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// Categorical palette NAMES (not hex) — the client maps these to CSS vars, so
// dark/light theming stays in the stylesheet, not in stored data.
const PALETTE = ["accent", "teal", "blue", "amber", "green", "violet", "orange"];

function root() {
  const r = db.load();
  if (!r.trips) r.trips = {};
  return r;
}

function tripId() {
  return "trip_" + crypto.randomBytes(9).toString("hex");
}
function itiId() {
  return "ti_" + crypto.randomBytes(9).toString("hex");
}
function commentId() {
  return "tc_" + crypto.randomBytes(9).toString("hex");
}
function flightId() {
  return "tf_" + crypto.randomBytes(9).toString("hex");
}
function lodgingId() {
  return "tl_" + crypto.randomBytes(9).toString("hex");
}
function checklistId() {
  return "tk_" + crypto.randomBytes(9).toString("hex");
}
function checklistItemId() {
  return "tki_" + crypto.randomBytes(9).toString("hex");
}

function genInviteCode() {
  let out = "";
  for (let i = 0; i < INVITE_CODE_LEN; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out;
}
function uniqueInviteCode() {
  const r = root();
  let code;
  do {
    code = genInviteCode();
  } while (Object.values(r.trips).some((t) => t.inviteCode === code));
  return code;
}

// ---------- lookup ----------

function getTrip(id) {
  if (!id) return null;
  return root().trips[id] || null;
}

// All trips, for the route layer to scan + filter via accessFor() — trips
// have no per-user index (a guest may belong to trips with no shared family),
// so "list my trips" is necessarily a scan. Fine at this app's scale.
function allTrips() {
  return Object.values(root().trips);
}

// Case-insensitive; a disabled link (inviteCode === null) simply never
// matches, same as a code that never existed — callers get an identical
// "not found" result either way (no existence leak).
function findByInviteCode(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  return Object.values(root().trips).find((t) => t.inviteCode === c) || null;
}

// ---------- activity feed ----------

// "Latest from the crew" feed, capped at the most recent 50. Text is the bare
// action ("joined the trip", "added a flight: BA283") — the actor's name is
// resolved client-side from `userId` against the trip's member list, so this
// module never needs to look up a display name.
function logActivity(trip, userId, text) {
  if (!trip.activity) trip.activity = [];
  trip.activity.push({ at: new Date().toISOString(), userId, text: String(text || "").slice(0, 300) });
  if (trip.activity.length > 50) trip.activity = trip.activity.slice(-50);
}

// ---------- trip CRUD ----------

function validateDates(startDate, endDate) {
  const sd = String(startDate || "").trim();
  const ed = String(endDate || "").trim();
  if (!DATE_RE.test(sd) || !DATE_RE.test(ed)) return { error: "Start and end dates must be valid (YYYY-MM-DD)." };
  if (ed < sd) return { error: "End date can't be before the start date." };
  return { sd, ed };
}

function createTrip(ownerUserId, familyId, { name, destination, startDate, endDate } = {}) {
  const n = String(name || "").trim().slice(0, 80);
  if (!n) return { error: "Trip name is required." };
  const dates = validateDates(startDate, endDate);
  if (dates.error) return { error: dates.error };

  const trip = {
    id: tripId(),
    name: n,
    destination: String(destination || "").trim().slice(0, 120),
    startDate: dates.sd,
    endDate: dates.ed,
    ownerUserId,
    familyId: familyId || null,
    members: [{ userId: ownerUserId, role: "owner", joinedAt: new Date().toISOString() }],
    inviteCode: uniqueInviteCode(),
    itinerary: [],
    flights: [],
    lodging: [],
    checklists: [],
    activity: [],
    createdAt: new Date().toISOString(),
  };
  root().trips[trip.id] = trip;
  db.persist();
  return { trip };
}

// Rename / change dates — owner AND editor may do this (route enforces "any
// member, non-kid" via requireTrip; no extra role check needed here).
function updateTrip(tripId_, patch = {}) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  if (patch.name != null) {
    const n = String(patch.name).trim().slice(0, 80);
    if (!n) return { error: "Trip name cannot be empty." };
    trip.name = n;
  }
  if (patch.destination != null) trip.destination = String(patch.destination).trim().slice(0, 120);
  if (patch.startDate != null || patch.endDate != null) {
    const dates = validateDates(patch.startDate != null ? patch.startDate : trip.startDate, patch.endDate != null ? patch.endDate : trip.endDate);
    if (dates.error) return { error: dates.error };
    trip.startDate = dates.sd;
    trip.endDate = dates.ed;
  }
  db.persist();
  return { trip };
}

function deleteTrip(tripId_, requestingUserId) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  if (trip.ownerUserId !== requestingUserId) return { error: "Only the trip owner can delete the trip." };
  delete root().trips[tripId_];
  db.persist();
  return { ok: true };
}

// ---------- invite / membership ----------

function regenerateInvite(tripId_, requestingUserId) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  if (trip.ownerUserId !== requestingUserId) return { error: "Only the trip owner can regenerate the invite link." };
  trip.inviteCode = uniqueInviteCode();
  db.persist();
  return { inviteCode: trip.inviteCode };
}

function disableInvite(tripId_, requestingUserId) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  if (trip.ownerUserId !== requestingUserId) return { error: "Only the trip owner can disable the invite link." };
  trip.inviteCode = null;
  db.persist();
  return { ok: true };
}

const INVITE_INVALID = "That invite link isn't valid or has been turned off.";

function previewByCode(code) {
  const trip = findByInviteCode(code);
  if (!trip) return { error: INVITE_INVALID };
  return {
    trip: {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      memberCount: trip.members.length,
    },
  };
}

// Idempotent: an existing member re-visiting the link just gets the trip
// back, no duplicate membership, no error.
function joinByCode(code, userId) {
  const trip = findByInviteCode(code);
  if (!trip) return { error: INVITE_INVALID };
  if (trip.members.some((m) => m.userId === userId)) return { trip };
  if (trip.members.length >= MAX_TRIP_MEMBERS) return { error: "This trip already has the maximum number of members." };
  trip.members.push({ userId, role: "editor", joinedAt: new Date().toISOString() });
  logActivity(trip, userId, "joined the trip");
  db.persist();
  return { trip };
}

// Owner may remove any OTHER member; any member may remove themselves
// (self-leave). The owner can't remove themselves this way (delete the trip
// instead) — mirrors lib/family.js removeMember's "last parent" guard.
function removeMember(tripId_, requestingUserId, targetUserId) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  const isOwnerReq = trip.ownerUserId === requestingUserId;
  const isSelf = requestingUserId === targetUserId;
  if (!isOwnerReq && !isSelf) return { error: "Only the trip owner can remove another member." };
  if (targetUserId === trip.ownerUserId) return { error: "The owner can't be removed — delete the trip instead." };
  const before = trip.members.length;
  trip.members = trip.members.filter((m) => m.userId !== targetUserId);
  if (trip.members.length === before) return { error: "That person isn't a member of this trip." };
  db.persist();
  return { ok: true };
}

// ---------- itinerary ----------

function reindexDay(trip, date) {
  trip.itinerary
    .filter((i) => i.date === date)
    .sort((a, b) => a.order - b.order)
    .forEach((i, idx) => { i.order = idx; });
}

// `date` is optional — an "idea" (unscheduled) item has date: null. Missing
// or empty string both mean null; a present value must still be a real date.
function addItineraryItem(tripId_, userId, { date, time, title, category, note } = {}) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  const dRaw = String(date || "").trim();
  let d = null;
  if (dRaw) {
    if (!DATE_RE.test(dRaw)) return { error: "A valid date (YYYY-MM-DD) is required." };
    d = dRaw;
  }
  const t = String(title || "").trim().slice(0, 200);
  if (!t) return { error: "Title is required." };
  if (!CATEGORIES.has(category)) return { error: "Category must be one of food, sight, activity, transit, stay." };
  const tm = time ? String(time).trim() : "";
  if (tm && !TIME_RE.test(tm)) return { error: "Time must be in HH:MM format." };

  const dayItems = trip.itinerary.filter((i) => i.date === d);
  const order = dayItems.length ? Math.max(...dayItems.map((i) => i.order)) + 1 : 0;
  const item = {
    id: itiId(),
    date: d,
    time: tm,
    title: t,
    category,
    note: String(note || "").trim().slice(0, 1000),
    order,
    votes: [],
    comments: [],
    createdBy: userId,
    createdAt: new Date().toISOString(),
  };
  trip.itinerary.push(item);
  logActivity(trip, userId, `added an itinerary item: ${t}`);
  db.persist();
  return { item };
}

function getItineraryItem(trip, id) {
  return trip.itinerary.find((i) => i.id === id) || null;
}

function getComment(trip, itemId, cid) {
  const item = getItineraryItem(trip, itemId);
  if (!item) return null;
  return item.comments.find((c) => c.id === cid) || null;
}

function updateItineraryItem(tripId_, id, patch = {}) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  const item = getItineraryItem(trip, id);
  if (!item) return { error: "Itinerary item not found." };

  // Empty string clears the date back to the ideas bucket (date: null); a
  // present non-empty value must still be a real date.
  if (patch.date !== undefined) {
    const d = String(patch.date || "").trim();
    if (d && !DATE_RE.test(d)) return { error: "A valid date (YYYY-MM-DD) is required." };
    item.date = d || null;
  }
  if (patch.time !== undefined) {
    const tm = patch.time ? String(patch.time).trim() : "";
    if (tm && !TIME_RE.test(tm)) return { error: "Time must be in HH:MM format." };
    item.time = tm;
  }
  if (patch.title != null) {
    const t = String(patch.title).trim().slice(0, 200);
    if (!t) return { error: "Title cannot be empty." };
    item.title = t;
  }
  if (patch.category != null) {
    if (!CATEGORIES.has(patch.category)) return { error: "Category must be one of food, sight, activity, transit, stay." };
    item.category = patch.category;
  }
  if (patch.note != null) item.note = String(patch.note).trim().slice(0, 1000);
  db.persist();
  return { item };
}

// Drag-reorder: moves the item onto `date` (null = back to the ideas group),
// inserted immediately before `beforeId` (or appended when null/not found on
// that day/group). Reindexes order on the destination group, and on the
// source group too if it changed — the null-date group orders exactly like a
// day (reindexDay's `===` comparison works the same for null).
function moveItineraryItem(tripId_, id, { date, beforeId } = {}) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  const item = getItineraryItem(trip, id);
  if (!item) return { error: "Itinerary item not found." };
  const dRaw = String(date || "").trim();
  let d = null;
  if (dRaw) {
    if (!DATE_RE.test(dRaw)) return { error: "A valid date (YYYY-MM-DD) is required." };
    d = dRaw;
  }

  const oldDate = item.date;
  item.date = d;
  const dayItems = trip.itinerary.filter((i) => i.date === d && i.id !== id).sort((a, b) => a.order - b.order);
  let insertAt = dayItems.length;
  if (beforeId) {
    const idx = dayItems.findIndex((i) => i.id === beforeId);
    if (idx !== -1) insertAt = idx;
  }
  dayItems.splice(insertAt, 0, item);
  dayItems.forEach((i, idx) => { i.order = idx; });
  if (oldDate !== d) reindexDay(trip, oldDate);
  db.persist();
  return { trip };
}

function removeItineraryItem(tripId_, id) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  const item = getItineraryItem(trip, id);
  if (!item) return { error: "Itinerary item not found." };
  trip.itinerary = trip.itinerary.filter((i) => i.id !== id);
  reindexDay(trip, item.date);
  db.persist();
  return { ok: true };
}

// Toggle vote for the given user — idempotent add/remove.
function toggleVote(tripId_, id, userId) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  const item = getItineraryItem(trip, id);
  if (!item) return { error: "Itinerary item not found." };
  const idx = item.votes.indexOf(userId);
  if (idx >= 0) item.votes.splice(idx, 1);
  else item.votes.push(userId);
  db.persist();
  return { item };
}

function addComment(tripId_, id, userId, text) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  const item = getItineraryItem(trip, id);
  if (!item) return { error: "Itinerary item not found." };
  const t = String(text || "").trim().slice(0, 1000);
  if (!t) return { error: "Comment can't be empty." };
  const comment = {
    id: commentId(),
    userId,
    text: t,
    createdAt: new Date().toISOString(),
    flagged: false,
    flagReason: null,
    flaggedBy: null,
  };
  item.comments.push(comment);
  db.persist();
  return { comment };
}

// Owner or the comment's own author may delete it — Apple UGC (1.2).
function removeComment(tripId_, id, commentIdToRemove, requestingUserId) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  const item = getItineraryItem(trip, id);
  if (!item) return { error: "Itinerary item not found." };
  const comment = item.comments.find((c) => c.id === commentIdToRemove);
  if (!comment) return { error: "Comment not found." };
  if (trip.ownerUserId !== requestingUserId && comment.userId !== requestingUserId) {
    return { error: "Only the trip owner or the comment's author can delete it." };
  }
  item.comments = item.comments.filter((c) => c.id !== commentIdToRemove);
  db.persist();
  return { ok: true };
}

// Report/flag — any member's client can call this; surfaces the comment for
// the owner to review, doesn't remove it (see lib/chat.js flagMessage).
function flagComment(tripId_, id, commentIdToFlag, flaggedByUserId, reason) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  const item = getItineraryItem(trip, id);
  if (!item) return { error: "Itinerary item not found." };
  const comment = item.comments.find((c) => c.id === commentIdToFlag);
  if (!comment) return { error: "Comment not found." };
  comment.flagged = true;
  comment.flagReason = String(reason || "").trim().slice(0, 300) || null;
  comment.flaggedBy = flaggedByUserId || null;
  db.persist();
  return { ok: true };
}

// ---------- flights ----------

function addFlight(tripId_, userId, { airline, flightNo, confirmation, from, to, departs, arrives, travelerUserIds } = {}) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  const al = String(airline || "").trim().slice(0, 80);
  const fn = String(flightNo || "").trim().slice(0, 20);
  if (!al && !fn) return { error: "Add at least an airline or a flight number." };

  const flight = {
    id: flightId(),
    airline: al,
    flightNo: fn,
    confirmation: String(confirmation || "").trim().slice(0, 40),
    from: String(from || "").trim().slice(0, 8).toUpperCase(),
    to: String(to || "").trim().slice(0, 8).toUpperCase(),
    departs: String(departs || "").trim().slice(0, 60), // free text — v1 keeps the paste-from-email grain
    arrives: String(arrives || "").trim().slice(0, 60),
    travelerUserIds: Array.isArray(travelerUserIds) ? travelerUserIds.filter((x) => typeof x === "string").slice(0, MAX_TRIP_MEMBERS) : [],
    createdBy: userId,
    createdAt: new Date().toISOString(),
  };
  trip.flights.push(flight);
  logActivity(trip, userId, `added a flight${al || fn ? `: ${(al + " " + fn).trim()}` : ""}`);
  db.persist();
  return { flight };
}

function updateFlight(tripId_, id, patch = {}) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  const flight = trip.flights.find((f) => f.id === id);
  if (!flight) return { error: "Flight not found." };
  if (patch.airline != null) flight.airline = String(patch.airline).trim().slice(0, 80);
  if (patch.flightNo != null) flight.flightNo = String(patch.flightNo).trim().slice(0, 20);
  if (patch.confirmation != null) flight.confirmation = String(patch.confirmation).trim().slice(0, 40);
  if (patch.from != null) flight.from = String(patch.from).trim().slice(0, 8).toUpperCase();
  if (patch.to != null) flight.to = String(patch.to).trim().slice(0, 8).toUpperCase();
  if (patch.departs != null) flight.departs = String(patch.departs).trim().slice(0, 60);
  if (patch.arrives != null) flight.arrives = String(patch.arrives).trim().slice(0, 60);
  if (patch.travelerUserIds != null) {
    flight.travelerUserIds = Array.isArray(patch.travelerUserIds)
      ? patch.travelerUserIds.filter((x) => typeof x === "string").slice(0, MAX_TRIP_MEMBERS)
      : [];
  }
  if (!flight.airline && !flight.flightNo) return { error: "Add at least an airline or a flight number." };
  db.persist();
  return { flight };
}

function getFlight(trip, id) {
  return trip.flights.find((f) => f.id === id) || null;
}

function removeFlight(tripId_, id) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  const before = trip.flights.length;
  trip.flights = trip.flights.filter((f) => f.id !== id);
  if (trip.flights.length === before) return { error: "Flight not found." };
  db.persist();
  return { ok: true };
}

// ---------- lodging ----------

function addLodging(tripId_, userId, { name, address, confirmation, checkIn, checkOut, note } = {}) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  const n = String(name || "").trim().slice(0, 120);
  if (!n) return { error: "Lodging name is required." };

  const lodging = {
    id: lodgingId(),
    name: n,
    address: String(address || "").trim().slice(0, 200),
    confirmation: String(confirmation || "").trim().slice(0, 40),
    checkIn: String(checkIn || "").trim().slice(0, 60),
    checkOut: String(checkOut || "").trim().slice(0, 60),
    note: String(note || "").trim().slice(0, 1000),
    createdBy: userId,
    createdAt: new Date().toISOString(),
  };
  trip.lodging.push(lodging);
  logActivity(trip, userId, `added lodging: ${n}`);
  db.persist();
  return { lodging };
}

function updateLodging(tripId_, id, patch = {}) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  const lodging = trip.lodging.find((l) => l.id === id);
  if (!lodging) return { error: "Lodging not found." };
  if (patch.name != null) {
    const n = String(patch.name).trim().slice(0, 120);
    if (!n) return { error: "Lodging name cannot be empty." };
    lodging.name = n;
  }
  if (patch.address != null) lodging.address = String(patch.address).trim().slice(0, 200);
  if (patch.confirmation != null) lodging.confirmation = String(patch.confirmation).trim().slice(0, 40);
  if (patch.checkIn != null) lodging.checkIn = String(patch.checkIn).trim().slice(0, 60);
  if (patch.checkOut != null) lodging.checkOut = String(patch.checkOut).trim().slice(0, 60);
  if (patch.note != null) lodging.note = String(patch.note).trim().slice(0, 1000);
  db.persist();
  return { lodging };
}

function getLodging(trip, id) {
  return trip.lodging.find((l) => l.id === id) || null;
}

function removeLodging(tripId_, id) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  const before = trip.lodging.length;
  trip.lodging = trip.lodging.filter((l) => l.id !== id);
  if (trip.lodging.length === before) return { error: "Lodging not found." };
  db.persist();
  return { ok: true };
}

// ---------- checklists ----------
// Packing lists — a shared list (any member) or a personal list (one per
// user, get-or-create). `trip.checklists` post-dates v1 trips, so every
// accessor default-inits it before touching it (see logActivity's
// `trip.activity` precedent above). Permission enforcement (member-only
// shared mutation, owner-only personal mutation, delete rules) lives in the
// ROUTE layer (docs/TRIPS-PLAN.md "Routes") — these are plain data ops, same
// division of labor as addFlight/addLodging.

function getChecklist(trip, lid) {
  if (!trip.checklists) trip.checklists = [];
  return trip.checklists.find((c) => c.id === lid) || null;
}

function getChecklistItem(trip, lid, iid) {
  const list = getChecklist(trip, lid);
  if (!list) return null;
  return list.items.find((i) => i.id === iid) || null;
}

function addSharedChecklist(tripId_, userId, title) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  if (!trip.checklists) trip.checklists = [];
  const t = String(title || "").trim().slice(0, 80);
  if (!t) return { error: "Checklist title is required." };
  const list = {
    id: checklistId(),
    title: t,
    kind: "shared",
    ownerUserId: null,
    items: [],
    createdBy: userId,
    createdAt: new Date().toISOString(),
  };
  trip.checklists.push(list);
  logActivity(trip, userId, `started a packing list: ${t}`);
  db.persist();
  return { checklist: list };
}

// Get-or-create, one per user — idempotent by design (repeat calls just
// return the existing list). `title` is the ROUTE layer's already-resolved
// "<Name>'s packing" (or its "My packing" fallback).
function getOrCreatePersonalChecklist(tripId_, userId, title) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  if (!trip.checklists) trip.checklists = [];
  const existing = trip.checklists.find((c) => c.kind === "personal" && c.ownerUserId === userId);
  if (existing) return { checklist: existing };
  const list = {
    id: checklistId(),
    title: String(title || "My packing").trim().slice(0, 80) || "My packing",
    kind: "personal",
    ownerUserId: userId,
    items: [],
    createdBy: userId,
    createdAt: new Date().toISOString(),
  };
  trip.checklists.push(list);
  db.persist();
  return { checklist: list };
}

// PATCH title — both list kinds (shared: members; personal: owner — enforced
// by the route).
function updateChecklistTitle(tripId_, lid, title) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  if (!trip.checklists) trip.checklists = [];
  const list = trip.checklists.find((c) => c.id === lid);
  if (!list) return { error: "Checklist not found." };
  const t = String(title || "").trim().slice(0, 80);
  if (!t) return { error: "Checklist title cannot be empty." };
  list.title = t;
  db.persist();
  return { checklist: list };
}

function removeChecklist(tripId_, lid) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  if (!trip.checklists) trip.checklists = [];
  const before = trip.checklists.length;
  trip.checklists = trip.checklists.filter((c) => c.id !== lid);
  if (trip.checklists.length === before) return { error: "Checklist not found." };
  db.persist();
  return { ok: true };
}

function addChecklistItem(tripId_, lid, userId, { text, assigneeUserId } = {}) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  if (!trip.checklists) trip.checklists = [];
  const list = trip.checklists.find((c) => c.id === lid);
  if (!list) return { error: "Checklist not found." };
  const t = String(text || "").trim().slice(0, 200);
  if (!t) return { error: "Item text is required." };
  const item = {
    id: checklistItemId(),
    text: t,
    done: false,
    doneBy: null,
    assigneeUserId: assigneeUserId ? String(assigneeUserId) : null,
    createdBy: userId,
    createdAt: new Date().toISOString(),
  };
  list.items.push(item);
  db.persist();
  return { item };
}

// `togglerUserId` stamps `doneBy` when `done` flips to true (null when
// flipped back to false) — regardless of who created the item.
function updateChecklistItem(tripId_, lid, iid, togglerUserId, patch = {}) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  if (!trip.checklists) trip.checklists = [];
  const list = trip.checklists.find((c) => c.id === lid);
  if (!list) return { error: "Checklist not found." };
  const item = list.items.find((i) => i.id === iid);
  if (!item) return { error: "Item not found." };
  if (patch.text != null) {
    const t = String(patch.text).trim().slice(0, 200);
    if (!t) return { error: "Item text cannot be empty." };
    item.text = t;
  }
  if (patch.assigneeUserId !== undefined) {
    item.assigneeUserId = patch.assigneeUserId ? String(patch.assigneeUserId) : null;
  }
  if (patch.done !== undefined) {
    item.done = !!patch.done;
    item.doneBy = item.done ? togglerUserId : null;
  }
  db.persist();
  return { item };
}

function removeChecklistItem(tripId_, lid, iid) {
  const trip = getTrip(tripId_);
  if (!trip) return { error: "Trip not found." };
  if (!trip.checklists) trip.checklists = [];
  const list = trip.checklists.find((c) => c.id === lid);
  if (!list) return { error: "Checklist not found." };
  const before = list.items.length;
  list.items = list.items.filter((i) => i.id !== iid);
  if (list.items.length === before) return { error: "Item not found." };
  db.persist();
  return { ok: true };
}

// ---------- permissions ----------

// "member" (owner or editor) | "kid-read" (view-only via family link) | null.
// Kid rule (docs/TRIPS-PLAN.md): a kid may read a trip if their OWN family
// matches the trip's family, OR any trip member is a parent in the kid's
// family (e.g. the co-parent booked the trip before the kid's family record
// was set as the trip's familyId, or the trip's nominal familyId differs but
// a parent from the kid's family is on it regardless).
function accessFor(user, trip) {
  if (!trip || !user) return null;
  if (trip.members.some((m) => m.userId === user.id)) return "member";
  const kidLink = user.data && user.data.kid;
  if (kidLink && kidLink.familyId) {
    if (kidLink.familyId === trip.familyId) return "kid-read";
    const kidFam = family.getFamily(kidLink.familyId);
    if (kidFam && trip.members.some((m) => kidFam.parentIds.includes(m.userId))) return "kid-read";
  }
  return null;
}

function memberRole(trip, userId) {
  const m = trip.members.find((x) => x.userId === userId);
  return m ? m.role : null;
}

function isOwner(trip, userId) {
  return !!trip && trip.ownerUserId === userId;
}

// ---------- public (client-safe) serializers ----------

function initialFor(name) {
  const s = String(name || "").trim();
  return s ? s[0].toUpperCase() : "?";
}

// `resolveName` (optional) maps a member userId -> display name, same pattern
// as lib/family.js publicFamily. Never includes email (privacy: "never leak
// other members' emails"). `myRole` is NOT set here — the route layer adds it
// per-requester, since this object has no single "viewer".
function publicTrip(trip, resolveName) {
  if (!trip) return null;
  const named = typeof resolveName === "function" ? resolveName : () => null;
  return {
    id: trip.id,
    name: trip.name,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    ownerUserId: trip.ownerUserId,
    familyId: trip.familyId,
    inviteCode: trip.inviteCode,
    members: trip.members.map((m, idx) => {
      const name = named(m.userId) || "Trip guest";
      return {
        userId: m.userId,
        name,
        initial: initialFor(name),
        color: PALETTE[idx % PALETTE.length],
        role: m.role,
        joinedAt: m.joinedAt,
      };
    }),
    itinerary: trip.itinerary,
    flights: trip.flights,
    lodging: trip.lodging,
    checklists: trip.checklists || [],
    activity: trip.activity.slice(-50),
    createdAt: trip.createdAt,
  };
}

// Small avatar-stack view for the trips list (GET /api/trips), capped at 6
// faces — the list only needs enough to render a stack, not the full roster.
function memberFaces(trip, resolveName) {
  const named = typeof resolveName === "function" ? resolveName : () => null;
  return trip.members.slice(0, 6).map((m, idx) => {
    const name = named(m.userId) || "Trip guest";
    return { userId: m.userId, initial: initialFor(name), color: PALETTE[idx % PALETTE.length] };
  });
}

// GET /api/trips row shape: id,name,destination,dates,role,counts,memberFaces.
// `roleLabel` is supplied by the route ("owner"/"editor" for a member,
// "kid" for kid-read) since role resolution depends on the requester.
function tripSummary(trip, roleLabel, resolveName) {
  return {
    id: trip.id,
    name: trip.name,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    role: roleLabel,
    counts: {
      itinerary: trip.itinerary.length,
      flights: trip.flights.length,
      lodging: trip.lodging.length,
      members: trip.members.length,
    },
    memberFaces: memberFaces(trip, resolveName),
  };
}

module.exports = {
  // trip CRUD
  createTrip,
  getTrip,
  allTrips,
  updateTrip,
  deleteTrip,
  // invite / membership
  findByInviteCode,
  regenerateInvite,
  disableInvite,
  previewByCode,
  joinByCode,
  removeMember,
  // itinerary
  addItineraryItem,
  getItineraryItem,
  updateItineraryItem,
  moveItineraryItem,
  removeItineraryItem,
  toggleVote,
  addComment,
  getComment,
  removeComment,
  flagComment,
  // flights
  addFlight,
  getFlight,
  updateFlight,
  removeFlight,
  // lodging
  addLodging,
  getLodging,
  updateLodging,
  removeLodging,
  // checklists
  getChecklist,
  getChecklistItem,
  addSharedChecklist,
  getOrCreatePersonalChecklist,
  updateChecklistTitle,
  removeChecklist,
  addChecklistItem,
  updateChecklistItem,
  removeChecklistItem,
  // activity feed
  logActivity,
  // permissions
  accessFor,
  memberRole,
  isOwner,
  // serializers
  publicTrip,
  tripSummary,
  // constants (tests + route layer)
  CATEGORIES,
  MAX_TRIP_MEMBERS,
  PALETTE,
};

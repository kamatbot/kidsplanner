"use strict";

const tripItineraryImport = require("../trip-itinerary-import");
const notificationOutbox = require("../notification-outbox");

// Long-poll tuning for trip chat — same numbers as lib/routes/chat.js's
// family chat (shared hosting has the same connection/worker headroom either
// way; a per-trip cap, not a global one, so one busy trip can't starve others).
const LONG_POLL_MS = 25000;
const MAX_WAITERS_PER_TRIP = 10;

module.exports = (app, deps) => {
  const { trips, store, family, chat, notifications, requireAuth, authLimiter, buzzLimiter: configuredBuzzLimiter, userRole } = deps;
  const buzzLimiter = configuredBuzzLimiter || ((req, res, next) => next());

  // Resolve a member userId -> display name for trips.publicTrip/tripSummary.
  // Profile name ONLY — never fall back to email (trip members include
  // outside adults; emails must not leak to co-travelers).
  function resolveName(userId) {
    const u = store.getUser(userId);
    if (!u) return null;
    return (u.data && u.data.profile && u.data.profile.name) || null;
  }

  function deliverTripNotification(kind, payload) {
    const live = trips.getTrip(payload.tripId);
    if (!live) return;
    // Only original recipients who STILL belong to the trip may receive retries.
    const trip = { ...live, members: live.members.filter((m) => payload.recipientIds.includes(m.userId)) };
    if (payload.messageId) {
      const message = chat.getMessage("trip:" + live.id, payload.messageId);
      if (!message || message.deleted) return;
    }
    const method = kind === "trip_chat_buzz" ? "notifyTripChatBuzz"
      : kind === "trip_chat_message" ? "notifyTripChatMessage" : "notifyTripEvent";
    return notifications[method](trip, payload.senderUserId, payload.senderName, payload.text, payload.messageId);
  }
  notificationOutbox.configure({
    trip_chat_message: (payload) => deliverTripNotification("trip_chat_message", payload),
    trip_chat_buzz: (payload) => deliverTripNotification("trip_chat_buzz", payload),
    trip_event: (payload) => deliverTripNotification("trip_event", payload),
  });
  function queueTripNotification(kind, trip, senderUserId, text, messageId) {
    const payload = {
      tripId: trip.id, recipientIds: trip.members.map((m) => m.userId),
      senderUserId, senderName: resolveName(senderUserId) || "Trip guest",
      text: String(text || "").slice(0, 160), messageId,
    };
    try { notificationOutbox.enqueue(kind, payload, { dedupeKey: messageId }); }
    catch (error) { console.error("[trips] push enqueue failed:", error.code || "storage_error"); }
  }

  // Kids get read-only access via accessFor()'s "kid-read" branch; they
  // should never reach a mutating action that ISN'T tripId-scoped either
  // (create a trip, join a trip). requireTrip handles the tripId-scoped half.
  function blockKid(req, res, next) {
    if (userRole(req.user) === "kid") return res.status(403).json({ error: "Kids can't do this — ask a parent." });
    next();
  }

  // Resolves :tripId, 404 unknown, 403 non-member; "kid-read" access passes
  // GET only. Never consults req.family — a trip is its own scope object
  // (docs/TRIPS-PLAN.md "Why the architecture falls out this way").
  function requireTrip(req, res, next) {
    const trip = trips.getTrip(req.params.tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found." });
    const access = trips.accessFor(req.user, trip);
    if (!access) return res.status(403).json({ error: "You don't have access to this trip." });
    if (access === "kid-read" && req.method !== "GET") {
      return res.status(403).json({ error: "This trip is read-only for kid accounts." });
    }
    req.trip = trip;
    req.tripAccess = access;
    next();
  }

  // Same 404/403 resolution as requireTrip, but WITHOUT the "kid-read is
  // GET-only" method check — checklist routes need kid-read to pass on every
  // method (POST/PATCH/DELETE included) because a kid may fully manage items
  // on their OWN personal list (docs/TRIPS-PLAN.md "Packing lists" — the ONE
  // kid-write carve-out in trips). Per-handler checks below enforce the real
  // matrix; this middleware only resolves access, it never denies on method.
  function requireTripAnyAccess(req, res, next) {
    const trip = trips.getTrip(req.params.tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found." });
    const access = trips.accessFor(req.user, trip);
    if (!access) return res.status(403).json({ error: "You don't have access to this trip." });
    req.trip = trip;
    req.tripAccess = access;
    next();
  }

  // Serialize a trip for a given requester: adds myRole, and strips the
  // invite code from a kid-read view (kids can't invite — no reason to hand
  // them the link).
  function serialize(trip, user, access) {
    const out = trips.publicTrip(trip, resolveName);
    out.myRole = access === "member" ? trips.memberRole(trip, user.id) : "kid";
    if (access === "kid-read") delete out.inviteCode;
    return out;
  }

  // Trip chat is members-only (docs/TRIPS-PLAN.md permission matrix) — unlike
  // the rest of the trip's GET surface, requireTrip's "kid-read passes GET"
  // rule must NOT apply here, so this runs as an explicit second gate after it.
  function requireTripMember(req, res, next) {
    if (req.tripAccess !== "member") return res.status(403).json({ error: "Trip chat is for trip members only." });
    next();
  }

  // Human trip chat messages carry no roomId/senderName (lib/chat.js stays
  // scope-generic); the Hermes agent stores its fixed display name. Add the
  // room id and route-layer name here, with the same "Trip guest" fallback as
  // trips.publicTrip's member names.
  function decorateTripMessage(tripId_, msg) {
    return Object.assign({}, msg, {
      roomId: "trip:" + tripId_,
      senderName: msg.senderType === "agent" ? "Hermes" : (resolveName(msg.senderId) || "Trip guest"),
    });
  }

  // Every event that appears in "Latest from the crew" also lands in the
  // trip room. Using the shared chat engine wakes web/iOS long-polls just like
  // a human message, so an open trip chat updates immediately. A chat/storage
  // hiccup must never make the underlying trip mutation fail.
  function postTripUpdateChatSafe(trip, actorUserId, update) {
    try {
      chat.sendMessage("trip:" + trip.id, {
        senderType: "member",
        senderId: actorUserId,
        postedByUserId: actorUserId,
        text: update.detail,
        card: {
          type: update.type,
          id: update.id,
          title: update.title,
        },
      });
    } catch (e) { /* chat must never block the trip mutation */ }
  }

  // Trip events are both chat updates and pushes. Neither delivery channel
  // may block the response — same convention as the family chat routes.
  async function notifyTripEventSafe(trip, actorUserId, text, update) {
    postTripUpdateChatSafe(trip, actorUserId, update);
    queueTripNotification("trip_event", trip, actorUserId, text);
  }

  // ===================== trip CRUD =====================

  app.post("/api/trips", requireAuth, blockKid, (req, res) => {
    const body = req.body || {};
    const fams = family.familiesForUser(req.user.id);
    const familyId = fams.length ? fams[0].id : null; // null for a guest with no family yet
    const result = trips.createTrip(req.user.id, familyId, {
      name: body.name,
      destination: body.destination,
      startDate: body.startDate,
      endDate: body.endDate,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ trip: serialize(result.trip, req.user, "member") });
  });

  app.get("/api/trips", requireAuth, (req, res) => {
    res.set("Cache-Control", "no-store");
    const rows = [];
    for (const trip of trips.allTrips()) {
      const access = trips.accessFor(req.user, trip);
      if (!access) continue;
      const roleLabel = access === "member" ? trips.memberRole(trip, req.user.id) : "kid";
      rows.push(trips.tripSummary(trip, roleLabel, resolveName));
    }
    res.json({ trips: rows });
  });

  app.get("/api/trips/:tripId", requireAuth, requireTrip, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ trip: serialize(req.trip, req.user, req.tripAccess) });
  });

  app.patch("/api/trips/:tripId", requireAuth, requireTrip, (req, res) => {
    const body = req.body || {};
    const result = trips.updateTrip(req.trip.id, {
      name: body.name,
      destination: body.destination,
      startDate: body.startDate,
      endDate: body.endDate,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ trip: serialize(result.trip, req.user, req.tripAccess) });
  });

  app.delete("/api/trips/:tripId", requireAuth, requireTrip, (req, res) => {
    if (!trips.isOwner(req.trip, req.user.id)) return res.status(403).json({ error: "Only the trip owner can delete the trip." });
    const result = trips.deleteTrip(req.trip.id, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  // ===================== invite / membership =====================

  app.post("/api/trips/:tripId/invite/regenerate", requireAuth, requireTrip, (req, res) => {
    if (!trips.isOwner(req.trip, req.user.id)) return res.status(403).json({ error: "Only the trip owner can regenerate the invite link." });
    const result = trips.regenerateInvite(req.trip.id, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ inviteCode: result.inviteCode });
  });

  app.post("/api/trips/:tripId/invite/disable", requireAuth, requireTrip, (req, res) => {
    if (!trips.isOwner(req.trip, req.user.id)) return res.status(403).json({ error: "Only the trip owner can disable the invite link." });
    const result = trips.disableInvite(req.trip.id, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  // Not tripId-scoped (the requester isn't a member yet) — no requireTrip.
  // PUBLIC on purpose: anyone holding the link can join anyway, so gating the
  // preview behind auth only degraded the invite landing page, not security.
  // authLimiter slows code scanning; errors never reveal whether a code
  // exists; the preview payload carries no ids/emails (see previewByCode).
  app.get("/api/trips/join/:code", authLimiter, (req, res) => {
    res.set("Cache-Control", "no-store");
    const result = trips.previewByCode(req.params.code, resolveName);
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ trip: result.trip });
  });

  // authLimiter slows code-scanning attempts; errors never distinguish an
  // unknown code from a disabled one (see trips.js INVITE_INVALID).
  app.post("/api/trips/join/:code", requireAuth, authLimiter, blockKid, async (req, res) => {
    // joinByCode is idempotent (re-visiting the link as an existing member is
    // a no-op) — only notify the crew on an ACTUAL new join, not every revisit.
    const before = trips.findByInviteCode(req.params.code);
    const alreadyMember = !!(before && before.members.some((m) => m.userId === req.user.id));
    const result = trips.joinByCode(req.params.code, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    if (!alreadyMember) {
      await notifyTripEventSafe(result.trip, req.user.id, "joined the trip", {
        type: "trip-member",
        id: req.user.id,
        title: resolveName(req.user.id) || "Trip guest",
        detail: "Joined the trip",
      });
    }
    res.json({ trip: serialize(result.trip, req.user, "member") });
  });

  app.delete("/api/trips/:tripId/members/:userId", requireAuth, requireTrip, (req, res) => {
    if (trips.memberRole(req.trip, req.params.userId) === null) {
      return res.status(404).json({ error: "That person isn't a member of this trip." });
    }
    const isSelf = req.user.id === req.params.userId;
    if (!isSelf && !trips.isOwner(req.trip, req.user.id)) {
      return res.status(403).json({ error: "Only the trip owner can remove another member." });
    }
    const result = trips.removeMember(req.trip.id, req.user.id, req.params.userId);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  // ===================== itinerary =====================

  const HERMES_TRIP_ITINERARY_CARD = Object.freeze({
    type: "trip-itinerary-draft",
    id: "hermes-trip-itinerary",
    title: "Itinerary ready",
  });
  const HERMES_SOURCE_ID_RE = /^m_[A-Za-z0-9_-]+$/;

  function itineraryItemDTO(item) {
    return {
      key: item.key || trips.itineraryDuplicateKey(item),
      date: item.date,
      time: item.time || "",
      title: item.title,
      category: item.category,
      note: item.note || "",
    };
  }

  function itineraryImportDuplicates(trip, items) {
    const matches = typeof trips.findItineraryDuplicates === "function"
      ? trips.findItineraryDuplicates(trip.id, items)
      : [];
    return matches.map(({ item, existingItem }) => Object.assign({}, itineraryItemDTO(item), {
      existingItemId: existingItem.id,
      existingTitle: existingItem.title,
    }));
  }

  function importedItineraryItems(trip, messageId) {
    if (typeof trips.getItineraryItemsBySource === "function") {
      return trips.getItineraryItemsBySource(trip.id, "chat", messageId);
    }
    return (trip.itinerary || []).filter((item) => (
      item.source === "hermes" && item.sourceType === "chat" && item.sourceId === messageId
    ));
  }

  // Only the stored trip-room message is a source. In particular, the client
  // cannot replace the text, borrow a family message, or reuse an ordinary
  // Hermes response by supplying a message id alone.
  function hermesTripItinerarySource(req, messageId) {
    if (typeof messageId !== "string" || !HERMES_SOURCE_ID_RE.test(messageId)
        || !chat || typeof chat.getMessage !== "function") return null;
    const scope = "trip:" + req.trip.id;
    let message;
    try { message = chat.getMessage(scope, messageId); } catch (e) { return null; }
    if (!message || message.id !== messageId || message.familyId !== scope || message.deleted) return null;
    if (message.roomId !== undefined && message.roomId !== null && message.roomId !== scope) return null;
    if (message.scopeId !== undefined && message.scopeId !== null && message.scopeId !== scope) return null;
    if (message.senderType !== "agent" || message.senderId !== "hermes" || message.postedByUserId !== null) return null;
    if (message.media !== undefined && message.media !== null) return null;
    const card = message.card;
    if (!card || card.type !== HERMES_TRIP_ITINERARY_CARD.type
        || card.id !== HERMES_TRIP_ITINERARY_CARD.id
        || card.title !== HERMES_TRIP_ITINERARY_CARD.title) return null;
    if (typeof message.text !== "string" || !message.text.trim()) return null;
    return message;
  }

  function parseTripItineraryRequest(req, messageId) {
    const source = hermesTripItinerarySource(req, messageId);
    if (!source) return { error: { status: 404, body: { error: "That Hermes itinerary message is unavailable." } } };
    try {
      return { source, items: tripItineraryImport.parseTripItinerary(source.text, req.trip) };
    } catch (error) {
      return { error: { status: 422, body: { error: "That Hermes message does not contain a valid itinerary table." } } };
    }
  }

  function existingTripImportResponse(req, importedItems) {
    return {
      trip: serialize(req.trip, req.user, req.tripAccess),
      importedItems,
      skippedDuplicates: [],
      existing: true,
    };
  }

  app.post("/api/trips/:tripId/itinerary/import-chat/:messageId/preview", requireAuth, requireTrip, (req, res) => {
    const messageId = req.params && req.params.messageId;
    const imported = importedItineraryItems(req.trip, messageId);
    // Source idempotency is checked before reading/reparsing chat content so a
    // successful import remains reviewable even after chat retention scrubs it.
    if (imported.length) {
      return res.json({
        items: imported.map(itineraryItemDTO),
        duplicates: [],
        imported: true,
      });
    }
    const parsed = parseTripItineraryRequest(req, messageId);
    if (parsed.error) return res.status(parsed.error.status).json(parsed.error.body);
    const duplicates = itineraryImportDuplicates(req.trip, parsed.items);
    res.json({ items: parsed.items, duplicates, imported: false });
  });

  app.post("/api/trips/:tripId/itinerary/import-chat/:messageId", requireAuth, requireTrip, async (req, res) => {
    const messageId = req.params && req.params.messageId;
    const imported = importedItineraryItems(req.trip, messageId);
    if (imported.length) return res.json(existingTripImportResponse(req, imported));

    const parsed = parseTripItineraryRequest(req, messageId);
    if (parsed.error) return res.status(parsed.error.status).json(parsed.error.body);
    const duplicateMatches = typeof trips.findItineraryDuplicates === "function"
      ? trips.findItineraryDuplicates(req.trip.id, parsed.items)
      : [];
    const duplicates = duplicateMatches.map(({ item, existingItem }) => Object.assign({}, itineraryItemDTO(item), {
      existingItemId: existingItem.id,
      existingTitle: existingItem.title,
    }));
    const duplicateItems = new Set(duplicateMatches.map(({ item }) => item));
    const toImport = parsed.items.filter((item) => !duplicateItems.has(item));

    // An all-duplicate confirmation is a successful additive no-op. It must
    // not create a second activity/chat/push summary.
    if (!toImport.length) {
      return res.json({
        trip: serialize(req.trip, req.user, req.tripAccess),
        importedItems: [],
        skippedDuplicates: duplicates,
        existing: false,
      });
    }

    const result = typeof trips.addHermesItineraryItems === "function"
      ? trips.addHermesItineraryItems(req.trip.id, req.user.id, toImport, messageId)
      : { error: "Itinerary import is unavailable." };
    if (result.error) return res.status(422).json({ error: result.error });

    const count = result.items.length;
    await notifyTripEventSafe(req.trip, req.user.id, `imported ${count} itinerary item${count === 1 ? "" : "s"} from Hermes`, {
      type: "trip-itinerary",
      id: messageId,
      title: "Itinerary imported",
      detail: `Added ${count} itinerary item${count === 1 ? "" : "s"} from Hermes`,
    });
    res.json({
      trip: serialize(req.trip, req.user, req.tripAccess),
      importedItems: result.items,
      skippedDuplicates: duplicates,
      existing: false,
    });
  });

  app.post("/api/trips/:tripId/itinerary", requireAuth, requireTrip, async (req, res) => {
    const body = req.body || {};
    const result = trips.addItineraryItem(req.trip.id, req.user.id, {
      date: body.date,
      time: body.time,
      title: body.title,
      category: body.category,
      note: body.note,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    await notifyTripEventSafe(req.trip, req.user.id, `added an itinerary item: ${result.item.title}`, {
      type: "trip-itinerary",
      id: result.item.id,
      title: result.item.title,
      detail: result.item.date
        ? [result.item.date, result.item.time].filter(Boolean).join(" · ")
        : "New itinerary idea",
    });
    res.json({ item: result.item });
  });

  app.patch("/api/trips/:tripId/itinerary/:id", requireAuth, requireTrip, (req, res) => {
    if (!trips.getItineraryItem(req.trip, req.params.id)) return res.status(404).json({ error: "Itinerary item not found." });
    const body = req.body || {};
    const result = trips.updateItineraryItem(req.trip.id, req.params.id, {
      date: body.date,
      time: body.time,
      title: body.title,
      category: body.category,
      note: body.note,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ item: result.item });
  });

  app.post("/api/trips/:tripId/itinerary/:id/move", requireAuth, requireTrip, (req, res) => {
    if (!trips.getItineraryItem(req.trip, req.params.id)) return res.status(404).json({ error: "Itinerary item not found." });
    const body = req.body || {};
    // date: null moves the item to the Ideas bucket — not rejected.
    const result = trips.moveItineraryItem(req.trip.id, req.params.id, { date: body.date || null, beforeId: body.beforeId || null });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ trip: serialize(result.trip, req.user, req.tripAccess) });
  });

  app.delete("/api/trips/:tripId/itinerary/:id", requireAuth, requireTrip, (req, res) => {
    if (!trips.getItineraryItem(req.trip, req.params.id)) return res.status(404).json({ error: "Itinerary item not found." });
    const result = trips.removeItineraryItem(req.trip.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  app.post("/api/trips/:tripId/itinerary/:id/vote", requireAuth, requireTrip, (req, res) => {
    if (!trips.getItineraryItem(req.trip, req.params.id)) return res.status(404).json({ error: "Itinerary item not found." });
    const result = trips.toggleVote(req.trip.id, req.params.id, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ item: result.item });
  });

  app.post("/api/trips/:tripId/itinerary/:id/comments", requireAuth, requireTrip, (req, res) => {
    if (!trips.getItineraryItem(req.trip, req.params.id)) return res.status(404).json({ error: "Itinerary item not found." });
    const result = trips.addComment(req.trip.id, req.params.id, req.user.id, (req.body || {}).text);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ comment: result.comment });
  });

  app.delete("/api/trips/:tripId/itinerary/:id/comments/:cid", requireAuth, requireTrip, (req, res) => {
    const comment = trips.getComment(req.trip, req.params.id, req.params.cid);
    if (!comment) return res.status(404).json({ error: "Comment not found." });
    if (comment.userId !== req.user.id && !trips.isOwner(req.trip, req.user.id)) {
      return res.status(403).json({ error: "Only the trip owner or the comment's author can delete it." });
    }
    const result = trips.removeComment(req.trip.id, req.params.id, req.params.cid, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  app.post("/api/trips/:tripId/itinerary/:id/comments/:cid/flag", requireAuth, requireTrip, (req, res) => {
    if (!trips.getComment(req.trip, req.params.id, req.params.cid)) return res.status(404).json({ error: "Comment not found." });
    const result = trips.flagComment(req.trip.id, req.params.id, req.params.cid, req.user.id, (req.body || {}).reason);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  // ===================== flights =====================

  app.post("/api/trips/:tripId/flights", requireAuth, requireTrip, async (req, res) => {
    const body = req.body || {};
    const result = trips.addFlight(req.trip.id, req.user.id, {
      airline: body.airline,
      flightNo: body.flightNo,
      confirmation: body.confirmation,
      from: body.from,
      to: body.to,
      departs: body.departs,
      arrives: body.arrives,
      travelerUserIds: body.travelerUserIds,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    const flightTitle = [result.flight.airline, result.flight.flightNo].filter(Boolean).join(" ");
    const label = flightTitle ? `: ${flightTitle}` : "";
    const flightRoute = [result.flight.from, result.flight.to].some(Boolean)
      ? `${result.flight.from || "—"} → ${result.flight.to || "—"}`
      : "Flight added";
    await notifyTripEventSafe(req.trip, req.user.id, `added a flight${label}`, {
      type: "trip-flight",
      id: result.flight.id,
      title: flightTitle,
      detail: [flightRoute, result.flight.departs].filter(Boolean).join(" · "),
    });
    res.json({ flight: result.flight });
  });

  app.patch("/api/trips/:tripId/flights/:id", requireAuth, requireTrip, (req, res) => {
    if (!trips.getFlight(req.trip, req.params.id)) return res.status(404).json({ error: "Flight not found." });
    const body = req.body || {};
    const result = trips.updateFlight(req.trip.id, req.params.id, {
      airline: body.airline,
      flightNo: body.flightNo,
      confirmation: body.confirmation,
      from: body.from,
      to: body.to,
      departs: body.departs,
      arrives: body.arrives,
      travelerUserIds: body.travelerUserIds,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ flight: result.flight });
  });

  app.delete("/api/trips/:tripId/flights/:id", requireAuth, requireTrip, (req, res) => {
    if (!trips.getFlight(req.trip, req.params.id)) return res.status(404).json({ error: "Flight not found." });
    const result = trips.removeFlight(req.trip.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  // ===================== lodging =====================

  app.post("/api/trips/:tripId/lodging", requireAuth, requireTrip, async (req, res) => {
    const body = req.body || {};
    const result = trips.addLodging(req.trip.id, req.user.id, {
      name: body.name,
      address: body.address,
      confirmation: body.confirmation,
      checkIn: body.checkIn,
      checkOut: body.checkOut,
      note: body.note,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    const stayDates = [
      result.lodging.checkIn ? `Check-in ${result.lodging.checkIn}` : null,
      result.lodging.checkOut ? `Check-out ${result.lodging.checkOut}` : null,
    ].filter(Boolean).join(" · ");
    await notifyTripEventSafe(req.trip, req.user.id, `added lodging: ${result.lodging.name}`, {
      type: "trip-lodging",
      id: result.lodging.id,
      title: result.lodging.name,
      detail: stayDates || result.lodging.address || "Lodging added",
    });
    res.json({ lodging: result.lodging });
  });

  app.patch("/api/trips/:tripId/lodging/:id", requireAuth, requireTrip, (req, res) => {
    if (!trips.getLodging(req.trip, req.params.id)) return res.status(404).json({ error: "Lodging not found." });
    const body = req.body || {};
    const result = trips.updateLodging(req.trip.id, req.params.id, {
      name: body.name,
      address: body.address,
      confirmation: body.confirmation,
      checkIn: body.checkIn,
      checkOut: body.checkOut,
      note: body.note,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ lodging: result.lodging });
  });

  app.delete("/api/trips/:tripId/lodging/:id", requireAuth, requireTrip, (req, res) => {
    if (!trips.getLodging(req.trip, req.params.id)) return res.status(404).json({ error: "Lodging not found." });
    const result = trips.removeLodging(req.trip.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  // ===================== checklists (packing lists) =====================
  // requireTripAnyAccess (not requireTrip) — kid-read passes every method
  // here; per-handler checks below enforce the real permission matrix
  // (docs/TRIPS-PLAN.md "Packing lists / shared checklists"): shared-list
  // mutations require member access, personal-list item mutations require
  // being that list's owner (the one kid-write carve-out in trips). No push
  // notifications for any checklist action (noise) — see the plan doc.

  function checklistWriteAllowed(req, list) {
    return list.kind === "shared" ? req.tripAccess === "member" : list.ownerUserId === req.user.id;
  }

  app.post("/api/trips/:tripId/checklists", requireAuth, requireTripAnyAccess, (req, res) => {
    if (req.tripAccess !== "member") return res.status(403).json({ error: "Only trip members can start a shared packing list." });
    const result = trips.addSharedChecklist(req.trip.id, req.user.id, (req.body || {}).title);
    if (result.error) return res.status(400).json({ error: result.error });
    postTripUpdateChatSafe(req.trip, req.user.id, {
      type: "trip-packing",
      id: result.checklist.id,
      title: result.checklist.title,
      detail: "Started a shared packing list",
    });
    res.json({ checklist: result.checklist });
  });

  // Get-or-create — any access (a kid gets their own list too).
  app.post("/api/trips/:tripId/checklists/personal", requireAuth, requireTripAnyAccess, (req, res) => {
    const name = resolveName(req.user.id);
    const title = name ? `${name}'s packing` : "My packing";
    const result = trips.getOrCreatePersonalChecklist(req.trip.id, req.user.id, title);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ checklist: result.checklist });
  });

  app.patch("/api/trips/:tripId/checklists/:lid", requireAuth, requireTripAnyAccess, (req, res) => {
    const list = trips.getChecklist(req.trip, req.params.lid);
    if (!list) return res.status(404).json({ error: "Checklist not found." });
    if (!checklistWriteAllowed(req, list)) return res.status(403).json({ error: "You can't rename this packing list." });
    const result = trips.updateChecklistTitle(req.trip.id, req.params.lid, (req.body || {}).title);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ checklist: result.checklist });
  });

  // Delete: shared = trip owner or the list's creator; personal = its owner only.
  app.delete("/api/trips/:tripId/checklists/:lid", requireAuth, requireTripAnyAccess, (req, res) => {
    const list = trips.getChecklist(req.trip, req.params.lid);
    if (!list) return res.status(404).json({ error: "Checklist not found." });
    const allowed = list.kind === "shared"
      ? (trips.isOwner(req.trip, req.user.id) || list.createdBy === req.user.id)
      : list.ownerUserId === req.user.id;
    if (!allowed) return res.status(403).json({ error: "You can't delete this packing list." });
    const result = trips.removeChecklist(req.trip.id, req.params.lid);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  app.post("/api/trips/:tripId/checklists/:lid/items", requireAuth, requireTripAnyAccess, (req, res) => {
    const list = trips.getChecklist(req.trip, req.params.lid);
    if (!list) return res.status(404).json({ error: "Checklist not found." });
    if (!checklistWriteAllowed(req, list)) return res.status(403).json({ error: "You can't add items to this packing list." });
    const body = req.body || {};
    const result = trips.addChecklistItem(req.trip.id, req.params.lid, req.user.id, { text: body.text, assigneeUserId: body.assigneeUserId });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ item: result.item });
  });

  // done:true/false stamps doneBy with the toggler's userId (or null when un-done).
  app.patch("/api/trips/:tripId/checklists/:lid/items/:iid", requireAuth, requireTripAnyAccess, (req, res) => {
    const list = trips.getChecklist(req.trip, req.params.lid);
    if (!list) return res.status(404).json({ error: "Checklist not found." });
    if (!trips.getChecklistItem(req.trip, req.params.lid, req.params.iid)) return res.status(404).json({ error: "Item not found." });
    if (!checklistWriteAllowed(req, list)) return res.status(403).json({ error: "You can't update items on this packing list." });
    const body = req.body || {};
    const result = trips.updateChecklistItem(req.trip.id, req.params.lid, req.params.iid, req.user.id, {
      text: body.text, done: body.done, assigneeUserId: body.assigneeUserId,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ item: result.item });
  });

  app.delete("/api/trips/:tripId/checklists/:lid/items/:iid", requireAuth, requireTripAnyAccess, (req, res) => {
    const list = trips.getChecklist(req.trip, req.params.lid);
    if (!list) return res.status(404).json({ error: "Checklist not found." });
    if (!trips.getChecklistItem(req.trip, req.params.lid, req.params.iid)) return res.status(404).json({ error: "Item not found." });
    if (!checklistWriteAllowed(req, list)) return res.status(403).json({ error: "You can't remove items from this packing list." });
    const result = trips.removeChecklistItem(req.trip.id, req.params.lid, req.params.iid);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  function tripChatNotificationText(message) {
    if (message.text) return message.text;
    const media = message.media;
    if (!media) return "Sent a message";
    if (media.type === "gif") return "Sent a GIF";
    if (media.type === "attachment") {
      if (media.kind === "photo") return "Sent a photo";
      if (media.kind === "video") return "Sent a video";
      return media.filename ? `Sent ${media.filename}` : "Sent a file";
    }
    return "Sent a message";
  }

  // ===================== trip chat =====================
  // Same long-poll semantics as lib/routes/chat.js (afterId+wait=1 holds up
  // to LONG_POLL_MS, MAX_WAITERS_PER_TRIP degrades to an immediate empty
  // response, legacy since/limit is immediate). Scope key "trip:"+tripId
  // reuses the exact same chat engine/waiter registry as family chat.

  app.get("/api/trips/:tripId/chat/messages", requireAuth, requireTrip, requireTripMember, (req, res) => {
    res.set("Cache-Control", "no-store");
    const scope = "trip:" + req.trip.id;
    const decorate = (msgs) => msgs.map((m) => decorateTripMessage(req.trip.id, m));
    const { since, limit, afterId, wait } = req.query;
    if (!wait) {
      return res.json({ messages: decorate(chat.listMessages(scope, { since, limit })) });
    }
    const immediate = chat.listMessagesAfterId(scope, afterId);
    if (immediate.length) return res.json({ messages: decorate(immediate) });
    if (chat.waiterCount(scope) >= MAX_WAITERS_PER_TRIP) {
      return res.json({ messages: [] }); // over the per-trip cap: behave like a normal (empty) poll
    }
    let settled = false;
    const cleanup = () => { clearTimeout(timer); chat.offMessage(scope, onMessage); };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      res.json({ messages: [] });
    }, LONG_POLL_MS);
    function onMessage() {
      if (settled) return;
      settled = true;
      cleanup();
      const liveUser = store.getUser(req.user.id);
      const liveTrip = trips.getTrip(req.trip.id);
      if (!liveUser || !liveTrip || trips.accessFor(liveUser, liveTrip) !== "member"
          || (typeof deps.currentUser === "function" && !deps.currentUser(req))) {
        return res.status(403).json({ error: "Chat access changed. Please sign in again." });
      }
      res.json({ messages: decorate(chat.listMessagesAfterId(scope, afterId)) });
    }
    chat.onMessage(scope, onMessage);
    const onDisconnect = () => {
      if (settled) return;
      settled = true;
      cleanup();
    };
    // IncomingMessage.close fires when the GET request is consumed, not only
    // when its response socket closes. Observe ServerResponse for disconnects.
    if (typeof res.once === "function") res.once("close", onDisconnect);
    req.on("aborted", onDisconnect);
  });

  app.post("/api/trips/:tripId/chat/messages", requireAuth, requireTrip, requireTripMember, async (req, res) => {
    const { text, media } = req.body || {};
    const result = chat.sendMessage("trip:" + req.trip.id, {
      senderType: "member",
      senderId: req.user.id,
      postedByUserId: req.user.id,
      text,
      media,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    queueTripNotification("trip_chat_message", req.trip, req.user.id, tripChatNotificationText(result.message), result.message.id);
    res.json({ message: decorateTripMessage(req.trip.id, result.message) });
  });

  app.post("/api/trips/:tripId/chat/buzz", requireAuth, buzzLimiter, requireTrip, requireTripMember, async (req, res) => {
    const { text } = req.body || {};
    const result = chat.sendMessage("trip:" + req.trip.id, {
      senderType: "member",
      senderId: req.user.id,
      postedByUserId: req.user.id,
      text,
      buzz: true,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    queueTripNotification("trip_chat_buzz", req.trip, req.user.id, result.message.text, result.message.id);
    res.json({ message: decorateTripMessage(req.trip.id, result.message) });
  });

  // Owner or the message's own author (docs/TRIPS-PLAN.md permission matrix —
  // trip editors have no admin-delete-any power, unlike family chat parents).
  app.delete("/api/trips/:tripId/chat/messages/:id", requireAuth, requireTrip, requireTripMember, (req, res) => {
    const result = chat.deleteMessage("trip:" + req.trip.id, req.user.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ message: decorateTripMessage(req.trip.id, result.message) });
  });

  app.post("/api/trips/:tripId/chat/messages/:id/flag", requireAuth, requireTrip, requireTripMember, (req, res) => {
    const result = chat.flagMessage("trip:" + req.trip.id, req.user.id, req.params.id, (req.body || {}).reason);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ message: decorateTripMessage(req.trip.id, result.message) });
  });
};

"use strict";

module.exports = (app, deps) => {
  const { trips, store, family, requireAuth, authLimiter, userRole } = deps;

  // Resolve a member userId -> display name for trips.publicTrip/tripSummary.
  // Profile name ONLY — never fall back to email (trip members include
  // outside adults; emails must not leak to co-travelers).
  function resolveName(userId) {
    const u = store.getUser(userId);
    if (!u) return null;
    return (u.data && u.data.profile && u.data.profile.name) || null;
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

  // Serialize a trip for a given requester: adds myRole, and strips the
  // invite code from a kid-read view (kids can't invite — no reason to hand
  // them the link).
  function serialize(trip, user, access) {
    const out = trips.publicTrip(trip, resolveName);
    out.myRole = access === "member" ? trips.memberRole(trip, user.id) : "kid";
    if (access === "kid-read") delete out.inviteCode;
    return out;
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
  app.get("/api/trips/join/:code", requireAuth, (req, res) => {
    res.set("Cache-Control", "no-store");
    const result = trips.previewByCode(req.params.code);
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ trip: result.trip });
  });

  // authLimiter slows code-scanning attempts; errors never distinguish an
  // unknown code from a disabled one (see trips.js INVITE_INVALID).
  app.post("/api/trips/join/:code", requireAuth, authLimiter, blockKid, (req, res) => {
    const result = trips.joinByCode(req.params.code, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
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

  app.post("/api/trips/:tripId/itinerary", requireAuth, requireTrip, (req, res) => {
    const body = req.body || {};
    const result = trips.addItineraryItem(req.trip.id, req.user.id, {
      date: body.date,
      time: body.time,
      title: body.title,
      category: body.category,
      note: body.note,
    });
    if (result.error) return res.status(400).json({ error: result.error });
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
    const result = trips.moveItineraryItem(req.trip.id, req.params.id, { date: body.date, beforeId: body.beforeId || null });
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

  app.post("/api/trips/:tripId/flights", requireAuth, requireTrip, (req, res) => {
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

  app.post("/api/trips/:tripId/lodging", requireAuth, requireTrip, (req, res) => {
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
};

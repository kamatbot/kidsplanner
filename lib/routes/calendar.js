"use strict";

module.exports = (app, deps) => {
  const { schoolFeeds, homework, events, chat, requireAuth, requireParent, requireFamily, userRole, kidIdForUser, friendlyDate } = deps;

  // Feed subscriptions are family data (shared across parents), so reads open
  // to any signed-in family member (kids included — they should see their own
  // school calendar) but mutations (subscribe/unsubscribe/preview-fetch) are
  // parent-only, matching the family/kids routes above.
  app.get("/api/calendar/feeds", requireAuth, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(schoolFeeds.listFeedsForFamily(req.family.id));
  });

  app.post("/api/calendar/feeds/preview", requireAuth, requireParent, async (req, res) => {
    const url = (req.body || {}).url;
    if (!url || typeof url !== "string") return res.status(400).json({ error: "Provide a calendar URL to preview." });
    try {
      const preview = await schoolFeeds.previewFeed(url.trim());
      if (!preview.ok) return res.status(400).json({ error: preview.error });
      res.json(preview);
    } catch (e) {
      console.error("[calendar] preview error:", e.message);
      res.status(502).json({ error: "Could not check that calendar right now. Please try again." });
    }
  });

  app.post("/api/calendar/feeds/subscribe", requireAuth, requireParent, requireFamily, (req, res) => {
    const { kidId, feedId, customUrl, customName, filterKeyword } = req.body || {};
    const result = schoolFeeds.subscribe(req.family.id, { kidId, feedId, customUrl, customName, filterKeyword });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ subscription: result.subscription });
  });

  app.post("/api/calendar/feeds/unsubscribe", requireAuth, requireParent, requireFamily, (req, res) => {
    const { kidId, feedId, customUrl, subscriptionId } = req.body || {};
    const result = schoolFeeds.unsubscribe(req.family.id, { kidId, feedId, customUrl, subscriptionId });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  app.post("/api/calendar/school-events/hide", requireAuth, requireParent, requireFamily, (req, res) => {
    const { subscriptionId, uid } = req.body || {};
    const result = schoolFeeds.hideEvent(req.family.id, { subscriptionId, uid });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  // Reads are open to kids too (they should see their own synced school
  // events); the sync itself only fetches/writes family-level subscription
  // data that a parent already configured, so no requireParent here.
  app.post("/api/calendar/sync", requireAuth, requireFamily, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const force = !!(req.body && req.body.force) && userRole(req.user) !== "kid";
    try {
      const result = await schoolFeeds.syncFamily(req.family.id, { force });
      // NOTE: public school calendars are informational (term dates, university
      // deadlines, IA copies) — NOT assignable homework. We do NOT create
      // homework items from them. Real homework comes from the school's
      // authenticated homework portal (see the homework-import feature).
      // Purge any homework a previous build auto-ingested from these feeds.
      try { homework.removeBySource(req.family.id, "school"); } catch (e) { /* non-fatal */ }
      res.json(result);
    } catch (e) {
      console.error("[calendar] sync error:", e.message);
      res.status(502).json({ error: "Could not sync school calendars right now. Please try again." });
    }
  });

  // ----- Family calendar events (manual appointments, server-synced) -----
  // Post a family-chat note (with a tappable card) when an event is added.
  function postEventChat(req, ev) {
    try {
      const isKid = userRole(req.user) === "kid";
      const when = ev.time ? `${friendlyDate(ev.date)} at ${ev.time}` : friendlyDate(ev.date);
      chat.sendMessage(req.family.id, {
        senderType: isKid ? "kid" : "parent",
        senderId: isKid ? req.user.data.kid.kidId : req.user.id,
        postedByUserId: req.user.id,
        text: `📅 New event: ${ev.title} — ${when}`,
        card: { type: "event", id: ev.id, title: ev.title },
      });
    } catch (e) { /* never block on a chat error */ }
  }

  app.get("/api/calendar/events", requireAuth, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    const isParent = userRole(req.user) !== "kid";
    const list = events.listEvents(req.family.id, { from: req.query.from, to: req.query.to })
      .map((ev) => Object.assign({}, ev, { canEdit: events.canManage(ev, { userId: req.user.id, isParent }) }));
    res.json({ events: list });
  });
  // Resolve an event's audience (its kidId) from the request.
  //   • Parents may target the whole family (null) or any kid.
  //   • Kids may target the whole family (null) or THEMSELVES — never a
  //     sibling; a kid pointing at another kid is coerced to the family
  //     scope rather than rejected (they get the safest non-error outcome).
  // null / "" / "family" all mean the shared family calendar.
  function resolveEventKidId(req, rawKidId) {
    const kidId = rawKidId === "" || rawKidId === "family" ? null : (rawKidId ?? null);
    if (userRole(req.user) !== "kid") return kidId;               // parent: as requested
    const own = kidIdForUser(req);
    return kidId === own ? own : null;                            // kid: self or family only
  }

  app.post("/api/calendar/events", requireAuth, requireFamily, (req, res) => {
    const b = req.body || {};
    const kidId = resolveEventKidId(req, b.kidId);
    const result = events.addEvent(req.family.id, {
      title: b.title, date: b.date, time: b.time, endTime: b.endTime,
      notes: b.notes, category: b.category, kidId,
      endDate: b.endDate, repeat: b.repeat, repeatUntil: b.repeatUntil,
      createdBy: req.user.id,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    // silent: bulk imports / one-time localStorage migration from the web app —
    // announcing each of dozens of timetable rows would flood the family chat.
    if (!b.silent) postEventChat(req, result.event);
    res.json({ event: result.event });
  });
  app.patch("/api/calendar/events/:id", requireAuth, requireFamily, (req, res) => {
    const isParent = userRole(req.user) !== "kid";
    const ev = events.getById(req.family.id, req.params.id);
    if (!ev) return res.status(404).json({ error: "Event not found." });
    if (!events.canManage(ev, { userId: req.user.id, isParent })) {
      return res.status(403).json({ error: "You can only edit events you created." });
    }
    const b = req.body || {};
    const patch = {
      title: b.title, date: b.date, time: b.time, endTime: b.endTime,
      notes: b.notes, category: b.category,
      endDate: b.endDate, repeat: b.repeat, repeatUntil: b.repeatUntil,
    };
    // Retarget the audience ONLY when the client actually sends kidId —
    // otherwise leave the event's current scope untouched (updateEvent skips
    // undefined fields; passing a resolved null on every edit would silently
    // move an event to the family calendar). Same rule as POST: kids may
    // retarget only to family or self.
    if (b.kidId !== undefined) patch.kidId = resolveEventKidId(req, b.kidId);
    const result = events.updateEvent(req.family.id, req.params.id, patch);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ event: result.event });
  });
  app.delete("/api/calendar/events/:id", requireAuth, requireFamily, (req, res) => {
    const isParent = userRole(req.user) !== "kid";
    const ev = events.getById(req.family.id, req.params.id);
    if (!ev) return res.status(404).json({ error: "Event not found." });
    if (!events.canManage(ev, { userId: req.user.id, isParent })) {
      return res.status(403).json({ error: "You can only delete events you created." });
    }
    const result = events.removeEvent(req.family.id, req.params.id);
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ ok: true });
  });
};

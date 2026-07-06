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
    res.json({ events: events.listEvents(req.family.id, { from: req.query.from, to: req.query.to }) });
  });
  app.post("/api/calendar/events", requireAuth, requireFamily, (req, res) => {
    const b = req.body || {};
    const kidId = userRole(req.user) === "kid" ? kidIdForUser(req) : b.kidId;
    const result = events.addEvent(req.family.id, {
      title: b.title, date: b.date, time: b.time, endTime: b.endTime,
      notes: b.notes, category: b.category, kidId,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    postEventChat(req, result.event);
    res.json({ event: result.event });
  });
  app.delete("/api/calendar/events/:id", requireAuth, requireParent, requireFamily, (req, res) => {
    const result = events.removeEvent(req.family.id, req.params.id);
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ ok: true });
  });
};

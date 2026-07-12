"use strict";

// Long-poll tuning: cap how long a request holds open, and how many
// concurrent long-poll requests one family can have parked at once — shared
// hosting has limited connection/worker headroom, so beyond the cap a request
// just degrades to a normal (possibly-empty) immediate response.
const LONG_POLL_MS = 25000;
const MAX_WAITERS_PER_FAMILY = 10;

module.exports = (app, deps) => {
  const { chat, notifications, store, gifs, requireAuth, requireParent, requireFamily, userRole, gifLimiter } = deps;

  // ===================== CHAT =====================
  // Transport: poll-friendly REST. Plain `since`/`limit` (no `afterId`/`wait`)
  // is the original immediate-response shape — unchanged, for back-compat
  // with older clients (e.g. iOS build 20). Passing `afterId` + `wait=1` opts
  // into long-polling: respond immediately if newer messages exist, else hold
  // the connection open (up to LONG_POLL_MS) until one arrives or time's up.
  app.get("/api/chat/messages", requireAuth, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    const familyId = req.family.id;
    const { since, limit, afterId, wait } = req.query;
    if (!wait) {
      return res.json({ messages: chat.listMessages(familyId, { since, limit }) });
    }
    const immediate = chat.listMessagesAfterId(familyId, afterId);
    if (immediate.length) return res.json({ messages: immediate });
    if (chat.waiterCount(familyId) >= MAX_WAITERS_PER_FAMILY) {
      return res.json({ messages: [] }); // over the per-family cap: behave like a normal (empty) poll
    }
    let settled = false;
    const cleanup = () => { clearTimeout(timer); chat.offMessage(familyId, onMessage); };
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
      res.json({ messages: chat.listMessagesAfterId(familyId, afterId) });
    }
    chat.onMessage(familyId, onMessage);
    req.on("close", () => {
      if (settled) return;
      settled = true;
      cleanup();
    });
  });
  app.post("/api/chat/messages", requireAuth, requireFamily, async (req, res) => {
    const { text, card, media } = req.body || {};
    // senderType/senderId are derived from the authenticated session, never
    // trusted from the request body — a kid session always posts as its own
    // kid profile id, a parent session always posts as itself.
    const isKid = userRole(req.user) === "kid";
    const result = chat.sendMessage(req.family.id, {
      senderType: isKid ? "kid" : "parent",
      senderId: isKid ? req.user.data.kid.kidId : req.user.id,
      postedByUserId: req.user.id,
      text,
      card,
      media,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    try {
      await notifications.notifyChatMessage({
        familyParentIds: req.family.parentIds,
        familyKidUserIds: store.listKidUserIdsForFamily(req.family.id),
        senderUserId: req.user.id,
        senderName: req.user.data.profile.name || "Family chat",
        familyId: req.family.id,
        text: result.message.text,
      });
    } catch (e) { /* push must never block message send */ }
    res.json({ message: result.message });
  });
  // Any parent may delete any message (parent-admin control, UGC review 1.2).
  // Kids may never delete — requireParent enforces that at the route level.
  app.delete("/api/chat/messages/:id", requireAuth, requireParent, requireFamily, (req, res) => {
    const result = chat.deleteMessage(req.family.id, req.user.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ message: result.message });
  });
  app.post("/api/chat/messages/:id/flag", requireAuth, requireFamily, (req, res) => {
    const result = chat.flagMessage(req.family.id, req.user.id, req.params.id, (req.body || {}).reason);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ message: result.message });
  });

  // ----- GIFs (Giphy proxy) -----
  // The client never calls Giphy directly (connect-src stays 'self') — this
  // proxies trending/search so the API key never reaches the browser. Every
  // request is pinned server-side to rating=pg (see lib/gifs.js) — this is a
  // kids' app and that is non-negotiable. If GIPHY_API_KEY is unset the
  // feature is simply off ({ gifs: [] }), not an error.
  app.get("/api/gifs/trending", requireAuth, gifLimiter, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const result = await gifs.trending(req.query.limit);
      res.json(result);
    } catch (e) {
      console.error("[gifs] trending error:", e.message);
      res.status(502).json({ error: "GIFs unavailable" });
    }
  });
  app.get("/api/gifs/search", requireAuth, gifLimiter, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const result = await gifs.search(req.query.q, req.query.limit);
      res.json(result);
    } catch (e) {
      console.error("[gifs] search error:", e.message);
      res.status(502).json({ error: "GIFs unavailable" });
    }
  });
};

"use strict";

module.exports = (app, deps) => {
  const { notifications, upload, requireAuth, requireParent, rateLimit, envNum } = deps;

  // ===================== PUSH: device token registration =====================
  app.post("/api/push/register", requireAuth, (req, res) => {
    const token = (req.body || {}).token;
    if (!token) return res.status(400).json({ error: "Missing device token." });
    notifications.registerToken(req.user.id, token);
    res.json({ ok: true });
  });
  app.post("/api/push/unregister", requireAuth, (req, res) => {
    const token = (req.body || {}).token;
    if (token) notifications.removeToken(req.user.id, token);
    res.json({ ok: true });
  });

  // ===================== PUSH: web subscription registration =====================
  // Public key only — not secret, the browser needs it to call
  // pushManager.subscribe({ applicationServerKey: ... }). requireAuth just
  // keeps this off anonymous scraping; it's not sensitive.
  app.get("/api/push/vapid-public-key", requireAuth, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
  });
  app.post("/api/push/web/subscribe", requireAuth, (req, res) => {
    const subscription = (req.body || {}).subscription;
    if (!subscription || !subscription.endpoint) return res.status(400).json({ error: "Missing subscription." });
    notifications.addWebSubscription(req.user.id, subscription);
    res.json({ ok: true });
  });
  app.post("/api/push/web/unsubscribe", requireAuth, (req, res) => {
    const endpoint = (req.body || {}).endpoint;
    if (endpoint) notifications.removeWebSubscription(req.user.id, endpoint);
    res.json({ ok: true });
  });

  // ===================== PUSH: notify self =====================
  // "Notify myself" path for client-side change/threshold detection (school
  // stats: attendance change, low canteen balance) that can't wait for a
  // server-side cron — the browser tab that ran the detection asks the server
  // to push to ITS OWN user's stored web subscriptions. requireParent because
  // today only the parent-facing school stats widget calls this; requireAuth
  // alone would also be safe (sendWebToUser is always scoped to req.user.id —
  // there is no way to target another user's subscriptions via this route).
  const notifySelfLimiter = rateLimit({ windowMs: 60 * 1000, max: envNum("RL_NOTIFY_SELF_MAX", 30), message: "Too many notifications requested — please wait a moment." });
  app.post("/api/notify/self", requireAuth, requireParent, notifySelfLimiter, async (req, res) => {
    const { title, body, tag } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: "Missing title." });
    if (!notifications.webEnabled()) return res.json({ sent: 0 });
    try {
      const payload = {
        title: String(title).slice(0, 200),
        body: body ? String(body).slice(0, 500) : "",
        data: { url: "/", famType: "self_notify", tag: tag || undefined },
      };
      const result = await notifications.sendWebToUser(req.user.id, payload, { urgency: "normal" });
      res.json({ sent: result.sent || 0 });
    } catch (e) {
      // Never let a push-delivery hiccup surface as a hard error to the caller
      // — this is a best-effort notify path.
      res.json({ sent: 0 });
    }
  });

  // ===================== UPLOADS =====================
  // Timetable/homework photo uploads (JPG/PNG/PDF). Parsing itself happens
  // client-side via the existing Claude pipeline (see app.js) — this endpoint
  // exists for the iOS scanner path where a native upload is simplest.
  app.post("/api/uploads", requireAuth, upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    // Scaffold: echoes size/type only. Wire to storage + parse pipeline as the
    // homework-hub feature (FEATURE_PLAN.md Phase 3) is built out.
    res.json({ ok: true, filename: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype });
  });
};

"use strict";

module.exports = (app, deps) => {
  const { watchAuth, store, family, notifications, requireAuth, requireParent, requireFamily, authLimiter } = deps;

  function requireWatch(req, res, next) {
    if (!req.watchAuth) return res.status(403).json({ error: "A paired watch credential is required." });
    next();
  }

  function validToken(token) {
    return typeof token === "string" && /^[a-f0-9]{32,256}$/i.test(token);
  }

  app.post("/api/watch/pairing/start", authLimiter, requireAuth, requireParent, requireFamily, (req, res) => {
    const body = req.body || {};
    const target = String(body.target || "self");
    let targetUserId = req.user.id;
    let targetType = "parent";
    let targetKidId = null;
    let targetName = req.user.data && req.user.data.profile ? req.user.data.profile.name : "Parent";
    if (target === "kid") {
      const kid = (req.family.kids || []).find((candidate) => candidate.id === body.kidId);
      if (!kid) return res.status(400).json({ error: "Choose a kid in this family." });
      const kidUser = store.findOrCreateKidUser(req.family.id, kid.id, kid.name);
      targetUserId = kidUser.id;
      targetType = "kid";
      targetKidId = kid.id;
      targetName = kid.name;
    } else if (target !== "self") {
      return res.status(400).json({ error: "Invalid watch pairing target." });
    }
    const result = watchAuth.createPairing({
      familyId: req.family.id,
      targetUserId,
      targetType,
      targetKidId,
      targetName,
      createdBy: req.user.id,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.set("Cache-Control", "no-store");
    res.json(result);
  });

  app.post("/api/watch/pairing/claim", authLimiter, (req, res) => {
    const body = req.body || {};
    const result = watchAuth.claimPairing(body.code, body.deviceLabel);
    if (result.error) return res.status(400).json({ error: result.error });
    res.set("Cache-Control", "no-store");
    res.json({
      token: result.token,
      tokenKind: "bearer",
      device: result.device,
    });
  });

  app.get("/api/watch/devices", requireAuth, requireParent, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ devices: watchAuth.listDevices(req.family.id) });
  });

  app.post("/api/watch/devices/:id/revoke", requireAuth, requireParent, requireFamily, (req, res) => {
    const result = watchAuth.revokeDevice(req.family.id, req.params.id);
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ device: result.device });
  });

  app.post("/api/watch/push/register", requireAuth, requireWatch, (req, res) => {
    const token = req.body && req.body.token;
    if (!validToken(token)) return res.status(400).json({ error: "Missing or invalid watch push token." });
    notifications.registerToken(req.user.id, token, { kind: "watch", topic: "com.fametc.watch" });
    res.json({ ok: true });
  });

  app.post("/api/watch/push/unregister", requireAuth, requireWatch, (req, res) => {
    const token = req.body && req.body.token;
    if (token) notifications.removeToken(req.user.id, token, { kind: "watch" });
    res.json({ ok: true });
  });
};

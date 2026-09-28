"use strict";
/**
 * Screen Time endpoints (contract: docs/SCREEN-TIME-PLAN.md). Three callers:
 * parents (session, own family's kids only), the kid's session (enroll a
 * device), and the enrolled device itself via `Authorization: FamDevice
 * <secret>` — no cookie, so the monitor extension and background refresh keep
 * working after the session expires. Domain logic lives in lib/screen-time.js.
 */
module.exports = (app, deps) => {
  const { screenTime, requireAuth, requireParent, requireFamily, userRole, kidIdForUser } = deps;

  function send(res, result, pick) {
    res.set("Cache-Control", "no-store");
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    return res.json(pick ? pick(result) : result);
  }
  const state = (r) => r.state;

  function requireKid(req, res) {
    if (userRole(req.user) === "kid" && kidIdForUser(req)) return kidIdForUser(req);
    res.set("Cache-Control", "no-store");
    res.status(403).json({ error: "Only a kid's own device can do this." });
    return null;
  }

  function device(req, res) {
    const header = (req.get && req.get("authorization")) || "";
    const m = /^FamDevice\s+([A-Za-z0-9_-]{20,128})$/.exec(header);
    const ctx = m && screenTime.resolveDevice(m[1]);
    if (ctx) return ctx;
    res.set("Cache-Control", "no-store");
    res.status(401).json({ error: "This device is not enrolled in Screen Time." });
    return null;
  }

  // ---------- parent ----------
  const parent = [requireAuth, requireParent, requireFamily];

  app.get("/api/screen-time", ...parent, (req, res) => {
    send(res, screenTime.overview(req.family));
  });

  app.put("/api/screen-time/kids/:kidId/policy", ...parent, (req, res) => {
    const result = screenTime.savePolicy(req.family, req.params.kidId, req.body);
    if (!result.error) screenTime.pingKidDevices(req.family, req.params.kidId);
    send(res, result, state);
  });

  app.post("/api/screen-time/kids/:kidId/pause", ...parent, (req, res) => {
    const result = screenTime.pause(req.family, req.params.kidId, (req.body || {}).minutes);
    if (!result.error) screenTime.pingKidDevices(req.family, req.params.kidId);
    send(res, result, state);
  });

  app.post("/api/screen-time/kids/:kidId/alerts/ack", ...parent, (req, res) => {
    send(res, screenTime.ackAlerts(req.family, req.params.kidId), state);
  });

  // One alert (banner/sheet ✕); 404 when it isn't this kid's alert.
  app.post("/api/screen-time/kids/:kidId/alerts/:alertId/ack", ...parent, (req, res) => {
    send(res, screenTime.ackAlert(req.family, req.params.kidId, req.params.alertId), state);
  });

  app.delete("/api/screen-time/kids/:kidId/devices/:deviceId", ...parent, (req, res) => {
    send(res, screenTime.forgetDevice(req.family, req.params.kidId, req.params.deviceId), state);
  });

  // Moves an enrolled device to another kid of the same family; the device's
  // secret keeps working, so it just starts pulling that kid's policy.
  app.post("/api/screen-time/kids/:kidId/devices/:deviceId/move", ...parent, (req, res) => {
    const toKidId = (req.body || {}).toKidId;
    const result = screenTime.moveDevice(req.family, req.params.kidId, req.params.deviceId, toKidId);
    if (!result.error) screenTime.pingKidDevices(req.family, toKidId);
    send(res, result, state);
  });

  app.get("/api/screen-time/kids/:kidId/usage", ...parent, (req, res) => {
    send(res, screenTime.usageReport(req.family, req.params.kidId, req.query && req.query.days));
  });

  // Approve/decline "more time for fams"; the domain pings devices on approve.
  app.post("/api/screen-time/kids/:kidId/requests/:id/approve", ...parent, (req, res) => {
    send(res, screenTime.decideRequest(req.family, req.params.kidId, req.params.id, true, req.user.id), state);
  });

  app.post("/api/screen-time/kids/:kidId/requests/:id/decline", ...parent, (req, res) => {
    send(res, screenTime.decideRequest(req.family, req.params.kidId, req.params.id, false, req.user.id), state);
  });

  // ---------- kid session ----------
  app.get("/api/screen-time/mine", requireAuth, requireFamily, (req, res) => {
    const kidId = requireKid(req, res);
    if (kidId) send(res, screenTime.mine(req.family, kidId));
  });

  app.post("/api/screen-time/requests", requireAuth, requireFamily, (req, res) => {
    const kidId = requireKid(req, res);
    if (kidId) send(res, screenTime.requestMoreTime(req.family, kidId, req.body));
  });

  app.post("/api/screen-time/device/enroll", requireAuth, requireFamily, (req, res) => {
    const kidId = requireKid(req, res);
    if (kidId) send(res, screenTime.enroll(req.family, kidId, req.body));
  });

  // ---------- device secret ----------
  app.post("/api/screen-time/device/heartbeat", (req, res) => {
    const ctx = device(req, res);
    if (ctx) send(res, screenTime.heartbeat(ctx, req.body));
  });

  app.put("/api/screen-time/device/limits/:limitId/selection", (req, res) => {
    const ctx = device(req, res);
    if (ctx) send(res, screenTime.uploadSelection(ctx, req.params.limitId, req.body));
  });

  app.put("/api/screen-time/device/agreement", (req, res) => {
    const ctx = device(req, res);
    if (ctx) send(res, screenTime.saveAgreement(ctx, req.body));
  });
};

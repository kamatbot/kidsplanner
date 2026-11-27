"use strict";

// Kids add their own events and reminders from a spoken note (watch app,
// Siri on the watch, or the iPad). See lib/kid-plans.js.
const kidPlans = require("../kid-plans");

const HOUR_MS = 3600000;
const MAX_PER_HOUR = 30;

module.exports = (app, deps) => {
  const { requireAuth, requireFamily, userRole, kidIdForUser, notifications } = deps;
  const recent = new Map(); // kidUserId -> [timestamps]

  function limited(userId, now = Date.now()) {
    const list = (recent.get(userId) || []).filter((t) => now - t < HOUR_MS);
    if (list.length >= MAX_PER_HOUR) { recent.set(userId, list); return true; }
    list.push(now);
    recent.set(userId, list);
    return false;
  }

  function requireKid(req, res, next) {
    if (userRole(req.user) !== "kid" || !kidIdForUser(req)) {
      return res.status(403).json({ error: "Adding plans by voice is for kids' accounts. Parents can ask Hermes in chat." });
    }
    if (req.watchAuth && (req.watchAuth.targetType !== "kid" || req.watchAuth.targetKidId !== kidIdForUser(req))) {
      return res.status(403).json({ error: "This watch belongs to someone else." });
    }
    next();
  }

  // Every device signed in as this kid except the one that made the request
  // (a watch re-plans its own buzzes straight after the reply).
  function syncOtherDevices(req, created) {
    if (!notifications || !created.length) return;
    const userIds = [req.user.id];
    for (const it of created) {
      if (it.type === "reminder" && typeof notifications.notifyWatchAction === "function" && !req.watchAuth) {
        Promise.resolve(notifications.notifyWatchAction({ recipientUserIds: userIds, actorUserId: req.user.id, includeActor: true, familyId: req.family.id, action: it.action })).catch(() => {});
        return;
      }
    }
    if (!req.watchAuth && typeof notifications.syncWatchesSilently === "function") {
      Promise.resolve(notifications.syncWatchesSilently({ userIds, familyId: req.family.id, resource: "calendar" })).catch(() => {});
    }
  }

  app.post("/api/kid-plans", requireAuth, requireFamily, requireKid, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (limited(req.user.id)) return res.status(429).json({ error: "That's a lot of plans! Try again in a little while." });
    const body = req.body || {};
    const out = await kidPlans.addFromText({
      fam: req.family,
      kidId: kidIdForUser(req),
      userId: req.user.id,
      text: body.text,
      requestId: body.requestId,
      source: req.watchAuth ? (body.via === "siri" ? "siri" : "watch") : "ipad",
    });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    if (!out.existing) syncOtherDevices(req, out.created || []);
    res.json(out.result);
  });

  app.post("/api/kid-plans/:requestId/undo", requireAuth, requireFamily, requireKid, (req, res) => {
    res.set("Cache-Control", "no-store");
    const out = kidPlans.undo({ fam: req.family, kidId: kidIdForUser(req), requestId: req.params.requestId });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    if (!req.watchAuth && notifications && typeof notifications.syncWatchesSilently === "function") {
      Promise.resolve(notifications.syncWatchesSilently({ userIds: [req.user.id], familyId: req.family.id, resource: "actions" })).catch(() => {});
    }
    res.json(out.result);
  });

};

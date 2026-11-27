"use strict";

// Kids and parents add events and reminders from a spoken note (watch app,
// Siri on the watch, or the iPad). See lib/kid-plans.js. The path keeps its
// original name so 1.4-era kid watches keep working.
const kidPlans = require("../kid-plans");

const HOUR_MS = 3600000;
const MAX_PER_HOUR = 30;

module.exports = (app, deps) => {
  const { requireAuth, requireFamily, userRole, kidIdForUser, notifications, store } = deps;
  const recent = new Map(); // userId -> [timestamps]

  function limited(userId, now = Date.now()) {
    const list = (recent.get(userId) || []).filter((t) => now - t < HOUR_MS);
    if (list.length >= MAX_PER_HOUR) { recent.set(userId, list); return true; }
    list.push(now);
    recent.set(userId, list);
    return false;
  }

  // Who is speaking: { kidId } for a kid, { parentUserId } for a parent.
  function speaker(req) {
    if (userRole(req.user) === "kid") {
      const kidId = kidIdForUser(req);
      return kidId ? { kidId } : null;
    }
    return (req.family.parentIds || []).includes(req.user.id) ? { parentUserId: req.user.id } : null;
  }

  function requireMember(req, res, next) {
    const who = speaker(req);
    if (!who) return res.status(403).json({ error: "This account isn't linked to a kid or parent in this family." });
    const w = req.watchAuth;
    if (w) {
      const same = who.kidId
        ? w.targetType === "kid" && w.targetKidId === who.kidId
        : w.targetType === "parent" && (!w.targetUserId || w.targetUserId === req.user.id);
      if (!same) return res.status(403).json({ error: "This watch belongs to someone else." });
    }
    req.planSpeaker = who;
    next();
  }

  function kidUserIds(fam, kidId) {
    if (!kidId || !store || typeof store.listKidUserIdsForFamily !== "function") return [];
    return store.listKidUserIdsForFamily(fam.id).filter((id) => {
      const user = store.getUser(id);
      return user && user.data && user.data.kid && user.data.kid.kidId === kidId;
    });
  }

  // The speaker's other devices (a watch re-plans its own buzzes straight
  // after the reply), plus the watch of any kid a parent added something for.
  function syncDevices(req, created) {
    if (!notifications || !created.length) return;
    const fam = req.family;
    const self = req.watchAuth ? [] : [req.user.id];
    const selfSynced = new Set();
    for (const it of created) {
      const others = req.planSpeaker.parentUserId && it.kidId ? kidUserIds(fam, it.kidId) : [];
      if (it.type === "reminder" && it.action && typeof notifications.notifyWatchAction === "function") {
        const recipients = [...new Set([...self, ...others])];
        if (recipients.length) {
          Promise.resolve(notifications.notifyWatchAction({ recipientUserIds: recipients, actorUserId: req.user.id, includeActor: true, familyId: fam.id, action: it.action })).catch(() => {});
          self.forEach((id) => selfSynced.add(id));
        }
      } else if (it.type === "event" && others.length && it.event && typeof notifications.notifyWatchEvent === "function") {
        Promise.resolve(notifications.notifyWatchEvent({ recipientUserIds: others, actorUserId: req.user.id, familyId: fam.id, event: it.event })).catch(() => {});
      }
    }
    const pending = self.filter((id) => !selfSynced.has(id));
    if (pending.length && typeof notifications.syncWatchesSilently === "function") {
      Promise.resolve(notifications.syncWatchesSilently({ userIds: pending, familyId: fam.id, resource: "calendar" })).catch(() => {});
    }
  }

  app.post("/api/kid-plans", requireAuth, requireFamily, requireMember, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (limited(req.user.id)) return res.status(429).json({ error: "That's a lot of plans! Try again in a little while." });
    const body = req.body || {};
    const who = req.planSpeaker;
    const out = await kidPlans.addFromText({
      fam: req.family,
      kidId: who.kidId,
      parentUserId: who.parentUserId,
      parentName: who.parentUserId ? ((req.user.data && req.user.data.profile && req.user.data.profile.name) || null) : null,
      userId: req.user.id,
      text: body.text,
      requestId: body.requestId,
      source: req.watchAuth ? (body.via === "siri" ? "siri" : "watch") : "ipad",
    });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    if (!out.existing) syncDevices(req, out.created || []);
    res.json(out.result);
  });

  app.post("/api/kid-plans/:requestId/undo", requireAuth, requireFamily, requireMember, (req, res) => {
    res.set("Cache-Control", "no-store");
    const who = req.planSpeaker;
    const out = kidPlans.undo({ fam: req.family, kidId: who.kidId, parentUserId: who.parentUserId, requestId: req.params.requestId });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    if (!req.watchAuth && notifications && typeof notifications.syncWatchesSilently === "function") {
      Promise.resolve(notifications.syncWatchesSilently({ userIds: [req.user.id], familyId: req.family.id, resource: "actions" })).catch(() => {});
    }
    res.json(out.result);
  });

};

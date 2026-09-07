"use strict";

module.exports = (app, deps) => {
  const { watchAuth, store, family, notifications, schoolFeeds, schoolApi, events, requireAuth, requireParent, requireFamily, authLimiter } = deps;

  function requireWatch(req, res, next) {
    if (!req.watchAuth) return res.status(403).json({ error: "A paired watch credential is required." });
    next();
  }

  function validToken(token) {
    return typeof token === "string" && /^[a-f0-9]{32,256}$/i.test(token);
  }

  // A bounded, explicitly projected watch payload. No family invite codes,
  // feed capabilities, sibling-only events, or calendar mutation permission.
  app.get("/api/watch/context", requireAuth, requireWatch, requireFamily, (req, res) => {
    const device = req.watchAuth;
    if (device.familyId !== req.family.id || device.targetUserId !== req.user.id) {
      return res.status(403).json({ error: "This watch belongs to another family." });
    }
    const isKid = device.targetType === "kid";
    const kid = isKid && (req.family.kids || []).find(k => k.id === device.targetKidId);
    if ((isKid && !kid) || (!isKid && !(req.family.parentIds || []).includes(req.user.id))) {
      return res.status(401).json({ error: "Reconnect this watch to Fam ETC." });
    }
    const now = new Date();
    const from = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    const to = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const school = schoolFeeds ? schoolFeeds.collectFromCache(schoolFeeds.famStore(req.family.id), now) : [];
    const timetable = schoolApi ? schoolApi.listTimetableEvents(req.family.id) : [];
    const manual = events ? events.listEvents(req.family.id, { from, to }) : [];
    const calendar = [...school, ...timetable, ...manual]
      .filter(e => !isKid || e.kidId == null || e.kidId === kid.id)
      .filter(e => isKid || !(e.feedId === "sta-child-timetable" || (e.kidId && e.category === "school" && e.notes === "Timetable")))
      .map(e => ({
        id: String(e.uid || e.id || `${e.title}|${e.start || e.date}`) + (e.occurrenceDate ? `@${e.occurrenceDate}` : ""),
        title: String(e.title || "Event"),
        date: String(e.start || e.date || "").slice(0, 10),
        start: e.start || null,
        time: e.time || null,
        end: e.end || null,
        endTime: e.endTime || null,
        allDay: e.allDay === true || !(e.time || /T\d{2}:\d{2}/.test(e.start || "")),
        kidId: e.kidId || null,
        location: e.location || null,
        isTimetable: e.feedId === "sta-child-timetable" || (e.category === "school" && e.notes === "Timetable"),
      }))
      .filter(e => e.date >= from && e.date <= to)
      .sort((a, b) => `${a.date}T${a.time || a.start || ""}`.localeCompare(`${b.date}T${b.time || b.start || ""}`))
      .slice(0, 160);
    res.set("Cache-Control", "no-store");
    res.json({
      profile: { role: isKid ? "kid" : "parent", userId: req.user.id, familyId: req.family.id,
        kidId: kid ? kid.id : null, name: kid ? kid.name : (req.user.data?.profile?.name || "Parent"),
        color: kid ? kid.color : "#6f43d6", photo: kid ? (kid.photo || null) : null },
      events: calendar,
    });
  });

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

  app.post("/api/watch/disconnect", requireAuth, requireWatch, (req, res) => {
    watchAuth.revokeDevice(req.watchAuth.familyId, req.watchAuth.id);
    res.json({ ok: true });
  });

  app.post("/api/watch/push/register", requireAuth, requireWatch, (req, res) => {
    const token = req.body && req.body.token;
    if (!validToken(token)) return res.status(400).json({ error: "Missing or invalid watch push token." });
    const topic = req.body.topic || "com.fametc.watch";
    if (!["com.fametc.watch", "com.fametc.app.watch"].includes(topic)) {
      return res.status(400).json({ error: "Invalid watch application." });
    }
    notifications.registerToken(req.user.id, token, { kind: "watch", topic, watchDeviceId: req.watchAuth.id });
    res.json({ ok: true });
  });

  app.post("/api/watch/push/unregister", requireAuth, requireWatch, (req, res) => {
    const token = req.body && req.body.token;
    if (token) notifications.removeToken(req.user.id, token, { kind: "watch" });
    res.json({ ok: true });
  });
};

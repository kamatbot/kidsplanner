"use strict";

module.exports = (app, deps) => {
  const { activities, requireAuth, requireParent, requireFamily, userRole, kidIdForUser } = deps;

  // Extracurricular activity registry (canvas-1e). A kid session only ever
  // lists their OWN activities; a parent sees the whole family's and may
  // filter by ?kidId=. Create/update/delete is parent-only — activities are
  // managed by parents, kids just see their own (mirrors school calendars /
  // Manage Family scoping, not the kid-editable homework/goal-check pattern).
  app.get("/api/activities", requireAuth, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    const role = userRole(req.user);
    let kidId = req.query.kidId ? String(req.query.kidId) : null;
    if (role === "kid") kidId = kidIdForUser(req);
    const items = activities.listActivities(req.family.id, { kidId });
    res.json({ activities: items });
  });

  app.post("/api/activities", requireAuth, requireParent, requireFamily, (req, res) => {
    const body = req.body || {};
    const result = activities.addActivity(req.family.id, {
      kidId: body.kidId,
      name: body.name,
      category: body.category,
      schedule: body.schedule,
      location: body.location,
      coachLabel: body.coachLabel,
      coachName: body.coachName,
      gear: body.gear,
      note: body.note,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ activity: result.activity });
  });

  app.patch("/api/activities/:id", requireAuth, requireParent, requireFamily, (req, res) => {
    const existing = activities.getById(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Activity not found." });
    const body = req.body || {};
    const result = activities.updateActivity(req.family.id, req.params.id, {
      name: body.name,
      category: body.category,
      schedule: body.schedule,
      location: body.location,
      coachLabel: body.coachLabel,
      coachName: body.coachName,
      gear: body.gear,
      note: body.note,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ activity: result.activity });
  });

  app.delete("/api/activities/:id", requireAuth, requireParent, requireFamily, (req, res) => {
    const existing = activities.getById(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Activity not found." });
    const result = activities.removeActivity(req.family.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });
};

"use strict";

module.exports = (app, deps) => {
  const { goals, requireAuth, requireParent, requireFamily, userRole, kidIdForUser } = deps;

  // Family/kid-scoped habit + milestone tracker (canvas-1d). A kid session
  // only ever lists their OWN goals; a parent sees the whole family's and may
  // filter by ?kidId=. Creating/deleting a goal is parent-only; checking a
  // habit in or bumping a milestone is allowed for the goal's own kid OR any
  // parent — mirrors lib/routes/homework.js's split (kid can progress their
  // own item, only a parent edits the descriptive fields / removes it).
  app.get("/api/goals", requireAuth, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    const role = userRole(req.user);
    let kidId = req.query.kidId ? String(req.query.kidId) : null;
    if (role === "kid") kidId = kidIdForUser(req);
    const items = goals.listGoals(req.family.id, { kidId });
    res.json({ goals: items });
  });

  app.post("/api/goals", requireAuth, requireParent, requireFamily, (req, res) => {
    const body = req.body || {};
    const result = goals.addGoal(req.family.id, {
      kidId: body.kidId,
      title: body.title,
      type: body.type,
      target: body.target,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ goal: result.goal });
  });

  app.patch("/api/goals/:id/check", requireAuth, requireFamily, (req, res) => {
    const role = userRole(req.user);
    const existing = goals.getById(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Goal not found." });
    if (!goals.canAccess(req.user, role, req.family.id, existing)) {
      return res.status(403).json({ error: "You don't have access to this goal." });
    }
    const result = goals.toggleHabitCheck(req.family.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ goal: result.goal });
  });

  app.patch("/api/goals/:id/progress", requireAuth, requireFamily, (req, res) => {
    const role = userRole(req.user);
    const existing = goals.getById(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Goal not found." });
    if (!goals.canAccess(req.user, role, req.family.id, existing)) {
      return res.status(403).json({ error: "You don't have access to this goal." });
    }
    const body = req.body || {};
    const result = goals.incrementMilestone(req.family.id, req.params.id, body.amount);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ goal: result.goal });
  });

  app.delete("/api/goals/:id", requireAuth, requireParent, requireFamily, (req, res) => {
    const existing = goals.getById(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Goal not found." });
    if (existing.familyId !== req.family.id) return res.status(404).json({ error: "Goal not found." });
    const result = goals.removeGoal(req.family.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });
};

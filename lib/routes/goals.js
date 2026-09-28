"use strict";

module.exports = (app, deps) => {
  const { goals, requireAuth, requireFamily, userRole, kidIdForUser } = deps;

  // Family/kid-scoped habit + milestone tracker (canvas-1d). A kid session
  // only ever lists their OWN goals; a parent sees the whole family's and may
  // filter by ?kidId=. Creating is open to both: a kid creates a goal for
  // THEMSELVES only (kidId is derived server-side — body.kidId is ignored for
  // a kid session, so a kid can never create a goal for a sibling) and it's
  // tagged createdBy kid; a parent still picks any kid via body.kidId and
  // it's tagged createdBy parent (see lib/goals.js addGoal). Deleting stays
  // ownership-scoped: a parent may delete any goal in the family, a kid may
  // delete only a goal THEY created for themselves — a goal a parent set for
  // them is parent-removable only (see lib/goals.js canDelete). Checking a
  // habit in or bumping a milestone is allowed for the goal's own kid OR any
  // parent — mirrors lib/routes/homework.js's split (kid can progress their
  // own item, only an owner removes it).
  app.get("/api/goals", requireAuth, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    const role = userRole(req.user);
    let kidId = req.query.kidId ? String(req.query.kidId) : null;
    if (role === "kid") kidId = kidIdForUser(req);
    const items = goals.listGoals(req.family.id, { kidId });
    res.json({ goals: items });
  });

  app.post("/api/goals", requireAuth, requireFamily, (req, res) => {
    const body = req.body || {};
    const role = userRole(req.user);
    // A kid can never create a goal for a sibling — kidId is derived
    // server-side for a kid session, body.kidId is ignored entirely.
    const kidId = role === "kid" ? kidIdForUser(req) : body.kidId;
    const result = goals.addGoal(req.family.id, {
      kidId,
      title: body.title,
      type: body.type,
      target: body.target,
      createdBy: { role, userId: req.user.id },
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

  app.delete("/api/goals/:id", requireAuth, requireFamily, (req, res) => {
    const existing = goals.getById(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Goal not found." });
    if (existing.familyId !== req.family.id) return res.status(404).json({ error: "Goal not found." });
    const role = userRole(req.user);
    if (!goals.canDelete(req.user, role, req.family.id, existing)) {
      return res.status(403).json({ error: "Only a parent can remove a goal they set." });
    }
    const result = goals.removeGoal(req.family.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });
};

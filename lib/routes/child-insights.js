"use strict";
const store = require("../child-insights");

module.exports = (app, deps) => {
  const { requireAuth, requireParent, requireFamily, userRole, kidIdForUser } = deps;
  const noStore = (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); };
  const child = (req, res, next) => {
    if (!req.family.kids.some(kid => kid.id === req.params.kidId)) return res.status(404).json({ error: "Child not found." });
    next();
  };
  const ownChild = (req, res, next) => {
    if (userRole(req.user) !== "kid") return res.status(403).json({ error: "Child session required." });
    req.insightsKidId = kidIdForUser(req);
    if (!req.insightsKidId || !req.family.kids.some(kid => kid.id === req.insightsKidId)) return res.status(404).json({ error: "Child not found." });
    next();
  };
  const result = (res, value) => res.status(value.error ? 400 : 200).json(value);
  app.get("/api/children/:kidId/insights", noStore, requireAuth, requireParent, requireFamily, child, (req, res) => {
    if (Object.keys(req.query).some(key => key !== "date") || !store.validDate(req.query.date)) return res.status(400).json({ error: "Invalid date." });
    res.json(store.insights(req.family.id, req.params.kidId, req.query.date));
  });
  app.put("/api/children/:kidId/home-plan", noStore, requireAuth, requireParent, requireFamily, child, (req, res) => result(res, store.saveHomePlan(req.family.id, req.params.kidId, req.body)));
  app.put("/api/children/:kidId/school-stats", noStore, requireAuth, requireParent, requireFamily, child, (req, res) => result(res, store.saveSchoolStats(req.family.id, req.params.kidId, req.body)));
  app.get("/api/daily5/progress", noStore, requireAuth, requireFamily, ownChild, (req, res) => {
    if (Object.keys(req.query).some(key => key !== "date") || !store.recentDate(req.query.date)) return res.status(400).json({ error: "Invalid date." });
    res.json(store.progress(req.family.id, req.insightsKidId, req.query.date));
  });
  app.post("/api/daily5/progress", noStore, requireAuth, requireFamily, ownChild, (req, res) => result(res, store.reportProgress(req.family.id, req.insightsKidId, req.body)));
};

"use strict";

const identities = require("../identity-subjects");
const grants = require("../integration-grants");
const pathodds = require("../pathodds-client");

const ROUTES = new Set(["sat.home", "sat.quest", "sat.setup", "sat.diagnostic", "sat.progress", "sat.full-test"]);

function linkUrl(route = "sat.home") {
  const safe = ROUTES.has(route) ? route : "sat.home";
  return `${pathodds.baseUrl()}/api/auth/fametc/start?route=${encodeURIComponent(safe)}`;
}

function resolveSubject(req, deps, explicitKidId) {
  const { family, userRole, kidIdForUser } = deps;
  const role = userRole(req.user);
  if (role === "kid") {
    const ownKidId = kidIdForUser(req);
    if (!ownKidId || (explicitKidId && String(explicitKidId) !== String(ownKidId))) return { error: "Kids can only access their own PathOdds work.", status: 403 };
    return {
      role,
      subject: identities.ensureKidSubject(req.family.id, ownKidId, req.user.id),
      isChildView: false,
    };
  }
  if (explicitKidId) {
    const kidId = String(explicitKidId);
    if (!family.kidBelongsToFamily(req.family.id, kidId)) return { error: "That kid isn't in your family.", status: 404 };
    return {
      role,
      subject: identities.ensureKidSubject(req.family.id, kidId),
      isChildView: true,
    };
  }
  return {
    role,
    subject: identities.ensureParentSubject(req.user.id, req.family.id),
    isChildView: false,
  };
}

function mount(app, deps) {
  const { requireAuth, requireFamily } = deps;

  app.get("/api/pathodds/status", requireAuth, requireFamily, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const resolved = resolveSubject(req, deps, req.query.kidId);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    let pairwise;
    try {
      pairwise = identities.pairwiseSubject(resolved.subject.id, "pathodds");
    } catch (error) {
      return res.status(503).json({ error: "PathOdds identity integration is not configured." });
    }
    const grant = grants.getGrant(resolved.subject.id);
    res.json({
      enabled: process.env.PATHODDS_INTEGRATION_ENABLED === "true",
      grant: grant && grant.status === "active" ? { status: "active", scopes: grant.scopes } : { status: "not-linked" },
      pairwiseSubject: pairwise,
      linkUrl: linkUrl("sat.home"),
      childView: resolved.isChildView,
    });
  });

  app.get("/api/pathodds/today", requireAuth, requireFamily, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const resolved = resolveSubject(req, deps, req.query.kidId);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    let pairwise;
    try {
      pairwise = identities.pairwiseSubject(resolved.subject.id, "pathodds");
    } catch (error) {
      return res.status(503).json({ error: "PathOdds identity integration is not configured." });
    }
    try {
      const snapshot = await pathodds.getToday(pairwise);
      res.json({ linked: true, snapshot, childView: resolved.isChildView });
    } catch (error) {
      if (error && error.status === 404 && error.code === "not-linked") {
        return res.json({ linked: false, linkUrl: linkUrl("sat.home"), childView: resolved.isChildView });
      }
      res.status(error && error.status === 401 ? 502 : 503).json({
        error: "PathOdds status is temporarily unavailable.",
        stale: true,
      });
    }
  });

  app.post("/api/pathodds/launch", requireAuth, requireFamily, async (req, res) => {
    const body = req.body || {};
    const route = ROUTES.has(String(body.route || "")) ? String(body.route) : "sat.home";
    const resolved = resolveSubject(req, deps, body.kidId);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    if (resolved.isChildView) return res.status(403).json({ error: "Parents can view a child's PathOdds status, but only the child can enter their learning session." });
    let pairwise;
    try {
      pairwise = identities.pairwiseSubject(resolved.subject.id, "pathodds");
    } catch (error) {
      return res.status(503).json({ error: "PathOdds identity integration is not configured." });
    }
    try {
      const launch = await pathodds.createLaunch(pairwise, route, "https://www.fametc.com/?tab=today");
      res.json(launch);
    } catch (error) {
      if (error && error.status === 404 && error.code === "not-linked") {
        return res.status(409).json({ error: "Connect PathOdds first.", linkUrl: linkUrl(route), code: "not-linked" });
      }
      res.status(503).json({ error: "PathOdds could not create a launch link right now." });
    }
  });
}

module.exports = { mount, resolveSubject, linkUrl };

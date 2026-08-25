"use strict";

const identities = require("../identity-subjects");
const grants = require("../integration-grants");
const pathodds = require("../pathodds-client");

const ROUTES = new Set(["sat.home", "sat.quest", "sat.setup", "sat.diagnostic", "sat.progress", "sat.full-test"]);

function linkUrl(route = "sat.home") {
  const safe = ROUTES.has(route) ? route : "sat.home";
  return `${pathodds.baseUrl()}/api/auth/fametc/start?route=${encodeURIComponent(safe)}`;
}

function validTimeZone(value) {
  const timeZone = String(value || "").trim();
  if (!timeZone || timeZone.length > 100) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch (error) {
    return null;
  }
}

function resolveSubject(req, deps, explicitKidId) {
  const { family, userRole, kidIdForUser } = deps;
  const role = userRole(req.user);
  if (role === "kid") {
    const ownKidId = kidIdForUser(req);
    if (!ownKidId || (explicitKidId && String(explicitKidId) !== String(ownKidId))) return { error: "Kids can only access their own PathOdds work.", status: 403 };
    return {
      role,
      pathOddsRole: "student",
      subject: identities.ensureKidSubject(req.family.id, ownKidId, req.user.id),
      isChildView: false,
    };
  }
  if (explicitKidId) {
    const kidId = String(explicitKidId);
    if (!family.kidBelongsToFamily(req.family.id, kidId)) return { error: "That kid isn't in your family.", status: 404 };
    return {
      role,
      pathOddsRole: "student",
      subject: identities.ensureKidSubject(req.family.id, kidId),
      isChildView: true,
    };
  }
  return {
    role,
    pathOddsRole: "guardian",
    subject: identities.ensureParentSubject(req.user.id, req.family.id),
    isChildView: false,
  };
}

function pairwiseFor(resolved) {
  return identities.pairwiseSubject(resolved.subject.id, "pathodds");
}

function mount(app, deps) {
  const { requireAuth, requireFamily } = deps;

  app.get("/api/pathodds/status", requireAuth, requireFamily, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const resolved = resolveSubject(req, deps, req.query.kidId);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    let pairwise;
    try {
      pairwise = pairwiseFor(resolved);
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

  // Link over the already-authenticated FamETC session. Parents may
  // pre-provision a child's PathOdds identity, but that never grants them a
  // student launch session; launch below rejects childView.
  app.post("/api/pathodds/connect", requireAuth, requireFamily, async (req, res) => {
    const body = req.body || {};
    const resolved = resolveSubject(req, deps, body.kidId);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    let pairwise;
    try {
      pairwise = pairwiseFor(resolved);
    } catch (error) {
      return res.status(503).json({ error: "PathOdds identity integration is not configured." });
    }
    const timeZone = body.timeZone == null ? null : validTimeZone(body.timeZone);
    if (body.timeZone != null && !timeZone) return res.status(400).json({ error: "Invalid time zone." });
    try {
      const connected = await pathodds.connectSubject(pairwise, resolved.pathOddsRole, timeZone);
      const grantingSubject = resolved.isChildView
        ? identities.ensureParentSubject(req.user.id, req.family.id)
        : resolved.subject;
      grants.ensureGrant({
        subjectId: resolved.subject.id,
        familyId: req.family.id,
        grantedBySubjectId: grantingSubject.id,
        role: resolved.pathOddsRole,
        scopes: ["openid", "sat:work", "sat:quest-summary:read", "sat:launch"],
      });
      res.status(connected && connected.snapshot ? 200 : 201).json({
        linked: true,
        snapshot: connected && connected.snapshot,
        childView: resolved.isChildView,
      });
    } catch (error) {
      res.status(503).json({ error: "PathOdds could not be connected right now." });
    }
  });

  app.delete("/api/pathodds/connect", requireAuth, requireFamily, async (req, res) => {
    const body = req.body || {};
    const resolved = resolveSubject(req, deps, body.kidId);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    let pairwise;
    try {
      pairwise = pairwiseFor(resolved);
    } catch (error) {
      return res.status(503).json({ error: "PathOdds identity integration is not configured." });
    }
    try {
      await pathodds.revokeSubject(pairwise);
    } catch (error) {
      return res.status(503).json({ error: "PathOdds could not be disconnected right now." });
    }
    grants.revokeGrant(resolved.subject.id);
    res.status(204).end();
  });

  app.get("/api/pathodds/today", requireAuth, requireFamily, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const resolved = resolveSubject(req, deps, req.query.kidId);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    const grant = grants.getGrant(resolved.subject.id);
    if (grant && grant.status === "revoked") return res.json({ linked: false, linkUrl: linkUrl("sat.home"), childView: resolved.isChildView });
    let pairwise;
    try {
      pairwise = pairwiseFor(resolved);
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
    const grant = grants.getGrant(resolved.subject.id);
    if (grant && grant.status === "revoked") return res.status(409).json({ error: "Connect PathOdds first.", linkUrl: linkUrl(route), code: "not-linked" });
    let pairwise;
    try {
      pairwise = pairwiseFor(resolved);
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

module.exports = { mount, resolveSubject, linkUrl, validTimeZone };

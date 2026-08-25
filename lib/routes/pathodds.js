"use strict";

const identities = require("../identity-subjects");
const grants = require("../integration-grants");
const pathodds = require("../pathodds-client");
const projections = require("../pathodds-projections");
const webhookAuth = require("../pathodds-webhook");
const inbox = require("../pathodds-inbox");
const reminders = require("../pathodds-reminders");

const ROUTES = new Set(["sat.home", "sat.quest", "sat.setup", "sat.diagnostic", "sat.progress", "sat.full-test"]);
const WEBHOOK_PATH = "/api/integrations/pathodds/webhooks";

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

function activeSubject(subject) {
  if (!subject || subject.status !== "active") return { error: "This family identity is no longer active.", status: 410 };
  return { subject };
}

function resolveSubject(req, deps, explicitKidId) {
  const { family, userRole, kidIdForUser } = deps;
  const role = userRole(req.user);
  if (role === "kid") {
    const ownKidId = kidIdForUser(req);
    if (!ownKidId || (explicitKidId && String(explicitKidId) !== String(ownKidId))) return { error: "Kids can only access their own PathOdds work.", status: 403 };
    const checked = activeSubject(identities.ensureKidSubject(req.family.id, ownKidId, req.user.id));
    if (checked.error) return checked;
    return { role, pathOddsRole: "student", subject: checked.subject, isChildView: false };
  }
  if (explicitKidId) {
    const kidId = String(explicitKidId);
    if (!family.kidBelongsToFamily(req.family.id, kidId)) return { error: "That kid isn't in your family.", status: 404 };
    const checked = activeSubject(identities.ensureKidSubject(req.family.id, kidId));
    if (checked.error) return checked;
    return { role, pathOddsRole: "student", subject: checked.subject, isChildView: true };
  }
  const checked = activeSubject(identities.ensureParentSubject(req.user.id, req.family.id));
  if (checked.error) return checked;
  return { role, pathOddsRole: "guardian", subject: checked.subject, isChildView: false };
}

function pairwiseFor(resolved) {
  return identities.pairwiseSubject(resolved.subject.id, "pathodds");
}

function mount(app, deps) {
  const { requireAuth, requireFamily, userRole } = deps;

  // PathOdds owns the learner model and publishes signed summary events. This
  // endpoint is intentionally not browser-authenticated; the HMAC, timestamp,
  // event-id match and durable inbox are the authentication/replay boundary.
  app.post(WEBHOOK_PATH, (req, res) => {
    const event = req.body || {};
    const body = JSON.stringify(event);
    const requestId = String(req.header("x-pathodds-request-id") || "");
    const valid = requestId === String(event.id || "") && webhookAuth.verify({
      method: "POST",
      path: WEBHOOK_PATH,
      timestamp: String(req.header("x-pathodds-timestamp") || ""),
      requestId,
      body,
      signature: String(req.header("x-pathodds-signature") || ""),
    });
    if (!valid) return res.status(401).json({ error: "Invalid PathOdds webhook signature." });

    const result = inbox.apply(event);
    if (result.status === "invalid") return res.status(400).json({ error: result.error });
    if (result.status === "conflict") return res.status(409).json({ error: result.error });

    if (event.type === "integration.revoked") {
      const subject = identities.findByPairwiseSubject(event.subject);
      if (subject) grants.revokeGrant(subject.id);
      projections.remove(event.subject);
    }
    res.json({ ok: true, status: result.status, sourceVersion: result.sourceVersion });
  });

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
      if (connected && connected.snapshot) projections.apply(pairwise, connected.snapshot);
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
    projections.remove(pairwise);
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

    const cached = projections.get(pairwise);
    if (projections.isFresh(cached)) {
      return res.json({ linked: true, snapshot: cached.snapshot, childView: resolved.isChildView, cached: true });
    }

    try {
      const snapshot = await pathodds.getToday(pairwise);
      projections.apply(pairwise, snapshot);
      res.json({ linked: true, snapshot, childView: resolved.isChildView });
    } catch (error) {
      if (error && error.status === 404 && error.code === "not-linked") {
        projections.remove(pairwise);
        return res.json({ linked: false, linkUrl: linkUrl("sat.home"), childView: resolved.isChildView });
      }
      if (cached && cached.snapshot) {
        return res.json({ linked: true, snapshot: cached.snapshot, childView: resolved.isChildView, stale: true, cachedAt: cached.cachedAt });
      }
      res.status(error && error.status === 401 ? 502 : 503).json({
        error: "PathOdds status is temporarily unavailable.",
        stale: true,
      });
    }
  });

  // Parent-initiated behavioral nudge. The child must belong to this family,
  // have an active grant and have an unfinished ready/in-progress quest. A
  // durable per-subject/day record prevents reminder spam across web/iOS.
  app.post("/api/pathodds/remind", requireAuth, requireFamily, async (req, res) => {
    if (userRole(req.user) !== "parent") return res.status(403).json({ error: "Only a parent can send a PathOdds reminder." });
    const kidId = String((req.body || {}).kidId || "");
    if (!kidId) return res.status(400).json({ error: "Choose a kid to remind." });
    const resolved = resolveSubject(req, deps, kidId);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    if (!resolved.isChildView) return res.status(403).json({ error: "A reminder must target a child." });
    const grant = grants.getGrant(resolved.subject.id);
    if (!grant || grant.status !== "active") return res.status(409).json({ error: "Connect this child to PathOdds first.", code: "not-linked" });
    let pairwise;
    try { pairwise = pairwiseFor(resolved); } catch (error) { return res.status(503).json({ error: "PathOdds identity integration is not configured." }); }

    let snapshot = projections.get(pairwise)?.snapshot || null;
    try {
      snapshot = await pathodds.getToday(pairwise);
      projections.apply(pairwise, snapshot);
    } catch (error) {
      if (!snapshot) return res.status(503).json({ error: "PathOdds status is unavailable, so FamETC did not send a stale reminder." });
    }
    const result = await reminders.send({ pairwiseSubject: pairwise, subject: resolved.subject, snapshot });
    if (result.reason === "already-complete") return res.status(409).json({ error: "Today's PathOdds quest is already complete.", code: result.reason });
    if (result.reason === "not-ready") return res.status(409).json({ error: "This PathOdds learner has setup or diagnostic work to finish first.", code: result.reason });
    if (result.reason === "already-reminded") return res.json({ ok: true, sent: 0, reason: result.reason });
    if (result.reason === "no-kid-device" || result.reason === "no-push-subscription") return res.status(409).json({ error: "This child does not have an enabled FamETC push destination yet.", code: result.reason });
    res.json({ ok: true, sent: result.sent, pruned: result.pruned || 0 });
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

module.exports = { mount, resolveSubject, linkUrl, validTimeZone, WEBHOOK_PATH };

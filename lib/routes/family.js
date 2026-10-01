"use strict";

const identities = require("../identity-subjects");
const grants = require("../integration-grants");
const pathodds = require("../pathodds-client");
const inviteCode = require("../invite-code");

module.exports = (app, deps) => {
  const { store, family, kidAccess, schoolApi, analytics, requireAuth, requireParent, requireFamily, userRole, rateLimit, envNum } = deps;

  // Invite-code guesses (family create with plan "full", upgrade) are throttled
  // per IP like sign-in attempts; a missing rateLimit (handler-level tests)
  // simply skips the throttle.
  const inviteLimiter = typeof rateLimit === "function"
    ? rateLimit({
      windowMs: 15 * 60 * 1000,
      max: (envNum || ((n, d) => d))("RL_INVITE_MAX", 30),
      message: "Too many invite-code attempts — please wait a few minutes and try again.",
    })
    : (req, res, next) => next();
  const whenInviteSent = (req, res, next) => (String((req.body || {}).inviteCode || "").trim() ? inviteLimiter(req, res, next) : next());
  function recordAnalytics(fn) {
    try { if (analytics) fn(analytics); } catch (e) { /* analytics must never fail a request */ }
  }

  // Resolve a parent userId -> display name so publicFamily can list co-parents
  // by name (used by the Settings "Parents" section).
  function parentName(id) {
    const u = store.getUser(id);
    return u ? (u.data.profile.name || u.email || "Parent") : "Parent";
  }
  const pubFam = (fam) => family.publicFamily(fam, parentName);
  function pubFamForUser(fam, user) {
    const out = pubFam(fam);
    if (out && userRole(user) === "kid") delete out.inviteCode;
    return out;
  }

  app.get("/api/family", requireAuth, (req, res) => {
    let fams = family.familiesForUser(req.user.id);
    // Kids aren't in parentIds, so familiesForUser() misses them — resolve their
    // family via the kid linkage instead so a signed-in kid lands in the app
    // (chat/calendar/etc.) rather than a "no family" dead end.
    if (!fams.length && userRole(req.user) === "kid") {
      const kidFam = family.familyForKidUser(req.user);
      if (kidFam) fams = [kidFam];
    }
    res.json({ families: fams.map((fam) => pubFamForUser(fam, req.user)) });
  });
  // Create the family. `plan` decides the product: "screen_time" is always
  // allowed; "full" needs a valid invite code in the body or one validated at
  // signup (user.data.inviteValidatedAt). `plan` omitted = an old app build:
  // full if the user passed the invite gate at signup, else Screen Time.
  app.post("/api/family", requireAuth, requireParent, whenInviteSent, (req, res) => {
    const existing = family.familiesForUser(req.user.id);
    if (existing.length) return res.status(409).json({ error: "You already belong to a family." });
    const body = req.body || {};
    const validatedAtSignup = !!(req.user.data && req.user.data.inviteValidatedAt);
    let plan;
    if (body.plan == null || body.plan === "") {
      plan = validatedAtSignup ? family.PLAN_FULL : family.PLAN_SCREEN_TIME;
    } else if (typeof body.plan === "string" && family.PLANS.has(body.plan)) {
      plan = body.plan;
    } else {
      return res.status(400).json({ error: "plan must be \"full\" or \"screen_time\".", code: "plan_invalid" });
    }
    if (plan === family.PLAN_FULL && !validatedAtSignup && !inviteCode.isValid(body.inviteCode)) {
      return res.status(403).json({
        error: "The whole Fam ETC needs an invite code. Check it, or start with Screen Time and upgrade later.",
        code: "invite_required",
      });
    }
    const fam = family.createFamily(req.user.id, body.name, { plan, timezone: body.timezone });
    identities.ensureParentSubject(req.user.id, fam.id);
    recordAnalytics((a) => a.recordFamilyCreated(plan));
    res.json({ family: pubFam(fam) });
  });
  // Upgrade the whole family to the whole Fam ETC (parent-only, idempotent).
  // Needs a valid invite code even if the account passed the gate at signup.
  app.post("/api/family/upgrade", requireAuth, requireParent, requireFamily, inviteLimiter, (req, res) => {
    if (family.isFull(req.family)) return res.json({ family: pubFam(req.family) });
    if (!inviteCode.isValid((req.body || {}).inviteCode)) {
      return res.status(403).json({
        error: "That invite code isn't valid. Check it and try again.",
        code: "invite_invalid",
      });
    }
    const result = family.upgradePlan(req.family.id);
    if (result.error) return res.status(404).json({ error: result.error });
    if (result.changed) recordAnalytics((a) => a.recordFamilyUpgraded());
    res.json({ family: pubFam(result.family) });
  });
  app.post("/api/family/join", requireAuth, requireParent, (req, res) => {
    const code = (req.body || {}).code;
    const result = family.joinFamilyAsParent(code, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    identities.ensureParentSubject(req.user.id, result.family.id);
    res.json({ family: pubFam(result.family) });
  });
  // Kid profiles: parent-only, minimal data (name, grade, color) — no email,
  // no login, per APP-BRIEF.md.
  app.post("/api/family/kids", requireAuth, requireParent, requireFamily, (req, res) => {
    const { name, grade, color } = req.body || {};
    const result = family.addKid(req.family.id, req.user.id, { name, grade, color });
    if (result.error) return res.status(400).json({ error: result.error });
    identities.ensureKidSubject(req.family.id, result.kid.id);
    res.json({ family: pubFam(result.family), kid: result.kid });
  });
  // Per-kid setup code (D6): a short, 30-minute, single-use code the parent
  // shows; the kid types it on their own device (POST /api/kid/setup-code/claim).
  app.post("/api/family/kids/:kidId/setup-code", requireAuth, requireParent, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!family.kidBelongsToFamily(req.family.id, req.params.kidId)) {
      return res.status(404).json({ error: "Kid not found in this family." });
    }
    res.json(kidAccess.issueSetupCode(req.family.id, req.params.kidId));
  });
  app.patch("/api/family/kids/:kidId", requireAuth, requireParent, requireFamily, (req, res) => {
    const result = family.updateKid(req.family.id, req.user.id, req.params.kidId, req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ family: pubFam(result.family), kid: result.kid });
  });
  app.delete("/api/family/kids/:kidId", requireAuth, requireParent, requireFamily, async (req, res) => {
    const subject = identities.subjectForPrincipal("kid", req.family.id, req.params.kidId);
    let pairwise = null;
    if (subject && subject.status === "active") {
      try { pairwise = identities.pairwiseSubject(subject.id, "pathodds"); } catch (e) { /* integration may be disabled */ }
    }
    const result = family.removeKid(req.family.id, req.user.id, req.params.kidId);
    if (result.error) return res.status(400).json({ error: result.error });

    // Revoke every provisioned FamETC login for this kid profile immediately.
    // Cookie sessions only carry a uid, and passkey lookup resolves through the
    // user table; deleting the linked kid user therefore invalidates both on
    // the very next request. Notification fan-out also stops because it derives
    // kid recipients from the surviving user records.
    store.removeKidUsersForProfile(req.family.id, req.params.kidId);

    // A removed child must not leave a bearer-capability feed or its cached
    // school data behind. The disconnect is local and deterministic.
    if (schoolApi && typeof schoolApi.disconnect === "function") {
      schoolApi.disconnect(req.family.id, req.params.kidId);
    }
    if (subject) {
      identities.disableSubject(subject.id);
      grants.revokeGrant(subject.id);
      // The local deletion is authoritative for FamETC. Revoke remotely as a
      // best-effort cleanup; a disabled subject can never mint a new local grant.
      if (pairwise) pathodds.revokeSubject(pairwise).catch((error) => console.error("[pathodds] kid revoke failed:", error.message));
    }
    res.json({ family: pubFam(result.family) });
  });
  // Remove a PARENT member — the "block equivalent" for Apple UGC review.
  app.delete("/api/family/members/:userId", requireAuth, requireParent, requireFamily, (req, res) => {
    const result = family.removeMember(req.family.id, req.user.id, req.params.userId);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ family: pubFam(result.family) });
  });

  // ===== Kid sign-in: request → parent approves → kid registers a passkey =====
  // Replaces the old "parent signs in on the kid's device and provisions" path.
  // The kid drives this on their OWN device; a parent approves remotely from
  // theirs. See lib/kid-access.js for the model and the pollToken gate.

  // --- Parent side (authenticated) ---
  app.get("/api/family/access-requests", requireAuth, requireParent, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ requests: kidAccess.listPendingForFamily(req.family.id) });
  });
  app.post("/api/family/access-requests/:id/approve", requireAuth, requireParent, requireFamily, (req, res) => {
    const result = kidAccess.approve(req.family.id, req.user.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ family: pubFam(result.family), kid: result.kid });
  });
  app.post("/api/family/access-requests/:id/deny", requireAuth, requireParent, requireFamily, (req, res) => {
    const result = kidAccess.deny(req.family.id, req.user.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });
};

"use strict";

const identities = require("../identity-subjects");
const grants = require("../integration-grants");
const pathodds = require("../pathodds-client");

module.exports = (app, deps) => {
  const { store, family, kidAccess, schoolApi, requireAuth, requireParent, requireFamily, userRole } = deps;

  // Resolve a parent userId -> display name so publicFamily can list co-parents
  // by name (used by the Settings "Parents" section).
  function parentName(id) {
    const u = store.getUser(id);
    return u ? (u.data.profile.name || u.email || "Parent") : "Parent";
  }
  const pubFam = (fam) => family.publicFamily(fam, parentName);

  app.get("/api/family", requireAuth, (req, res) => {
    let fams = family.familiesForUser(req.user.id);
    // Kids aren't in parentIds, so familiesForUser() misses them — resolve their
    // family via the kid linkage instead so a signed-in kid lands in the app
    // (chat/calendar/etc.) rather than a "no family" dead end.
    if (!fams.length && userRole(req.user) === "kid") {
      const kidFam = family.familyForKidUser(req.user);
      if (kidFam) fams = [kidFam];
    }
    res.json({ families: fams.map(pubFam) });
  });
  app.post("/api/family", requireAuth, requireParent, (req, res) => {
    const existing = family.familiesForUser(req.user.id);
    if (existing.length) return res.status(409).json({ error: "You already belong to a family." });
    const fam = family.createFamily(req.user.id, (req.body || {}).name);
    identities.ensureParentSubject(req.user.id, fam.id);
    res.json({ family: pubFam(fam) });
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

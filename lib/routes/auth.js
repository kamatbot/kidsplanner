"use strict";

module.exports = (app, deps) => {
  const {
    store, db, backupCodes, analytics, family, kidAccess, notifications,
    requireAuth, requireParent, authLimiter, signupLimiter, apiLimiter,
    generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse,
    rpForRequest, toB64url, fromB64url, crypto,
    isIOSClient, deviceLabelFromUA, publicProfile, currentUser,
  } = deps;

  // ===================== PASSKEYS (WebAuthn) — PARENTS ONLY =====================
  // There is no kid signup path: every account created through these routes is
  // a parent (see APP-BRIEF.md "Kids' privacy & compliance"). Kid profiles are
  // created only via POST /api/family/kids by an already-signed-in parent.
  function publicCredential(c) {
    return {
      id: c.id,
      name: c.name || "Passkey",
      createdAt: c.createdAt,
      lastUsed: c.lastUsed || null,
      deviceType: c.deviceType || null,
      backedUp: !!c.backedUp,
    };
  }

  app.post("/api/webauthn/register/options", authLimiter, requireAuth, async (req, res) => {
    const { rpID, rpName } = rpForRequest(req);
    const existing = store.listCredentials(req.user.id);
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(req.user.id),
      userName: req.user.email,
      userDisplayName: req.user.data.profile.name || req.user.email,
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    });
    req.session.waReg = options.challenge;
    res.json(options);
  });

  app.post("/api/webauthn/register/verify", authLimiter, requireAuth, async (req, res) => {
    const expectedChallenge = req.session.waReg;
    req.session.waReg = undefined;
    if (!expectedChallenge) return res.status(400).json({ error: "Registration session expired — try again." });
    const { rpID, origins } = rpForRequest(req);
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: req.body,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch (e) {
      return res.status(400).json({ error: "Could not register this passkey. " + e.message });
    }
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: "Passkey registration could not be verified." });
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    if (store.findByCredentialId(credential.id)) {
      return res.status(409).json({ error: "That passkey is already registered." });
    }
    const label = (req.body && req.body.label ? String(req.body.label) : "").trim().slice(0, 60);
    store.addCredential(req.user.id, {
      id: credential.id,
      publicKey: toB64url(credential.publicKey),
      counter: credential.counter || 0,
      transports: credential.transports || [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: label || (credentialDeviceType === "multiDevice" ? "Synced passkey" : "This device"),
      createdAt: new Date().toISOString(),
    });
    res.json({ verified: true, credentials: store.listCredentials(req.user.id).map(publicCredential) });
  });

  app.post("/api/webauthn/auth/options", authLimiter, async (req, res) => {
    const { rpID } = rpForRequest(req);
    const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
    req.session.waAuth = options.challenge;
    res.json(options);
  });

  app.post("/api/webauthn/auth/verify", authLimiter, async (req, res) => {
    const expectedChallenge = req.session.waAuth;
    req.session.waAuth = undefined;
    if (!expectedChallenge) return res.status(400).json({ error: "Sign-in session expired — try again." });
    const credId = req.body && req.body.id;
    const user = credId ? store.findByCredentialId(credId) : null;
    const cred = user && (user.credentials || []).find((c) => c.id === credId);
    if (!user || !cred) return res.status(401).json({ error: "Unrecognized passkey." });
    const { rpID, origins } = rpForRequest(req);
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: req.body,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        credential: {
          id: cred.id,
          publicKey: fromB64url(cred.publicKey),
          counter: cred.counter || 0,
          transports: cred.transports || [],
        },
        requireUserVerification: true,
      });
    } catch (e) {
      return res.status(400).json({ error: "Passkey sign-in failed. " + e.message });
    }
    if (!verification.verified) return res.status(401).json({ error: "Passkey could not be verified." });
    store.updateCredentialCounter(cred.id, verification.authenticationInfo.newCounter);
    req.session.uid = user.id;
    res.json({ user: publicProfile(user) });
  });

  // PARENT-ONLY signup. No role parameter, no kid path — accepting one here
  // would reopen the direct-kid-signup hole the brief explicitly closes.
  app.post("/api/webauthn/signup/options", signupLimiter, async (req, res) => {
    if (currentUser(req)) return res.status(400).json({ error: "You're already signed in." });
    const { rpID, rpName } = rpForRequest(req);
    const newId = "u_" + crypto.randomBytes(9).toString("hex");
    const name = (req.body && req.body.name ? String(req.body.name) : "").trim().slice(0, 60);
    const displayName = name || "Fam ETC parent";
    const userName = name || "parent-" + newId.slice(2, 8);
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(newId),
      userName,
      userDisplayName: displayName,
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    req.session.waSignup = { challenge: options.challenge, userId: newId, name: displayName };
    res.json(options);
  });

  app.post("/api/webauthn/signup/verify", signupLimiter, async (req, res) => {
    const pending = req.session.waSignup;
    req.session.waSignup = undefined;
    if (!pending) return res.status(400).json({ error: "Sign-up session expired — start again." });
    const { rpID, origins } = rpForRequest(req);
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: req.body,
        expectedChallenge: pending.challenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch (e) {
      return res.status(400).json({ error: "Could not create your passkey. " + e.message });
    }
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: "Passkey could not be verified." });
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    if (store.findByCredentialId(credential.id)) {
      return res.status(409).json({ error: "That passkey is already in use. Try signing in instead." });
    }
    const user = store.createUser("", pending.name, {
      id: pending.userId,
      grandfathered: isIOSClient(req),
    });
    store.addCredential(user.id, {
      id: credential.id,
      publicKey: toB64url(credential.publicKey),
      counter: credential.counter || 0,
      transports: credential.transports || [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: credentialDeviceType === "multiDevice" ? "Synced passkey" : "This device",
      createdAt: new Date().toISOString(),
    });
    req.session.uid = user.id;
    try { analytics.recordSignup(isIOSClient(req) ? "ios" : "web"); } catch (e) { /* never block signup */ }
    res.json({ user: publicProfile(user) });
  });

  app.get("/api/webauthn/credentials", requireAuth, (req, res) => {
    res.json({ credentials: store.listCredentials(req.user.id).map(publicCredential) });
  });
  app.patch("/api/webauthn/credentials/:id", requireAuth, (req, res) => {
    const creds = store.renameCredential(req.user.id, req.params.id, (req.body || {}).name);
    res.json({ credentials: creds.map(publicCredential) });
  });
  app.delete("/api/webauthn/credentials/:id", requireAuth, (req, res) => {
    const creds = store.removeCredential(req.user.id, req.params.id);
    res.json({ credentials: creds.map(publicCredential) });
  });

  // ----- backup-code account recovery -----
  const BACKUP_GENERIC_ERR = "That code didn't match. Check it and try again.";
  function findUserByBackupCode(code) {
    const root = db.load();
    for (const u of Object.values(root.users || {})) {
      if (!u.backupCodes) continue;
      const idx = backupCodes.matchIndex(u.backupCodes, code);
      if (idx >= 0) return { user: u, idx };
    }
    return null;
  }
  app.post("/api/auth/backup/verify", authLimiter, (req, res) => {
    if (currentUser(req)) return res.status(400).json({ error: "You're already signed in." });
    const code = (req.body && req.body.code) || "";
    if (backupCodes.normalize(code).length < 8) return res.status(400).json({ error: BACKUP_GENERIC_ERR });
    const hit = findUserByBackupCode(code);
    if (!hit) return res.status(401).json({ error: BACKUP_GENERIC_ERR });
    hit.user.backupCodes.codes[hit.idx].used = true;
    store.saveUser(hit.user);
    req.session.uid = hit.user.id;
    res.json({ user: publicProfile(hit.user) });
  });
  app.post("/api/auth/backup/issue", authLimiter, requireAuth, requireParent, (req, res) => {
    const user = req.user;
    if (user.backupCodes) return res.json({ issued: false });
    const set = backupCodes.generateSet();
    user.backupCodes = set.record;
    store.saveUser(user);
    res.json({ issued: true, backupCodes: set.plaintext });
  });
  app.post("/api/auth/backup/regenerate", authLimiter, requireAuth, requireParent, (req, res) => {
    const user = req.user;
    const set = backupCodes.generateSet();
    user.backupCodes = set.record;
    store.saveUser(user);
    res.json({ backupCodes: set.plaintext, remaining: set.plaintext.length });
  });

  // --- Kid side (public — the kid has no session yet; pollToken gates everything) ---
  app.post("/api/kid/access-request", authLimiter, async (req, res) => {
    const { inviteCode, name, deviceLabel } = req.body || {};
    const label = String(deviceLabel || "").trim() || deviceLabelFromUA(req);
    const result = kidAccess.createRequest(inviteCode, name, label);
    if (result.error) return res.status(400).json({ error: result.error });
    // Ping every parent so they can approve — never block the kid's response on it.
    notifications
      .notifyKidAccessRequest({
        familyParentIds: result.family.parentIds,
        name: result.request.name,
        deviceLabel: result.request.deviceLabel,
        familyId: result.family.id,
      })
      .catch((e) => console.error("[kid-access] notify error:", e.message));
    res.json({ requestId: result.request.id, pollToken: result.request.pollToken, name: result.request.name });
  });
  app.get("/api/kid/access-request/:id", apiLimiter, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(kidAccess.statusForKid(req.params.id, String(req.query.token || "")));
  });
  app.post("/api/kid/access-request/:id/register/options", authLimiter, async (req, res) => {
    const token = String((req.body || {}).token || "");
    const request = kidAccess.getApproved(req.params.id, token);
    if (!request) return res.status(400).json({ error: "This request isn't approved yet (or has expired)." });
    const fam = family.getFamily(request.familyId);
    const kidProfile = fam && fam.kids.find((k) => k.id === request.kidId);
    if (!kidProfile) return res.status(400).json({ error: "That kid profile is no longer available." });
    const kidUser = store.findOrCreateKidUser(request.familyId, request.kidId, kidProfile.name);
    const { rpID, rpName } = rpForRequest(req);
    const existing = store.listCredentials(kidUser.id);
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(kidUser.id),
      userName: kidProfile.name || "kid-" + kidUser.id.slice(2, 8),
      userDisplayName: kidProfile.name || "Fam ETC kid",
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    kidAccess.setRegistration(req.params.id, token, options.challenge, kidUser.id);
    res.json(options);
  });
  app.post("/api/kid/access-request/:id/register/verify", authLimiter, async (req, res) => {
    const token = String((req.body || {}).token || "");
    const request = kidAccess.getApproved(req.params.id, token);
    if (!request || !request.regChallenge || !request.kidUserId) {
      return res.status(400).json({ error: "Device setup expired — start again." });
    }
    const { rpID, origins } = rpForRequest(req);
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: req.body.response || req.body,
        expectedChallenge: request.regChallenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch (e) {
      return res.status(400).json({ error: "Could not set up this device. " + e.message });
    }
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: "Device passkey could not be verified." });
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    if (store.findByCredentialId(credential.id)) {
      return res.status(409).json({ error: "That passkey is already registered." });
    }
    store.addCredential(request.kidUserId, {
      id: credential.id,
      publicKey: toB64url(credential.publicKey),
      counter: credential.counter || 0,
      transports: credential.transports || [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: "This device",
      createdAt: new Date().toISOString(),
    });
    kidAccess.complete(req.params.id, token);
    // Sign the kid in on THIS device — the whole point: no parent session needed.
    req.session.uid = request.kidUserId;
    const kidUser = store.getUser(request.kidUserId);
    res.json({ user: publicProfile(kidUser) });
  });
};

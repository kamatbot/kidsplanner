"use strict";

const crypto = require("crypto");
const db = require("./db");
const identities = require("./identity-subjects");
const grants = require("./integration-grants");

const CODE_TTL_MS = 5 * 60 * 1000;

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("base64url");
}

function codeHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function signingKeyFromEnv() {
  const raw = String(process.env.OIDC_SIGNING_PRIVATE_KEY || "").trim();
  if (!raw) return null;
  const pem = raw.includes("BEGIN") ? raw.replace(/\\n/g, "\n") : Buffer.from(raw, "base64").toString("utf8");
  return crypto.createPrivateKey(pem);
}

function signingKid() {
  return String(process.env.OIDC_SIGNING_KEY_ID || "fametc-2026-01").trim();
}

function issuer() {
  return String(process.env.OIDC_ISSUER || "https://www.fametc.com").replace(/\/$/, "");
}

function clientConfig() {
  return {
    clientId: String(process.env.PATHODDS_OIDC_CLIENT_ID || "pathodds"),
    redirectUri: String(process.env.PATHODDS_OIDC_REDIRECT_URI || "https://www.pathodds.com/api/auth/fametc/callback"),
  };
}

function enabled() {
  if (process.env.PATHODDS_INTEGRATION_ENABLED !== "true" || String(process.env.OIDC_PAIRWISE_SUBJECT_KEY || "").length < 32) return false;
  try {
    return !!signingKeyFromEnv();
  } catch (error) {
    return false;
  }
}

function b64json(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signIdToken(claims, key = signingKeyFromEnv()) {
  if (!key) throw new Error("OIDC signing key is not configured.");
  const header = { alg: "EdDSA", kid: signingKid(), typ: "JWT" };
  const input = `${b64json(header)}.${b64json(claims)}`;
  const signature = crypto.sign(null, Buffer.from(input), key).toString("base64url");
  return `${input}.${signature}`;
}

function publicJwk(key = signingKeyFromEnv()) {
  if (!key) throw new Error("OIDC signing key is not configured.");
  const jwk = crypto.createPublicKey(key).export({ format: "jwk" });
  return { ...jwk, kid: signingKid(), use: "sig", alg: "EdDSA" };
}

function codeRoot() {
  const root = db.load();
  if (!root.oauthAuthorizationCodes) root.oauthAuthorizationCodes = {};
  return root;
}

function issueCode(record) {
  const code = crypto.randomBytes(32).toString("base64url");
  const root = codeRoot();
  root.oauthAuthorizationCodes[codeHash(code)] = { ...record, expiresAt: Date.now() + CODE_TTL_MS };
  db.persist();
  return code;
}

function consumeCode(code) {
  const root = codeRoot();
  const key = codeHash(code);
  const record = root.oauthAuthorizationCodes[key];
  delete root.oauthAuthorizationCodes[key];
  db.persist();
  if (!record || record.expiresAt <= Date.now()) return null;
  return record;
}

function familyForUser(user, family) {
  if (user && user.data && user.data.kid && user.data.kid.familyId) return family.getFamily(user.data.kid.familyId);
  return (family.familiesForUser(user.id) || [])[0] || null;
}

function roleForUser(user) {
  return user && user.data && user.data.profile && user.data.profile.role === "kid" ? "kid" : "parent";
}

function mount(app, deps) {
  const { currentUser, family } = deps;

  app.get("/.well-known/openid-configuration", (req, res) => {
    const base = issuer();
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      jwks_uri: `${base}/.well-known/jwks.json`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      subject_types_supported: ["pairwise"],
      id_token_signing_alg_values_supported: ["EdDSA"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["openid", "sat:work", "sat:quest-summary:read", "sat:launch"],
    });
  });

  app.get("/.well-known/jwks.json", (req, res) => {
    if (!enabled()) return res.status(503).json({ error: "PathOdds identity integration is not enabled." });
    res.set("Cache-Control", "public, max-age=300");
    res.json({ keys: [publicJwk()] });
  });

  app.get("/oauth/authorize", (req, res) => {
    if (!enabled()) return res.status(503).send("PathOdds identity integration is not enabled.");
    const cfg = clientConfig();
    const responseType = String(req.query.response_type || "");
    const clientId = String(req.query.client_id || "");
    const redirectUri = String(req.query.redirect_uri || "");
    const state = String(req.query.state || "");
    const nonce = String(req.query.nonce || "");
    const codeChallenge = String(req.query.code_challenge || "");
    const method = String(req.query.code_challenge_method || "");
    const scope = String(req.query.scope || "").split(/\s+/).filter(Boolean);
    if (responseType !== "code" || clientId !== cfg.clientId || redirectUri !== cfg.redirectUri || method !== "S256" || !state || nonce.length < 16 || codeChallenge.length < 32 || !scope.includes("openid")) {
      return res.status(400).send("Invalid PathOdds authorization request.");
    }
    const user = currentUser(req);
    if (!user) return res.redirect(302, "/login?next=" + encodeURIComponent(req.originalUrl));
    const fam = familyForUser(user, family);
    if (!fam) return res.status(400).send("Join or create a FamETC family before connecting PathOdds.");
    const famRole = roleForUser(user);
    const subject = famRole === "kid"
      ? identities.ensureKidSubject(fam.id, user.data.kid.kidId, user.id)
      : identities.ensureParentSubject(user.id, fam.id);
    if (!subject || subject.status !== "active") return res.status(403).send("This FamETC identity is no longer active.");
    const pairwise = identities.pairwiseSubject(subject.id, cfg.clientId);
    grants.ensureGrant({
      subjectId: subject.id,
      familyId: fam.id,
      grantedBySubjectId: subject.id,
      role: famRole === "kid" ? "student" : "guardian",
      scopes: ["openid", "sat:work", "sat:quest-summary:read", "sat:launch"],
    });
    const code = issueCode({
      clientId,
      redirectUri,
      pairwiseSubject: pairwise,
      famRole,
      nonce,
      codeChallenge,
      authTime: Math.floor(Date.now() / 1000),
      consentVersion: "pathodds-link-v1",
    });
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", state);
    res.redirect(302, callback.toString());
  });

  app.post("/oauth/token", (req, res) => {
    if (!enabled()) return res.status(503).json({ error: "PathOdds identity integration is not enabled." });
    const cfg = clientConfig();
    const body = req.body || {};
    const grantType = String(body.grant_type || "");
    const clientId = String(body.client_id || "");
    const redirectUri = String(body.redirect_uri || "");
    const code = String(body.code || "");
    const verifier = String(body.code_verifier || "");
    if (grantType !== "authorization_code" || clientId !== cfg.clientId || redirectUri !== cfg.redirectUri || !code || verifier.length < 43) {
      return res.status(400).json({ error: "invalid_request" });
    }
    const record = consumeCode(code);
    if (!record || record.clientId !== clientId || record.redirectUri !== redirectUri || sha256(verifier) !== record.codeChallenge) {
      return res.status(400).json({ error: "invalid_grant" });
    }
    const now = Math.floor(Date.now() / 1000);
    const idToken = signIdToken({
      iss: issuer(),
      sub: record.pairwiseSubject,
      aud: clientId,
      iat: now,
      exp: now + 300,
      auth_time: record.authTime,
      nonce: record.nonce,
      fam_role: record.famRole,
      consent_version: record.consentVersion,
    });
    res.set("Cache-Control", "no-store");
    res.json({
      token_type: "Bearer",
      expires_in: 300,
      access_token: crypto.randomBytes(32).toString("base64url"),
      id_token: idToken,
    });
  });
}

module.exports = {
  mount,
  enabled,
  sha256,
  signIdToken,
  publicJwk,
  issueCode,
  consumeCode,
};

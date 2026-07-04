"use strict";
/**
 * APNs provider authentication token (ES256 JWT signed with a .p8 key).
 * Portable — no app-specific logic. See README.md for the config contract.
 *
 * Apple's tokens may be used for up to 1 hour and Apple rate-limits how often
 * a given (teamId, keyId) pair may mint a new one, so this caches the signed
 * token and only re-signs when it's within REISSUE_MARGIN_MS of expiring.
 */
const crypto = require("crypto");

const MAX_AGE_MS = 55 * 60 * 1000; // stay under Apple's 1h cap with margin
const REISSUE_MARGIN_MS = 5 * 60 * 1000;

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Convert a PKCS#8 EC private key (.p8 contents) into a Node KeyObject once,
// so signing per-token doesn't re-parse the PEM every time.
//
// Tolerates the common env-var encodings of a .p8: surrounding quotes, and
// literal "\n" sequences instead of real newlines (what you get pasting a PEM
// into a single-line env var — a multi-line PEM can't survive a line-based
// .env). Real-newline PEMs (from APNS_KEY_PATH) pass through unchanged.
function normalizePem(raw) {
  let s = String(raw || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  if (s.includes("\\n")) s = s.replace(/\\n/g, "\n");
  return s;
}

function loadPrivateKey(pemContents) {
  try {
    return crypto.createPrivateKey({ key: normalizePem(pemContents), format: "pem" });
  } catch (e) {
    throw new Error("apns-sender: could not parse the .p8 key (APNS_KEY / APNS_KEY_PATH). " + e.message);
  }
}

class ProviderTokenCache {
  constructor({ teamId, keyId, keyPem }) {
    if (!teamId) throw new Error("apns-sender: teamId is required.");
    if (!keyId) throw new Error("apns-sender: keyId is required.");
    if (!keyPem) throw new Error("apns-sender: a .p8 key (keyPath or key) is required.");
    this.teamId = teamId;
    this.keyId = keyId;
    this.privateKey = loadPrivateKey(keyPem);
    this._token = null;
    this._issuedAt = 0;
  }

  // Returns a valid provider token, minting a fresh one if the cached one is
  // absent or close to expiry. `force: true` bypasses the cache (used after
  // Apple rejects a token as expired mid-flight).
  get(force = false) {
    const now = Date.now();
    if (!force && this._token && now - this._issuedAt < MAX_AGE_MS - REISSUE_MARGIN_MS) {
      return this._token;
    }
    const header = base64url(JSON.stringify({ alg: "ES256", kid: this.keyId }));
    const payload = base64url(JSON.stringify({ iss: this.teamId, iat: Math.floor(now / 1000) }));
    const signingInput = `${header}.${payload}`;
    const der = crypto.sign(null, Buffer.from(signingInput), {
      key: this.privateKey,
      dsaEncoding: "ieee-p1363", // JWS wants raw r||s, not ASN.1 DER
    });
    const signature = base64url(der);
    this._token = `${signingInput}.${signature}`;
    this._issuedAt = now;
    return this._token;
  }
}

module.exports = { ProviderTokenCache };

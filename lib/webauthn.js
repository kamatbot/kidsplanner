"use strict";
/**
 * WebAuthn / passkey configuration helpers.
 *
 * Passkeys are bound to a Relying Party (RP) — identified by `rpID` (a
 * registrable domain, e.g. "retireodds.com") and validated against the full
 * `origin` (e.g. "https://retireodds.com"). These MUST match the domain the
 * browser is actually on, or the browser refuses to create/use a credential.
 *
 * To make this work the same in local dev and on Hostinger without fiddly
 * config, we resolve the RP from the incoming request by default (honoring the
 * x-forwarded-* headers Hostinger/Passenger sets when terminating TLS), and let
 * explicit env vars override:
 *
 *   RP_ID      e.g. retireodds.com          (no scheme, no port)
 *   RP_ORIGIN  e.g. https://retireodds.com  (comma-separated list allowed)
 *   RP_NAME    human-facing name shown in the OS passkey prompt
 *
 * Setting RP_ID + RP_ORIGIN explicitly in production is recommended — it's the
 * robust choice if you ever sit behind a CDN/proxy that rewrites Host.
 */

const RP_NAME = process.env.RP_NAME || "RetireOdds";
const ENV_RP_ID = (process.env.RP_ID || "").trim();
const ENV_ORIGINS = (process.env.RP_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Pull host/proto from the request, trusting the proxy headers Hostinger sets.
function hostOf(req) {
  return String(req.headers["x-forwarded-host"] || req.headers["host"] || "").split(",")[0].trim();
}
function protoOf(req) {
  const xf = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  if (xf) return xf;
  return req.secure ? "https" : "http";
}

// A passkey is bound to its rpID, and an rpID may be a *parent* of the origin's
// domain. So if we register on `www.retireodds.com` under rpID
// `www.retireodds.com`, that credential is NOT usable on the apex
// `retireodds.com` (and vice-versa) — they'd be two separate passkeys. To make
// the apex and `www.` share one passkey, we scope the rpID to the registrable
// parent by dropping a leading `www.`, and accept assertions from either host.
function parentDomain(hostname) {
  return hostname.replace(/^www\./i, "");
}
// apex + www variants of a host (port preserved) so expectedOrigin covers both.
function siblingHosts(host) {
  const bare = host.replace(/^www\./i, "");
  return [...new Set([host, bare, "www." + bare])];
}

/**
 * Resolve { rpID, rpName, origins } for this request.
 * - rpID: env override, else the registrable parent of the hostname (so apex and
 *   `www.` share passkeys), port stripped.
 * - origins: env override (list), else the request origin plus its apex/www
 *   sibling, so a passkey made on one host verifies on the other.
 */
function rpForRequest(req) {
  const host = hostOf(req);
  const hostname = host.split(":")[0] || "localhost";
  const rpID = ENV_RP_ID || parentDomain(hostname);
  let origins;
  if (ENV_ORIGINS.length) {
    origins = ENV_ORIGINS;
  } else {
    const proto = protoOf(req);
    origins = siblingHosts(host).map((h) => `${proto}://${h}`);
  }
  return { rpID, rpName: RP_NAME, origins };
}

// base64url <-> Buffer/Uint8Array (Node 18+ supports the "base64url" encoding).
const toB64url = (buf) => Buffer.from(buf).toString("base64url");
const fromB64url = (str) => new Uint8Array(Buffer.from(String(str), "base64url"));

module.exports = { rpForRequest, toB64url, fromB64url, RP_NAME };

"use strict";

// Temporary compatibility for App Store builds that did not copy the server's
// `userVerification: "required"` setting onto the native AuthenticationServices
// request. The environment cutoff is additionally capped in source so a stale
// production setting cannot leave this relaxation enabled indefinitely.
const HARD_END_MS = Date.parse("2026-09-22T00:00:00Z");
const REGISTRATION_UV_ERROR = "User verification was required, but user could not be verified";
const AUTHENTICATION_UV_ERROR = "User verification required, but user could not be verified";

function header(req, name) {
  if (req && typeof req.get === "function") return String(req.get(name) || "");
  return String((req && req.headers && req.headers[name.toLowerCase()]) || "");
}

function declaresLegacyIOS(req) {
  if (header(req, "x-fametc-client").trim().toLowerCase() === "ios") return true;
  return /FamETC-?iOS(?:\/|\b)/i.test(header(req, "user-agent"));
}

function isMissingUserVerification(error) {
  const message = error && typeof error.message === "string" ? error.message : "";
  return message === REGISTRATION_UV_ERROR || message === AUTHENTICATION_UV_ERROR;
}

function configuredEndMs(raw = process.env.FAM_LEGACY_IOS_UV_BYPASS_UNTIL) {
  const parsed = Date.parse(String(raw || ""));
  if (!Number.isFinite(parsed)) return null;
  return Math.min(parsed, HARD_END_MS);
}

function isAllowed(req, error, nowMs = Date.now(), configuredUntil) {
  const endMs = configuredEndMs(configuredUntil);
  return endMs !== null
    && nowMs < endMs
    && declaresLegacyIOS(req)
    && isMissingUserVerification(error);
}

module.exports = {
  HARD_END_MS,
  REGISTRATION_UV_ERROR,
  AUTHENTICATION_UV_ERROR,
  declaresLegacyIOS,
  isMissingUserVerification,
  configuredEndMs,
  isAllowed,
};

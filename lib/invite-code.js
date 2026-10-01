"use strict";
/**
 * The Fam ETC invite code (docs/SCREEN-TIME-ONLY-PLAN.md §1, §10.1).
 *
 * The code no longer gates account creation; it gates the FULL plan (at family
 * creation or via POST /api/family/upgrade). One chokepoint so every check
 * behaves the same:
 *
 *   - non-production: SIGNUP_INVITE_CODE, falling back to the legacy dev code;
 *   - NODE_ENV=production with SIGNUP_INVITE_CODE unset: EVERY check fails
 *     closed (no hardcoded fallback in production).
 *
 * Environment is read per call so a deploy-time change or a test toggle takes
 * effect without re-requiring modules. Comparison is case-insensitive,
 * whitespace-trimmed and constant-time.
 */
const crypto = require("crypto");

const DEV_FALLBACK_CODE = "fitodds";

function normalize(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

// The accepted code, or null when checks must fail closed.
function configuredCode() {
  const fromEnv = normalize(process.env.SIGNUP_INVITE_CODE);
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") return null;
  return DEV_FALLBACK_CODE;
}

function isValid(code) {
  const expected = configuredCode();
  const given = normalize(code);
  if (!expected || !given) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { isValid, configuredCode, normalize };

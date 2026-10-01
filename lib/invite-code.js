"use strict";
/**
 * The Fam ETC invite code (docs/SCREEN-TIME-ONLY-PLAN.md §1, §10.1).
 *
 * The code no longer gates account creation; it gates the FULL plan (at family
 * creation or via POST /api/family/upgrade). One chokepoint so every check
 * behaves the same:
 *
 *   - SIGNUP_INVITE_CODE when set, otherwise the current family code
 *     "fitodds" (owner decision 2026-10-01: the existing code stays valid in
 *     every environment).
 *
 * Environment is read per call so a deploy-time change or a test toggle takes
 * effect without re-requiring modules. Comparison is case-insensitive,
 * whitespace-trimmed and constant-time.
 */
const crypto = require("crypto");

const DEFAULT_CODE = "fitodds";

function normalize(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

// The accepted code: the env override, else the current default.
function configuredCode() {
  return normalize(process.env.SIGNUP_INVITE_CODE) || DEFAULT_CODE;
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

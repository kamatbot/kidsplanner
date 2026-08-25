"use strict";

const crypto = require("crypto");

const MAX_SKEW_MS = 5 * 60 * 1000;

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function canonical({ method, path, timestamp, requestId, body = "" }) {
  return [String(method || "").toUpperCase(), String(path || ""), String(timestamp || ""), String(requestId || ""), sha256(body)].join("\n");
}

function sign({ method, path, timestamp, requestId, body = "" }, secret) {
  if (!secret || String(secret).length < 32) throw new Error("PATHODDS_WEBHOOK_SECRET must contain at least 32 characters.");
  return crypto.createHmac("sha256", String(secret)).update(canonical({ method, path, timestamp, requestId, body })).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verify({ method, path, timestamp, requestId, body = "", signature }, secret = process.env.PATHODDS_WEBHOOK_SECRET, now = Date.now()) {
  if (!timestamp || !requestId || !signature || !secret || String(secret).length < 32) return false;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || Math.abs(now - parsed) > MAX_SKEW_MS) return false;
  try {
    return safeEqual(sign({ method, path, timestamp, requestId, body }, secret), signature);
  } catch (error) {
    return false;
  }
}

module.exports = { MAX_SKEW_MS, sign, verify };

"use strict";

const crypto = require("crypto");

function baseUrl() {
  return String(process.env.PATHODDS_SERVICE_BASE_URL || "https://www.pathodds.com").replace(/\/$/, "");
}

function secret() {
  return String(process.env.PATHODDS_SERVICE_SECRET || "");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function signServiceRequest({ method, path, timestamp, requestId, body = "" }, key = secret()) {
  if (key.length < 32) throw new Error("PATHODDS_SERVICE_SECRET must contain at least 32 characters.");
  const canonical = [method.toUpperCase(), path, timestamp, requestId, sha256(body)].join("\n");
  return crypto.createHmac("sha256", key).update(canonical).digest("base64url");
}

async function request(method, path, payload) {
  const body = payload == null ? "" : JSON.stringify(payload);
  const timestamp = new Date().toISOString();
  const requestId = "req_" + crypto.randomBytes(18).toString("base64url");
  const headers = {
    accept: "application/json",
    "x-fametc-timestamp": timestamp,
    "x-fametc-request-id": requestId,
    "x-fametc-signature": signServiceRequest({ method, path, timestamp, requestId, body }),
  };
  if (body) headers["content-type"] = "application/json";
  const response = await fetch(baseUrl() + path, {
    method,
    headers,
    body: body || undefined,
    signal: AbortSignal.timeout(5000),
  });
  let result = null;
  try { result = await response.json(); } catch (e) { /* non-json error */ }
  if (!response.ok) {
    const error = new Error((result && result.error) || `PathOdds request failed (${response.status})`);
    error.status = response.status;
    error.code = result && result.code;
    throw error;
  }
  return result;
}

function getToday(pairwiseSubject) {
  const encoded = encodeURIComponent(pairwiseSubject);
  return request("GET", `/api/auth/fametc/integration/subjects/${encoded}/sat/today`);
}

function createLaunch(pairwiseSubject, route, returnTo) {
  return request("POST", "/api/auth/fametc/integration/launch-tickets", {
    subject: pairwiseSubject,
    route,
    ...(returnTo ? { returnTo } : {}),
  });
}

module.exports = { getToday, createLaunch, signServiceRequest, baseUrl };

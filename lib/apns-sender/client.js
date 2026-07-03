"use strict";
/**
 * Portable APNs HTTP/2 sender. See README.md for the full reuse contract —
 * this file must never import app-specific code or reference an app name.
 */
const fs = require("fs");
const http2 = require("http2");
const { ProviderTokenCache } = require("./jwt");

const HOST_PROD = "api.push.apple.com";
const HOST_SANDBOX = "api.sandbox.push.apple.com";
const PORT = 443;

// Reasons Apple returns that mean the token is permanently dead — the caller
// should delete it from their own device-token storage.
const PRUNE_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

// Reasons worth one quick retry (token/session hiccups), vs failing fast.
const RETRYABLE_REASONS = new Set(["ExpiredProviderToken", "InternalServerError", "ServiceUnavailable", "Shutdown"]);

function readKeyMaterial({ key, keyPath }) {
  if (key) return key;
  if (keyPath) return fs.readFileSync(keyPath, "utf8");
  return null;
}

/**
 * @param {object} config
 * @param {string} config.teamId
 * @param {string} config.keyId
 * @param {string} config.bundleId
 * @param {string} [config.keyPath] absolute path to a .p8 file
 * @param {string} [config.key] .p8 file contents (takes precedence over keyPath)
 * @param {boolean} [config.production] true -> production APNs host
 * @param {number} [config.maxRetries] default 2
 */
function createAPNsClient(config = {}) {
  const { teamId, keyId, bundleId } = config;
  if (!teamId) throw new Error("apns-sender: config.teamId (APNS_TEAM_ID) is required.");
  if (!keyId) throw new Error("apns-sender: config.keyId (APNS_KEY_ID) is required.");
  if (!bundleId) throw new Error("apns-sender: config.bundleId (APNS_BUNDLE_ID) is required.");
  const keyPem = readKeyMaterial(config);
  if (!keyPem) throw new Error("apns-sender: config.key or config.keyPath (APNS_KEY / APNS_KEY_PATH) is required.");

  const tokens = new ProviderTokenCache({ teamId, keyId, keyPem });
  const host = config.production ? HOST_PROD : HOST_SANDBOX;
  const maxRetries = Number.isInteger(config.maxRetries) ? config.maxRetries : 2;

  function requestOnce(deviceToken, body, opts, forceFreshToken) {
    return new Promise((resolve) => {
      const session = http2.connect(`https://${host}:${PORT}`);
      session.on("error", (err) => {
        resolve({ ok: false, status: 0, apnsId: null, reason: "ConnectionError:" + err.message, shouldPruneToken: false });
      });

      const headers = {
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${tokens.get(forceFreshToken)}`,
        "apns-topic": bundleId,
        "apns-push-type": opts.pushType || "alert",
        "apns-priority": String(opts.priority != null ? opts.priority : (opts.pushType === "background" ? 5 : 10)),
      };
      if (opts.collapseId) headers["apns-collapse-id"] = opts.collapseId;
      if (opts.expiration != null) headers["apns-expiration"] = String(opts.expiration);

      const req = session.request(headers);
      let responseHeaders = {};
      let data = "";
      req.on("response", (h) => { responseHeaders = h; });
      req.setEncoding("utf8");
      req.on("data", (chunk) => { data += chunk; });
      req.on("end", () => {
        session.close();
        const status = Number(responseHeaders[":status"]) || 0;
        const apnsId = responseHeaders["apns-id"] || null;
        if (status === 200) {
          resolve({ ok: true, status, apnsId, reason: null, shouldPruneToken: false });
          return;
        }
        let reason = null;
        try { reason = JSON.parse(data).reason || null; } catch (e) { /* non-JSON error body */ }
        resolve({
          ok: false,
          status,
          apnsId,
          reason: reason || `HTTP ${status}`,
          shouldPruneToken: PRUNE_REASONS.has(reason),
        });
      });
      req.on("error", (err) => {
        session.close();
        resolve({ ok: false, status: 0, apnsId: null, reason: "RequestError:" + err.message, shouldPruneToken: false });
      });
      req.end(JSON.stringify(body));
    });
  }

  /**
   * Send one push. Returns
   *   { ok, status, apnsId, reason, shouldPruneToken }
   * `shouldPruneToken: true` means the caller should delete this device
   * token from its own storage — this module keeps no state.
   */
  async function send({ deviceToken, payload, pushType, priority, collapseId, expiration }) {
    if (!deviceToken) return { ok: false, status: 0, apnsId: null, reason: "MissingDeviceToken", shouldPruneToken: false };
    if (!payload || typeof payload !== "object") return { ok: false, status: 0, apnsId: null, reason: "MissingPayload", shouldPruneToken: false };

    let attempt = 0;
    let forceFreshToken = false;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await requestOnce(deviceToken, payload, { pushType, priority, collapseId, expiration }, forceFreshToken);
      if (result.ok || result.shouldPruneToken) return result;
      const retryable = RETRYABLE_REASONS.has(result.reason) || result.status === 0;
      attempt++;
      if (!retryable || attempt > maxRetries) return result;
      forceFreshToken = result.reason === "ExpiredProviderToken" || result.reason === "InvalidProviderToken";
      await new Promise((r) => setTimeout(r, 200 * attempt)); // small linear backoff
    }
  }

  return { send };
}

module.exports = { createAPNsClient, PRUNE_REASONS };

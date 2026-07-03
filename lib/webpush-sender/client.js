"use strict";
/**
 * Portable Web Push sender. See README.md for the full reuse contract —
 * this file must never import app-specific code or reference an app name.
 *
 * Thin wrapper around the `web-push` npm library (VAPID auth, payload
 * encryption, delivery to the browser's push service). No storage, no
 * queueing, no knowledge of what a "notification" means to any given app —
 * that's the caller's job (mirrors lib/apns-sender's split).
 */
const webpush = require("web-push");

// Push-service response codes that mean the subscription is permanently
// dead — the caller should delete it from their own subscription storage.
const GONE_STATUSES = new Set([404, 410]);

/**
 * @param {object} config
 * @param {string} config.publicKey    VAPID public key (base64url), VAPID_PUBLIC_KEY
 * @param {string} config.privateKey   VAPID private key (base64url), VAPID_PRIVATE_KEY
 * @param {string} config.subject      "mailto:you@example.com" or "https://example.com", VAPID_SUBJECT
 */
function createWebPushClient(config = {}) {
  const { publicKey, privateKey, subject } = config;
  if (!publicKey) throw new Error("webpush-sender: config.publicKey (VAPID_PUBLIC_KEY) is required.");
  if (!privateKey) throw new Error("webpush-sender: config.privateKey (VAPID_PRIVATE_KEY) is required.");
  if (!subject) throw new Error("webpush-sender: config.subject (VAPID_SUBJECT) is required.");

  // web-push's setVapidDetails is process-global (the library keeps module-
  // level state), so each client re-asserts its own details immediately
  // before sending. Fine for a single-app process; a multi-tenant caller
  // would need to serialize sends per config.
  function applyVapidDetails() {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  /**
   * Send one push. Returns
   *   { ok, status, reason, shouldPruneSubscription }
   * `shouldPruneSubscription: true` means the caller should delete this
   * subscription from its own storage — this module keeps no state.
   *
   * @param {object} subscription  the PushSubscription JSON from the browser
   *                                ({ endpoint, keys: { p256dh, auth } })
   * @param {object} payload       JSON-serializable notification payload
   * @param {object} [opts]
   * @param {number} [opts.TTL]    seconds the push service may hold the
   *                                message if the device is offline
   * @param {"normal"|"high"|"very-low"} [opts.urgency]
   */
  async function send(subscription, payload, opts = {}) {
    if (!subscription || !subscription.endpoint) {
      return { ok: false, status: 0, reason: "MissingSubscription", shouldPruneSubscription: false };
    }
    if (!payload || typeof payload !== "object") {
      return { ok: false, status: 0, reason: "MissingPayload", shouldPruneSubscription: false };
    }
    applyVapidDetails();
    try {
      const result = await webpush.sendNotification(subscription, JSON.stringify(payload), {
        TTL: opts.TTL != null ? opts.TTL : 86400,
        urgency: opts.urgency,
      });
      return { ok: true, status: result.statusCode || 201, reason: null, shouldPruneSubscription: false };
    } catch (err) {
      const status = err.statusCode || 0;
      return {
        ok: false,
        status,
        reason: err.body || err.message || `HTTP ${status}`,
        shouldPruneSubscription: GONE_STATUSES.has(status),
      };
    }
  }

  return { send };
}

module.exports = { createWebPushClient, GONE_STATUSES };

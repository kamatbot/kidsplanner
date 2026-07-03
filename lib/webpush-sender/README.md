# webpush-sender

Portable, app-agnostic Web Push sender core. Wraps the `web-push` npm
library: VAPID auth, payload encryption, delivery to the browser's push
service (Chrome/FCM, Firefox/Mozilla, Edge, Safari on macOS/iOS 16.4+ PWAs),
and gone-subscription feedback so callers can prune dead subscriptions.

**Zero app-specific logic lives here.** No imports from any app's code, no
hardcoded VAPID subject, no notification copy. Everything comes from config
passed in by the caller. This directory is designed to be copied verbatim
into another Node project (RetireOdds, mytharva, ...) — see "Reuse contract"
below. Mirrors the structure of `lib/apns-sender/`.

## Files

| File | Purpose |
|---|---|
| `client.js` | `createWebPushClient(config)` — the sender. Wraps `web-push`'s `sendNotification`, classifies gone/permanent failures. |
| `index.js` | Public entry point — re-exports `createWebPushClient`. |

## Reuse contract

### Required config (env vars or explicit fields)

| Field | Env var | Description |
|---|---|---|
| `publicKey` | `VAPID_PUBLIC_KEY` | VAPID public key (base64url). Also handed to the browser client for `pushManager.subscribe()`. Not secret. |
| `privateKey` | `VAPID_PRIVATE_KEY` | VAPID private key (base64url). Secret — server-side only, never sent to the client. |
| `subject` | `VAPID_SUBJECT` | Contact URI the push service may use to reach the sender if it's misbehaving, e.g. `mailto:hello@example.com`. |

None of these have defaults — a missing required field throws at
`createWebPushClient()` time, not on first send, so misconfiguration fails
loud and early.

Generate a VAPID key pair once per app with:
```
npx web-push generate-vapid-keys
```
or programmatically via `require("web-push").generateVAPIDKeys()`.

### Usage

```js
const { createWebPushClient } = require("./lib/webpush-sender");

const webpush = createWebPushClient({
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
  subject: process.env.VAPID_SUBJECT,
});

const result = await webpush.send(
  subscription, // the PushSubscription JSON from the browser: { endpoint, keys: { p256dh, auth } }
  { title: "New message", body: "...", data: { url: "/chat" } }, // any JSON-serializable payload
  { TTL: 86400, urgency: "normal" } // optional
);

// result: { ok: boolean, status: number, reason: string|null, shouldPruneSubscription: boolean }
```

`shouldPruneSubscription` is `true` when the push service's response means
the subscription is permanently invalid (HTTP 404/410 — the user
unsubscribed, cleared site data, or uninstalled) — the caller's app layer is
responsible for deleting that subscription from its own storage; this
module has no storage of its own.

### What this module deliberately does NOT do

- No database, no subscription storage, no per-app notification templates.
- No queueing — call `.send()` per notification; batch/fan-out is the
  caller's job (e.g. `fam-notifications` looping over a family's web push
  subscriptions).
- No knowledge of what a "chat message" is — that's the app layer.
- No service worker — the caller's frontend ships its own tiny `sw.js` that
  handles the `push` and `notificationclick` events and calls
  `self.registration.showNotification(...)`.

### Porting to another project

Copy the `webpush-sender/` directory as-is, add the `web-push` npm
dependency, and set the three env vars for the new app's own VAPID key
pair. No code changes required.

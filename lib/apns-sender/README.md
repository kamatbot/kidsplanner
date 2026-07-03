# apns-sender

Portable, app-agnostic Apple Push Notification service (APNs) sender core.
Token-based (.p8) auth, HTTP/2 to Apple's endpoints, retry on transient
failure, and bad-device-token feedback so callers can prune dead tokens.

**Zero app-specific logic lives here.** No imports from any app's code, no
hardcoded bundle IDs, team IDs, or notification copy. Everything comes from
config passed in by the caller. This directory is designed to be copied
verbatim into another Node project (RetireOdds, mytharva, ...) — see "Reuse
contract" below.

## Files

| File | Purpose |
|---|---|
| `client.js` | `createAPNsClient(config)` — the sender. HTTP/2 requests, JWT provider-token auth, retry, response classification. |
| `jwt.js` | Signs the ES256 provider authentication token from a `.p8` key; caches and reissues it (Apple tokens are valid up to 1 hour, must be re-used, not re-signed per request). |
| `index.js` | Public entry point — re-exports `createAPNsClient`. |

## Reuse contract

### Required config (env vars or explicit fields — see below)

| Field | Env var | Description |
|---|---|---|
| `teamId` | `APNS_TEAM_ID` | Apple Developer Team ID (10 chars). |
| `keyId` | `APNS_KEY_ID` | Key ID of the `.p8` APNs Auth Key. |
| `bundleId` | `APNS_BUNDLE_ID` | The target app's bundle identifier (becomes the `apns-topic` header). |
| `keyPath` | `APNS_KEY_PATH` | Absolute path to the `.p8` private key file. |
| — or — | | |
| `key` | `APNS_KEY` | The `.p8` key contents directly (e.g. loaded from a secret manager instead of a file). Takes precedence over `keyPath` if both are set. |
| `production` | `APNS_PRODUCTION` | `"true"` → `api.push.apple.com`; anything else → `api.sandbox.push.apple.com`. |

None of these have defaults — a missing required field throws at
`createAPNsClient()` time, not on first send, so misconfiguration fails loud
and early.

### Usage

```js
const { createAPNsClient } = require("./lib/apns-sender");

const apns = createAPNsClient({
  teamId: process.env.APNS_TEAM_ID,
  keyId: process.env.APNS_KEY_ID,
  bundleId: process.env.APNS_BUNDLE_ID,
  keyPath: process.env.APNS_KEY_PATH, // or `key: process.env.APNS_KEY`
  production: process.env.APNS_PRODUCTION === "true",
});

const result = await apns.send({
  deviceToken: "abcd1234...", // hex device token from the client
  payload: { aps: { alert: { title: "New message", body: "..." }, sound: "default" } },
  // optional:
  pushType: "alert", // "alert" | "background" | "voip" | ... (default "alert")
  priority: 10, // 10 = immediate, 5 = throttled/background (default 10, or 5 if pushType is "background")
  collapseId: undefined, // string, groups notifications that supersede each other
  expiration: undefined, // unix seconds; 0 = discard if undeliverable when device is offline
});

// result: { ok: boolean, status: number, apnsId: string|null,
//           reason: string|null, shouldPruneToken: boolean }
```

`shouldPruneToken` is `true` when Apple's response means the token is
permanently invalid (`BadDeviceToken`, `Unregistered`, `DeviceTokenNotForTopic`)
— the caller's app layer is responsible for deleting that token from its own
storage; this module has no storage of its own.

### Retry behavior

Transient failures (`ExpiredProviderToken`, HTTP 5xx, connection errors) are
retried up to 2 times with a short backoff, re-signing the provider JWT if it
was the cause. Permanent failures (`BadDeviceToken`, `Unregistered`, `TopicDisallowed`,
`InvalidProviderToken` with a config problem) are NOT retried — they're
returned immediately so the caller can act (prune the token, fix config).

### What this module deliberately does NOT do

- No database, no token storage, no per-app notification templates.
- No queueing — call `.send()` per notification; batch/fan-out is the
  caller's job (e.g. `fam-notifications` looping over a family's device
  tokens).
- No knowledge of what a "chat message" or "homework reminder" is — that's
  the app layer.

### Porting to another project

Copy the `apns-sender/` directory as-is. Set the five env vars for the new
app's own Apple Developer account/bundle ID. No code changes required.

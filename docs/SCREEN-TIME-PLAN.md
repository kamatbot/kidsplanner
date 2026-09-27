# Screen Time — parent controls + child enforcement

Status: building on `feat/screen-time` (2026-09-27). This file is the contract
the server, iOS enforcement and iOS UX work are built against.

## Core tenet: both modes are first-class

Many kids' devices were set up without a child Apple Account, and moving them
into Family Sharing afterwards is close to impossible. Fam ETC therefore
supports two modes, chosen **on the child's device** at setup:

| Mode (`mode`) | Apple authorization | Enforcement | Who picks apps |
|---|---|---|---|
| `family` — "With Family Sharing" | `AuthorizationCenter.requestAuthorization(for: .child)` (a parent approves on the kid's device; kid must be a child account in the parent's Family Sharing group) | Strong: the kid cannot delete Fam ETC or revoke Screen Time access | Parent on their own phone (`FamilyActivityPicker` lists the child's apps), or on the kid's device |
| `cooperative` — "Without Family Sharing" | `.individual` (the device owner approves with Face ID / passcode) | Real shields and limits, but the kid **can** revoke access in Settings or delete the app. Fam ETC **detects that and alerts the parents** | On the kid's device (tokens are device-local) |

Setup tries `family` first; if Apple refuses (not a child account / no Family
Sharing), the kid screen offers `cooperative` with honest copy. The kid always
sees that the rules exist and that turning them off notifies their parents.

Apple has no API for a parent's phone to control another device. The parent
edits a **policy** on our server; the kid's device pulls it and enforces it
locally with ManagedSettings + DeviceActivity. "Pause now" is best-effort
(delivered by silent push / next check-in) and the parent UI shows
Pending vs Applied, never "blocked" on server acceptance alone.

## Tamper detection (the no-Family-Sharing promise)

The server holds per-device state and alerts all family parents (APNs alert +
web push) — never the family chat, which kids can read.

| Signal | Detected by | Alert `type` |
|---|---|---|
| Authorization went `approved` → `denied`/`notDetermined` | Kid app reports `authStatus` in every heartbeat (launch, foreground, `AuthorizationCenter` status observer, BGAppRefresh, silent push) | `revoked` |
| Access turned back on | Next heartbeat with `approved` after `revoked` | `restored` |
| No heartbeat for `SCREEN_TIME_STALE_HOURS` (default 24) | Server sweep. While authorized, the DeviceActivity monitor extension heartbeats at 4 quarter-day schedule boundaries even if the app is never opened/force-quit; after revocation it stops | `stale` |
| APNs says the token is gone (410 / Unregistered) on a silent ping | Server ping every `SCREEN_TIME_PING_HOURS` (default 4) | `removed` |
| Kid changed the apps in a limit on their device | Device selection upload | `selection_changed` |

A heartbeat after `stale`/`removed` sets the device back to `ok` (alert
`restored`, no push unless it was `revoked`).

## Server (`lib/screen-time.js`, `lib/routes/screen-time.js`)

Storage: `root.screenTime[familyId].kids[kidId] = { policy, devices, alerts }`
in the whole-file-encrypted db. Device secrets are stored as SHA-256 hashes
only. Alerts capped at 50 per kid.

### Policy JSON (server ⇄ iOS, identical keys)
```json
{
  "version": 3, "enabled": true, "updatedAt": "ISO",
  "pauseUntil": "ISO or null",
  "limits": [{
    "id": "lim_x", "name": "Games", "minutesPerDay": 60,
    "selection": "base64(JSON FamilyActivitySelection) or null",
    "selectionSummary": { "apps": 3, "categories": 1, "webDomains": 0 },
    "deviceSelections": { "dev_x": { "apps": 2, "categories": 0, "webDomains": 0 } }
  }],
  "downtime": [{ "id": "dt_x", "name": "Bedtime", "start": "21:00", "end": "07:00", "days": [1,2,3,4,5,6,7] }]
}
```
- `days` use `Calendar.weekday` numbering (1 = Sunday … 7 = Saturday). A
  downtime applies when it **starts** on a listed day; `end < start` crosses
  midnight.
- Limits: 1–720 minutes/day, max 8. Downtime: max 4. Names ≤ 40 chars.
- `selection` is an opaque blob; the server never decodes it (≤ 64 KB).
- **Device projection** (heartbeat/enroll responses): `selection` is replaced by
  that device's own uploaded selection when one exists, otherwise the parent's;
  `deviceSelections` is omitted. **Parent projection**: `selection` blobs are
  kept (parent may re-open the picker), `deviceSelections` holds summaries only.

### Device JSON (parent view)
`{ id, label, mode, authStatus, appliedVersion, lastSeenAt, enrolledAt, state }`
- `label`: e.g. "iPhone"/"iPad" (client-supplied, ≤ 40 chars).
- `authStatus`: `approved` | `denied` | `notDetermined`.
- `state`: `ok` | `revoked` | `stale` | `removed`.
- Never includes the secret hash or push token.

### Alert JSON
`{ id, kidId, deviceId, type, message, at, ackedAt }` — `message` is the
human sentence shown in the app (e.g. "Mia turned off Screen Time on iPhone").

### Endpoints
Parent (`requireAuth, requireParent, requireFamily`; kid must belong to family):
- `GET  /api/screen-time` → `{ kids: [{ kidId, policy, devices: [], alerts: [] }] }` (every kid in the family, default policy `{version:0, enabled:false, limits:[], downtime:[], pauseUntil:null}`).
- `PUT  /api/screen-time/kids/:kidId/policy` body `{ enabled, limits, downtime }` → kid state. Limit without `id` gets one; a limit body **without** a `selection` key keeps the stored selection, `selection: null` clears it. Bumps `version`, pings the kid's devices (`screen_time_sync`).
- `POST /api/screen-time/kids/:kidId/pause` body `{ minutes }` (0 = resume, else 15–1440) → kid state. Bumps version, pings.
- `POST /api/screen-time/kids/:kidId/alerts/ack` → kid state (acks all).
- `DELETE /api/screen-time/kids/:kidId/devices/:deviceId` → kid state.

Kid session (`requireAuth, requireFamily`, role kid):
- `GET  /api/screen-time/mine` → `{ policy }` (parent selection projection, no device).
- `POST /api/screen-time/device/enroll` body `{ label, mode, authStatus, pushToken? }` → `{ deviceId, deviceSecret, policy }` (device projection). Only `mode` ∈ family|cooperative, only when `authStatus == approved`.

Device (header `Authorization: FamDevice <deviceSecret>`, no session — works from the monitor extension and in the background after cookies expire):
- `POST /api/screen-time/device/heartbeat` body `{ authStatus, mode, appliedVersion, pushToken?, source }` (`source` ∈ app|foreground|observer|background|push|monitor) → `{ policy }` (device projection). Drives the revoked/restored/stale-recovery transitions above.
- `PUT  /api/screen-time/device/limits/:limitId/selection` body `{ selection, summary }` → `{ policy }`. Stores a per-device selection and raises `selection_changed` when the summary changed.
Unknown/forgotten secret → 401.

### Pushes (`lib/fam-notifications.js`)
- Parent alert: `{ aps: { alert: {title, body}, sound: "default", "thread-id": "screen-time-<familyId>" }, famType: "screen_time_alert", familyId, kidId }` + web push. Titles: revoked "⚠️ Screen Time turned off", removed "⚠️ Fam ETC may have been removed", stale "Screen Time isn't checking in", selection_changed "Screen Time apps changed", restored "✅ Screen Time is back on".
- Device ping: background push `{ aps: { "content-available": 1 }, famType: "screen_time_sync" | "screen_time_ping" }`, `pushType: "background"`, priority 5, sent to the device's `pushToken` directly.

### Monitor
`screenTime.startMonitor()` from server.js (unref'd 10-minute interval): stale sweep + pings. Clock and sender injectable for tests.

## iOS

### Targets (project.yml)
| Target | Type | Bundle ID | Sources |
|---|---|---|---|
| FamETC (existing) | app | com.fametc.app | + `FamETCScreenTimeShared` |
| FamETCScreenTimeMonitor | app-extension, `com.apple.deviceactivity.monitor-extension` | com.fametc.app.screentime-monitor | FamETCScreenTimeMonitor + FamETCScreenTimeShared |
| FamETCShieldConfig | app-extension, `com.apple.ManagedSettingsUI.shield-configuration-service` | com.fametc.app.shield-config | FamETCShieldConfig |

All three carry `com.apple.developer.family-controls` and the existing App
Group `group.com.fametc.app.family-assistance`. App Info.plist adds
`fetch` background mode and `BGTaskSchedulerPermittedIdentifiers =
[com.fametc.app.screentime.refresh]`.

### Shared (`ios/FamETCScreenTimeShared/`)
- `ScreenTimeModels.swift`: `ScreenTimePolicy`, `ScreenTimeLimit`, `ScreenTimeDowntime`, `SelectionSummary`, `ScreenTimeDevice`, `ScreenTimeAlert`, `ScreenTimeKidState`, `ScreenTimeOverview` — Codable mirrors of the JSON above.
- `ScreenTimeEnforcer.swift`: App Group storage (policy, device credentials, last monitor fire), selection encode/decode, `apply(policy)` (named `ManagedSettingsStore`s `downtime`, `pause`, `limit.<id>`; `DeviceActivityCenter` activities `daily` [limit events `limit.<id>`], `downtime.<id>`, `heartbeat.0…3`, `pause`), and a tiny `heartbeat(source:)` HTTP client usable from the extension.
- Pure schedule helpers (unit-tested): time parsing, weekday check, pause interval (≥ 15 min).

### Monitor extension
`intervalDidStart`: `daily` → clear all `limit.*` stores; `downtime.<id>` → shield all categories/web if today is listed; `heartbeat.*` → heartbeat(source: monitor). `intervalDidEnd`: `downtime.<id>`/`pause` → clear that store. `eventDidReachThreshold(limit.<id>)` → shield that limit's selection. Every callback records `lastMonitorAt`. Stays well under the ~6 MB memory cap: no SwiftUI, no big decoders.

### Shield configuration
Fam ETC-branded shield: title "Paused by Fam ETC", subtitle names the reason (limit name / Downtime / Paused by a parent), single "OK" button. Shield action extension ("ask for more time") is deferred.

### `ScreenTimeService` (`ios/FamETC/Features/ScreenTime/ScreenTimeService.swift`)
`@MainActor @Observable final class ScreenTimeService { static let shared }`
- Kid device: `authState: ScreenTimeAuthState` (`.notDetermined/.denied/.approved`), `mode: ScreenTimeMode?` (`.family/.cooperative`), `isEnrolled`, `policy: ScreenTimePolicy?`, `lastSyncAt: Date?`, `lastError: String?`;
  `requestAuthorization(_ mode: ScreenTimeMode) async throws`, `enroll() async throws`, `sync(source: String) async`, `saveDeviceSelection(limitId: String, selection: FamilyActivitySelection) async throws`, `selection(for: ScreenTimeLimit) -> FamilyActivitySelection`, `startObserving()` (status observer + BG task scheduling; called once at launch for kid sessions).
- Parent: `overview: ScreenTimeOverview?`, `loadOverview() async`, `state(for kidId: String) -> ScreenTimeKidState?`, `savePolicy(kidId:enabled:limits:downtime:) async throws`, `pause(kidId:minutes:) async throws`, `ackAlerts(kidId:) async`, `forgetDevice(kidId:deviceId:) async throws`, `unackedAlerts: [ScreenTimeAlert]`.
- Static: `encode(_ FamilyActivitySelection) -> String?`, `summary(of:) -> SelectionSummary`.
- Handles `screen_time_sync`/`screen_time_ping` silent pushes (AppDelegate `didReceiveRemoteNotification`) by calling `sync(source: "push")`.

### UX (`ios/FamETC/Features/ScreenTime/*View.swift`)
- Parent Today: `ScreenTimeSummaryCard` (per-kid status chip) → `ScreenTimeParentSheet` (kid switcher; status + devices with mode badge and last check-in; Pause now 15m/1h/until tomorrow/Resume; Daily limits with minutes + Choose apps; Downtime windows; alert history; "How protection works" explaining both modes).
- App-wide parent banner `ScreenTimeAlertBanner` for unacknowledged alerts (next to `KidApprovalBanner`); `screen_time_alert` push deep-links to the sheet for that kid.
- Kid Today: `ScreenTimeKidCard` → `ScreenTimeKidSetupSheet` (explain → Family Sharing first → fallback to without Family Sharing → enroll) and, once enrolled, the rules list, per-limit "Choose apps with a parent", and the transparency line "Turning this off tells your parents."

## Distribution gate (owner action)
Development builds work with the `family-controls` entitlement today. App
Store/TestFlight distribution needs Apple's **Family Controls (Distribution)**
approval for `com.fametc.app`, `com.fametc.app.screentime-monitor` and
`com.fametc.app.shield-config` — request at
developer.apple.com/contact/request/family-controls-distribution.

## Deferred (not built)
Shared allowance across a kid's iPhone+iPad (each device enforces its own
minutes), "ask for more time" shield action, usage reports, always-allowed
apps during downtime, web (desktop) Screen Time UI, Android.

## Appendix: Family Controls (Distribution) request text

Ready-to-paste answers for Apple's request form at
developer.apple.com/contact/request/family-controls-distribution.

- **App name**: Fam ETC
- **Team ID**: B4F73U5RGR
- **Bundle IDs**: com.fametc.app, com.fametc.app.screentime-monitor,
  com.fametc.app.shield-config

**How your app uses the Family Controls framework** (description, ~120 words):

> Fam ETC is a family organizer app (school calendars, homework, chat) used by
> parents and their kids. Parents configure per-app and per-category daily
> time limits and downtime schedules for their kids from their own device or
> the family server; the child's device enforces that policy locally using
> FamilyControls, ManagedSettings, and DeviceActivity — shielding the chosen
> apps/categories when a limit is reached or downtime begins, and lifting
> shields when a parent pauses or adjusts the policy. We support both Family
> Sharing child accounts (`.child` authorization) and, for families whose
> kids' devices were never set up in Family Sharing, individual authorization
> (`.individual`) approved directly on the child's device. No usage data
> leaves the device. App selections are synced only as Apple's opaque tokens
> plus counts, and the child's device reports its authorization status and
> applied policy version so parents can be alerted if a child disables or
> removes Screen Time protection on a cooperative-mode device.

## App Review notes

- Sign in as a parent, add or select a child, open the Screen Time section,
  and create a daily limit (pick an app/category and set minutes) or a
  downtime window — this writes the policy to the server.
- On the child's device, sign in as that kid, open Screen Time setup, and
  complete authorization (Family Sharing child account if available,
  otherwise the without-Family-Sharing / individual path with Face ID or
  passcode) to enroll the device and pull the policy.
- To see tamper detection: on the child's device, go to Settings → Screen
  Time → Apps with Screen Time Access and turn off access for Fam ETC (only
  possible in the without-Family-Sharing / cooperative mode). Within one
  heartbeat cycle, the parent's account receives a push and in-app alert that
  Screen Time was turned off on that device.

# Screen Time — parent controls + child enforcement

## Launch-safety refinement — 2026-09-30

The parent-simplicity section of SCREEN-TIME-UX.md supersedes older alert copy
and setup descriptions below. Unknown authorization never becomes revocation
just because time elapsed. Invalid push tokens indicate a delivery problem,
not proven deletion. Recovery notifications distinguish authorization from
successfully registered rules. A neutral 24-hour uncertainty reminder is
deduplicated per episode, including after the parent dismisses it.

Extra-time approval must revalidate that Screen Time and its total daily limit
are still enabled before spending Fams. Rejected pending approval cannot change
the ledger, balance or request status; approved replay stays idempotent. Removing
a child profile also purges that child's Screen Time data, including device
credentials, selections, usage and agreement. No other child's records change.

Required agreement remains part of first setup. Physical enforcement, signing
entitlements and published privacy disclosures remain independent launch gates;
source/build-only verification cannot satisfy them.

## Essentials contract — 2026-09-30

This addendum supersedes the older health, assignment and usage descriptions
below. Native presentation follows the matching addendum in SCREEN-TIME-UX.md.

- **Device-confirmed setup:** heartbeats carry optional `health` with
  `policyVersion`, `state` (`applied`, `off`, `partial`, `failed`,
  `needsSelection`), `registeredActivities`, `expectedActivities`,
  `hasUsageSelection`, and bounded stable failure codes. The server supplies
  `checkedAt`. Missing health is unverified. Only successful registration of
  the relevant activities advances `appliedVersion`; failed registration
  remains retryable. This confirms configuration, not a live hardware test.
  Parent `POST /api/screen-time/kids/:kidId/check` requests a device check-in;
  push delivery is best-effort, never immediate proof of protection.
- **Assignment isolation:** device enrollment, policy responses and public
  device records include `assignmentGeneration`. Moving/re-enrolling a device
  increments it and clears app approvals. Heartbeats from an old generation
  cannot attribute usage, health or applied-version evidence to the new child.
  Device mutations include the generation; stale mutations are rejected.
  Legacy generation-less requests are compatible only with generation 1.
  Native assignment-local usage, event evidence and drafts reset on a move;
  older responses cannot revert a newer assignment. Signing out clears account
  presentation state, but does not turn off device-owned enforcement.
- **Essential apps:** each device stores one approved opaque selection and an
  optional pending proposal. Device `PUT /api/screen-time/device/essential-apps`
  accepts `{selection, summary, note?, assignmentGeneration}`. Selection must
  contain 1–50 individual apps, no categories/websites; note is at most 80
  characters. Parent `POST .../kids/:kidId/devices/:deviceId/essential-apps/approve`
  or `/decline` requires `{requestId}`. Stale proposals cannot be approved.
  `DELETE .../essential-apps` removes approval and the pending proposal.
  Approval/removal bumps policy version and requests device sync.
  Only **approved** selection tokens reach device enforcement; parent JSON
  contains counts and pending metadata, never device token blobs. Parents must
  verify the actual apps together on the child's device. Exceptions apply to
  bedtime/quiet-time shields only, not daily limits or a manual parent pause.
- **Per-device allowance:** usage rows include optional `updatedAt`,
  `limitMinutes` and `remainingMinutes`. Unreported devices retain a row with
  unknown usage. The allowance is per device, not a shared family/child budget;
  a sum across devices must not be compared with one device's allowance.
  Historical allowance is captured with the report; changing today's rules
  must not rewrite yesterday's allowance. Older unknown history stays unknown.
  Usage is approximate, reported in 15-minute steps, not a live countdown.
  A nonempty activity selection proves only that selected activity can be
  counted; it does not prove that every application on the device was selected.
- **Schedule validation:** downtime must span at least 15 minutes, including
  overnight windows, to fit DeviceActivity's scheduling constraints.

Release evidence still requires entitled, physical-device verification of
authorization, background delivery, schedule registration, overlapping shields,
essential-app access and device reassignment. Source tests/builds cannot prove
these OS-managed behaviors. No distribution approval is implied here.

Focused physical-device acceptance before release (existing devices only):
1. In both authorization modes, finish selection, check protection and verify
   the parent transitions from awaiting to current device-confirmed health.
2. Interrupt connectivity during a rule/pause update. Confirm the parent never
   labels the unreceived rule as applied; reconnect and retry on the child device.
3. Propose essential apps, close/reopen the proposal, review the exact selection
   together, then approve. Verify access during downtime while daily-limit and
   manual-pause stores still restrict those same apps. Decline/replacement/removal
   must not enable an unapproved selection.
4. Move/re-enroll a used device, including into a child with a lower policy
   version. Old usage, drafts and delayed callbacks must not cross assignments.
5. Switch accounts/sign out with requests in flight. Old account details must
   disappear while the device's enforced restrictions remain.

Status: building on `feat/screen-time` (2026-09-27). This file is the contract
the server, iOS enforcement and iOS UX work are built against. States, alert
lifecycle, presentation and enforcement rules were refined by
[SCREEN-TIME-UX.md](SCREEN-TIME-UX.md) (2026-09-27); where the two disagree,
that spec wins and this file mirrors it.

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

Alerts are parent-only and raised through one choke point (`raise()`), which
does nothing while the kid's `policy.enabled` is false: the parent turned
Screen Time off, so device state is still tracked but nothing is listed,
pushed or pinged.

| Type | Raised when | Never raised when | Auto-resolved (acked) | Banner | Push |
|---|---|---|---|---|---|
| `revoked` | heartbeat `authStatus != approved` and device `state != revoked` | policy off (state still updated silently) | next `approved` heartbeat | yes, danger | yes |
| `removed` | sweep/sync ping: APNs says the token is gone (410 / Unregistered) | policy off; no push token | next heartbeat | yes, danger | yes |
| `stale` | sweep: `state == ok` and no heartbeat for `SCREEN_TIME_STALE_HOURS` (default 24) | policy off (sweep skips the kid) | next heartbeat | yes, warning | yes |
| `selection_changed` | device replaces its own earlier selection with different counts | policy off; a device's first pick | never (parent acks) | yes, info | yes |
| `restored` | `approved` heartbeat from a revoked/stale/removed device | policy off | created **pre-acked** (`ackedAt = at`) | never | only if it was `revoked` |

While authorized, the DeviceActivity monitor extension heartbeats at 4
quarter-day schedule boundaries even if the app is never opened/force-quit
(and keeps doing so while the policy is off). Revocation is reported by the
kid app in every heartbeat (launch, foreground, `AuthorizationCenter` status
observer, BGAppRefresh, silent push). Keep-alive pings go every
`SCREEN_TIME_PING_HOURS` (default 4) to kids whose policy is on.

Lifecycle:
1. **Turn off** (`PUT policy` `enabled` true → false): ack every open alert,
   `pauseUntil = null`, bump `version`, ping devices (`screen_time_sync`) so
   they drop their shields. Rules (limits/downtime) are kept as sent.
2. **Turn on** (false → true), per device: `stale` (or `ok` but silent for
   longer than the stale window, since the sweep skipped it while off) →
   `state = ok`, `lastSeenAt = now` (24 h grace, no alert); `revoked` → raise
   `revoked` now; `removed` → raise `removed` now. Then bump + ping.
3. **Restore**: an `approved` heartbeat from a revoked/stale/removed device
   acks that device's open revoked/stale/removed alerts and adds the pre-acked
   `restored` entry. Any heartbeat acks that device's open stale/removed alerts.
4. **Forget device** acks that device's open alerts.
5. **Expiry**: an unacked alert older than 7 days is acked when the kid state
   is read (persisted on that read).
6. **Ack**: per alert (`POST …/alerts/:alertId/ack`) or all (`POST …/alerts/ack`).

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
    "id": "total", "kind": "total", "name": "Screen time", "minutesPerDay": 120, "weekendMinutes": 180,
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
- `kind`: `total` (whole-device daily screen time; at most one, id is always
  `total`) or `apps` (default; per-app/category limit, Advanced). 
- `weekendMinutes`: minutes on Saturday + Sunday (weekday 7 and 1); `null` =
  same as `minutesPerDay` (which then means Monday–Friday).
- Well-known ids the **Basic** parent screen edits: limit `total` and
  downtime `bedtime`. Everything else is Advanced.
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
human sentence shown in the app: revoked "Mia turned off Screen Time on
iPad"; removed "Fam ETC may have been removed from Mia's iPad"; stale "Mia's
iPad hasn't checked in since Sat 9:12 PM. It may be off or offline."
(family timezone); restored "Screen Time is back on for Mia's iPad";
selection_changed "Mia changed the apps in Games (1 app → 2 apps)".

### States (client-derived, see SCREEN-TIME-UX.md §1)
**Not set up** = policy off and no devices; **Off** = policy off with enrolled
devices (the parent turned it off — rules and deal are kept, no alerts, the
kid sees a quiet "Screen Time is off right now" card); then revoked, removed,
stale, waiting for setup, finish setup, paused, downtime, limit reached,
pending, on — first match wins.

### Endpoints
Parent (`requireAuth, requireParent, requireFamily`; kid must belong to family):
- `GET  /api/screen-time` → `{ kids: [{ kidId, policy, devices: [], alerts: [] }] }` (every kid in the family, default policy `{version:0, enabled:false, limits:[], downtime:[], pauseUntil:null}`).
- `PUT  /api/screen-time/kids/:kidId/policy` body `{ enabled, limits, downtime }` → kid state. Limit without `id` gets one; a limit body **without** a `selection` key keeps the stored selection, `selection: null` clears it. Bumps `version`, pings the kid's devices (`screen_time_sync`). `enabled` true → false / false → true run the turn-off / turn-on lifecycle above. "Turn off" sends the current lists with `enabled: false`; both switches off + Save sends `{ enabled: false, limits: [], downtime: [] }` ("remove the rules").
- `POST /api/screen-time/kids/:kidId/pause` body `{ minutes }` (0 = resume, else 15–1440) → kid state. Bumps version, pings.
- `POST /api/screen-time/kids/:kidId/alerts/ack` → kid state (acks all).
- `POST /api/screen-time/kids/:kidId/alerts/:alertId/ack` → kid state (acks that one alert; idempotent). 404 when the id is not one of this kid's alerts.
- `DELETE /api/screen-time/kids/:kidId/devices/:deviceId` → kid state (acks that device's alerts).
- `POST /api/screen-time/kids/:kidId/devices/:deviceId/move` body `{ toKidId }` → kid state (the source kid's, like forget). Moves an enrolled device to another kid of the same family — its secret keeps working, it just starts pulling/reporting that kid's policy (fresh `appliedVersion: 0`). Pings the destination kid's devices.

Kid session (`requireAuth, requireFamily`, role kid):
- `GET  /api/screen-time/mine` → `{ policy }` (parent selection projection, no device).
- `POST /api/screen-time/device/enroll` body `{ label, mode, authStatus, pushToken?, installKey? }` → `{ deviceId, deviceSecret, policy, kidId, kidName }` (device projection plus the device's current kid). Only `mode` ∈ family|cooperative, only when `authStatus == approved`. `installKey` (optional, 16–128 chars `[A-Za-z0-9_-]`, kept in the Keychain so it survives a reinstall): enrolling again with the same key re-enrolls that device record in place (same id, fresh secret, re-picks apps) instead of leaving a "not checking in" ghost; if the key now belongs to a different kid of the family, the old record moves to the current kid.

Device (header `Authorization: FamDevice <deviceSecret>`, no session — works from the monitor extension and in the background after cookies expire):
- `POST /api/screen-time/device/heartbeat` body `{ authStatus, mode, appliedVersion, pushToken?, source }` (`source` ∈ app|foreground|observer|background|push|monitor) → `{ policy, kidId, kidName }` (device projection plus the device's current kid). Drives the revoked/restored/stale-recovery transitions above. A `notDetermined` authStatus is never treated as tamper by itself: from `source == monitor` it never counts at all; from any other source it only revokes once it has persisted for 10 minutes (`AUTH_UNKNOWN_CONFIRM_MS`) — iOS can report it for a moment right after launch or a background wake before the real status loads.
- `PUT  /api/screen-time/device/limits/:limitId/selection` body `{ selection, summary }` → `{ policy, kidId, kidName }`. Stores a per-device selection and raises `selection_changed` when the summary changed.
Unknown/forgotten secret → 401.

### Pushes (`lib/fam-notifications.js`)
- Parent alert: `{ aps: { alert: {title, body}, sound: "default", "thread-id": "screen-time-<familyId>" }, famType: "screen_time_alert", familyId, kidId }` + web push. Titles: revoked "⚠️ Screen Time turned off", removed "⚠️ Fam ETC may have been removed", stale "Screen Time isn't checking in", selection_changed "Screen Time apps changed", restored "✅ Screen Time is back on".
- Device ping: background push `{ aps: { "content-available": 1 }, famType: "screen_time_sync" | "screen_time_ping" }`, `pushType: "background"`, priority 5, sent to the device's `pushToken` directly.

### Monitor
`screenTime.startMonitor()` from server.js (unref'd 10-minute interval): stale sweep + pings, skipping kids whose policy is off. Clock and sender injectable for tests.

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
- `ScreenTimeEnforcer.swift`: App Group storage (policy, device credentials, last monitor fire), selection encode/decode, `apply(policy)` (named `ManagedSettingsStore`s `downtime`, `pause`, `limit.<id>`; `DeviceActivityCenter` activities `day.1…7` (one weekly-repeating 00:00–23:59 activity per weekday, each carrying events `limit.<id>` with that day's minutes — weekday vs weekend thresholds), `downtime.<id>`, `heartbeat.0…3`, `pause`), and a tiny `heartbeat(source:)` HTTP client usable from the extension.
- Pure schedule helpers (unit-tested): time parsing, weekday check, pause interval (≥ 15 min).

### Monitor extension
`intervalDidStart`: `day.*` → clear all `limit.*` stores; `downtime.<id>` → shield all categories/web if today is listed; `heartbeat.*` → heartbeat(source: monitor). `intervalDidEnd`: `downtime.<id>`/`pause` → clear that store. `eventDidReachThreshold(limit.<id>)` → shield that limit's selection; for `limit.total` shield **all** app categories + web (`.all()`), not just the selection. Every callback records `lastMonitorAt`. Stays well under the ~6 MB memory cap: no SwiftUI, no big decoders.

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

**Simple first — non-technical parents are the key audience.** Intended flow:
parent opens Screen Time for Mia → two switches, **Bedtime** (no phone from
9:00 PM to 7:00 AM) and **Daily screen time** (2 h on school days, 3 h on
weekends) → Save → "Now set it up on Mia's phone" with 3 plain steps → on
Mia's phone, Fam ETC → Set up → approve → tap "All Apps & Categories" → done.
No jargon on the Basic screen (no "tokens", "authorization", "cooperative",
"categories"). Everything else (per-app limits, extra downtime windows,
choosing apps on the parent phone, device list, check-in details, forgetting
devices, how-protection-works) lives under a collapsed **Advanced** section.
Pause now and alerts stay visible on Basic because parents need them.

The whole-device `total` limit needs an "everything" selection, which Apple
only lets a person pick: the kid-device setup ends with the picker and the
instruction "Tap **All Apps & Categories**, then Done" (uploaded as that
device's selection for `total`). Until that's done the kid card and the parent
status say "Finish setup on Mia's phone".

- Parent Today: `ScreenTimeSummaryCard` (per-kid status chip) → `ScreenTimeParentSheet`. **Basic**: kid switcher; one-line status in plain words ("On for Mia's iPhone", "Mia turned it off — 4:12 PM", "Finish setup on Mia's phone"); Bedtime switch + two times; Daily screen time switch + School days / Weekends steppers (15-min steps, presets); Pause now (1 hour / Until tomorrow / Resume); unacknowledged alerts; setup steps when no device. **Advanced** (collapsed): per-app limits (with weekend minutes + Choose apps), extra downtime windows with weekdays, devices with mode badge/last check-in/applied/forget, alert history, "How protection works" explaining both modes.
- App-wide parent banner `ScreenTimeAlertBanner` for unacknowledged alerts (next to `KidApprovalBanner`); `screen_time_alert` push deep-links to the sheet for that kid. Shows only the newest bannerable alert (unacked revoked/removed/stale/selection_changed, < 7 days, kid's policy on) with a ✕ that acks that alert and a Review that always opens the controls (SCREEN-TIME-UX.md §2).
- Presentation (SCREEN-TIME-UX.md §3, by `horizontalSizeClass`): kid deal flow is a `fullScreenCover` on every size; parent controls are a large sheet on compact width and a `fullScreenCover` with a kid sidebar (`NavigationSplitView`) on regular width; other Screen Time sheets use `.large` detents on compact. The Off state has an explicit "Turn off Screen Time" row + confirmation and a "Turn Screen Time back on" button.
- Kid Today: `ScreenTimeKidCard` → `ScreenTimeKidSetupSheet` (explain → Family Sharing first → fallback to without Family Sharing → enroll) and, once enrolled, the rules list, per-limit "Choose apps with a parent", and the transparency line "Turning this off tells your parents."

## Our Screen Time Deal (kid setup = a social contract)

Owner direction 2026-09-27: kid setup must be fun and a **social contract the
kid and parent make together**, not a permissions chore. Intended flow, on the
kid's device with a parent beside them: kid Today card "Make our Screen Time
deal 🤝" → **The plan** (bedtime + daily time as big friendly cards) →
**Kid's promises** (pick 1–3 from fun chips, or write one) → **Parent's
promises** (hand the phone over; pick 1–3) → **Turn it on** (Apple approval,
Family Sharing first, then without; "All Apps & Categories") → **Sign it**
(kid picks an emoji stamp and holds the thumb button; parent types their name
and taps "I'm in") → confetti "Deal! 🎉". The fairness line is part of the
deal, not a warning: "If Screen Time gets switched off, the app tells
<parent names>. No sneaky switch-offs — that's the deal."

After signing, the kid card shows the signed deal (rules, both sides'
promises, stamps, date). If the parent later changes bedtime or daily time,
the card says "Your rules changed — renew your deal together" (compare the
deal's `rules` snapshot with the current policy; pause never triggers this).

### Agreement JSON
```json
{ "kidPromises": ["Phone charges outside my room at night"],
  "parentPromises": ["We'll give a 10-minute heads-up before bedtime"],
  "kidStamp": "🦊", "parentSigner": "Kate",
  "rules": { "bedStart": "21:00", "bedEnd": "07:00", "school": 120, "weekend": 180 },
  "signedAt": "ISO", "deviceId": "std_x" }
```
`rules` fields are null when that rule is off. Promises: 0–5 each, ≤ 80
chars; stamp ≤ 8 chars (an emoji); signer 1–40 chars.

### Endpoints
- `PUT /api/screen-time/device/agreement` (FamDevice) body = agreement minus
  `signedAt`/`deviceId` → `{ agreement }`. Server stamps `signedAt`, `deviceId`;
  stores ONE current agreement per kid (replaces the previous).
- Heartbeat, enroll and `/mine` responses add `agreement` (or null) next to
  `policy`. Parent kid state adds `agreement`.
- On a new signature, parents get a positive push (not an alert-list entry):
  "🤝 Mia signed your Screen Time deal".

## Parent promo + welcome (owner direction 2026-09-27)

A Screen Time promo sits at the **very top** of parent Today (above the
Family Rings hero) while no kid has ever set Screen Time up (every kid's
`policy.version == 0`; turning Screen Time off never brings it back). It is compact, friendly and dismissible ("Not now" hides it for 7
days on this device). Tapping it opens a **full-screen welcome**
(`fullScreenCover`) that explains the product in 3 short panels — what it does
(bedtime + daily time, simple), how it works with or without Family Sharing
(honest: without it, a kid could switch it off and you'll be told), and how
setup goes (you pick the rules here → make the deal together on your kid's
phone) — ending in "Set up for <kid>" (one button per kid; opens
`ScreenTimeParentSheet(initialKidId:)`). Once any kid's policy has been saved
(`version > 0`) the promo is gone for good; the regular `ScreenTimeSummaryCard`
remains.

## More time for fams (owner direction 2026-09-27)

Intended flow: kid taps "Ask for more time" (kid Screen Time card / Our deal) →
picks 15, 30, 45 or 60 minutes at **1 fam per 3 minutes** (5/10/15/20 fams),
optional short note → parents get a push "Mia asks for 15 more minutes (5
fams)" → a parent approves or declines in the parent sheet or the app-wide
banner → on approve the fams are **deducted** and today's `total` allowance
grows by those minutes on the kid's devices; the kid gets a push either way.
Only for the `total` limit; bedtime/downtime are never extended. One pending
request per kid; a request expires at the end of its `date`.

Server:
- `lib/fams.js` gains `spend(familyId, kidId, { event, amount, title })` —
  idempotent by `event`, refuses when balance < amount, records a negative
  transaction (category `screen_time`); `summary().totalEarned` counts only
  positive transactions.
- Kid session: `POST /api/screen-time/requests` `{ minutes, date, note? }`
  (minutes ∈ 15/30/45/60; date = kid device's local YYYY-MM-DD; note ≤ 80) →
  `{ request }`; 409 if one is pending or balance is too low.
  `GET /api/screen-time/mine` + heartbeat add `requests` (the kid's last 10).
- Parent: `POST /api/screen-time/kids/:kidId/requests/:id/approve|decline`
  → kid state. Approve spends `minutes/3` fams (409 + no grant if the balance
  is now too low), adds `minutes` to `policy.bonus` for that date
  (`bonus: { date, minutes }`, replaced when the date changes), bumps version,
  pings devices. Kid state adds `requests`.
- Request JSON: `{ id, kidId, minutes, fams, date, note, status:
  pending|approved|declined|expired, createdAt, decidedAt, decidedBy }`.
- Pushes: parents `famType: "screen_time_request"` (+ kidId); kid
  `famType: "screen_time_request_result"`.

iOS enforcement: today's threshold for `total` = weekday/weekend minutes +
`bonus.minutes` when `bonus.date` == device-local today; applying a new bonus
re-registers today's `day.N` activity (events use `includesPastActivity`) and
clears the `limit.total` shield immediately.

## Usage details (owner direction 2026-09-27)

Apple keeps detailed Screen Time usage on the device that produced it (the
`DeviceActivityReport` extension can render but not transmit; the EU-only
`FamilyActivityData` path is not used). So there are three surfaces:

1. **Kid, on their own iPhone/iPad Today** — `ScreenTimeUsageCard` hosts a
   `DeviceActivityReport` (report extension `FamETCUsageReport`, bundle
   `com.fametc.app.usage-report`, extension point
   `com.apple.deviceactivityui.report-extension`, family-controls + App Group
   entitlements). Scene `kidToday`: today's total, top apps (Apple labels),
   time by category, vs today's allowance when a daily limit exists. Shown to
   enrolled kid devices only. Not a Home Screen widget (Apple only renders the
   report inside the app).
2. **Parent, native, Family Sharing only** — the parent sheet shows Apple's
   report for children (`users: .children`) in a "Detailed usage" section,
   visible when any of the family's devices is in `family` mode, with an empty
   state explaining it needs Family Sharing.
3. **Parent, web child page (and data for native)** — coarse totals we own:
   - The kid device registers usage milestone events `usage.<m>` every 15
     minutes (15…960) on each `day.N` activity, over an "everything" selection:
     the device's `total` selection when present, else a device-local "usage
     selection" captured in setup (the deal flow now always ends with "Tap
     All Apps & Categories"). The monitor extension records the highest
     milestone for today and heartbeats it. It never records which apps.
   - Heartbeat body adds optional `usage: { date: "YYYY-MM-DD" (device-local),
     minutes: 0–1440 multiple of 15, limitReachedAt: ISO | null }`.
   - Server stores `entry.usage[date][deviceId] = { minutes, limitReachedAt,
     updatedAt }` — minutes only ever increase within a date, the first
     limitReachedAt wins, dates older than 35 days are pruned.
   - `GET /api/screen-time/kids/:kidId/usage?days=7` (parent only, 1–30 days)
     → `{ kidId, days: [{ date, minutes (sum over devices, null when no
     device reported), devices: [{ deviceId, label, minutes, limitReachedAt }],
     limitMinutes (today's allowance from the current policy for that
     weekday incl. that date's bonus; null without a daily limit),
     extraMinutes (approved requests for that date) }], requests (last 30
     days) }`, newest date first, every date in the range present.
   - Web child page gets a "Screen time" section: today's "about 1 h 45 min of
     2 h", a 7-day bar chart against the allowance, when the limit was hit,
     extra time bought with fams, and the latest alerts; honest note "Counted
     in 15-minute steps. App-by-app details stay on Mia's device."
   - App Review note: coarse totals are shown only to the child's parents.

## Distribution gate (owner action)
The targets declare the `family-controls` entitlement. App
Store/TestFlight distribution needs Apple's **Family Controls (Distribution)**
approval for `com.fametc.app`, `com.fametc.app.screentime-monitor` and
`com.fametc.app.shield-config`, `com.fametc.app.usage-report` — request at
developer.apple.com/contact/request/family-controls-distribution.
This revision's unsigned build does not verify distribution approval or
physical-device authorization. No installed provisioning profiles were available
to establish that gate during the source/build-only check.

## Deferred (not built)
Shared allowance across a kid's iPhone+iPad (each device enforces its own
minutes), "ask for more time" shield action and Android enforcement. Coarse
usage reporting, the desktop read-only summary, and parent-approved essential
apps during downtime are implemented; they are not full cross-device controls.

## Appendix: Family Controls (Distribution) request text

Implementation-grounded draft for owner review before submitting Apple's form at
developer.apple.com/contact/request/family-controls-distribution.

- **App name**: Fam ETC
- **Team ID**: B4F73U5RGR
- **Bundle IDs**: com.fametc.app, com.fametc.app.screentime-monitor,
  com.fametc.app.shield-config, com.fametc.app.usage-report

**How your app uses the Family Controls framework** (description, ~120 words):

> Fam ETC is a family organizer app (school calendars, homework, chat) used by
> parents and their kids. Parents configure per-app and per-category daily
> time limits and downtime schedules for their kids from their own device or
> the family server; the child's device enforces that policy locally using
> FamilyControls, ManagedSettings, and DeviceActivity — shielding the chosen
> apps/categories when a limit is reached or downtime begins. Parent pauses
> add a restriction; resume or policy changes remove the applicable restriction.
> We support both Family
> Sharing child accounts (`.child` authorization) and, for families whose
> kids' devices were never set up in Family Sharing, individual authorization
> (`.individual`) approved directly on the child's device. Coarse daily usage
> totals in 15-minute steps and limit-reached timestamps are sent to the family
> server; app-by-app usage details stay on the device. App selections sync as
> Apple's opaque tokens plus counts. Devices report authorization and rule
> registration health so parents can see confirmed status, permission problems
> or uncertainty without attributing a change to a particular person.

## App Review notes

- Sign in as a parent, add or select a child, open the Screen Time section,
  and create a daily limit (pick an app/category and set minutes) or a
  downtime window — this writes the policy to the server.
- On the child's device, sign in as that kid, open Screen Time setup, and
  complete authorization (Family Sharing child account if available,
  otherwise the without-Family-Sharing / individual path with Face ID or
  passcode) to enroll the device and pull the policy.
- To check permission-loss reporting: on the child's device, go to Settings → Screen
  Time → Apps with Screen Time Access and turn off access for Fam ETC (only
  possible in the without-Family-Sharing / cooperative mode). Within one
  successful device check-in after denied authorization, the parent's account
  receives a neutral permission-loss alert. Push delivery is best-effort. Unknown
  authorization or missing check-ins do not prove revocation or app removal.

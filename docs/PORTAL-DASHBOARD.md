# Fam ETC for Portal+

## Delivery status

This change adds a native Android household dashboard for the larger Meta
Portal+ and the Fam ETC server and parent setup surfaces it needs. The device
generation is not assumed: the app uses its available screen size and supports
Android API 28 and later.

The source handoff is based on `kamatbot/kidsplanner` commit
`3c0554635de7be9013e9538b7080cc997bd0c72f`. It was implemented and reviewed as
source only under the active `code-only-github` workflow. No APK was compiled,
no backend was deployed, and no GitHub branch or workflow was changed.

**Tests and builds were not run. Local Codex should validate the changes before integration.**

## The main screen

The family calendar is the main surface. It shows seven days, beginning today,
with everyone selected by default. Children use their existing profile colours;
shared family appointments remain visible when a child filter is selected.
Touch a day to inspect its agenda. Homework due and planned meals are secondary
panels and can be hidden by a parent.

The Portal view includes shared Fam ETC appointments, ECAs, informational school
dates and the applicable school feed events. It applies one display-specific
rule requested for this device:

- Keep extra-curricular activities, including activities during school hours.
- Hide recognised regular child timetable lessons whose time overlaps
  **08:00–14:00**, interpreted in the display's configured time zone.
- Keep other family events during those hours, all-day calendar dates, and
  lessons outside that interval. A lesson beginning at 14:00 is outside it.

Classification uses the event's source metadata, including the school timetable
feed and supported legacy timetable import markers. It does not guess from an
event title or remove every event between 08:00 and 14:00. Explicit ECA markers
take priority. The underlying Fam ETC calendars are unchanged.

This reads the household data already present in Fam ETC. It does not connect
new Google, Apple or work calendars, expose private chats, or provide calendar
editing from the shared screen. Existing family calendar entries are used;
private calendars must first be connected or copied into the household's normal
calendar through a separately supported Fam ETC flow.

## Project structure

| Area | Source |
| --- | --- |
| Native Android app | `android/portal/` |
| Module registration | `android/settings.gradle.kts` (`include(":portal")`) |
| Pairing and device credentials | `lib/display-auth.js` |
| Household projection and calendar filtering | `lib/display-context.js` |
| Parent and device HTTP routes | `lib/routes/display.js` |
| Parent setup page | `public/displays.html`, `public/js/displays.js`, `public/css/displays.css` |
| Express integration and early cache policy | `server.js` |
| Plan classification | `lib/hub-gate.js` |
| Settings entry | `public/js/settings.js` |
| Account deletion cleanup | `lib/account-deletion.js` |
| Regression source | `tests/display-*.test.js`, `tests/account-deletion.test.js`, Android unit test sources |

`:portal` is a separate application module. It shares the repository's existing
Gradle version catalogue and does not reuse the phone app's Google sign-in,
scanner or WebView flows. Its package is `com.fametc.portal`; debug builds use
`com.fametc.portal.debug`. It currently targets/compiles SDK 35, has `minSdk 28`,
and uses JVM 17, native Compose, OkHttp and Kotlin serialization.

The existing Fam ETC icon is reused. The implementation follows the native
Android approach demonstrated by portal-calendar; no portal-calendar source
was copied into this change.

## Pairing and operation

After the server changes have been validated and released:

1. Open **Fam ETC** on the Portal+.
2. On a phone or computer, sign in as a parent at
   `https://www.fametc.com/displays`. The main app links there from
   **Settings → Connections → Family displays**.
3. Name the display, confirm the household time zone, and choose whether it
   should show homework and meals. The initial time zone is `Asia/Bangkok`.
4. Generate a code and type its eight characters on the Portal.
5. The device retrieves its restricted family snapshot and refreshes while
   the dashboard is in the foreground.

A code lasts ten minutes and works once. Generating a replacement invalidates
that parent's previous pending code. The phone page keeps codes only in page
memory and erases them on expiry, page exit and loss of authorisation. Hiding
a code clears it from the page but does not revoke it; requesting a replacement
invalidates the old code on the server. At most twelve active displays can be
paired to one family.

The parent page can rename a display, change its time zone or panel choices,
and disconnect it. The app also has a local disconnect control. If the Portal
cannot contact the server when disconnected locally, the parent page can
finish revoking the device credential.

An explicit **DEMO** option shows an invented household locally. It works
without live pairing and is clearly labelled. It does not contain or claim to
be the user's family data.

## Display behaviour

- The wide layout prioritises the family calendar. Narrow layouts remain
  usable, including portrait orientation.
- The app reserves a dark 64 dp strip for the Portal system overlay.
- Local preferences include automatic/landscape/portrait orientation, larger
  text, and always-on/scheduled/normal screen modes.
- The keep-screen-on flag applies only while a paired or demo dashboard is
  active in the foreground. Leaving the app releases it.
- Scheduled night hours can cross midnight. Night mode dims the app and
  releases keep-screen-on; interaction temporarily brightens it.
- The app does not replace the Portal launcher, force itself back into the
  foreground, or automatically start an activity after boot. Relaunch after
  reboot and wake behaviour must be checked on the actual Portal firmware.

This is a household display application, not a device-owner kiosk. Stock Portal
sleep and launcher behaviour can still affect it. There are no camera,
microphone, accessibility, usage-access, root or Google Play Services
requirements in this module.

## Data, refresh and offline behaviour

The device calls only the canonical HTTPS origin, `https://www.fametc.com`.
Redirects and cleartext HTTP are disabled. Tokens are not passed in URLs, web
cookies, logs or ordinary preferences.

Successful snapshots normally poll every 60 seconds. Polling is serial and
stops when the activity stops; it resumes immediately on return. Network
failures use bounded backoff, and refresh/network recovery can request an
earlier attempt. Session generations prevent an old request from restoring
data after disconnect.

Public school calendars reuse the existing throttled server-side sync. Calls
are coalesced per family, with cached data returned promptly and a later
dashboard poll picking up updates. The private homework/timetable service
continues to use its existing server scheduler. Generic source notices indicate
pending or delayed school updates; provider errors and capability URLs never
cross the display boundary. A freshly generated dashboard response does not
by itself mean every school provider was fetched at that instant.

The token and minimal cached snapshot are stored together using Android
Keystore AES/GCM in the app's no-backup directory. The cache can remain visible
for up to twelve hours after the last accepted snapshot, with an offline label.
The lease is checked while the app is running, including monotonic-clock and
wall-clock rollback checks. A previously saved view is discarded if its boot
cannot be verified after a restart; the pairing credential is retained. Newly
fetched data can still be cached within the current app process when the system
boot counter is unavailable. A `401` or `403` response
clears both token and snapshot. A corrupt or unavailable encrypted record
returns the device to pairing.

Remote revocation takes effect on the next successful contact with Fam ETC.
An offline device can display its last approved snapshot until its lease
expires. Parent setup explains this delay. Changing a panel preference also
takes effect when the device next connects.

All-day/date-only events stay on their stated calendar dates. Timed instants
are converted to the display time zone. Multi-day dates, exclusive ICS end
dates, recurrence identity and equivalent feed duplicates are handled in the
projection. Only bounded, explicit fields are sent: event title/time/location,
child names and colours, due homework titles, and meal titles. No raw database
records, school credentials, homework notes or recipe details are included.

## API and access boundaries

| Method and route | Authority | Purpose |
| --- | --- | --- |
| `POST /api/displays/pairing` | Signed parent session | Create a short-lived code |
| `GET /api/displays` | Signed parent session | List the family's displays |
| `PATCH /api/displays/:id` | Signed parent session | Update display choices |
| `POST /api/displays/:id/revoke` | Signed parent session | Revoke a device |
| `POST /api/display/pair` | One-time code | Exchange the code for a device token |
| `GET /api/display/context` | Display bearer | Read the restricted dashboard |
| `POST /api/display/disconnect` | Display bearer | Revoke this display |

Mutations require JSON; send `{}` for revoke/disconnect. Parent mutations reject
foreign browser origins. All display API responses, including earlier parser,
rate-limit and plan-gate responses, receive `Cache-Control: no-store`.

Display tokens use the `fdp_` prefix and are hashed server-side. They never
become `req.user`, never set a parent cookie, and are not accepted by the
existing general-purpose authentication middleware. Every device access checks
the family and the approving parent's current membership and plan. Displays
are part of the existing `full` household plan.

The server persists pairing consumption and credential issuance together.
Pairing, settings and revoke operations check the database's durable-write
generation before reporting success. Account deletion removes the deleting
parent's grants and pending codes; deleting the final parent removes the
family's display records as well.

The version 1 response contains `generatedAt`, `today`, `timeZone`,
`pollAfterSeconds`, `cacheMaxAgeSeconds`, `family`, `device`, `notices`, `members`,
seven `days`, `homework` and `meals`. The device identity includes the two panel
visibility flags. Disabled panels are hidden after the next refresh.

## Local integration and validation

The downloadable bundle contains a patch plus replacement copies of changed
files. It is not a standalone checkout. Start with a clean local checkout of
the base commit, or review and adapt the patch if main has advanced. Keep any
existing user work intact. Apply the patch once; do not also copy the same
replacement files over unrelated newer changes.

The following are **suggested commands for local Codex**, not checks performed
in this handoff. Follow the local repository's instructions and install its
normal dependencies if they are not already present.

From the repository root, review/apply the supplied patch:

```bash
git apply --check /path/to/fametc-portal.patch
git apply /path/to/fametc-portal.patch
```

Use the repository-required Node 24 environment, then run the focused backend
checks:

```bash
node --test tests/display-*.test.js tests/account-deletion.test.js tests/screen-time-plan.test.js tests/session-revocation.test.js
```

With JDK 17, Android SDK 35 and the repository's Gradle wrapper available:

```bash
cd android
./gradlew :portal:testDebugUnitTest :portal:assembleDebug
```

The expected debug output is
`android/portal/build/outputs/apk/debug/portal-debug.apk`. Release signing is
intentionally left to the existing local signing process; do not ship a shared
debug signing key or put keystore secrets into this source. Keep a stable
release signing identity for later device updates.

Before releasing the server, check the real parent and device flow locally:

- A parent can create and claim one code; replay and expired codes fail.
- A display bearer cannot access `/api/me`, `/api/family`, chat or parent
  display management. Mixed identities cannot change the paired family.
- A different family cannot edit or revoke this device. Revocation, family
  plan changes and parent removal stop device access.
- Only identified regular school lessons are hidden during 08:00–14:00.
  An ECA and a family appointment at the same time remain visible.
- School cache refresh, provider delays, all-day dates, cross-midnight events,
  recurrence/deduplication and time-zone changes appear correctly.
- The parent page preserves edits, clears codes on access loss and history
  restoration, and hides disabled homework/meal panels after device refresh.

The backend must be released through the repository's normal authorised release
process before production pairing will work. The APK's fixed production origin
does not point to a new local/staging server. Demo mode can be reviewed before
the backend is released.

## Install on the actual Portal+

Meta's current setup instructions list both Portal+ generations, using API
28/29 and a USB-C connection. On the Portal, open **Settings → Debug → ADB
Enabled**, enter the PIN if requested, connect a data-capable USB-C cable, and
accept the computer trust prompt. If those controls are unavailable on this
device, resolve its firmware/setup state before relying on this installation
path; this source change cannot enable a disabled OS facility.

After local validation and APK creation, run from `android/`:

```bash
adb devices
adb shell getprop ro.product.model
adb shell getprop ro.build.version.sdk
adb install -r portal/build/outputs/apk/debug/portal-debug.apk
adb shell am start -n com.fametc.portal.debug/com.fametc.portal.PortalActivity
```

For a release build the package is `com.fametc.portal`. The first build should
be evaluated on the actual Portal+ in landscape, portrait if supported, and
with the larger text option. Check top-system-overlay clearance, long titles,
crowded calendar days, touch selection and the keyboard during pairing.

Device acceptance also needs Wi-Fi loss/recovery, foreground/background
transitions, midnight in Asia/Bangkok, expired offline cache, remote revoke,
night hours crossing midnight, power-cycle recovery, and an update signed with
the same key. These checks remain outstanding.

## References

- [Meta: Set up your Portal device](https://developers.meta.com/vr/documentation/android-apps/portal-setup/)
- [Meta: Create an Android app for Portal](https://developers.meta.com/vr/documentation/android-apps/portal-create-app/)
- [Meta: Portal design requirements](https://developers.meta.com/vr/documentation/android-apps/portal-design-requirements/)
- [portal-calendar reference repository](https://github.com/thefloppytaco/portal-calendar)
- [Fam ETC source repository](https://github.com/kamatbot/kidsplanner)

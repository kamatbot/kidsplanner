# Fam ETC watchOS

The shared watchOS 11 source presents Now, Day, and More, with direct HTTPS reads and mutations, durable local work, and locally scheduled reminders. The visual system is recorded in [DESIGN.md](DESIGN.md).

## App identities and setup

| Target | Bundle identifier | Distribution relationship |
| --- | --- | --- |
| `FamETCWatch` | `com.fametc.watch` | Existing standalone watch app, retained for child setup |
| `FamETCWatchWidget` | `com.fametc.watch.widget` | Standalone app complication |
| `FamETCParentWatch` | `com.fametc.app.watch` | Embedded in the `com.fametc.app` iPhone app |
| `FamETCParentWatchWidget` | `com.fametc.app.watch.widget` | Parent companion complication |

Both watch app targets compile the same `FamETCWatch` and `FamETCWatchShared` sources. The existing child identity is not migrated or renamed. A parent creates an eight-character FamETC watch code; the child enters that code on the watch. An iPhone may assist initial Apple Watch setup, but ongoing FamETC reads/writes use the watch's own connection. Actual Wi-Fi/cellular independence still requires hardware verification.

The parent target additionally offers **Connect with iPhone** while Fam ETC is open on the paired iPhone. `ParentWatchCompanion` verifies the active parent and requests a narrowly scoped, one-time watch pairing code. `WatchCompanion` claims that code directly over HTTPS and checks the returned parent identity. This transport does not copy the parent's web session, cookies, child credentials, or family data. The ordinary FamETC-code route remains available. WatchConnectivity identity updates detect parent account changes; actual paired-device delivery has not yet been verified.

See [project.yml](../project.yml), [WatchPairingView.swift](WatchPairingView.swift), [WatchCompanion.swift](WatchCompanion.swift), and [ParentWatchCompanion.swift](../FamETC/Onboarding/ParentWatchCompanion.swift).

## What comes next

[WatchPlan.swift](WatchPlan.swift) supplies the glance ordering. Active focus is displayed first by the view. Otherwise a timed event already happening or starting within 15 minutes gets first priority; remaining upcoming events, open homework, and urgent actions follow their scheduled/deadline date, with stable identifier tie-breaking and undated work last. Homework-derived actions are omitted when the open homework already represents them. Date-only work uses 17:00 local time. All-day events remain in Day, rather than the Now event candidates.

Day lists today's events in time order. More preserves school work, to-do, settings, and parent-only shopping. Assignment details expose checklist progress and explicit completion. A 20-minute focus block persists locally; expiry acknowledges the focus interval and never marks homework complete. Ending focus also leaves assignment status unchanged.

## Sync, reminders, and recovery

[WatchStore.swift](WatchStore.swift) restores snapshot, focus, and mutation outbox before refreshing. Local mutations persist before a request is attempted and replay in order. Role-scoped context is fetched before the main data sections; partial failure retains usable cached information and exposes an error. Foreground activation and manual refresh are recovery routes. Signed-in settings shows pending changes and the last update instead of presenting local changes as confirmed server writes.

Reminder opt-in is explicit in Now and Settings. [WatchReminderPlan.swift](WatchReminderPlan.swift) produces at most 24 pending local reminders within 48 hours:

- Timed calendar events, including lessons, are scheduled 10 minutes before their start.
- Open homework/actions use their due time, or 17:00 for a date-only deadline; represented homework does not generate a duplicate action reminder.
- Ordinary reminders are omitted during local quiet hours, 21:00–07:00; they are not postponed to morning.
- Ordinary plans require a valid role-scoped profile and a snapshot refreshed less than 48 hours ago.
- An explicitly started focus completion reserves one slot and may fire during quiet hours.

[WatchReminders.swift](WatchReminders.swift) reconciles owned notification requests, removes obsolete requests, and reports scheduling failures. A completed/deleted remote item cannot change a previously scheduled local reminder until the watch syncs it.

[WatchPushRegistration.swift](WatchPushRegistration.swift) registers APNs only with a scoped watch credential and notification authorization. Remote notifications and opportunistic background refresh read without draining offline mutations. The app requests a preferred background refresh around 30 minutes later; watchOS decides whether and when to run it. No background schedule or remote-change arrival guarantee is implied. Foreground refresh remains the reliable user-triggered recovery path.

Disconnect requires successful server revocation, or an already-unauthenticated result, before clearing the local connection. If offline revocation fails, the app reports a retry route and keeps the connection. Confirmation warns about pending changes. Local reset clears saved state, focus, reminders, and the complication snapshot; parent identity changes also invalidate the local connection.

## Complications and provisioning

The widget reads an aggregate snapshot only: counts, last update, and focus timing. It receives no credentials, assignment titles, or checklist text. Both variants use `group.com.fametc.watch`, with separate keys:

- Child: `fametc.watch.complication.snapshot`
- Parent: `fametc.parentwatch.complication.snapshot`

See [WatchComplicationSnapshot.swift](../FamETCWatchShared/WatchComplicationSnapshot.swift). Before TestFlight, register/provision the new parent watch and widget identifiers, APNs capability for the watch app, and app-group membership for the app/widget targets. Verify the corresponding server APNs topic configuration. Source entitlements alone do not establish Apple portal provisioning.

## Verification and release status

The standalone watch test suite passed 32 tests; the subsequent focused store/complication run passed 20 tests, including two added regressions A further signed-device Keychain test verified save, replacement, read, and clear (35 unique tests in total). The iPhone app with its embedded parent watch and widget also builds successfully with simulator signing. Synthetic HTTP checks verified child code claim, own/shared calendar scope, privileged endpoint denial, and revoked credentials.

This is not a release certificate. Simulator UI acceptance is pending, and actual WatchConnectivity, physical-device interaction, cellular operation with the iPhone unavailable, and APNs delivery are unverified. No native upload, TestFlight release, or App Store submission has been performed. Backend release evidence is maintained separately. Follow the native release gate in [CLAUDE.md](../../CLAUDE.md); complete Xcode tests and device checks before TestFlight, and never ship automatically to the App Store.

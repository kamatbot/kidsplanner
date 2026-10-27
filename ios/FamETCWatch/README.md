# Fam ETC watchOS

The shared watchOS 11 source presents Now, Day, and More, with direct HTTPS reads and mutations, durable local work, and locally scheduled reminders. The visual system is recorded in [DESIGN.md](DESIGN.md).

**Family chat is the root screen** (`WatchChatView`, kids' redesign in [BRIEF](../../docs/design/kids-watch/BRIEF.md) screens 1–5): an inline violet "Family" title, an orange to-do capsule (`store.openTodoCount`, opens My list), newest messages at the bottom, big emoji-only messages without a bubble, and two always-visible 44 pt capsules, **Emoji** (quick-reply sheet: 3 × 2 emoji grid, phrases, then the system field for dictation/Scribble, one tap sends) and **Talk** (voice note). Helper (kids' companion) and More (Now/Day/lists/settings/disconnect) sit at the top of the history. Text sends go through the durable outbox (`WatchMutationKind.chatMessage`, server retry key = client message id). While chat is on screen and the wrist is raised, the watch long-polls `GET /api/chat/messages?wait=1`; leaving the screen or dropping the wrist cancels it.

**Voice notes** ([contract](../../docs/VOICE-MESSAGES.md)): `WatchVoiceRecorder` records AAC `.m4a`, mono, 22 050 Hz, ~32 kbps with live level bars and a 30 s ring; tapping send or reaching 30 s sends, × cancels and deletes. `WatchVoiceOutbox` moves the file into a protected Application Support folder and saves its queue (read back) before any request: upload (`POST /api/chat/attachments`, multipart `audio/mp4` + `durationMs` + `roomId=family`), keep the returned descriptor, then `POST /api/chat/messages` with `media` and the queued id as `clientMessageId`, so an offline retry claims the same attachment. A pending bubble shows until confirmed; a permanent rejection drops the note with a visible error, and an identity reset deletes queued notes and cached audio. It is a separate queue from check-offs so a slow upload never blocks them. Tapping a voice bubble opens the play screen: bearer-authenticated download to Caches, `AVAudioPlayer`, progress and `0:03 / 0:06`, a client-local unplayed dot, a 👍 ❤️ 😂 react row (`POST /api/chat/messages/:id/reactions`; falls back to sending the emoji as a reply) and Talk back. Watch tokens may use only `GET`/`POST /api/chat/messages`, audio `POST /api/chat/attachments`, `GET /api/chat/attachments/:id` and reactions; trips, buzz, flag and delete remain unavailable.

**Notifications:** kids' standalone watches receive their own chat alert (`FAM_CHAT`) with 👍 🏃 ❤️ quick replies (sent in the background through the outbox), **Talk** (opens the app straight into recording) and an inline Reply; parent watches rely on the mirrored iPhone alert. `fametc-watch://talk` and `fametc-watch://chat` (`WatchChatRoute`) are the complication deep links.

## Child AI companion

The sparkle button in a child's family chat opens `WatchCompanionChatView`. It reads the child's private companion profile and thread directly over HTTPS using the Watch's scoped bearer, without an iPhone relay. The child can chat using the system text input, change the name, mascot, colour and personality, and opt out of companion reminders. A parent enables access and sets the age group on iPhone, iPad or web. Parent Watch credentials cannot enter a child's companion or change its policy.

Private chat is online-only and remains outside the durable family-chat outbox. Unconfirmed sends keep the same message ID for retry; leaving this screen discards its ephemeral state. Identity changes hide and clear the private transcript and draft. The raised-wrist screen long-polls for screened replies; backgrounding, navigation and wrist drop cancel its work. Existing reminder cards support snooze/dismiss and opening My Next; goal navigation asks the child to use iPhone or iPad because Watch has no goal-detail destination.

Companion notifications use the standalone Watch APNs topic and open the private companion. They carry generic lock-screen copy and omit the family-chat inline-reply category. Even an older payload with that category cannot send a private reply into family chat. Companion quiet hours and daily limits are enforced by the server and are separate from local planner reminders below. See [the companion contract](../../docs/HERMES-KID-COMPANIONS.md) for content review, privacy boundaries and provider limitations.

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

Reminder opt-in is explicit in My list, Now and Settings. [WatchReminderPlan.swift](WatchReminderPlan.swift) produces at most 24 pending local requests within 48 hours (watchOS's per-app limit), soonest first:

- Timed calendar events, including lessons, are scheduled 10 minutes before their start.
- Open homework/actions use their due time, or 17:00 for a date-only deadline; represented homework does not generate a duplicate action reminder. Homework (and homework-derived actions) are **homework** reminders; other family actions are **chore** reminders.
- Ordinary reminders are omitted during local quiet hours, 21:00–07:00; they are not postponed to morning.
- Ordinary plans require a valid role-scoped profile and a snapshot refreshed less than 48 hours ago.
- An explicitly started focus completion reserves one slot and may fire during quiet hours.

**Strong buzz** ([BRIEF](../../docs/design/kids-watch/BRIEF.md)): homework and chore reminders are `timeSensitive` (entitlement `com.apple.developer.usernotifications.time-sensitive`) and use the `FAM_REMINDER_HOMEWORK`/`FAM_REMINDER_CHORE` categories with Start/Done and Snooze actions (`…_FINAL` variants without Snooze). Each schedules five re-alerts two minutes apart (`<id>_f1`…`_f5`); re-alerts count against the 24-request budget and are dropped inside quiet hours. Start, Done or Snooze — in the notification or the app — acknowledges the reminder and cancels its re-alerts. Snooze moves the series 5 minutes later, at most twice per reminder; the local `fam_watch_alarm_ledger` (UserDefaults) records acknowledgements and snoozes per due time, so a moved deadline starts fresh. Dismissing the alert is not an acknowledgement. Ignored reminders never notify a parent.

[WatchAlarmCenter.swift](WatchAlarmCenter.swift) presents the full-screen alarm ([WatchAlarmView.swift](WatchAlarmView.swift), screens 6/7) when a reminder arrives in the foreground, is tapped, or is due while the app is in front (a 15 s check), and repeats a `.notification` + `.retry` haptic every ~4 s until a button is tapped. The soonest pending first buzz is also armed as a `WKExtendedRuntimeSession` smart alarm (`WKBackgroundModes: alarm`); at fire time the app calls `notifyUser(hapticType:repeatHandler:)` until the child responds. Smart alarms can only be scheduled while the app is in front, so each activation re-arms. Hooks into the shared notification delegate (`additionalCategories`, `additionalResponseHandler`, `additionalPresentationHandler`) are installed in `FamETCWatchApp.init`.

**My list** ([WatchMyListView.swift](WatchMyListView.swift), screen 8) is pushed from the chat header's to-do capsule (`WatchStore.openTodoCount` = open homework due today or earlier + open actions due today/earlier or undated + pending Fams chores). Kid profiles also load Fams chores from `GET /api/fams` (cached in the snapshot; parent tokens never ask) and submit them with `POST /api/fams/chores/:id/submit` through the durable outbox (`choreSubmit`; 4xx rejections are dropped so they cannot block later work). Completing a row shows the Done screen (screen 9) with progress, "+N Fams when a parent OKs" and the next item. Now/Day/More and Settings stay reachable below the list.

[WatchReminders.swift](WatchReminders.swift) reconciles owned notification requests, removes obsolete requests, and reports scheduling failures. A completed/deleted remote item cannot change a previously scheduled local reminder until the watch syncs it.

[WatchPushRegistration.swift](WatchPushRegistration.swift) registers APNs only with a scoped watch credential and notification authorization. Remote notifications and opportunistic background refresh read without draining offline mutations. The app requests a preferred background refresh around 30 minutes later; watchOS decides whether and when to run it. No background schedule or remote-change arrival guarantee is implied. Foreground refresh remains the reliable user-triggered recovery path.

Disconnect requires successful server revocation, or an already-unauthenticated result, before clearing the local connection. If offline revocation fails, the app reports a retry route and keeps the connection. Confirmation warns about pending changes. Local reset clears saved state, focus, reminders, and the complication snapshot; parent identity changes also invalidate the local connection.

## Complications and provisioning

The widget reads an aggregate snapshot only: counts, last update, focus timing, today's My list progress and the next to-do's category (homework/chore) and time. It receives no credentials, assignment titles, or checklist text, so the rectangular "next to-do" shows "Homework next · in 8 min" with a progress ring rather than a title. Circular Chat and Talk shortcuts open `fametc-watch://chat` / `fametc-watch://talk` (scheme registered in Info.plist); chat has no unread badge yet. Both variants use `group.com.fametc.watch`, with separate keys:

- Child: `fametc.watch.complication.snapshot`
- Parent: `fametc.parentwatch.complication.snapshot`

See [WatchComplicationSnapshot.swift](../FamETCWatchShared/WatchComplicationSnapshot.swift). Before TestFlight, register/provision the new parent watch and widget identifiers, APNs capability for the watch app, and app-group membership for the app/widget targets. Verify the corresponding server APNs topic configuration. Source entitlements alone do not establish Apple portal provisioning.

## Verification and release status

The standalone watch test suite passed 32 tests; the subsequent focused store/complication run passed 20 tests, including two added regressions. A further signed-device Keychain test verified save, replacement, read, and clear (35 unique tests in total). The iPhone app with its embedded parent watch and widget also builds successfully with simulator signing. Synthetic HTTP checks verified child code claim, own/shared calendar scope, privileged endpoint denial, and revoked credentials.

This is not a release certificate. Simulator UI acceptance is pending, and actual WatchConnectivity, physical-device interaction, cellular operation with the iPhone unavailable, and APNs delivery are unverified. No native upload, TestFlight release, or App Store submission has been performed. Backend release evidence is maintained separately. Follow the native release gate in [CLAUDE.md](../../CLAUDE.md); complete Xcode tests and device checks before TestFlight, and never ship automatically to the App Store.

## Student support pilot (source implementation)

Child-only My Next links in Now, Day and More read the standalone HTTPS student-support API. Pack shows source coverage and phase plus explicit needed/packed/morning/at-school/missing states. Routines keep steps, done, skipped, handoff, snooze and previewed parent help separate. Homework support saves a next step, work-finished state and explicit self-reported hand-in without completing canonical homework or granting rewards.

Support commands live in the same protected atomic state file as the existing cache, in a separate identity-bound queue. The queue is saved and read back before sending. Offline failures keep command IDs and revisions across restart; conflicts stop replay and expose review plus confirmed discard/reload. Role/account/child changes and revocation clear support with the existing auth epoch. Pending support changes are included in Settings and disconnect warnings. Changes remain visibly pending until confirmed; lists project persisted intents over acknowledged server state, preserving the canonical revision. A failed local save does not show an optimistic check or send the command. Discard is unavailable while a request is in flight.

The support homework screen offers no timer or 5/10/15/20 minutes; Now permits pause/resume/end. Pause survives restart and cancels the completion reminder. Timer expiry never finishes homework. Support cues require a separate explicit toggle and notification permission, use generic copy, school-timezone quiet hours and a 48-hour freshness gate, and bundle homework/packing/routine/morning checks. Enabled support suppresses ordinary homework prompts. Missing/stale packing coverage does not schedule packing cues. A remotely changed task can retain an old local cue until refresh; Schooltime is not bypassed.

Focused source tests cover durable replay, identity mismatch, revision conflict, reset, pause recovery and reminder privacy/quiet/stale gates. Simulator execution and physical Family Setup acceptance must be recorded separately; this source work does not establish hardware or release readiness.

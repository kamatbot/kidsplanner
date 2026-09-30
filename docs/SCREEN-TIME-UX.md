# Screen Time — UX spec (states, alerts, presentation, enforcement)

## Parent simplicity / truthful alerts — 2026-09-30 owner decisions

This section supersedes earlier conflicting wording and first-run flow details.

- The family agreement stays **required**. Simplify the screens around it;
  retain at least one child promise, one parent promise and both confirmations.
  Recovery may reuse an existing agreement, but may not bypass a missing one.
- Replace the introductory tour with a single setup entry. Parent controls
  prioritize bedtime, daily allowance and saving. Child-device handoff should
  be explicit and resumable, without unsupported setup-time promises or claims
  that the app automatically determines Apple-account setup.
- Show one evidence-based status and next action per device. Technical
  registration counts and troubleshooting belong under Details. Essential-app
  proposals appear when relevant; advanced controls remain available.
- Unknown authorization is never evidence of revoked access. A failed push
  token is never evidence that an app was deleted. Permission loss does not
  establish who caused it. All copy must remain neutral, including old alerts.
- Restored authorization is not restored protection. Do not send a protection
  success notification, or render a green On badge, while current registration
  health is missing, partial, failed or awaiting the latest rules.
- Send one neutral reminder after 24 hours of continuous uncertainty/offline
  status, not repeated reminders on every sweep or after dismissal. Confirmed
  recovery or the parent turning the feature off ends that episode. Delivery
  is best-effort; no "right away" promise. Keep uncertainty visible in-app.
- Approval says **Approve apps we reviewed**, with the exact child-device
  review instruction. Counts are not app identities; pending proposals never
  grant access.

Owner requested source/build-only verification. No simulator/device execution
or visual validation is authorized for this revision. Readiness must therefore
distinguish passing code/build checks from still-unverified physical enforcement.

## Essentials UX addendum — 2026-09-30

These refinements take precedence over the original state table below:

- Parent controls expose a per-device setup/health row and **Check protection**.
  A sent check says awaiting device, not protected. Legacy, stale, partial,
  failed and missing-selection states explain the next action. A confirmation
  must match the current policy and have fresh device-reported health. A manual
  pause is shown as requested until each device confirms the current rules.
- Show approximate remaining minutes **on this device**, with last-report
  time and the 15-minute reporting granularity. Missing/stale reports are not
  zero usage. Multi-device totals are usage totals only, not a shared budget.
  Next bedtime/end-time information uses the device's local calendar/timezone;
  overlapping downtime windows must not promise access between restrictions.
- Children can propose essential apps from their own device. The picker accepts
  individual apps, not categories/websites. Waiting for approval survives a
  refresh; a proposal never grants access. Parents review counts and the child's
  optional note, verify actual apps together on the child's device, then approve
  or decline that exact proposal. Existing approval can be removed. Explain
  beside these controls: exceptions apply during bedtime/quiet time only;
  daily limits and a parent pause still apply.
- Keep these additions within existing native Screen Time controls/rules/usage
  surfaces, using Family Rings tokens, system controls, accessible labels and
  wrapping text. No new top-level navigation or web control surface is added.
- Sign-out/account changes clear account-specific presentation and pending
  asynchronous results without removing the device's enforced restrictions.

Status: decided 2026-09-27 after the owner's real-device test ("turned off
Screen Time — seems to be firing wrongly", "permanent modal on top … no way to
dismiss it", kid and parent flows in "a small modal" on iPad). This spec is
implemented directly; where it disagrees with docs/SCREEN-TIME-PLAN.md, this
file wins and the plan is updated by WP2. Design follows DESIGN.md (Family
Rings): violet `action` for primary, `frDanger` only for real tamper signals,
24 pt cards (20 pt on phone), Geist, tabular numerals, no confetti outside the
deal ceremony, Reduce Motion honoured.

Root causes confirmed in code (fixed by the work packages at the end):

| # | Symptom | Where |
|---|---|---|
| 1 | Shields fire after the parent turned Screen Time off | `ScreenTimeEnforcer.policyRequest` stores the returned policy but never clears shields (`ScreenTimeEnforcer.swift:466-476`); `DeviceActivityMonitorExtension` shields on `pause`/`downtime.*`/`limit.*` callbacks with no `enabled`/window/pause/today check (`DeviceActivityMonitorExtension.swift:16-19, 36-46`); `shieldLimit`/`downtimeDidStart` check only that the rule exists (`ScreenTimeEnforcer.swift:230-244, 266-272`). A force-quit app never receives the silent `screen_time_sync`, so the old schedules keep running until the kid opens Fam ETC. |
| 2 | `limit.*` threshold events trusted blindly | `eventDidReachThreshold` shields on any `limit.<id>` event, for any activity, at any time — including the burst DeviceActivity emits right after `startMonitoring(... includesPastActivity: true)` (`DeviceActivityMonitorExtension.swift:40-46`). |
| 3 | False "stale" alarm after turning off | `apply(disabled)` stops every activity incl. `heartbeat.0…3` (`ScreenTimeEnforcer.swift:284-290`); 24 h later `sweep` raises `stale` ("… or Screen Time was turned off") regardless of `policy.enabled` (`lib/screen-time.js:748-753`). `heartbeat` raises `revoked` and `pingDevice` raises `removed` regardless of `policy.enabled` too (`lib/screen-time.js:473-477, 709-717`). |
| 4 | Undismissable banner | `ScreenTimeAlertBanner` (`ScreenTimeParentViews.swift:260-368`) sits in `RootView`'s top `safeAreaInset` on every tab (`RootView.swift:137-144`) with no dismiss; the only acks are "Got it" deep inside the sheet (`:599`) and "Acknowledge all" under Advanced (`:1191`). "Review" silently does nothing when `openScreenTime`'s guard fails (`RootView.swift:73-78`). Alerts never expire and disabling Screen Time acks nothing (`lib/screen-time.js:345-358`). |
| 5 | Promo comes back when Screen Time is turned off | `ScreenTimePromoCard.eligible` = "no kid has an enabled policy" (`ScreenTimeWelcome.swift:22-25`), so the big top-of-Today promo reappears for a family that deliberately turned it off. |
| 6 | Small iPad modals | Kid deal/rules/more-time and parent controls are all plain `.sheet` (`ScreenTimeKidViews.swift:132-134`, `RootView.swift:124`, `ScreenTimeParentViews.swift:222`, `ScreenTimeWelcome.swift:40`) → iPad form sheet. |
| 7 | "Off" has no first-class state | Parent chip maps `!enabled` to "Not set up / Set up" even with enrolled devices (`ScreenTimeParentViews.swift:123`); the only way to turn off is both switches off + Save, which also deletes the rules (`:1301-1306`). |

## 1. States

One state per kid, derived on the client from the server's `ScreenTimeKidState`
(`policy`, `devices`, `alerts`, `agreement`, today's `usage`). Precedence is
top to bottom: the first matching row wins for the chip and status line.

| State | Condition | Parent chip (Today card) | Parent status line (sheet) | Kid Today card (iPhone + iPad) |
|---|---|---|---|---|
| **Not set up** | `!policy.enabled && devices.isEmpty` | "Set up" (ink2 on card2) | "Screen Time is off for Mia. Turn on a switch below and tap Save." | Nothing (card hidden). |
| **Off** (parent turned it off) | `!policy.enabled && !devices.isEmpty` | "Off" (ink2 on card2) | "Off. Bedtime 9:00 PM–7:00 AM and 2 h a day are saved." + **Turn Screen Time back on** button. Sub-line: "Off on Mia's iPad" or "Mia's iPad hasn't picked this up yet" while `appliedVersion < version`. | Quiet one-line card: "Screen Time is off right now — your grown-ups turned it off. Your deal is saved." No button. Usage card ("My screen time today") stays. |
| **Kid turned it off** (revoked) | enabled, any device `state == revoked` | "Turned off · 4:12 PM" (danger) | "Mia turned it off — 4:12 PM" (danger) + the open alert row + **Got it**. | "Screen Time is off — let's turn it back on" + **Turn it back on** (existing). |
| **Removed** | enabled, any device `state == removed` | "May be removed" (danger) | "Fam ETC may have been removed from Mia's iPad" + Got it. | n/a (device is gone). |
| **Not checking in** (stale) | enabled, any device `state == stale` | "Not checking in" (fams ink) | "Mia's iPad hasn't checked in since Sat 9:12 PM. It may be off or offline." (no "turned off" wording) + Got it. | Nothing special; shields keep working locally. |
| **Setting up** (waiting) | enabled, `devices.isEmpty` | "Set up on their phone" (fams) | "Saved. Now set it up on Mia's phone." + 3 steps. | "Make our Screen Time deal 🤝" / "Turn on Screen Time on this iPad" (existing). |
| **Finish setup** | enabled, `needsFinishSetup` | "Finish setup on their phone" (fams) | existing copy | "Finish setup with your grown-up" (existing). |
| **Paused** | enabled, `pauseUntil > now` | "Paused until 8:30 PM" (you-ink) | "Paused until 8:30 PM" + Resume. | Deal card line "Paused by a grown-up until 8:30 PM" (existing). Shield subtitle "Paused by a parent". |
| **Downtime** (device-local) | enabled, now inside a downtime window (computed from policy on both sides) | "On" chip; status sub-line "Bedtime now" | same | Deal card line "Bedtime now — back at 7:00 AM". Shield subtitle "Downtime". |
| **Limit reached** (device-local) | enabled, today's usage `limitReachedAt != nil` | "On" chip; sub-line "Daily time used up at 4:12 PM" | same, plus "Today: about 2 h of 2 h" | Deal card line "Daily time is used up — back tomorrow" + **Ask for more time** (existing). Shield subtitle "Daily screen time is up". |
| **Pending** (delivery) | enabled, any device `appliedVersion < policy.version` | "On" chip | existing "Pending on Mia's iPad" + Check | n/a |
| **On** | everything else | "Protected · Family Sharing" (d3) / "On · without Family Sharing" (you) | "On for Mia's iPad" | Signed deal card (existing). |

Rules:
- A kid never sees alerts, device lists, or anything red. The kid's only
  "problem" surfaces are cards inside Today (never a modal): revoked → "Turn
  it back on"; finish setup; renew deal. All open ordinary flows.
- The kid card is hidden while **Not set up**; shows the quiet Off card while
  **Off**. The usage card (`ScreenTimeUsageCard`) shows whenever the device is
  enrolled + approved — it is Apple's data, independent of our policy.
- `ScreenTimePromoCard` (parent Today top) is eligible only while **no kid has
  ever set Screen Time up**: every kid is **Not set up** with
  `policy.version == 0`. Off, Waiting, etc. never bring the promo back.
- Deal staleness (`agreement.isStale`) compares rules only; turning off keeps
  the lists, so Off never triggers "renew your deal".

## 2. Alerts

Alerts are parent-only. `raise()` on the server is the single choke point.

| Type | Raised when | Never raised when | Auto-resolved | In banner? | Push |
|---|---|---|---|---|---|
| `revoked` | heartbeat `authStatus == denied`; or `notDetermined` from a non-`monitor` source that has persisted ≥ 10 minutes; device `state != revoked` either way | `!policy.enabled` (state still updated, silently); `notDetermined` from `source == monitor`, or one that hasn't persisted 10 minutes yet, never counts | next `approved` heartbeat acks it | yes, danger | yes |
| `removed` | sweep/sync ping returns "token gone" | `!policy.enabled`; no push token | next heartbeat acks it | yes, danger | yes |
| `stale` | sweep: `state == ok` and `lastSeenAt` older than `SCREEN_TIME_STALE_HOURS` | `!policy.enabled` | next heartbeat acks it | yes, warning (fams) | yes |
| `selection_changed` | device replaces its own earlier selection with different counts | `!policy.enabled`; first pick on a device | none | yes, info (violet) | yes |
| `restored` | heartbeat `approved` after revoked/stale/removed | `!policy.enabled` | created **pre-acked** (`ackedAt = at`) | never | only if it was `revoked` |
| deal signed | never an alert (push only, unchanged) | | | never | yes |

Every alert also carries the existing `message` sentence; copy is in §6.

Lifecycle rules (server):
1. **Disable** (`PUT policy` with `enabled` true → false): ack every open alert
   for that kid, set `pauseUntil = null`, bump `version`, ping devices
   (`screen_time_sync`). No alert is ever raised while `!policy.enabled`; the
   sweep skips `stale` and `screen_time_ping` for those devices entirely.
2. **Enable** (false → true): for each device — `stale` → `state = ok`,
   `lastSeenAt = now` (24 h grace, no alert); `revoked` → raise `revoked` now
   (the parent must know the device can't enforce); `removed` → raise
   `removed` now. Then bump `version` and ping.
3. **Restore**: an `approved` heartbeat from a device in revoked/stale/removed
   acks that device's open revoked/stale/removed alerts and adds the pre-acked
   `restored` entry.
4. **Forget device**: acks that device's open alerts.
5. **Expiry**: any alert older than 7 days is acked on read (`kidState`),
   persisted lazily.
6. **Per-alert ack**: new `POST /api/screen-time/kids/:kidId/alerts/:alertId/ack`
   → kid state; the existing ack-all stays.

Client rules (parent):
- **Banner** (`ScreenTimeAlertBanner`, still in `RootView`'s top inset on all
  tabs): shows the newest *bannerable* alert only — unacked, type ∈ {revoked,
  removed, stale, selection_changed}, younger than 7 days, and that kid's
  `policy.enabled == true` (defensive; the server already guarantees it).
  Two controls, both 44 pt: an **✕** on the left of the text (label "Dismiss")
  that acks *that* alert (optimistic: hide immediately, then
  `ackAlert(kidId:alertId:)`; on failure it simply reappears on the next
  overview load), and **Review** which opens the parent controls for that kid.
  "N more" tail stays. The request banner (more-time) is unchanged except it
  also gets the ✕, which *declines nothing* — it hides the banner for that
  request id on this device (`@AppStorage("fam_st_hiddenRequestBanner")`);
  the request still shows in the sheet.
- **Review** must always do something: `openScreenTime(kidId:)` drops the
  `store.kids.contains` guard (keep `isParent`, `!needsAuth`), selects Today
  and presents the controls; the sheet already renders "isn't available right
  now" for an unknown kid.
- **Sheet**: the status section lists open alerts each with its own ✕ (per
  alert ack) and keeps **Got it** (ack all for this kid). "Acknowledge all"
  under Advanced is removed (redundant).
- Every surfaced alert is therefore dismissable in one tap, from where it is
  shown, without opening anything.

## 3. Presentation

Decide by `horizontalSizeClass`, never by device idiom (RootView rule).

| Surface | Compact (iPhone, iPad Split View narrow) | Regular (iPad full/⅔, iPhone landscape Max is still compact) | Dismiss |
|---|---|---|---|
| Kid deal flow `ScreenTimeKidSetupSheet` (make / renew / turn back on / finish setup) | `fullScreenCover` | `fullScreenCover` | Toolbar **Not now** (✕ icon + text on regular) on every page except Deal!/You're back on, which has **Done**. `interactiveDismissDisabled` is irrelevant for covers; the existing "Close — we'll keep trying" stays for save failures. Account change closes it. |
| Kid "Our deal" `ScreenTimeKidRulesSheet`, `ScreenTimeMoreTimeSheet`, parent `ScreenTimeDealSheet`, limit/downtime editors | `.sheet` `.presentationDetents([.large])` | `.sheet` (system form sheet) | **Done/Close** toolbar; swipe-down allowed except while saving/sending (existing). |
| Parent controls `ScreenTimeParentSheet` | `.sheet` `.presentationDetents([.large])`, swipe-down allowed unless `working`/`pausing` | `fullScreenCover` | **Done** toolbar (trailing) on both. |
| Parent welcome `ScreenTimeWelcomeView` | `fullScreenCover` (existing) | same | ✕ top-right, "Maybe later" (existing). |

One reusable modifier, `screenTimeControlsCover(item:content:)` in a new file
`ScreenTimePresentation.swift` (owned by WP3), applies `.fullScreenCover` when
the presenting view's size class is regular and `.sheet(.large)` otherwise;
both modifiers are attached, each bound to the item only when its size class
is active, so a live size-class change while presented dismisses and the user
re-opens (acceptable; state lives in the service, not the view). All three
presenters of the parent controls (`RootView`, `ScreenTimeSummaryCard`,
`ScreenTimePromoCard`) use it.

Regular-width layouts (no stretched phone column):
- **Parent controls**: `NavigationSplitView` — sidebar (min 260 pt) lists the
  family's kids with avatar, name and their status chip (replaces the
  segmented picker; selection is the sheet's `kidId`); detail keeps today's
  `List` sections, constrained to a centred 720 pt content column. Basic and
  Advanced order unchanged. The "Turn off Screen Time" row (§4) sits at the
  end of Basic. Title "Screen Time for Mia" stays inline in the detail bar.
- **Kid deal**: content column max 680 pt (560 today), page titles 36 pt (30
  on compact), hero emoji 120 pt (88), footer buttons max 480 pt centred.
  Page-specific: *The plan* shows Bedtime and Daily time cards side by side
  (`ViewThatFits` → HStack when both fit); *promises* pages use
  `LazyVGrid(.adaptive(minimum: 220))` for chips; *Sign it* puts the kid panel
  and the grown-up panel side by side; *Pass the phone* and *Deal!* stay
  centred single column. Progress capsules and the fairness line keep their
  widths.
- **Kid Today card** and **usage card** already live in the two-column
  `tightLayout`; unchanged.

Modal hygiene (all Screen Time presentations): close on `store.me?.id` change
and on `needsAuth` (existing pattern); never present two Screen Time
covers/sheets at once — the promo's welcome → controls hand-off keeps its
`onDismiss` chaining.

## 4. Parent "turn off" and "turn back on"

- **Turn off** is an explicit, destructive-styled text button "Turn off Screen
  Time" at the end of Basic (visible when `policy.enabled`). Confirmation
  dialog (title visible): **"Turn off Screen Time for Mia?"** — "Bedtime and
  daily time stop on Mia's iPad as soon as it checks in — usually within a
  minute when it's online. Your settings and your deal are kept, and alerts
  stop." Buttons: **Turn off** (destructive), Cancel.
- Client sends `PUT policy { enabled: false, limits: <current>, downtime:
  <current> }`. Server does §2 rule 1. Kid device: `apply(disabled)` stops
  `day.*`, `downtime.*`, `pause`, clears every store (shield gone), but keeps
  `heartbeat.0…3` registered so the device keeps checking in. A device that is
  offline/force-quit clears its shields the moment its monitor extension next
  runs (§5, reconcile) — the shield can outlive the parent's tap only until the
  next scheduled callback, never past it.
- While Off, the Basic switches are replaced by the Off section (§1) when
  rules are saved; with no saved rules the switches show as today.
- **Turn Screen Time back on**: `PUT { enabled: true, same lists }`; server
  does §2 rule 2; status shows Pending/Applied per device as today.
- Both switches off + Save keeps its meaning: "remove the rules" →
  `{ enabled: false, limits: [], downtime: [] }` (Advanced items are kept in
  the lists as today). Save is disabled when the draft equals the baseline.
- Pause is independent of Off: turning off clears `pauseUntil`; Pause buttons
  are hidden while Off.

## 5. Enforcement correctness (monitor extension + enforcer)

Principles: the extension **never adds a shield unless the stored policy says
so right now**, **only removes** on anything ambiguous, and treats DeviceActivity
callbacks as hints to re-check, not as truth. The app is the only registrar.

Stored keys added to the App Group: `fam_st_registeredAt` (Date the app last
called `register`), `fam_st_limitEventAt.<id>` (Date of the last `limit.<id>`
event today).

`reconcileShields(now:)` (enforcer, safe in the extension; removes only):
1. `!isEnrolled || storedPolicy == nil || !storedPolicy.enabled` → `clearAllStores()`; return.
2. `pauseInterval(now, pauseUntil) == nil` → `clear(.pause)`.
3. no downtime window `isInsideWindow(now)` → `clear(.downtime)`.
4. every `limit.<id>` store whose id is not in `policy.limits` → `clear`.
Called at the end of every device HTTP response (`policyRequest`), at every
`intervalDidStart`/`intervalDidEnd`, and at the start of `apply`.

Extension callbacks:

```
intervalDidStart(activity):
  recordMonitorFire()
  if heartbeat.N            → heartbeat() (always, even when disabled)
  reconcileShields(now)
  guard enabled else return
  if day.N                  → clearLimitStores(); pending limit events forgotten
  if downtime.<id>          → guard window exists && isInsideWindow(start,end,days,now) → shieldAll(.downtime)   // not just "today is listed"
  if pause                  → guard pauseInterval(now, pauseUntil) != nil → shieldAll(.pause)

intervalDidEnd(activity):
  recordMonitorFire(); reconcileShields(now)
  if pause                  → clear(.pause)
  if downtime.<id>          → clear(.downtime) unless another window isInsideWindow(now)

eventDidReachThreshold(event, activity):
  recordMonitorFire()
  guard enabled, isEnrolled else { clearAllStores(); return }
  guard activity == .day(Calendar.current.weekday(now)) else return       // other-day or stale activity
  if usage.<m>:
      recordUsage(minutes: m)
      decideTotalShield()                                                  // milestones are the truth for `total`
      else if claimUsageHeartbeat() → heartbeat()
  if limit.<id>:
      guard let limit = policy.limits[id] else return
      threshold = minutes(for: limit, weekday, bonus, today)             // > 0
      if limit.isTotal: set limitEventAt.total = now; decideTotalShield()
      else (apps):      guard now - registeredAt > 60 s else return       // ignore the re-registration burst
                        shieldLimit(id)

decideTotalShield():   // pure: ScreenTimeSchedule.totalShieldDecision(recorded:threshold:limitEventSeenToday:)
  recorded = todayUsage.minutes (0 when nil)
  shield iff recorded >= threshold, or (limitEventSeenToday && recorded >= threshold - 15)
  on shield: shieldLimit("total"); recordUsage(limitReached: true) once; heartbeat()
```

Why: `usage.<m>` milestones and `limit.total` use the same "everything"
selection, so a genuine threshold is always accompanied by milestones within
15 minutes of it; a spurious `limit.total` with 0 recorded minutes shields
nothing, and a late-arriving milestone completes a genuine one. Apps limits
have no cross-check, so only the 60 s post-registration window is filtered
(during it the app is in the foreground applying the policy anyway).

Enforcer/app rules:
- `apply(policy)` first calls `reconcileShields`. Disabled → stop all
  activities except `heartbeat.*` (register them if missing), clear stores and
  signatures, return. Enabled → unchanged, plus write `registeredAt` inside
  `register`.
- Only the app registers/stops DeviceActivity; the extension never calls
  `DeviceActivityCenter`.
- Day rollover: `day.N` start clears limit stores and the usage record's date
  check restarts counting; `limitReachedAt` is set only when a shield was
  actually applied.
- Bonus: unchanged — signature change re-registers today's `day.N` with the
  higher threshold and clears `limit.total`; the milestone rule then shields at
  the new threshold.
- Revocation: `performSync` skips `apply` when auth ≠ approved (existing);
  `reconcileShields` still runs so no stale shield reason lingers in
  `fam_st_shieldReasons` for the shield extension.
- Forgotten device (401): unchanged (`clearAllStores` + credentials).

## 6. Copy

Parent chip / status: "Set up", "Off", "Set up on their phone", "Finish setup
on their phone", "Protected · Family Sharing", "On · without Family Sharing",
"Turned off · 4:12 PM", "May be removed", "Not checking in", "Paused until
8:30 PM"; sub-lines "Bedtime now", "Daily time used up at 4:12 PM", "Off on
Mia's iPad", "Mia's iPad hasn't picked this up yet".

Off section: "Off. Bedtime 9:00 PM–7:00 AM and 2 h a day are saved." /
button "Turn Screen Time back on". Turn-off row: "Turn off Screen Time".
Dialog as §4.

Alert messages (server `message`): revoked "Mia turned off Screen Time on
iPad"; removed "Fam ETC may have been removed from Mia's iPad"; stale "Mia's
iPad hasn't checked in since Sat 9:12 PM. It may be off or offline."; restored
"Screen Time is back on for Mia's iPad"; selection_changed unchanged. Push
titles unchanged. Banner accessibility: ✕ = "Dismiss this alert", Review =
"Opens Screen Time for Mia".

Kid: Off card "Screen Time is off right now — your grown-ups turned it off.
Your deal is saved."; deal-card lines "Bedtime now — back at 7:00 AM", "Daily
time is used up — back tomorrow". Shield: title "Paused by Fam ETC"; subtitles
"Paused by a parent", "Downtime", "Daily screen time is up", "<Limit>: daily
limit reached" (existing).

## 7. Work packages

Five packages, disjoint file ownership. Swift cannot be compiled on the Linux
box: Swift changes must be small, additive, mirror existing patterns in the
same file, and be re-read line by line for syntax/optional/actor correctness
before hand-off; anything shared must be pure Foundation so it is unit-tested
in `FamETCTests`. Node changes run `node --test` before commit. Nobody edits
`ScreenTimeModels.swift`, `TodayView.swift`, `NotificationHandler.swift`,
`ShieldConfigurationExtension.swift` or `UsageReportExtension.swift`.

### WP1 — Enforcement correctness (kid device)
Goal: §5 exactly; a kid device never shields when the policy is off/paused-out/
other-day, and `limit.total` shields only when usage really reached it.
Owns: `ios/FamETCScreenTimeMonitor/DeviceActivityMonitorExtension.swift`,
`ios/FamETCScreenTimeShared/ScreenTimeEnforcer.swift`,
`ios/FamETCScreenTimeShared/ScreenTimeSchedule.swift`,
`ios/FamETCTests/ScreenTimeScheduleTests.swift`.
Changes: add `reconcileShields(now:)`, `registeredAt`, `limitEventAt(id)`,
`decideTotalShield(now:)` to the enforcer; `apply(disabled)` keeps
`heartbeat.*`; `policyRequest` completion calls `reconcileShields`; rewrite the
three extension callbacks per §5. New pure helpers in `ScreenTimeSchedule`:
`totalShieldDecision(recorded:threshold:limitEventSeenToday:) -> Bool`,
`isTodayActivity(_ name: String, now:calendar:) -> Bool`,
`shouldIgnoreAppsLimitEvent(now:registeredAt:) -> Bool`,
`activeDowntimeIds(_ policy:now:) -> [String]`.
Tests (XCTest, pure): decision table for `totalShieldDecision` (0/105/120 vs
120 with and without event; bonus 150), `isTodayActivity("day.N")` across a
Sunday/Saturday boundary and for `downtime.x`, apps-limit 60 s window,
`activeDowntimeIds` for a 21:00–07:00 window at 06:30 Monday (listed Sunday
only), and a `reconcile` decision table modelled as a pure function over
(enabled, pauseUntil, windows, limit ids) → set of stores to clear.
Acceptance: parent turns off → kid device with app force-quit clears its shield
at the next monitor callback and never re-shields; a `limit.total` event with
0 recorded minutes shields nothing; a genuine 2 h day shields within one
milestone of the threshold; bedtime never shields outside its window; pause
never shields after `pauseUntil`; heartbeats continue while Off.
Interface others rely on: heartbeat body/response unchanged.

### WP2 — Server alert semantics + contract
Goal: §2 and §4 server side; no alert, push or `screen_time_ping` while
`!policy.enabled`; auto-resolution; per-alert ack; 7-day expiry.
Owns: `lib/screen-time.js`, `lib/routes/screen-time.js`,
`tests/screen-time.test.js`, `docs/SCREEN-TIME-PLAN.md`.
Changes: guard in `raise()`; `savePolicy` transitions (disable: ack all,
`pauseUntil = null`; enable: device state handling + immediate re-raise);
heartbeat restore acks + pre-acked `restored`; sweep skips disabled kids for
stale and pings (sync pings on save still go); `forgetDevice` acks its
alerts; `expireAlerts` (7 d) in `kidState`; `ackAlert(fam, kidId, alertId)` +
route `POST /api/screen-time/kids/:kidId/alerts/:alertId/ack` (404 unknown);
stale message copy per §6; plan doc: alert table, endpoints, "Off" state,
presentation note.
Tests (node --test): disabled policy → heartbeat denied raises nothing and no
push; sweep raises no stale / sends no ping while disabled; disable acks all
and clears pause and pings sync; enable after revoked-while-off raises
`revoked` once; enable after stale resets `lastSeenAt` with no alert; restore
acks the device's open alerts and `restored` is pre-acked; per-alert ack acks
one and 404s for another kid's alert; 8-day-old alert reads as acked; forget
device acks its alerts; existing tests updated for the new `stale` message.
Acceptance: all `tests/screen-time.test.js` green; `tests/fixtures/ios-family-assistance-server.js` still boots (it runs the real module).
Interface others rely on: JSON shapes unchanged; new ack route as above.

### WP3 — Parent iOS: banner, Off state, iPad presentation
Goal: §1 parent columns, §2 client rules, §3 parent rows, §4, §6 parent copy.
Owns: `ios/FamETC/Features/ScreenTime/ScreenTimeParentViews.swift`,
`ios/FamETC/Features/ScreenTime/ScreenTimeWelcome.swift`,
`ios/FamETC/Features/ScreenTime/ScreenTimePresentation.swift` (new),
`ios/FamETC/Features/ScreenTime/ScreenTimeService.swift`,
`ios/FamETC/Networking/APIClient.swift`, `ios/FamETC/App/RootView.swift`,
`ios/FamETCUITests/ScreenTimeUITests.swift`,
`ios/FamETCUITests/ScreenTimePromoUITests.swift`,
`tests/fixtures/ios-family-assistance-server.js` (QA hooks only).
Changes: `ScreenTimeKidStatus` gains `.off` and the precedence in §1;
`ScreenTimeAlertBanner` ✕ + always-working Review + banner filter
(`ScreenTimeService.bannerAlerts`); `ackAlert(kidId:alertId:)` in service +
`ackScreenTimeAlert(kidId:alertId:)` in APIClient; sheet: per-alert ✕, remove
"Acknowledge all", Off section, "Turn off Screen Time" row + dialog, status
sub-lines (Bedtime now / used up / Off on…), `NavigationSplitView` at regular
width with 720 pt detail column; `screenTimeControlsCover` modifier used by
`RootView`, `ScreenTimeSummaryCard`, `ScreenTimePromoCard`; promo eligibility
= no kid with `policy.version > 0`; `RootView.openScreenTime` guard relaxed.
Tests: XCUITest — banner shows a seeded revoked alert (add fixture hook
`POST /__qa/screen-time/alert { kidId, type }` that calls the real
`heartbeat` with `denied`), ✕ hides it, Review opens the controls; "Turn off
Screen Time" → dialog → chip reads "Off" and the promo does not reappear;
iPad run (`iPad Pro 13-inch` destination) asserts the controls occupy the full
window (sidebar kid list exists) — screenshots attached as today.
Acceptance: every visible alert dismissable in one tap; no banner for a kid
whose policy is off; iPad parent controls full screen with kid sidebar; iPhone
unchanged (large sheet); Off/Turn-back-on round trip works against the
fixture.
Interface others rely on: none (WP4 does not use the new modifier).

### WP4 — Kid iOS: full-screen deal, iPad layout, Off card
Goal: §1 kid column, §3 kid rows, §6 kid copy.
Owns: `ios/FamETC/Features/ScreenTime/ScreenTimeKidViews.swift`,
`ios/FamETCUITests/ScreenTimeDealUITests.swift` (new).
Changes: `ScreenTimeKidCard` presents `ScreenTimeKidSetupSheet` with
`.fullScreenCover(item:)` on all sizes; card renders the Off card when
`!policy.enabled && service.isEnrolled` (today it renders nothing when
disabled — split the `policy.enabled` gate); deal-card lines for downtime-now
(`ScreenTimeSchedule.isInsideWindow` over `service.policy.downtime`) and limit
reached (`ScreenTimeEnforcer.shared.todayUsage()?.limitReachedAt` — an
existing public read on the shared singleton; WP1 keeps that signature);
regular-width layout per §3 (680 pt column, side-by-side plan/sign, adaptive
promise grid, 36 pt titles, 120 pt hero); toolbar "Not now" with ✕ icon on
regular.
Tests: XCUITest on iPhone: deal opens as a cover (no sheet grabber; "Not
now" present on every page but Deal!) and the existing walk-through in
`ScreenTimeUITests.testKidSeesDealCardAndWalksTheDealUpToTurnOn` still
passes unchanged; on iPad Pro 13-inch: plan page shows Bedtime and Daily time
side by side (both `staticTexts` exist and share the same y), promises grid
has ≥ 2 chips per row. The Off card needs an enrolled device (App Group
state FamilyControls can't grant in the simulator), so it is verified on the
owner's iPad: parent turns off → kid Today shows the quiet Off card within one
foreground sync and the shield is gone.
Acceptance: kid deal is full screen on iPhone and iPad; nothing on the kid side
is an undismissable modal; kid sees the quiet Off card, never an alert.

### WP5 — Web child page: Off state
Goal: parent web view mirrors §1 for Off and the new stale wording.
Owns: `public/js/child-view.js`, `public/css/child-view.css`,
`tests/child-screen-time-ui.test.js`.
Changes: `screenTimeMarkup` renders "Screen Time is off for Mia right now.
Turn it back on in the Fam ETC app." above the chart when
`!kid.policy.enabled && kid.devices.length`; alerts list keeps history (last
3) but labels acked entries plainly and unacked with the existing chip style;
`.cv-st-off` line style using `--fr-ink-2`.
Tests: off state renders the line and still the chart; unacked vs acked alert
styling; escaping test extended with the new string path.
Acceptance: `node --test tests/child-screen-time-ui.test.js` green; no
regression in the not-set-up/error/loading cases.

Dispatch order: WP1, WP2, WP5 in parallel immediately; WP3 and WP4 in parallel
(they only need WP2's ack route for the banner ✕, which can be stubbed by the
fixture until WP2 merges). Release: web (WP2 + WP5) via the standard deploy
pipeline; iOS via TestFlight to the owner's iPad first.

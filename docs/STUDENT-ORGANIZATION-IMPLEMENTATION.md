# Student organization pilot — implementation record

5 October 2026. Approved product direction: [student organization plan](ADHD-SUPPORT-PLAN.md). Baseline: `36c1930140092b3e7f12ebb9c68356261bd23b43`; work branch: `codex/student-organization`. The server, native iPad/iPhone app and independent child Watch target are implemented locally. This is the core pilot increment, not completion of every later roadmap phase or a released clinical product.

## Delivered workflows

| Workflow | Implemented behavior |
| --- | --- |
| Parent setup | Full-hub parents open Today → Student organizer, select a child, agree routines/material rules and enable My Next. Off by default. Cue windows, quiet hours and focus duration are editable. |
| Student next action | Today → My Next presents a due routine or planned homework step, with an explanation and a choice of another task. Existing Family Rings retain their meanings. |
| Pack | Explicit everyday, subject, activity and dated material rules are matched to actual dated, child-scoped timetable events. Evening/morning passes show needed, packed, morning, at-school and missing states. Reasons and source freshness remain visible. |
| Uncertain equipment | Missing, stale or uncovered future school data cannot produce a ready state. A new lesson without an explicit material mapping produces a “Confirm materials” warning even when all remaining essentials were checked. Parents see this warning too. |
| Homework | Student chooses a small next step and optional planned date, reports work finished, chooses hand-in method and reports submission separately. Existing school status, due dates, original checklist, rewards and provenance are preserved. Paper hand-ins can appear in packing. |
| Routines | Weekday/time templates, small steps, done, skipped, handed off, snoozed, reopened and help requested are distinct. Ordinary routines do not require payment and do not generate Fams credits. |
| Watch | Existing direct HTTPS and scoped credentials power Pack, Homework and Routines without a child's iPhone. Durable pending changes have visible sync/review states. Existing focus timer adds pause/resume and selectable short intervals. |
| Reminders | Watch support cues require explicit opt-in, use generic text and respect configured quiet hours. Routine cues are bundled rather than emitted per checklist step. Schooltime and OS delivery restrictions still apply. |
| Parent exceptions | Missing equipment, uncertain materials and explicit help/handoff outcomes are visible. Asking for help does not send a chat message automatically. |
| Recovery | Identity-bound protected local state persists before sending; retries keep command identities. Conflict stops further writes and offers explicit discard/reload. Sign-out/account changes clear the support cache and timer. Late responses cannot restore another account. |

## Contracts and data

- `GET /api/student-support?kidId=…` returns `{support}`. Child sessions always read their own scope. Parents can select an existing child in their family. Parent Watch support is excluded from this first increment.
- `POST /api/student-support/commands` accepts `kidId`, `commandId`, `expectedRevision`, `type`, and `payload`. Commands are `configure`, `packing_item`, `routine_step`, `routine_status`, and `homework_plan`. Configuration requires an interactive parent session.
- Both endpoints apply authenticated family/full-hub gates, including after resolving Watch bearer credentials. Watch access is an exact method/path allowlist; it does not grant general API access.
- Validations precede writes. Revision conflicts return 409. Identical actor-bound retries do not reapply mutations; reused command IDs with different payloads are rejected. A retry returning a newer remote revision does not silently rebase remaining local work.
- Data lives in `fam_studentSupport` inside the existing encrypted database. Removing a child removes their support state. New native files use protected storage and exclude iPad recovery data from backups.
- `packing.requirementsConfirmed` is additive. Older native caches decode its absence conservatively. Fresh timetable coverage and confirmed per-lesson material mappings are separate facts.
- The pilot uses `Asia/Bangkok`, matching its school use case. General family timezone support must precede expansion. The date window includes today before noon and looks ahead up to 14 days; absent timetable dates never repeat automatically into another week.
- Routine projection covers seven days. Explicit packing/routine history and command receipts are pruned after 30 days on access; this is not a background deletion service. Expired receipts still cannot create financial credits because this subsystem has none.
- Caps: 60 material rules, 20 routine templates, 15 steps per routine. Templates preserve explicit outcomes under stable occurrence identity.

The main server files are [student-support.js](../lib/student-support.js) and its [routes](../lib/routes/student-support.js). Native iPad code is in [StudentSupport](../ios/FamETC/Features/StudentSupport/StudentSupportView.swift); independent Watch code is in [WatchStudentSupportView.swift](../ios/FamETCWatch/WatchStudentSupportView.swift). Existing authenticated clients and Watch stores remain the integration points.

## Verification

Verification used Node `v24.21.0` and local Xcode 27.1. No hosted CI minutes were used. Focused evidence and xcresult bundles are retained locally under `.dev-data/student-support-verification/`.

- Server model, role routes, real signed-session/Watch-bearer HTTP, child deletion, auth allowlist, session revocation and plan gates: 56 checks passed before the final unmapped-material regression. The updated model/routes/HTTP subset then passed 12/12, including the new regression.
- iPad native model/privacy decoding, logout-cookie behavior and support state: 72 selected tests passed initially. The updated support suite passed 14/14 after the old-cache packing guard was added.
- Independent Watch support, queue/store, reminders, plans and complication state: 36 selected tests passed initially. The final support suite passed 10/10 after the unmapped/legacy requirements guard was added.
- Real iPad interaction tests use `tests/fixtures/student-organization-server.js`: synthetic family data, real Express routes/stores, an isolated data directory, no local provider credentials and no school network calls. The test must be launched only against this loopback fixture. Run these journeys with explicit `StudentOrganizationUITests` selection and the fixture listening on `127.0.0.1:18465`; a generic UI run without its fixtures is not valid evidence.
- iPad actual interaction: child packing and hand-in passed against the real fixture; canonical homework remained `todo`. Portrait and landscape screenshots were inspected. Parent setup, material editing and save passed in landscape with accessibility XXXL text. Initial test-helper failures were diagnosed from screenshots/hierarchy and corrected (offscreen taps, lazy rows and bottom-of-list bounds); no product behavior was bypassed. Accepted journeys are in `ipad-ui-tests.xcresult` (child) and `ipad-parent-ui-tests.xcresult` (parent).
- Review fixed partial-identity cold-start queue loss, an in-flight Watch discard race, and missing optimistic Watch projections. Integrated HTTP tests exposed and fixed the Watch full-hub gate ordering. The added timetable-change regression prevents a false packing all-clear.
- A single independent review was followed by focused fixes and acceptance tests; no speculative refactor or new dependency was introduced.

## Deliberate limits and release gates

Timers are device-local and never infer task completion; cross-device timer takeover is deferred. The iPad saves cue preferences but does not schedule support notifications. School hand-in remains self-reported; no external school submission or receipt verification is claimed. Optional reward linkage, OCR/voice extraction, teacher tools and the later roadmap are deferred. No diagnosis field, attention score, location surveillance or clinical data was added.

A physical Family Setup Watch was unavailable. Installation/enrollment, operation while the managing iPhone is unavailable, actual Wi-Fi/cellular behavior, on-wrist prompts, Schooltime, permission-denied behavior, battery across a school day, Watch taps and VoiceOver remain required before native release. Simulator tests do not replace this evidence. Also verify initial-family-load failure and sign-out recovery on the release device, with the native session cleared before another account is shown.

Next acceptance step: use the target Watch and a real upcoming school timetable to rehearse evening packing, a morning-only item, a missing item, a dog-walk snooze/handoff, and a homework hand-in. Rehearse offline/restart/concurrent-device edits and revoked credentials. Keep only cues the student finds useful.

No push, merge, TestFlight upload, App Store submission or Hostinger deployment has occurred. Full release CI was not run during local implementation. A release requires the normal frozen-commit gate and native distribution checks; Hostinger must use committed merged `main`. Existing production behavior has not changed.

# Native Family Rings and Study Pal handoff

2026-09-26 · branch `codex/ios-family-rings` · version 1.2 (12).

Open `ios/FamETC.xcodeproj` in the isolated `ios-family-rings` worktree. The project is generated from `ios/project.yml` with XcodeGen. The owner has authorized merging the integrated source and deploying its web/backend counterpart. Native archive/upload remains owner-controlled. The release receipt records the final commit, CI run and live web build.

## Included

- Exact adaptive Family Rings palette, bundled Geist, borderless cards and reusable accessible rings without the zero-progress cap dot.
- Native parent/kid Today, scoped counts in `FamilyRingsMath`, action Review/Done flows, native habits, child cards, calendar strip, Tonight and four learning tiles. Challenge remains separate from the Daily 3 count.
- Child-only Koko panel with the next homework task, Energy check-in and My Corner. It opens as a compact anchored iPad popover or a smaller iPhone sheet; full activities open only after selection. Energy requires preview/send to share; private notes and six sticker choices persist only for the owning child. Save failures retain the draft.
- Account-switch protections: private views/state clear immediately; native and WebKit session cookies clear before onboarding. Cookie cleanup retains its WebKit data store through asynchronous work.
- Completed native chat changes from the separate chat task, integrated using three-way merges against `07d8ae2`: receive-loop fixes, article cards, family bubbles/avatars and keyboard-height attachment picker with draft recovery. The original shared changes were preserved through integration, with input hashes retained in the local receipt.

## Focused evidence

Local Xcode 27.1, iOS 27 simulators and Node v24.21.0. Synthetic accounts only; no real credentials. Logs and result bundles are under `.dev-data/ios-family-rings/` in the worktree.

- Initial focused native run: 76 tests passed across ring math, fonts, decoding, family snapshot, mood, corner and logout. Three action-mutation/account-switch regressions passed subsequently.
- The default-WebKit-store regression and the real My Corner save/reopen/logout/relaunch/sibling/parent journey passed in `ipad-recovery.xcresult`. The parent Review/Done journey also passed there.
- Focused backend checks: 13 mood/corner tests, 11 completion-timestamp tests and one session-revocation test passed. Seven native chat source checks passed after integration.
- iPad interaction evidence covers portrait/landscape, light/dark, accessibility XXXL, Koko hide/show persistence, homework navigation, explicit mood preview/cancel/retry, corner movement/removal and failed-save recovery, parent exclusion, Daily 3 visibility, action creation/snooze/delete and empty/error states.
- iPhone SE (375pt): light parent/dark child layouts inspected; Koko-to-homework navigation passed in `se-navigation.xcresult`.
- Combined native integration: all selected unit tests and all five iPad chat tests passed, including the exact keyboard/picker/draft round-trip. Koko homework and parent Review/Done passed. The separate habit-touch recovery (`habit-control.xcresult`) verifies the actual switch, sibling exclusion and updated ring count. Earlier coordinate/row test failures were corrected using the recorded UI hierarchy.

Implementation checks are focused under the standing local-iteration policy. Web deployment requires one successful full CI run for the final merged commit; its ID and result belong in the release receipt. Earlier failed diagnostic runs remain on disk; the named recovery results supersede their corrected failures.

## Release dependencies and remaining acceptance

The integrated source includes My Corner endpoints, explicit mood-sharing context guards, action `completedAt`, news/chat sharing and notification backends as well as both clients. The matching web/backend release must be live before testing these new native features against production. The user lifted the deployment hold and requested the combined release on 2026-09-26.

Before a native release, verify with an owner-signed-in real family that native/web numbers agree; confirm physical-device haptics, VoiceOver custom actions, camera, uploads, push delivery and hardware/floating keyboard behavior. The full brief screenshot/Accessibility Inspector matrix, including iPad one-third Split View, remains a release acceptance item. Simulator evidence is not physical-device acceptance. Widgets and watch design are unchanged; the optional widget phase still requires owner approval on device.

The owner archives/uploads only after the project’s native release gate and the matching backend release are complete. No automatic native archive, upload, TestFlight or App Store submission is authorized by this handoff.

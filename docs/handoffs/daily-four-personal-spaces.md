# Daily 4 and personal spaces — Claude handoff (2026-09-26)

Source: codex/daily-four-learning, 25b47623c2e22f8f68eda26289ef7d0fd1629e5e. Pushed; working tree clean. Main remains owned by the other active task and was not changed. The release contains the previously live 4034c81 chat changes through its baseline.

Open /Users/mk/.codex/worktrees/daily-four-learning/Planner/ios/FamETC.xcodeproj. Generated with XcodeGen, built and tested with Xcode 27.1 on iOS 27 simulators. No native archive, TestFlight upload or App Store submission.

## Changes
- Daily 4: News, Quote, Word and one Challenge. Puzzle and brain teaser cannot double-count progress. One iOS heading; existing storage/API identifiers and drafts remain compatible.
- Crossword: per-clue first-letter/count hint and separate answer reveal, without autofill or completion. Optional weekly recall cards use unattempted words and timestamped mistakes for the signed-in player.
- Koko is available to parents and children. Native parent Koko opens Needs you; children retain their own homework. Energy check-ins require explicit preview/send.
- Each parent and child owns a separate private Corner. Optional account/family/role guards prevent stale saves and chat sends. Parents cannot open children’s or other parents’ Corners.
- 48 sticker choices in All/Moods/Activities/Little things. Existing six retained, 42 generated. The maximum remains 18 placed stickers. Web/native PNG bytes match; all generated files are transparent RGBA at 1254×1254.

## Evidence
- Earlier feature checks: 85 native model/math/identity tests; iPad and iPhone learning UI; crossword response privacy, browser hints and recall, and full My Corner editing/conflict/retry/account-switch flows.
- Parent delta: 14 server/model boundary tests, 7 native Corner tests, iPad child/parent energy preview switching, iPhone Koko large text and Needs you navigation, final-artwork iPad parent Corner save/reopen, and real web parent flows at 390/1024px.
- 48-entry asset catalog checks pass. All 42 generated images were individually reviewed by the artwork worker, with root spot checks and in-app review.
- Independent privacy review accepted after correcting role binding.
- Full CI passed for implementation SHA `25b47623c2e22f8f68eda26289ef7d0fd1629e5e`: [run 36235472756](https://github.com/kamatbot/kidsplanner/actions/runs/36235472756), workflow_dispatch. No further CI is needed for this handoff-only documentation commit. Validate the final merged main commit under the established release policy.

Artwork lives in public/img/my-corner and ios/FamETC/Assets.xcassets/Corner-*.imageset. Exact prompts and source hashes: docs/sticker-art-prompts.md. The Astra High worker used one built-in image generation call per asset. The tool exposes no model/version selector, so Images 2.5 could not be independently confirmed.

No real-account production navigation or passkey registration/authentication ceremony was exercised. Release checks cover public endpoints and unauthenticated contract responses.

## Latest presentation change

Commit `4ca8daa` moved the web My Corner entry into the Today header, immediately before the school-sync status. Responsive wrapping and open/close verified in Chromium at 390, 1024 and 1920 pixels. This localized presentation change uses UX_FAST focused evidence; no full CI rerun or deployment was performed for it.

## Current authorization and external state

The owner has revoked deployment authorization for this task and reserved merge/deploy for Claude. Hostinger deployments must use merged main only, never a feature branch. The rule is recorded in repository AGENTS.md, the global Codex agreement and the Hostinger deployment skill.

The release worker had already initiated a Hostinger upload/build before the stop reached it. That build completed: `01a0dd3f-6bfb-7277-8426-5bdc01a67377`. Last observed live commit was `25b47623c2e22f8f68eda26289ef7d0fd1629e5e`, marker `20260926-102234Z-25b4762`; health 200, private API 401, passkey RP fametc.com, zero pending builds. No rollback was performed. Main was never merged or pushed by this task.

## Archive access observation — exposure unconfirmed

The worker initially reported a publicly downloadable archive, but its original remote evidence captured only HTTP 200, without Content-Type, Content-Length, ZIP magic or downloaded bytes. That did not establish ZIP or credential exposure; it could have been an HTML fallback. The local deployment archive did contain the packer's `.env.hostinger` and APNs `.p8` runtime files. No secret values or download URL are included here.

The owner authorized removing the archive while leaving the running app unchanged. Follow-up exact URL checks returned HEAD and GET 404 (`text/html`), and the Hostinger file listing omitted it. No deletion API, rebuild, rollback or configuration change was performed. The app remains at the earlier implementation release. Credential exposure and a need for rotation are not established by these observations; review the upload access guarantees before another release.

Private local evidence: `.dev-data/daily-four/release/deploy-revoked-20260926.json`, corrected with `remoteZipExposureConfirmed: false`. The owner was explicitly informed of this correction.

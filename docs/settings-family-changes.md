# Family experience changes

Baseline: main, 19f771e5c833b10a94f2f8e747a0d8fcac2801e9.
Existing untracked android/ and .impeccable/review/ are preserved.
Mission: hide parent Today timetables, match vocabulary options by part of speech,
and simplify web settings with persistent child color/picture identity on web and iOS.
External actions: project standing authorization in CLAUDE.md applies to web changes: test, commit, deploy, live verification. Release is isolated from unrelated concurrent edits. No automatic App Store release.

Modules (each checked before the next):
1. iOS visibility: AppStore shared school-event filter; parent Calendar retains raw timetable data.
2. Vocabulary: expand same-type pools, then update server/web/iOS question generation and verify parity.
3. Profile storage: validate optional bounded raster picture and color on the existing parent-only update path.
4. Web settings: section navigation and child editor, then shared identity rendering/styles.
5. iOS identity: optional picture model and shared color/avatar rendering, then callers.

Rollback: reverse only each module's diff against this baseline; preserve unrelated files.
Checks: focused Node tests, Swift source/type checks, synthetic parent/kid browser flows at desktop and mobile sizes.
No full CI/build until a frozen deployment commit is authorized.

Settings direction: Operate mode; retain the surrounding FamETC typography and palette,
replace the long settings stack with Family / School / Preferences / Connections sections.
Use progressive child editors, native controls, visible save/error feedback, and compact
profile previews. No changes to authentication, school connection behavior, or account permissions.

## Verification

- iOS shared visibility behavior: compiled Swift parent, kid, and unresolved-kid cases pass; Calendar continues to use the unfiltered timetable input.
- Vocabulary: 35 matching web/server/iOS entries; four unique same-part-of-speech options in all 105 daily variants; server pop-quiz coverage passes.
- Profile: parent membership enforced, invalid data rejected before mutation, optional photo clear supported; legacy native profile decoding and photo round trip pass.
- Browser: synthetic parent profile saved through the real family update route, resized JPEG persisted across reload, and matched chat; HTTP 503 preserves edits and permits retry; child controls hidden; all four sections and Today setup shortcuts work.
- Layout: 1440px and 390px screenshots inspected, plus 20px base text with no horizontal overflow. Arbitrary colors use readable neutral text.
- Native: new avatar/identity components typechecked against the iOS simulator SDK; the app built successfully for the iPhone simulator and all 43 selected ModelDecodingTests/ChatMergeTests passed. No TestFlight distribution yet.
- Mechanical design detector ran once in degraded regex mode; no findings, but computed contrast was not evaluated by that tool. Browser inspection supplied the layout evidence.

Complexity-only review: Theme.swift — delete — unused legacy Palette.kidColor(index:) can be removed after callers migrated — 7 lines. net: -7 lines possible. Not applied automatically.

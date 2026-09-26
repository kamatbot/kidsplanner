# My Corner integration

Child-only personal sticker canvas, reached from Today. Six allowlisted local
stickers; 18 placements maximum; plain sticky note up to 240 UTF-16 code units.
No sharing, earning, uploads, URLs, rich text, family-note integration or changes
to Fams/learning. Web/iPhone are secondary to the native iPad experience.

## Host touchpoints

- `server.js`: register `lib/routes/my-corner` with existing `routeDeps`.
- `public/index.html`: include `/css/my-corner.css`, `/js/my-corner.js` before
  `app.js`, and an initially hidden `#fam-my-corner-entry` on Today.
- `public/js/app.js`: call `famMyCorner.setUser(sessionUser)` after resolving
  `/api/me` and when rendering Today; call `famMyCorner.clear()` before logout.
- Native `TodayView.swift`: kid branch button and a `MyCornerScreen(ownerID:)`
  sheet, keyed by current user ID; dismiss it on account changes. Keep this
  additive button after the existing homework-first child content.
- XcodeGen automatically includes `Features/MyCorner`, `Corner-*.imageset`, and
  focused test sources. No networking/model changes in shared entry points.
- Assets are local `/img/my-corner/*.svg` and matching bundled native PNGs.

## API and persistence

`GET /api/my-corner` and `PUT /api/my-corner` use the authenticated interactive
kid session and current family membership. No owner/query parameters accepted.
Parents, watch credentials, stale/removed kid membership and ownership spoofing
are rejected. Siblings/families access only their own records.

Payload: `{ revision: 0, note: "", stickers: [] }`; each sticker contains exactly
`{ id, stickerId, x, y, rotation }`. Coordinates are normalized 0…1 with a fixed
canvas inset; rotation is −180…180. Unknown keys/IDs, duplicate IDs, nonfinite
or out-of-range values, HTML/control characters and excessive sizes fail 400.

The `fam_my_corners` DB namespace stores separately encrypted documents with
existing `datacrypto` helpers and existing atomic DB persistence. It is outside
users/families/notes, so their existing serializers and exports cannot include
it. Encryption is mandatory even in development. Successful writes flush
before responding; failure restores the readable previous version. This uses
the existing single-process DB writer, not a new distributed store.

PUT compares `revision` atomically before any async work; success increments it.
409 preserves the local draft, loads a separate latest preview, and requires an
explicit choice to adopt it or prepare the draft to replace the reviewed version.
A further concurrent edit still conflicts. No silent last-writer-wins behavior.

Drafts exist only in editor memory. Closing asks before discarding. No note data
is stored in localStorage, native DiskCache, UserDefaults or URLCache. Native
requests use an ephemeral session with the cookie captured when the editor opens;
account changes clear/dismiss the editor and generation checks reject late results.
Both web and native requests send the editor's expected account ID in
`X-Fam-Corner-Account`; a changed session is rejected before reading or saving.
This header never chooses an owner. The web editor revalidates `/api/me` before
opening and clears its private DOM and unsaved drafts when its tab is hidden;
the interface asks users to save before switching tabs. Lifecycle generation
checks prevent a late response restoring that content. Native sign-out now
clears the app's native and WK session cookies even if server revocation fails.

## Focused verification

Use Node 24 (`/opt/homebrew/opt/node@24/bin` first in PATH; verify `node --version`).
`node --test tests/my-corner.test.js` exercises route/store privacy, validation,
concurrency, encryption/fresh-process reload, membership removal and disk failure.

For local app journeys start `node tests/fixtures/my-corner-server.js` from the
repository root. It creates only synthetic accounts in a fresh ignored
`.dev-data/corner-qa-*` directory on port 18369. Local-only QA endpoints supply
synthetic signed cookies and inject one load/save failure; they are never
registered by production `server.js`. Stop it after checks.

`tests/my-corner-browser.cjs` needs Playwright/Chrome, supplied via
`FAM_PLAYWRIGHT_MODULE` when Playwright is installed outside the repository.
Run it separately from native tests because both intentionally edit the same
synthetic child. Screenshots go under `.dev-data/`.

Generate with `xcodegen generate --spec ios/project.yml`; run only
`FamETCTests/MyCornerTests` and `FamETCUITests/MyCornerUITests` with an explicitly
selected task-owned simulator and derived-data directory. The UI test covers
native Today entry, local load/save recovery, sticker controls, note persistence,
portrait/landscape, sign-out, sibling large-text/dark state and parent visibility.
It does not claim physical-device or spoken VoiceOver testing.

## Local acceptance receipt (2026-09-22)

Baseline `057ece020bd488e5be09947501fea53a4b901098`; Node `v24.21.0`, Xcode
27.1. Five focused Node tests and four native model tests passed. Real web Today
journeys passed CRUD/reload, a separate browser client, explicit conflict review,
load/save retry, keyboard placement, dark/narrow/larger text, account clearing,
parent child-profile hiding and private-note exclusion from HTTP 200 family,
notes and profile responses.

Native iPad full-flow assertions passed in 54.380s, including actual sign-out to
onboarding, sibling-account clearing, dark accessibility text, portrait/landscape,
and parent hiding. Xcode stalled after those assertions while finalizing that
result bundle; its owned process was terminated after more than five minutes.
Separate iPad touch-removal/reopen (19.036s) and iPhone touch-removal/reopen
(22.097s) completed successfully with finalized result bundles. After the drawer typography fix, the final iPad layout/removal check also passed (17.680s), with screenshots visually reviewed. The iPad fixture
is primary: use the whole MyCornerUITests class there. On iPhone select
`testTouchPlacementAndRemoval`; the full flow's sidebar sign-out check is iPad-specific.

Logs, screenshots and the single task checkpoint are in ignored `.dev-data/`.
No physical-device or spoken VoiceOver testing is claimed. No full suite, hosted
CI, push, merge, upload or deployment was performed. The coordinating task owns
combined integration and independent privacy review with the sibling features.

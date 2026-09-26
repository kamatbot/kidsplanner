# Koko study pal

Optional child-only Today companion. The same original illustration is served
from `/img/study-pal/koko.png` on web and bundled as `KokoStudyPal` on iOS.
384×384 RGBA PNG, approximately 176 KiB. No remote dependencies, animation,
sound, rewards, homework inference, or submission claims. The neutral welcome
is the same on every visit and is independent of activity or absence.

Visibility is a device-local boolean under `fam_study_pal_hidden:<user id>`
(web URL-encodes the id). It is correctly keyed by authenticated account;
native view identity changes with the user id. No profile/activity data is
stored. Web storage failures fall back to the current session. The show
control remains visible when the illustration and copy are hidden.

Integration: load `study-pal.css` and `study-pal.js` before app.js, retain the
`today-study-pal` host after the homework support card, and render with the
current session user at bootstrap and Today refresh; clear at sign-out.
Existing support-card CSS uses explicit ordering, so the dedicated CSS gives
Koko homework's order and places it after homework in document order. Native
`KidTodayStack` inserts `StudyPalCard(userID:).id(userID)` after StudyStartCard
only for explicit kid roles. Keep this ordering when integrating newer Today
layouts. XcodeGen discovers the new Swift source and image set automatically.
No API, model, auth, navigation, CSP, or service-worker changes are needed.

The native asset is available offline. The web service worker is intentionally
network-only; this feature preserves that architecture and does not promise
offline web startup. The image has descriptive alternative text if unavailable.

## Illustration provenance

Built-in imagegen tool, generated 2026-09-22 after inspecting the approved
03-study-pal reference. No image-model version is asserted. Original generated
PNG retained in Codex generated_images; production copies resized with sips.
The concept board, its text and branding are not shipped.

Prompt: Create a single production app illustration: Koko, a warm friendly
Asian small-clawed otter with round thin dark glasses. Soft textured storybook
watercolor/gouache quality, warm brown fur, cream cheeks and chest, small rounded
ears, anatomically otter-like little paws. Sitting beside one small open book,
relaxed neutral welcoming expression, no clothing or accessories other than
round glasses. Compact centered complete silhouette, square composition,
genuine transparent background, subtle soft grounding shadow only. Legible at
100px. No text, logos, lettering, UI, frames, badges, rewards or other characters.
Match the warm illustrated character idea in the previously inspected Study
Pal reference; create original standalone character art, not the screenshot.

## Focused verification (2026-09-22)

Node 24.21.0 syntax checks and local Chromium checks against the actual web
Today page passed: account-scoped toggle persistence, keyboard operation,
parent/parent-child-context exclusion, 320px dark and 390px light layouts,
1366px layout, local asset loading, reduced-motion setting, Homework navigation,
and delayed/error/empty homework responses. No full CI was run.

Native iPad Pro 13-inch M5 / iOS 27 simulator: two focused `StudyPalUITests`
passed on the final application source. They cover dark accessibility XXXL
portrait, light layouts, hide/show and relaunch, parent exclusion including
parent child-filter view, a minimum 44pt toggle target, and native Homework
navigation. iPhone 18 Pro / iOS 27 also passed the dark large-text persistence
and parent-exclusion journey before the final touch-target refinement.
Commands, test bundles and screenshots are in `.dev-data/study-pal/` in the
implementation worktree. Run the existing fixture with `FAM_QA_PORT=18347`
and select only `FamETCUITests/StudyPalUITests` for reproduction.

The baseline Watch AppIcon catalog blocks an unmodified simulator build;
focused verification used a command-line-only
`ASSETCATALOG_COMPILER_APPICON_NAME=` override. No release setting was changed.
These are full-app flows with synthetic local API sessions, not production
passkey ceremonies. Manual VoiceOver speech/gesture testing, live sign-out
recovery after initial family-load failure, and native homework failure/empty
journeys remain integration checks. Accessibility labels and state were
exercised through XCTest. Native navigation (including Chat) is preserved;
this change does not redesign the baseline sidebar-adaptable app shell.

Visual QA used full-screen XCTest capture because app-window capture clipped
landscape output on this simulator. The full-screen landscape and portrait
images were inspected successfully after a focused navigation rerun.

# FamETC — Architecture & Maintainability Plan

_Assessed 2026-07-06. Scope: whole repo (Node/Express backend, iOS SwiftUI hybrid shell, web SPA, chrome-extension). Read-only assessment; no source files were changed._

## 1. Current-state assessment

- **Hybrid architecture as designed.** Node/Express backend (`server.js`) + on-disk `public/` web SPA + native SwiftUI shell (`ios/FamETC`) that hosts native tabs (Today/Chat/Calendar/Homework) and `HybridWebView` for secondary surfaces. Matches the RetireOdds model documented in `CLAUDE.md` / `APP-BRIEF.md`.
- **Tests are healthy.** `node --test tests/*.test.js` → 176 pass / 0 fail. 18 backend test files, good `lib/` coverage. No iOS unit tests of note (`FamETCTests` has 2 small files, 173 lines).
- **`lib/` is well-factored.** 31 focused modules, largest is `lib/moodle-client.js` (434). Clear boundaries (auth, billing, chat, calendar, homework, analytics). This is the healthy part of the codebase.
- **Two files dominate the tangle:** `public/js/app.js` (4128 lines, 228 functions, one global-scope SPA) and `server.js` (1673 lines, ~90 routes in one file). Everything else is under 600 lines.
- **The legacy KidsPlanner web app is still committed as dead code:** root `app.js` (1078), `index.html` (430), `styles.css` (706) — the original single-file app (`git log`: "Initial commit: KidsPlanner web app"). The live server serves **only** from `public/`; these root files are never referenced.
- **Feature logic is implemented twice** — natively in Swift and again in the web SPA — for SAT/WordBank/quiz, Notes, Chat, Calendar, Homework, dashboard widgets. Both talk to the same `/api/*` endpoints, so drift risk is behavioral, not data-model.
- **Dead iOS files exist:** `ios/FamETC/App/PlaceholderScreens.swift` (`ComingSoonScreen`, unreferenced) and `ios/FamETC/WebShellView.swift` (superseded by `HybridWebView`; `RootView` uses the latter).
- **Two web-host wrappers coexist on iOS:** `WebShellView`+`WebShellController` (UIKit, owns document-camera modal) vs `HybridWebView` (SwiftUI, the one actually wired in). Unclear which is canonical.
- **Secrets hygiene needs a look:** `.env`, `.env.hostinger`, and `AuthKey_93CXR2FUS5.p8` (an App Store Connect API key) sit in the repo root. `.gitignore` should be verified to exclude all three; the `.p8` in particular must never be committed.
- **`chrome-extension/` is unexplained** — not mentioned in `CLAUDE.md` architecture and no obvious wiring to the product; likely a school-scraping helper or dead exploration. Needs a one-line disposition (keep+document or delete).

## 2. Top 5 maintainability risks

1. **`public/js/app.js` (4128 lines, one file, all globals).** 228 top-level functions in module scope, no modules. Any dashboard/chat/homework change means paging through the whole file. Highest daily-friction file in the repo. `/Users/kamatbot/Documents/Claude/Planner/public/js/app.js`
2. **Dead legacy KidsPlanner app committed at repo root.** `app.js`, `index.html`, `styles.css` — 2214 lines of code that looks live (real feature data, auth UI) but is served by nothing. A future edit here is wasted work or a footgun. `/Users/kamatbot/Documents/Claude/Planner/{app.js,index.html,styles.css}`
3. **`server.js` monolith (1673 lines).** ~90 routes across auth/billing/family/chat/calendar/homework/analytics in one file with inline helpers. `lib/` already holds the logic — the routes should be grouped into route modules under the existing `lib/routes/` dir (which exists but is underused). `/Users/kamatbot/Documents/Claude/Planner/server.js`
4. **Native/web feature duplication with no shared contract.** SAT/Notes/Chat/Calendar exist in both `ios/FamETC/Features/**` and `public/js/app.js`. Divergence is invisible until a user sees different behavior across surfaces. `/Users/kamatbot/Documents/Claude/Planner/ios/FamETC/Features/Today/SATActivityView.swift` (562) vs `public/js/app.js`.
5. **Secrets + private key in working tree.** `AuthKey_93CXR2FUS5.p8`, `.env`, `.env.hostinger`. If any is git-tracked it's a credential leak. `/Users/kamatbot/Documents/Claude/Planner/AuthKey_93CXR2FUS5.p8`

## 3. Phased refactor plan

Pragmatic, deletion-first. No rewrites, no new dependencies. Each task is sized for one agent session, with a runnable acceptance check. Run from repo root `/Users/kamatbot/Documents/Claude/Planner`.

> **Implementation status (updated 2026-07-06).** Phases 1 (web), 2, and 3 are **done** on `main`, 176/176 tests passing throughout:
> - Phase 1 web — root `app.js`/`index.html`/`styles.css` deleted; `chrome-extension/` documented + kept (it's the live MV3 Moodle importer); secrets confirmed already untracked/gitignored.
> - Phase 2 — `server.js` 1673 → **593 lines**; routes extracted into `lib/routes/{homework,calendar,chat,family,learning,school,push,billing,auth}.js` via a shared `routeDeps` object. Stripe webhook intentionally left in `server.js` before `express.json()`. Boot-smoke + handler-body checks verified.
> - Phase 3 — `public/js/app.js` 4128 → **2986 lines**; helpers/notes/SAT/school split into `public/js/{util,notes,sat,school}.js`, loaded before `app.js`. `client-bundle.test.js` green.
> - **Phase 1 iOS — NOT done (deliberately deferred, owner decision 2026-07-06).** Two corrections to this plan's assessment: (1) `PlaceholderScreens.swift` is **live**, not dead — it defines `HomeworkScreen`, used by `RootView` for the Homework tab; do not delete. (2) The genuine dead island is `WebShellView → WebShellController → Bridge`, unwired since `HybridWebView` replaced it — but `WebShellController` is the sole path to `Bridge → ScannerService → DocumentScannerViewController`, so the **native document scanner is currently unreachable in the shipping app** and deleting the island would remove the only scanner integration. Left in place pending a decision on whether to re-wire the scanner into `HybridWebView`.

### Phase 1 — Delete dead weight (highest ROI, lowest risk)

- [ ] **Verify secrets are ignored, then confirm the `.p8` is untracked.**
  - Check: `git ls-files AuthKey_93CXR2FUS5.p8 .env .env.hostinger` returns **nothing**. If any is listed, `git rm --cached` it and add to `.gitignore`.
  - Accept: `git ls-files | grep -E 'AuthKey_.*\.p8|^\.env'` → empty.
- [ ] **Delete legacy root web app.** Remove `/app.js`, `/index.html`, `/styles.css` (the KidsPlanner single-file app). Confirmed served by nothing — server serves only `public/`.
  - Accept: `grep -rn "sendFile\|static" server.js | grep -v PUBLIC` → no ref to root files; `node --test tests/*.test.js` still 176 pass; `git grep -l "KidsPlanner" -- '*.html'` → empty.
- [ ] **Delete dead iOS files.** Remove `ios/FamETC/App/PlaceholderScreens.swift` and `ios/FamETC/WebShellView.swift` (+ `WebShellController.swift` only if nothing else references it — grep first). Remove their entries from `project.pbxproj`.
  - Accept: `grep -rn "ComingSoonScreen\|WebShellView\b" ios/FamETC --include='*.swift'` → empty; `xcodebuild -scheme FamETC -project ios/FamETC.xcodeproj -destination 'generic/platform=iOS' build` succeeds.
- [ ] **Decide `chrome-extension/`.** One session: trace whether anything ships/uses it. If not, `git rm -r chrome-extension` and note in `CLAUDE.md`; else add a two-line purpose to `CLAUDE.md`.
  - Accept: `chrome-extension` is either gone or documented in `CLAUDE.md`.

### Phase 2 — Break up `server.js` into route modules (`lib/routes/` already exists)

Move route groups out one at a time; each group is a `module.exports = (app, deps) => {...}` wired from `server.js`. Keep helpers (`requireAuth`, etc.) in a shared `lib/routes/_middleware.js`. No behavior change.

- [ ] **Extract billing routes** (`/api/billing/*`, lines ~371–461 + webhook ~128) → `lib/routes/billing.js`.
  - Accept: `node --test tests/*.test.js` passes; `grep -c "app.post(\"/api/billing" server.js` → 0.
- [ ] **Extract webauthn/auth routes** (`/api/webauthn/*`, `/api/auth/backup/*`, `/api/kid/*`) → `lib/routes/auth.js`.
  - Accept: `tests/kid-login.test.js` + `tests/school-account.test.js` pass; server boots (`node -e "require('./server.js')"` with test env, or a smoke `curl /api/health`).
- [ ] **Extract chat + gifs routes** → `lib/routes/chat.js`. **Extract calendar + events** → `lib/routes/calendar.js`. **Extract homework** → `lib/routes/homework.js`. (One route module per session.)
  - Accept per module: relevant `tests/*.test.js` pass; `wc -l server.js` strictly decreases each session; target `server.js` < 700 lines by end of phase.

### Phase 3 — Modularize `public/js/app.js` (split the 4128-line SPA)

No framework, no bundler change. Split by feature into separate `<script>` files loaded from `public/index.html`, keeping the existing global-function style (lazy: preserve the working pattern, just co-locate). Extract shared helpers first so feature files can depend on them.

- [ ] **Extract pure helpers** (`isoDate`, `parseIso`, `formatLong`, `fmt12`, `mondayOf`, `uid`, `load`/`save`, `dailyPick`, lines ~656–712) → `public/js/util.js`, add `<script src="/js/util.js">` before `app.js` in `public/index.html`.
  - Accept: `node --test tests/client-bundle.test.js` passes; app loads in browser with no console errors (or grep: `grep -c "function isoDate" public/js/app.js` → 0).
- [ ] **Extract SAT/WordBank/quiz block** (lines ~217–655) → `public/js/sat.js`. **Extract notes** (~248–397) → `public/js/notes.js`. **Extract school-import + homework-AI** (~3173–3600) → `public/js/school.js`. One feature per session.
  - Accept per file: `public/index.html` loads all scripts; `grep -c "renderSatActivity\|loadNotes\|parseHomeworkWithAI" public/js/app.js` drops to 0 for the moved block; manual smoke of that surface.
  - Note: `public/index.html` is a hand-maintained page; if a build step assembles it, update the source template, not the output.

### Phase 4 — Contain native/web duplication (guard against drift, don't rewrite)

Do NOT unify native and web implementations — that's a rewrite. Instead make divergence detectable.

- [ ] **Document the parity contract.** Add a short table to `CLAUDE.md`: for each feature that exists in both surfaces (SAT, Notes, Chat, Calendar, Homework), list the shared `/api/*` endpoints and the two files that implement it (`ios/FamETC/Features/...` + `public/js/...`). This turns invisible drift into a checklist.
  - Accept: `CLAUDE.md` has a "Native/Web parity" section naming both files per feature.
- [ ] **Add a parity smoke test** for the shared API shapes both clients consume (e.g. `/api/wordbank`, `/api/homework`) so a server response-shape change that would silently break one client fails a test.
  - Accept: new `tests/parity.test.js` asserts response keys; `node --test tests/*.test.js` passes.

## 4. Shared components (copied from / shared with RetireOdds)

The `CLAUDE.md` and `APP-BRIEF.md` state FamETC was scaffolded from RetireOdds via a rename map (`kp_`→`fam_`, `RO_`→`FAM`). Confirmed shared/ported pieces:

- **Backend server foundation** — `server.js` structure (security headers, rate limiting, cookie-session, passkey/WebAuthn flow, Stripe billing, static serving, `sendPage`). Ported from the RetireOdds Express server. `/Users/kamatbot/Documents/Claude/Planner/server.js`
- **Analytics engine** — `lib/analytics.js` header: _"ported from RetireOdds"_. Zero-dependency aggregated daily counters + A/B experiments, same pattern as the `lite-analytics` skill. `/Users/kamatbot/Documents/Claude/Planner/lib/analytics.js`
- **Push senders** — `lib/apns-sender/` and `lib/webpush-sender/` (READMEs reference RetireOdds origin). Zero-dep APNs (JWT) + Web Push clients. `/Users/kamatbot/Documents/Claude/Planner/lib/{apns-sender,webpush-sender}/`
- **iOS hybrid shell** — the WKWebView + native-tabs pattern: `ios/FamETC/App/RootView.swift`, `ios/FamETC/App/HybridWebView.swift`, `ios/FamETC/Bridge.swift`, `ios/FamETC/WebShellController.swift` (comments explicitly cite RetireOdds `VoiceExpenseController` as the out-of-scope original). `/Users/kamatbot/Documents/Claude/Planner/ios/FamETC/`
- **Design system** — `ios/FamETC/DesignSystem/Theme.swift` (`Palette`, `Space`, `Typography`) — the "Horizon" design tokens referenced in `CLAUDE.md`. `/Users/kamatbot/Documents/Claude/Planner/ios/FamETC/DesignSystem/`
- **iOS domain/auth scaffolding** — `ios/FamETC/Domain/AppStore.swift`, `ios/FamETC/Onboarding/{AuthService,OnboardingView}.swift` (passkey + shared-cookie session, RetireOdds pattern).
- **Deploy flow** — `scripts/deploy-hostinger.sh` + `scripts/pack-deploy.sh` (Hostinger deploy pipeline from the RetireOdds model per `CLAUDE.md`).
- **Net-new (NOT copied)** — family group model (`lib/family.js`), family chat (`lib/chat.js`), Moodle/school-feed integration (`lib/moodle-client.js`, `lib/school-feeds.js`, `lib/homework.js`), document scanner (`ios/FamETC/DocumentScannerViewController.swift`). Per file headers, these have no RetireOdds equivalent.

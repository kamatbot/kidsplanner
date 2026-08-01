# Trips — project handoff notes

> Written 2026-08-01 at the close of the build sessions that shipped Trips
> v1 + v1.1. Audience: any engineer (human or agent) picking this feature up
> cold. The API/data contract lives in [TRIPS-PLAN.md](TRIPS-PLAN.md); this
> document is the narrative: what exists, why it's shaped this way, every
> decision made with the owner, how to operate it, and what's still open.

---

## 1. What Trips is

Collaborative vacation planning at **fametc.com/trips**. A parent creates a
trip and invites OTHER ADULTS (outside the FamETC family) via a shareable
link. Together they build a day-by-day itinerary (with voting and comment
threads), track flights and lodging, keep packing lists, and talk in a
per-trip chat room. Trip dates/flights/check-ins surface automatically in
the family calendar — including the native iOS calendar with zero app
changes. UX reference: the "Waypoint" mock (same Horizon design tokens as
the app, ported 1:1).

**Current state: fully merged to `main`** across four PRs, all squash-merged:

| PR | Contents |
|---|---|
| #1 | Trips v1 — backend core, chat rooms, notifications, calendar merge, web UI, iOS multi-room chat + Trips webview tab |
| #2 | Destination-first create-trip hero |
| #3 | v1.1 — ideas bucket, packing checklists, paste-to-import, vibrant invite landing, unified hub header |
| #4 | fix: sent chat messages rendered twice (web long-poll race) |

Plus a direct-to-main commit (owner): trip updates also post card messages
into the trip chat room, making it the live activity stream.

Test suite at handoff: **329/329 green** (`node --test`). Trips-specific
suites: `tests/trips*.test.js`, plus extensions to `chat`, `calendar-routes`
and `ai-route` suites.

**NOT yet done** (see §8): Hostinger deploy of the merged main; Xcode
build/test verification of the Swift changes (never compiled in the build
environment — Linux); `/security-review` before outside families use it.

---

## 2. Decision log (chronological, all owner-confirmed)

| # | Decision | Choice | Rationale / notes |
|---|---|---|---|
| 1 | Guest access model | **Free passkey "trip guest" accounts** — invite link → normal passkey signup, zero families, sees only their trips | Consistent with passkey-only auth; user records are family-agnostic so no auth changes were needed. Rejected: magic-link no-account (weak security, parallel auth path), full paid accounts (too much friction). |
| 2 | Kids' access | **Read-only** for kids on trips their family is on | Later amended by decision 10 (packing carve-out). Kids never see trip chat or invite links. |
| 3 | Trip chat | **Per-trip room on the existing chat engine** | Scope-key generalization (`trip:<tripId>`), not a new system. Encrypted at rest like family chat. |
| 4 | Platform split | **Trip chat + trip calendar events NATIVE on iOS; everything else webview** at /trips | Owner's exact words: "calendar and chat should work in native iOS app. rest can be webview." |
| 5 | Billing | **No paywall on trips in v1** | Consistent with the rest of the app (no gate enforced anywhere); trips are a retention feature, not a monetization surface. |
| 6 | Invites | **Shareable high-entropy link only** (24-char revocable code); no email invites | The repo has no mail infrastructure; link-grain matches family invite codes and kid pollTokens. |
| 7 | Trip↔family calendar | **Server merges read-only trip events into GET /api/calendar/events** | The decisive trick: iOS FamilyEvent decoding is unchanged, so the native calendar got trips for free. Itinerary items deliberately do NOT flood the calendar — only trip span, flights, lodging check-in/out. |
| 8 | Expense splitting | **Never built here — owner uses retireodds.com/split** (2026-08-01) | Recorded as permanently out of scope in TRIPS-PLAN.md. Do not re-propose. |
| 9 | Wanderlog-gap features (v1.1) | Build **ideas bucket, packing checklists, paste-to-import**; skip flight-status APIs, deals, community guides | From a Wanderlog feature comparison. Chat/voting/calendar/kid-access/encryption were already FamETC advantages. |
| 10 | Kid-write carve-out | A kid fully manages **their OWN packing list** and nothing else | The ONE exception to decision 2. Enforced via `requireTripAnyAccess` + per-handler ownership checks, fully covered by route tests. |
| 11 | Email import | **Paste-to-import instead** — `POST /api/ai/parse-booking` (Claude, env-gated `ANTHROPIC_API_KEY`, shared daily quota) | Wanderlog's email magic without mail infra. Prompt emits dates shaped like "Jun 3, 21:50" so the calendar merge can parse them. |
| 12 | Maps | **Deferred, deliberately** | Needs either external tile servers or Google Maps — both break the strict `default-src 'self'` CSP. Revisit only as an explicit CSP/product decision, never sneak it in. |
| 13 | Invite preview | **Public (unauthenticated), rate-limited** | Anyone holding the link can join anyway; auth-gating the preview only degraded the landing page. Payload carries no ids/emails; errors never reveal whether a code exists. |
| 14 | Invite landing design | Trip name + inviter + countdown over **inline-SVG scenery picked from destination keywords** (beach/mountain/city/flight) | CSP forbids external imagery; scenes are hand-built SVG, self-colored in both themes. |
| 15 | Create-trip UX | **Destination-first gradient hero**: rotating city placeholder, self-writing trip name, date preset chips, live "7 days · in 6 days" chip; first-run lands in the hero | Uses the brief's one momentum-gradient element per screen (coral→violet, fixed light-palette stops in both themes — matches the auth pages). |
| 16 | Hub header | **Single sticky row** per the mock: brand tile (doubles as back-to-app link) + divider + trip title + avatars + invite; inner width capped at 1160px | Fixes the wide-screen full-bleed drift the owner flagged. |
| 17 | Trip-update chat cards | Trip events (itinerary/flight/lodging adds, joins) **post card messages into the trip room** (owner, direct to main) | Reuses the family-chat "event card" pattern; wakes open long-polls so the room doubles as the live feed. |

Standing project rules that constrained everything: APP-BRIEF.md is a
contract (Identity/Design rows untouched — Trips is recorded there as an
addendum); `fam_` prefixes; encryption at rest; no secrets in repo; strict
CSP (no third-party requests); conventional commits per completed task.

---

## 3. Architecture

### Why a trip is its own scope object
The family model hard-caps `MAX_PARENTS = 2` (lib/family.js) and
`requireFamily` assumes one family per user (server.js). Trips therefore
NEVER route through `req.family`: `root.trips[tripId]` holds its own
`members[]` (cap 12, roles `owner`/`editor`), resolved by `requireTrip`
middleware (404 unknown → 403 non-member → 403 kid-read-on-non-GET) in
lib/routes/trips.js. Guests are ordinary passkey users with zero families —
a state the user model always supported.

### Data & encryption
Everything trip lives inside `db.json` under `root.trips[tripId]` —
whole-file AES-256-GCM encryption at rest via lib/datacrypto.js (prod boot
refuses without `DATA_ENCRYPTION_KEY`). Trip chat messages live in the
existing chat store (SQLite via better-sqlite3, JSON fallback) under scope
key `"trip:" + tripId`, body/card field-encrypted. Record shapes: see
TRIPS-PLAN.md "Data model" + "v1.1".

### Chat
lib/chat.js is scope-key generic: a scope is a familyId (behavior
byte-identical to pre-Trips) or `trip:<tripId>` (existence via
trips.getTrip, senderType `"member"`, delete = owner-or-author — trip
editors do NOT get family-parents' delete-any power). Long-poll transport
(`?afterId=&wait=1`, 25s hold, 10 waiters/scope) identical to family chat.
`GET /api/chat/rooms` drives the iOS room list (family room + member trips;
guests get trips only; kids get no trip rooms). Messages are decorated at
the route layer with `roomId` + `senderName` (members include outside
adults the client can't resolve; names come from profile names ONLY —
never emails).

**Hard-won rule (PR #4, and iOS build-24 before it): send paths MERGE by id,
never raw-append** — the server emits to long-poll waiters before the send
POST returns, so the in-flight poll usually delivers your own message
first. Both platforms now carry "NEVER append" comments at the send sites.

### Calendar merge
lib/routes/calendar.js appends read-only synthetic events (`canEdit:false`,
`source:"trip"`, `category:"trip"`, ids `trip_ev_*`) to
`GET /api/calendar/events` for every trip visible to the requester (member,
co-parent-of-member, or kid-read). Flight/lodging dates are free text —
`parseTripFreeTextDate` parses "Jun 3, 21:50"-shaped strings using the
trip's own year(s) and SKIPS (never guesses) ambiguous ones, including
year-boundary trips. `familyId` on synthetic events is the REQUESTER's
family, not the trip's.

### Notifications
lib/fam-notifications.js `notifyTripChatMessage` / `notifyTripEvent` fan
out APNs + web push to `trip.members[]` minus actor. Registries are
userId-keyed, so guests get push with zero changes. `thread-id:
"trip-<id>"`, famTypes `trip_chat_message` / `trip_update`, `data.url:
"/trips/<id>"`. Push never blocks a response (try/catch convention).
Checklist actions deliberately send NO push (noise).

### Invites
24-char codes from the unambiguous alphabet (~118 bits), owner
regenerate/disable, join idempotent + `authLimiter`-limited, errors
identical for unknown vs disabled codes. Preview endpoint public per
decision 13.

### Apple UGC (guideline 1.2) compliance
Comments and trip chat both ship flag/report + owner-delete-any(+author);
members are removable (block equivalent). Mirrors family chat's controls.

---

## 4. Web UI

Standalone pages (the billing.html precedent — NOT part of the 4,100-line
app.js shell):
- `public/trips.html` + `public/js/trips.js` (~2k lines) + `public/css/trips.css`
  — serves both `/trips` (list + create-hero) and `/trips/<id>` (hub) via
  `location.pathname` + pushState. Hub tabs: Overview / Itinerary (Ideas
  panel + day sections, HTML5 drag between days and ideas) / Flights /
  Lodging / Packing / Chat / People. Kid sessions render read-only except
  their own packing card.
- `public/trip-join.html` — fully self-contained invite landing (own inline
  styles + SVG scenes; falls back to a generic card if the server still
  auth-gates the preview).
- `public/index.html` sidebar gained a plain `<a href="/trips">` (separate
  page — not a `switchNavTab` tab); app.js `bootstrapSession` redirects
  family-less guests with ≥1 trip to /trips instead of the create-family
  panel.
- All fetches go through `window.auth.*` wrappers in public/js/auth.js
  EXCEPT the chat long-poll (needs AbortController; mirrors app.js).
- House rules honored: template-literal `innerHTML` + `esc()` on all user
  content (onclick args are server-generated ids only), Horizon tokens only
  (dark mode by construction), `tests/trips-bundle.test.js` guards the
  page's script set for global clashes.

---

## 5. iOS

Changes shipped in PR #1 (`ios/FamETC/**`), **written on Linux and never
compiled — Xcode build + FamETCTests/ChatMergeTests/ModelDecodingTests +
ChatFirstLoadUITests must be verified on a Mac**. Owner bumped build 30 to
TestFlight after the merge, which suggests it builds, but nobody has
confirmed the test suites or a device run of multi-room chat end-to-end.

- `ChatMessage` gained optional `roomId`/`senderName` (old caches/fixtures
  still decode); new `ChatRoom` model; `APIClient` routes room
  `"family"` to the legacy endpoints byte-identically and `"trip:<id>"` to
  `/api/trips/<id>/chat/messages`.
- `AppStore`: `messagesByRoom` dictionary (computed `messages` mirror keeps
  family-room call sites/tests intact), `activeRoomId` drives one near-live
  loop for the on-screen room + an always-on 8s family poll, per-room
  lastSeen under `fam_last_seen_chat_<roomId>` (legacy key migrates),
  unread badge = sum. `mergeIncoming`/`dedupe` remain the ONLY upsert path.
- Chat tab: unchanged single-room UX until ≥2 rooms exist, then a room list
  (NavigationStack); iPad docked column keeps family + a switcher Menu.
- `Tab.trips` webview (`HybridWebView(path: "/trips")`) in all three
  layouts — the app's FIRST live webview surface. Watch: FloatingTabBar at
  6 icons on small iPhones; the webview has no navigation delegate (external
  links open in-place — the old WebShellController policy was never wired).
- Push: `trip_chat_message`/`trip_update` select the Chat tab and flag the
  room via `pendingChatRoomId`. Full deep-linking remains unbuilt app-wide.
- Calendar needed NO changes (see §3); polish only: airplane icon/teal for
  `category == "trip"`, multi-day expansion cap 62→120 days (Agenda.swift).

---

## 6. Operations runbook

**Deploy (web)** — standing authorization: test → commit → deploy → verify
LIVE. `node --test` (329 green expected) → deploy `main` via the Hostinger
MCP / `scripts/deploy-hostinger.sh` → verify `/api/health` build label, then
live-check /trips, an invite link in a logged-out browser, and chat between
two browsers.

**Env vars (Hostinger panel)**: `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`
(loss = data loss; offline backup location must be recorded in APP-BRIEF
before real families — still ⚠ TBD there), `FAM_DATA_DIR`, and
`ANTHROPIC_API_KEY` — without it paste-to-import returns 503 and the UI
degrades gracefully; everything else works.

**iOS ship**: Xcode build + test suites → TestFlight (never auto to App
Store). Verify on device: room list appears once a trip exists, cross-post
web↔native, trip push arrives and lands on Chat.

**Local dev / QA loop used throughout (works headless):**
```
node scripts/dev-login.js --json         # dev account + signed fam_sess cookie
FAM_DATA_DIR=<tmp> PORT=4301 node server.js
# drive/screenshot with playwright-core + /opt/pw-browsers chromium
# (see scratchpad pattern: addCookies with the cookieHeader, goto /trips)
```
Gotchas that cost time: the server caches page/JS files in memory — RESTART
after editing public/; `pkill -f "node server.js"` matches your own compound
shell command (exit 144) — kill by PID.

---

## 7. Testing conventions (match these)

- Preamble: `process.env.FAM_DATA_DIR = fs.mkdtempSync(...)` BEFORE any
  lib require (db.js caches on first load); add `DATA_ENCRYPTION_KEY` to
  exercise crypto paths.
- Lib-level tests build real users/families/trips via the real stores;
  route-level tests use the no-HTTP harness from
  tests/calendar-routes.test.js (capture handlers from the `(app, deps)`
  module signature, stub middleware, inject `req.trip`). Only 3 suites boot
  the real server.
- `tests/client-bundle.test.js` + `tests/trips-bundle.test.js` vm-compile
  each page's script set to catch top-level global clashes — new page
  scripts must be added there.
- Never test the live Anthropic call — validation paths only (503/400/422).

---

## 8. Open items & suggested next steps

**Must do before real outside families:**
1. Deploy current `main` to Hostinger + live verification (§6).
2. Xcode build + test pass + on-device multi-room chat verification (§5).
3. Run `/security-review` — on record in APP-BRIEF as the gate before
   non-owner families; trips added an unauthenticated endpoint (join
   preview) and an LLM-parsing endpoint since the last look.
4. Record the `DATA_ENCRYPTION_KEY` offline-backup location in APP-BRIEF.

**Known rough edges / small follow-ups:**
- Trip hub tab count is 7; tabs scroll horizontally on phones — fine, but
  revisit if another tab is ever added.
- `GET /api/trips` scans all trips per request (documented as fine at this
  scale; index if trips ever number in the thousands).
- iOS room list shows last-message preview only for visited rooms; trip
  rooms have no background polling (family only) — acceptable v1 choices,
  revisit if users expect live trip badges.
- Guests who leave/get removed from their only trip land on /trips' empty
  state with no family — the create-family path is still available to them
  from `/`; no dedicated "guest → full family account" upsell exists yet.

**Roadmap candidates (from the Wanderlog comparison, owner-aware):**
- Trip AI assistant (itinerary suggestions via the existing Claude route).
- Per-trip ICS export feed (token-gated) for non-FamETC calendar apps.
- Map view — ONLY as an explicit CSP decision (decision 12).
- iOS native trips UI, billing gate, trip photos: all explicitly deferred.

---

## 9. File map (trips-touching)

| Area | Files |
|---|---|
| Contract & decisions | docs/TRIPS-PLAN.md (v1 + v1.1 contract), APP-BRIEF.md (Trips addendum), this file |
| Store/domain | lib/trips.js |
| Routes | lib/routes/trips.js (CRUD, invites, itinerary, flights, lodging, checklists, trip chat), lib/routes/chat.js (rooms + senderName), lib/routes/calendar.js (merge), lib/routes/ai.js (parse-booking) |
| Chat engine | lib/chat.js (scope keys), lib/chat-store.js (untouched — scope key rides family_id column) |
| Push | lib/fam-notifications.js (notifyTripChatMessage/notifyTripEvent) |
| Server wiring | server.js (require + routeDeps + page routes /trips, /trips/:id, /trips/join/:code) |
| Web | public/trips.html, public/js/trips.js, public/css/trips.css, public/trip-join.html, public/js/auth.js (wrappers), public/index.html (sidebar), public/js/app.js (guest redirect + chat merge fix) |
| iOS | ios/FamETC/Networking/{Models,APIClient}.swift, Domain/{AppStore,DiskCache}.swift, Features/Chat/ChatView.swift, Features/Trips/TripsScreen.swift, App/{RootView,NotificationHandler}.swift, Features/Shared/{Agenda,AgendaRow}.swift, Features/Calendar/MonthCalendarView.swift |
| Tests | tests/trips.test.js, trips-routes, trips-chat, trips-calendar, trips-bundle + extended chat/calendar-routes/ai-route suites; ios/FamETCTests updated |

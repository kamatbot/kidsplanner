# Screen Time plan — app-only signup, onboarding and architecture

Status: **plan, not built.** Drafted 2026-10-01 from the owner's request:
parents download Fam ETC, create a family and pick **the whole Fam ETC**
(invite code) or **Screen Time** (open to everyone). Screen Time families get
guided kid-device setup (install, passkey, the deal), a Screen Time home, and
can upgrade to the whole app later.

Builds on [SCREEN-TIME-PLAN.md](SCREEN-TIME-PLAN.md) (server contract) and
[SCREEN-TIME-UX.md](SCREEN-TIME-UX.md) (states, alerts, presentation, the
2026-09-30 owner decisions). Where this plan touches Screen Time behaviour,
those documents still win. "Essentials" already means essential apps in Screen
Time, so this tier is never called Essentials.

---

## 0. Decisions needed before building

| # | Decision | Recommendation |
|---|---|---|
| D1 | **APP-BRIEF Identity row "Pitch / target user" changes** (today: a hub for St Andrews families). A Screen Time product for everyone widens the target user. Per CLAUDE.md this needs explicit owner confirmation and a list of affected files (§9). | Keep the name and pitch; add a second line: "Screen Time for any family, free, in the app." |
| D2 | Price of the Screen Time plan. | Free while Screen Time is in TestFlight/early App Store; revisit under the existing StoreKit-later decision. No paywall code in this plan. |
| D3 | Fams in the Screen Time plan (today "more time" costs fams, earned from homework, Daily 4, news, school points, chores). Without the hub, kids can only earn from chores/lessons. | Screen Time families ask for more time **without fams**. Fams appear after upgrade. |
| D4 | What a Screen Time parent sees on fametc.com. | A single "Fam ETC Screen Time lives in the app" page with sign-out and account deletion; no web hub. |
| D5 | Upgrade path. | Settings → "Get the whole Fam ETC" → invite code → instant upgrade for the whole family; no downgrade in v1. |

Everything below assumes the recommendations.

---

## 1. Product model

- A **family** has a `plan`: `"full"` (the whole Fam ETC) or `"screen_time"`.
  Plan lives on the family, not the user, so co-parents and kids always agree.
- Existing families (no `plan` field) read as `"full"` — nobody loses anything.
- `"screen_time"` unlocks: auth, family management (parents, kids, codes),
  Screen Time (policy, devices, deal, alerts, more-time requests, usage), push,
  account deletion. Nothing else.
- `"full"` unlocks everything, as today.
- The **invite code stops gating account creation** and starts gating the
  **full plan**. Anyone can make a passkey account in the app and create a
  Screen Time family; the full plan (at family creation or later) requires a
  valid invite code checked on the server.

Why this split is safe: the server decides features from `family.plan`, and
only the server can set `plan = "full"`, only after checking the invite code.
A spoofed client can at most create a Screen Time family, which grants nothing
beyond what the plan offers.

---

## 2. Parent onboarding (iOS)

One flow, size-class adaptive (iPad: centred 560 pt card on a full-screen
background; iPhone: full screen). Every step is resumable: quitting mid-way
reopens at the first unfinished step (state from the server, not local flags).

```
Welcome ─┬─ Set up Fam ETC ──► Choose ──► Name + passkey ──► Family ──► Kids ──► Recovery codes ──► Notifications ──► Device setup (per kid) ──► Home
         ├─ I already have an account (passkey / backup code — unchanged)
         └─ I'm a kid  ──► kid flow (§3)
```

1. **Welcome.** Logo, one line: "Family life, sorted — or just screen time."
   Buttons: **Set up Fam ETC** · I already have an account · I'm a kid.
2. **Choose** (two large cards, the decision of this flow):
   - **Screen Time** — "Bedtime, daily limits and a deal you make together.
     For any family." Badge: Free.
   - **The whole Fam ETC** — "School calendar, homework, family chat, trips,
     meals — plus Screen Time." Badge: Invite code. Tapping it reveals the
     invite-code field inline; an invalid code keeps the parent on this card
     with "That code didn't work — check it, or start with Screen Time and
     upgrade later."
   Footnote: "You can add the whole Fam ETC later."
3. **Your name + passkey.** Name field → "Create my passkey" (Face ID).
   Copy: "No password. Your face or fingerprint signs you in."
4. **Family.** Family name prefilled "The {Surname} family" (editable). Time
   zone taken silently from the device and stored on the family (fixes today's
   unset `family.timezone`, which Screen Time already reads).
   Co-parent with a family code: "Joining your partner's family? Enter their
   code" link → join path (plan inherited; no invite code needed even for a
   full family, because the family already passed the gate).
5. **Your kids.** Add 1+ kids: first name, optional emoji/colour. "Each kid
   gets their own sign-in on their own iPhone or iPad." (Creating profiles here
   is the parent's consent — same COPPA/PDPA basis as today.)
6. **Recovery codes.** Existing `RecoveryCodesView`, unchanged.
7. **Notifications.** "Get a nudge when a kid asks for more time or a device
   needs a look." → system prompt. Skippable.
8. **Set up each kid's device** — the checklist (§2.1). "Do it later" lands on
   Home with the checklist pinned at the top.

### 2.1 Device setup checklist (parent, per kid)

The single setup entry required by the 2026-09-30 decisions; explicit and
resumable. Each row shows the evidence-based state from the server, never a
guess.

| Step | Parent sees | Done when (server evidence) |
|---|---|---|
| 1. Get Fam ETC on {Kid}'s device | App Store QR + "Send link" share sheet. Tip: "Their device needs a passcode." | Kid access request received for this kid |
| 2. {Kid} signs in | Big QR + 6-character code: "On {Kid}'s device, open Fam ETC, tap **I'm a kid**, scan this." | Request exists |
| 3. Approve | Inline **Approve {Kid}** button (also arrives as a push + the existing approval banner) | Request approved; kid passkey registered |
| 4. Make the deal + turn on Screen Time together | "Sit with {Kid}. On their device, follow *Make our deal*. If {Kid}'s Apple Account is in your Family Sharing, you'll approve with your Apple ID; otherwise choose *Without Family Sharing*." | Agreement signed and device enrolled |
| 5. Check protection | Existing **Check protection** + per-device status | Device health reports current rules applied (SCREEN-TIME-UX "evidence-based status") |

Multiple devices per kid: after step 5, "Add another device for {Kid}" repeats
steps 1–5 (the kid signs in with their passkey or the same QR flow).

---

## 3. Kid onboarding (iOS, on the kid's device)

```
Welcome ─► I'm a kid ─► Scan code (or type it) ─► "Are you Maya?" ─► Ask your grown-up ─► Passkey ─► Make our deal (existing flow) ─► Kid home
```

1. **I'm a kid** (existing entry).
2. **Scan the code** on the parent's phone (camera) or type the 6 characters.
   The QR carries the family code **and the kid it was shown for**.
3. **Are you {Kid}?** Confirms the pre-created profile (from parent step 5).
   "Not me" falls back to the existing name-entry request.
4. **Waiting:** "Ask your grown-up to tap Approve." (existing polling).
5. **Passkey:** "Make your sign-in" → Face ID / passcode (existing
   `completeKidPasskey`).
6. Straight into **Make our deal** — the existing `ScreenTimeKidSetupSheet`
   (review → permission → signatures → verification), full screen.
7. **Kid home** (§4.2).

Risk to verify on a real device before committing to passkeys for kids:
passkey creation on a kid device **without an Apple Account signed in** (common
for the "without Family Sharing" families). If it fails, fall back to a
device-bound sign-in token issued on approval (the watch-pairing pattern in
`lib/watch-auth.js`), kept in the Keychain.

---

## 4. Home screens (Screen Time plan)

The hub tabs (Calendar, Homework, Chat, Planning) do not exist for Screen Time
families. The app is two places for parents and one for kids.

### 4.1 Parent — **Home** and **Family**

- **iPhone:** tab bar with Home · Family.
- **iPad (regular width):** sidebar with the kid list on the left and the
  selected kid's controls as the detail. This is the parent controls from
  SCREEN-TIME-UX §3 promoted from a modal to the home screen itself.

Home, top to bottom:
1. Existing alert/request banners (unchanged, one-tap dismiss).
2. **Setup checklist** card while any kid is unfinished (§2.1).
3. One card per kid: neutral evidence-based status line + next action
   ("Bedtime 21:00–07:00 · 1 h 10 m of 2 h today"), quick actions **Pause**,
   **+15 min**, **Rules** (opens the same controls).
4. **More-time requests** inline (approve / decline).
5. Quiet upgrade card at the bottom: "Want the school calendar, homework and
   family chat too? Get the whole Fam ETC." (dismissible for 30 days).

Family (native; replaces the web Settings for this plan): family name; parents
(invite co-parent: code + share); kids (add, rename, remove, devices,
"Set up a device"); your passkeys and recovery codes; notifications; **Get the
whole Fam ETC**; sign out; delete account.

### 4.2 Kid — single screen, no tab bar

The existing `ScreenTimeKidCard` states become the page: the deal card, today's
time left, bedtime, **Ask for more time** (no fams cost on this plan, D3),
"See our deal". iPad: two-column (deal + usage).

---

## 5. Upgrade to the whole Fam ETC

Family → **Get the whole Fam ETC** → invite code → `POST /api/family/upgrade`.
On success the app shows a one-screen "Welcome to the whole Fam ETC" (what's
new: calendar, homework, chat, planning) and rebuilds into the full tab layout.
Other family devices pick it up on their next `/api/me`/family refresh
(foreground), no reinstall. Screen Time keeps everything: policies, devices,
deals, history. Fams start at 0 and earning begins. Downgrade: not offered.

---

## 6. Architecture

### 6.1 Server

| Area | Change |
|---|---|
| `lib/family.js` | `plan` on the family (`"full"` default when absent); `timezone` set at creation; `upgradePlan(familyId)`; `publicFamily` returns `plan` and `features` (`["screen_time"]` or `["screen_time","hub"]`). |
| `lib/routes/auth.js` | `POST /api/webauthn/signup/options` no longer requires the invite code (still rate-limited by `signupLimiter`). If a code is sent and valid, the session records `inviteValidated` for the family step. |
| `lib/routes/family.js` | `POST /api/family {name, plan, inviteCode?, timezone}` — `plan:"full"` requires a valid code (from the request or the signup session); otherwise 403 and nothing is created. `POST /api/family/upgrade {inviteCode}` (parent-only, 403 on bad code). Join by family code needs no invite code. |
| New `requireHub` middleware (`server.js`, beside `requireFamily`) | 403 `{error:"This is part of the whole Fam ETC.", upgrade:true}` when `family.plan !== "full"`. Applied at mount for chat, hermes (+threads), calendar, homework, school, meals, trips, activities, goals, learning, child-insights, actions, decisions, my-corner, ai, watch, fams. Background jobs (school sync, hermes proactive) skip Screen Time families. |
| `lib/screen-time.js` | `requestMoreTime`/`decideRequest` skip the fams balance/spend when `plan === "screen_time"` (D3). |
| `lib/kid-access.js` | Requests may carry `kidId` (from the QR) to **claim a pre-created profile**; approve links to that kid instead of creating one. Without `kidId`, today's behaviour. |
| Setup progress | `GET /api/screen-time` adds per-kid `setup: {requested, signedIn, dealSigned, devices:[health]}` so the checklist is server-evidenced. |
| Invite code hardening | The full-plan gate now matters more: require `SIGNUP_INVITE_CODE` in production (remove the hardcoded fallback in `lib/routes/auth.js`), add it to `.env.example`. Per-code issuing/revocation stays future work. |
| Web | `/app` for a Screen Time family serves the "lives in the app" page (D4). |
| Analytics | `recordSignup(source, plan)`, `recordUpgrade()` — aggregate counters only. |

### 6.2 iOS

| Area | Change |
|---|---|
| `Networking/Models.swift` | `Family.plan: String?`, `features: [String]?` — optional for cache back-compat; absent = full. |
| `Domain/AppStore.swift` | `var productPlan: ProductPlan { .screenTime / .full }` from the family; one source of truth for the UI. |
| `App/RootView.swift` | Switch at the top: `.full` → today's `adaptiveLayout`; `.screenTime` → new `ScreenTimeRootView`. Root-level hooks (banners, push routing, Screen Time load) stay shared; hub push types are ignored on the Screen Time plan. |
| New `Features/ScreenTimePlan/` | `ScreenTimeRootView` (parent Home + Family, kid single screen), `ScreenTimeHomeView`, `DeviceSetupChecklist`, `FamilySettingsView`, `UpgradeView`. |
| `Features/ScreenTime/ScreenTimeParentViews.swift` | Extract the controls body of `ScreenTimeParentSheet` into an embeddable `ScreenTimeKidControls` so Home (iPad detail) and the sheet share it. |
| `Onboarding/` | `OnboardingView` gains Choose / Family / Kids / Notifications / Checklist steps; `KidSignInView` gains QR scan (AVFoundation) and the "Are you {Kid}?" claim. Kid passkey flow unchanged. |
| `ScreenTimeKidViews.swift` | More-time requests hide fams on the Screen Time plan. |

### 6.3 Web

Signup page and marketing stay invite-only for the full hub. Landing/pricing
gain a Screen Time section pointing to the App Store (separate marketing task).

---

## 7. Security, privacy and App Review

- **Server is the gate.** Feature access comes from `family.plan`, set only by
  the server after an invite-code check. `isIOSClient` is spoofable today
  (bare header accepted), so "app only" is a product rule, not a security
  boundary — acceptable, because a Screen Time family gets nothing extra.
- **Kid consent** unchanged: kid profiles exist only because a parent created
  them (onboarding step 5) or approved a request.
- **QR payload** = family code + kid id; it grants nothing without parent
  approval (existing 30-minute, pollToken-gated request).
- **App Review:** Family Controls (Distribution) entitlement for the app and
  all Screen Time extensions (SCREEN-TIME-PLAN distribution gate); reviewer
  account must be able to see both plans (seed one Screen Time family);
  account deletion already exists; listing copy must mention parental
  controls and that Screen Time is free with optional upgrade.

---

## 8. Build order (each step shippable)

1. **Server plan model + gate** (`plan`, `features`, `requireHub`, migration
   default, timezone, tests that walk every mounted route for both plans).
2. **Signup decoupling + upgrade** (invite code optional for accounts,
   required for `full`, `/api/family/upgrade`, production code hardening).
3. **iOS plan switch + Screen Time home** (`ProductPlan`, `ScreenTimeRootView`,
   embedded controls, Family settings, upgrade screen).
4. **iOS onboarding** (Choose, Family, Kids, Notifications, checklist).
5. **Kid claim + QR** (server `kidId` claim, setup progress; iOS scan + claim).
6. **Fams-free more time** on the Screen Time plan.
7. **Web "lives in the app" page**, analytics, App Review prep, TestFlight.

Steps 1–2 are server-only and ship first behind the iOS release that uses
them; old app builds keep working because absent `plan` means full.

---

## 9. Contract updates on approval

- `APP-BRIEF.md` **Identity → Pitch / target user** (D1 — needs explicit
  confirmation), **Architecture → Auth** (invite code gates the full plan, not
  sign-up), **Kids' privacy → Kid sign-in** (QR + claim of a parent-created
  profile), **Monetization** (Screen Time plan free, D2), new **Screen Time
  plan** section linking here.
- `CLAUDE.md` architecture bullet for the plan split.
- `docs/SCREEN-TIME-PLAN.md` endpoints (setup progress, fams-free requests),
  `docs/SCREEN-TIME-UX.md` §1/§3 (controls as the iPad home on this plan).
- Affected code (for the rebrand check): `ios/FamETC/Onboarding/*`,
  `ios/FamETC/App/RootView.swift`, `public/pricing.html`,
  `public/landing.html` FAQ, `docs/marketing/STA-LAUNCH-PLAN.md`.

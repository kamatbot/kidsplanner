# Family Rings — design & implementation brief (Fam ETC web)

**Status:** approved by Mayur on 2026-09-26 ("this is the right direction").
**Implementer:** Astra.
**Design:** Claude (Opus), impeccable direction round seed `19a71449`, the "Family Rings" card.
**Scope:** the whole Fam ETC web app (not the iOS app, not the marketing site).

Reference comps are in this folder and are the visual contract. Match them:

| File | Shows |
|---|---|
| `today-desktop-light.png` | 1600×1000, light |
| `today-desktop-dark.png` | Dark mode |
| `today-mobile-light.png` | 390px wide, full page |
| `today-reference.html` | Standalone HTML with every token and the component CSS. Copy values from it; don't re-derive them. |

---

## 0. One-paragraph summary

Replace the text-heavy "Horizon" look with **Family Rings**: a bright, cool-grey, violet world where every child's day is three rings (Homework, Habits, Daily 3) and the parent's own ring counts **what needs you**. Numbers and rings come first, words second. Tapping a ring or a number takes you to its source. Closing rings is the daily pleasure. Every existing feature stays; only presentation, hierarchy and the design system change.

**Five rules you must not break**

1. **Every ring is a real count** with a defined numerator and denominator (§6). Never decorative or pre-filled. A denominator of 0 renders a dashed empty track plus an empty-state line.
2. **Violet (`--fr-you`) means you and actions only.** Buttons, the parent ring, the now-marker, selection and focus.
3. **Ring colours are fixed per metric**: rose for Homework, teal for Habits, azure for Daily 3. Gold is only for fams. Kid identity uses the kid's profile colour on the avatar badge, never on rings.
4. **Colour is never the only carrier.** Every ring has adjacent numbers and text, `role="img"` and an `aria-label`.
5. **Keep product truth:**
   - parents review homework but never mark it done;
   - kids manage only their own actions;
   - the action preview stays capped at 3;
   - Hermes shows only when it has cases;
   - no sibling ranking (keep family order).

---

## 1. Why (user brief, verbatim intent)

- The current page is "uniform but still very boring, so much text everywhere… not engaging or actionable. I don't look forward to opening this every day."
- **First glance must answer:** what needs me today, and how the kids are doing.
- **Avoid:** childish, and dark or techy.
- **Nothing is sacred:** brand colours, type and navigation may all change.
- **The rings must complement the purple.** The ring palette below is tuned to violet: azure and rose are its neighbours on either side, teal is the fresh counterpoint, and gold is its complement.

---

## 2. Scope

**In scope**
- **Shell:** sidebar, page header, chat dock.
- **Today** (flagship) and every web page:
  - Calendar, Homework, Goals, Activities, Notes, Settings
  - Child view (`#tab-child`)
  - Trips (`/trips`), Meals (`/meals`), Finance (`/finance`)
  - Billing, Security, Login, Signup: token refresh only
- Light and dark mode, and phone layout.

**Out of scope**
- **iOS native app.** APP-BRIEF says Horizon tokens are 1:1 across web and iOS. This redesign breaks that parity, and a follow-up iOS brief should adopt these tokens (§9).
- The marketing landing page (`landing.html` / `landing.css`).
- Backend contracts, except the optional `completedAt` in §6.1.

---

## 3. Visual system

### 3.1 Colour tokens

Define these in `public/css/horizon.css`, rewritten; §7 P1 covers the migration. The contrast column is measured on the card colour.

| Role | Token | Light | Dark | Contrast (light / dark) |
|---|---|---|---|---|
| Page ground | `--fr-bg` | `#F4F5F7` | `#121318` | — |
| Card | `--fr-card` | `#FFFFFF` | `#1B1D24` | — |
| Inset / track | `--fr-card-2` | `#F7F8FA` | `#22252D` | — |
| Hairline | `--fr-rule` | `#E7E9EE` | `#2C2F38` | — |
| Text | `--fr-ink` | `#15171C` | `#F2F3F5` | 17:1 |
| Secondary text | `--fr-ink-2` | `#6B7280` | `#A1A7B3` | 4.8 / 7.0 |
| Tertiary text | `--fr-ink-3` | `#9CA3AF` | `#6E7582` | Placeholders only |
| **You / actions** | `--fr-you` | `#7B4DFF` | `#A68CFF` | 4.8 / 6.3 |
| Actions text | `--fr-you-ink` | `#5B2EE6` | `#C3B1FF` | 7.0 |
| Actions tint | `--fr-you-soft` | `#EFEAFF` | `rgba(166,140,255,.16)` | — |
| On violet | `--fr-on-you` | `#FFFFFF` | `#15121F` | 4.8 / 6.9 |
| **Homework ring** | `--fr-hw` | `#E8467C` | `#FF6F9D` | 3.8 (graphic) |
| Homework text | `--fr-hw-ink` | `#B8205A` | `#FF9CBB` | 6.2 |
| Homework tint | `--fr-hw-soft` | `#FDE8EF` | `rgba(255,111,157,.14)` | — |
| **Daily 3 ring** | `--fr-d3` | `#4B7BF5` | `#7EA3FF` | 3.9 (graphic) |
| Daily 3 text | `--fr-d3-ink` | `#2A57C9` | `#A9C1FF` | 6.4 |
| Daily 3 tint | `--fr-d3-soft` | `#E7EEFE` | `rgba(126,163,255,.14)` | — |
| **Habits ring** | `--fr-hab` | `#0EA58C` | `#2FD3B4` | 3.1 (graphic) |
| Habits text | `--fr-hab-ink` | `#0B7866` | `#74E6CF` | 5.4 |
| Habits tint | `--fr-hab-soft` | `#DDF4EF` | `rgba(47,211,180,.14)` | — |
| **Fams** | `--fr-fams` | `#D99A00` | `#FFC53D` | Bar only, always with numbers |
| Fams text | `--fr-fams-ink` | `#8A5A00` | `#FFD978` | 5.9 |
| Fams tint | `--fr-fams-soft` | `#FFF3D6` | `rgba(255,197,61,.14)` | — |
| Danger (overdue) | `--fr-danger` | `#C8283F` | `#FF7A8A` | ≥5 |
| Ring track opacity | `--fr-track` | `15%` | `22%` | — |
| Card shadow | `--fr-shadow` | `0 1px 2px rgba(16,24,40,.06), 0 8px 24px rgba(16,24,40,.06)` | `0 1px 2px rgba(0,0,0,.4), 0 10px 28px rgba(0,0,0,.35)` | — |

- **Overdue:** always show the word "overdue" in `--fr-danger`, even on rose rings, so red and rose never carry the meaning alone.
- **Kid badge colours:** keep `kidColorFor(kid.id)` (the parent-selected profile colour). On dark cards, badge text uses `#15121F`.

### 3.2 Typography

**Geist** (SIL OFL, variable 100–900) replaces Space Grotesk and JetBrains Mono everywhere in the app.

- **Self-host it.** The CSP is first-party, so no Google Fonts `<link>` in production. Add `public/fonts/geist.woff2` (the latin variable file) and update `public/fonts/fonts.css`.
- **Numbers:** `font-variant-numeric: tabular-nums` everywhere.

| Role | Size / weight / tracking |
|---|---|
| Greeting (h1) | 30 / 700 / -0.02em (phone 26) |
| Hero numeral (parent ring centre) | 64 / 800 / -0.04em (phone 52) |
| Stat numeral (next to kid rings) | 30 / 800 / -0.03em (phone 26) |
| Kid name / card title | 20 / 700 / -0.01em |
| Item title (action row) | 17 / 600 / -0.01em |
| Body | 14 / 400 |
| Meta | 13 / 400, `--fr-ink-2` |
| Label (section heads) | 12 / 600, uppercase, 0.08em, `--fr-ink-2` |
| Tag / chip | 12 / 600 (tag 10 / 700) |

Aim for at most 12 words above the fold per card. Numbers carry the message.

### 3.3 Shape, spacing, elevation

- **8px grid.**
- **Cards:** radius 24px (20px on phone), no border, `--fr-shadow`, white on grey.
- **Inside cards:** 1px `--fr-rule` hairlines only.
- **Radii:**
  - buttons and chips: 999px
  - inputs: 12px
  - day-strip track: 12px
  - event blocks: 9px
- **Page padding:** 30px / 32px on desktop, 16px on phone.
- **Gaps:** 20px between cards (14px on phone).

### 3.4 Icons

- Line icons on a 24px grid, 1.8px stroke, round caps.
- Reuse and extend `TODAY_ICONS` / `todayIcon()` in `public/js/app.js`.
- No emoji in chrome. Content keeps its emoji.

### 3.5 Motion

This is the one authored moment. Use `cubic-bezier(.2,.8,.2,1)` throughout.

- **Ring fill:** animate `stroke-dasharray` from the old value to the new one over 700ms whenever data changes.
- **Increment spark:** a 4px dot with a 9px halo at the ring's leading edge, fading out over 1.2s.
- **Ring closes (reaches 100%):**
  - one 600ms glow on that ring (track opacity to 35% and back);
  - its stat turns ✓ (for example "Done ✓");
  - no confetti.
- **Action completed:** the existing "stack advances" row collapse, then the parent ring advances.
- **Reduced motion** (`prefers-reduced-motion: reduce`): values jump instantly, with no spark or glow.

---

## 4. Components

`today-reference.html` has CSS for every one of these; its `§` comments match the sections below.

### 4.1 App shell

- **Sidebar**
  - 224px wide, white, 1px right rule.
  - Brand: a violet 30px rounded "F" mark plus "Fam ETC".
  - Nav rows: 40px, radius 12.
  - Active row: `--fr-you-soft` background with `--fr-you-ink` text.
  - "Children" group: 26px kid badges.
  - Notes and Settings, then the user, at the bottom.
- **Chat dock**
  - 340px, white, 1px left rule.
  - Keep the existing resize handle (`FamChatWidth`) and the per-tab modes (`CHAT_DOCK_MODE`).
- **Phone (≤700px)**
  - Top bar: brand plus avatar.
  - Bottom tab bar, 76px: Today, Calendar, Homework, Goals, More.
  - Chat becomes a 56px violet FAB. Keep the existing slide-over mechanism (`chat-fab` / `chat-open`).
- **Page header**
  - Greeting h1, then one meta line: "Saturday 26 September · Nothing overdue · 1 event today".
  - School-sync status pill on the right, with a green dot when fresh, amber when stale and hollow when never synced (existing logic).

### 4.2 Needs-you hero (parent ring plus actions)

- **Layout:** one card with a 250px ring column and the action list (phone: stacked).
- **Parent ring**
  - 188px, 18px stroke, `--fr-you`.
  - Centre: the open-actions count (64px), "need you", and a small "N cleared today".
  - Progress follows §6.1.
- **Actions:** the label "NEEDS YOU", "See all N" (opens the existing `#family-actions-dialog`), then **up to 3 rows** (the existing `previewActions` cap), then "+N more".
- **Row anatomy**
  - 40px kid badge (or a violet "F" badge for family/shared actions);
  - title (17/600);
  - meta line (13, ink-2), e.g. "Ryshi · homework · due Mon 29 Sep";
  - one control:

  | Row type | Control | Behaviour |
  |---|---|---|
  | Parent homework review | Filled violet pill "Review" | Calls the existing `reviewTodayHomework(sourceId)` |
  | Manageable action | Outline pill "Done" (violet text, 1px `--fr-you` border) | Calls `completeTodayAction(id)`; the ring advances |
  | Neither | No control | — |

- **Snooze and delete** stay in the all-actions dialog only, labelled, as they are today.
- **Hermes cases:** when present, render as a compact card above the hero.
- **Setup card** (new families only): a card between the hero and the kids.
- **Empty (0 open):** the ring shows today's cleared count as full; the centre reads "All clear".
- **Loading:** a skeleton ring and 2 skeleton rows.
- **Error:** the existing message plus "Try again".

### 4.3 Kid card (one per child, in family order)

- **Header:** 34px badge, name (20/700), and a factual status chip:
  - `N overdue` → danger tint;
  - otherwise `N due today` → homework tint;
  - otherwise "Nothing due today" → habits tint.
  - Never "on track", or any other judgement.
- **Rings**
  - 156px SVG (120px on phone), 14px strokes, radii 66 / 48 / 30.
  - Order: outer Homework (`--fr-hw`), middle Habits (`--fr-hab`), inner Daily 3 (`--fr-d3`).
  - Track: the same colour at `--fr-track`.
  - Habits with no habits: dashed track (`stroke-dasharray: 4 7`).
- **Stats column:** three rows of numeral plus two-line label, in the ring colour's `-ink` token:
  - Homework: left this week, e.g. "3 / homework left this week".
  - Daily 3: "1/3 / Daily 3 today" plus a sub-line, e.g. "not started" or "News done just now".
  - Habits: "1/2 / habits today"; with none, "— / No habits yet · Set a first habit" (link to Goals).
- **Fams row** (hairline above):
  - "882 fams" (22/800);
  - a gold weekly bar (8px, `--fr-fams-soft` track), earned divided by limit;
  - "12 of 300 this week".
- **Interactions**

  | Tap target | Result |
  |---|---|
  | Card or ring | `openChildView(kid.id)` |
  | Homework numeral | Homework tab filtered to that kid |
  | Habits numeral | Popover listing that kid's habits with check buttons (existing `toggleGoalCheckIn`) |
  | Daily 3 | Scrolls to the learning section |

- **Legend:** once, under the kid cards: "Homework (outer) · Habits (middle) · Daily 3 (inner) · Fams this week".

### 4.4 Day strip

- One card: the label "TODAY · N EVENTS", with the "Tonight" chip on the right.
- **Tonight chip:** fams tint, bowl icon.
  - Dinner planned: "Tonight: dinner name".
  - Not planned: "Tonight: dinner not planned · Plan tonight" (links to `/meals`).
  - Kids never see it.
- **Track:** 44px, 7 AM to 9 PM, hour ticklines, labels below.
- **Event blocks**
  - Tint: the kid's profile colour at 16%. Family events use `--fr-you-soft` with `--fr-you-ink` text.
  - Label: "Swimming 1:40–4:00".
  - Click calls the existing `showDetail(id, date)`.
- **Now marker:** 2px violet line with a "Now 8:30" pill. Re-render every 5 minutes (existing interval).
- **Day over:** also show tomorrow's first events as a second, smaller track labelled "Tomorrow".
- **Phone:** the track scrolls horizontally, with now centred on load.

### 4.5 Daily 3 and challenge

- A row of 4 tiles (2×2 on phone): News, Quote, Word and Challenge ("1-day streak · Weekend crossword ready").
- Each tile has a 44px azure mini-ring for that part: 0 or 100%, plus partial when started.
- Clicking a tile opens the **existing Daily 3 panel** with that tab selected. Keep everything built in the last round: mounted panels, drafts, puzzle progress and `selectDaily5Activity`.
- The panels live in a full-width card below the tiles.
- The brain teaser / puzzle card follows, restyled with these tokens.

### 4.6 Chat

Restyle only; keep every feature: emoji, GIF, attachments, pins, add-to-today, meal-plan review and Hermes.

- **Others:** `--fr-card-2` bubbles, radius 16 with a 4px tail corner.
- **Mine:** `--fr-you-soft` with `--fr-you-ink` text, right-aligned.
- **Hermes:** name plus a "HELPER" tag pill.
- **Event cards:** a white inset with a calendar icon.
- **Photos:** radius 14.
- **Composer:** pill input, icon buttons, 44px violet send.

### 4.7 Controls and states

- **Buttons:** primary is a violet pill, 40px (44px on touch); secondary is an outline pill; links are violet 14/600 with an arrow.
- **Inputs:** 44px, radius 12, 1px rule, violet focus ring (2px, offset 2).
- **Dialogs:** radius 24, `--fr-shadow`.
- **Focus:** always visible.
- **Hit targets:** at least 44px on touch.

---

## 5. Pages

### 5.1 Today (parent)

Order: header, Hermes (if any), hero, setup (if any), kid cards, legend, day strip, Daily 3 tiles, learning panels, challenge.

| Container width | Layout |
|---|---|
| ≥1100px | Kids side by side |
| 700–1100px | Kids stacked, hero two-column |
| ≤700px | Everything stacked |

Use container queries on `#tab-today` (they already exist).

### 5.2 Today (kid session)

- **Hero:** "Your day". The ring counts their own open actions and homework; kids can complete their own. Use the existing `todayActionCanManage` rules.
- **Body:** one large kid card (their rings), then fams linking to `/finance`, then the Daily 3 tiles, promoted to the second row.
- **Hidden:** Tonight, setup, Hermes, and the other kids.

### 5.3 Other pages

Tokens, shell and controls apply to every page.

| Page | Changes |
|---|---|
| **Child view** | The kid card at hero scale: 220px rings, week bars (Mon–Sun) per metric, homework list with Review, and the existing home-plan block. |
| **Homework** | Top row: a mini ring summary per kid (homework ring plus left count). List rows as white cards with due chips (overdue uses danger text). Parent: Review. Kid: Done. |
| **Goals** | Each habit is a card with its own teal ring (this week's check-ins against the target) and a streak count. Milestone goals use a gold progress bar. |
| **Calendar** | Week and month grids on white. Event chips tinted by kid colour (family events violet tint). Today column in `--fr-you-soft`. Header controls as pills. |
| **Activities, Trips, Meals** | Restyle cards, lists and buttons to the tokens. Meals: the dinner card uses the fams-gold accent only for shopping counts. |
| **Notes, Settings, Billing, Security** | Tokens and controls only. |
| **Login, Signup** | Tokens and Geist only (they load `horizon.css`). |

---

## 6. Data mapping (exact sources)

All of this data is already loaded client-side in `public/js/app.js`.

### 6.1 Parent ring

- **Centre number:** open actions visible to the parent, meaning `todayActionItems` that aren't done and aren't snoozed into the future. This is the same eligibility `previewActions` uses in `public/js/action-queue.js`. Show the "See all N" total.
- **Progress:** `clearedToday / (clearedToday + dueByToday)`.
  - `dueByToday` is the `groupActions(...).now` length.
  - `clearedToday` counts actions with `status === 'done'` and a `completedAt` (or, as a fallback, `updatedAt`) on today's local date.
  - Both zero means an empty track.
- **Optional backend change:** in `lib/actions.js`, set `completedAt` when status becomes `done`. It's one field; add a test in `tests/action-queue.test.js`.

### 6.2 Kid rings

| Ring | Formula | Source |
|---|---|---|
| **Homework** | `done / (done + notDone)` for that kid's homework due in the current Monday–Sunday week, plus overdue not done. The "left" numeral is `notDone`, including overdue. | `homeworkItems` (`status` is `todo`, `in_progress` or `done`), grouped with `groupHomeworkByDueDate` or a week variant |
| **Habits** | Habits checked today divided by the kid's habits (`type === 'habit'`). None means a dashed track plus "No habits yet". | `goalsItems`, same as today's `todayKidFacts` |
| **Daily 3** | Completed parts out of 3 (`news`, `quote`, `word`) for that kid today. The challenge (`puzzle` / `bt`) is shown on the Challenge tile, not in the ring. | Parent: `GET /api/children/:kidId/insights?date=YYYY-MM-DD` → `daily5.parts`. Kid session: `/api/daily5/progress` or the local `daily5DoneKey()` state. |
| **Fams** | Balance, and `weekly.earned` / `weekly.limit`. | `/api/fams?kidId=` (existing, per kid) |

If the insights call fails for the parent, hide the Daily 3 ring and show "Daily 3: unavailable". Never show 0.

### 6.3 Functions to rework (keep names where tests reference them)

| Area | Functions |
|---|---|
| Header | `renderTodayScreen` (meta line and sync pill) |
| Hero | `renderTodayActionQueue` and `renderTodayActionRow`, keeping the strings tests assert ("Homework due for …", "Review homework" can become the aria-label) and the `withMenu` dialog variant |
| Kids | `renderTodayFams` → kid cards. Keep the name or alias it. `todayKidFacts` → stats. Add a ring helper `famRing({ size, stroke, rings: [{ value, total, color }] })` that returns SVG. |
| Day strip | `renderTodaySchedule` / `renderTodayScheduleRow` |
| Tonight | `famRenderTodayMeals` → the Tonight chip |
| Habits | `renderTodayHabitsAndMomentum` → the habits popover and stat |
| Daily 3 | `applyDaily5Done`, `selectDaily5Activity` and the panels stay; add tile rings |

Update tests only where they encode old markup, and keep their behavioural intent. Affected files include:
- `tests/today-layout-chat.test.js`
- `tests/today-brief-tabs.test.js`
- `tests/action-rendering.test.js`
- `tests/news-ui.test.js`
- `tests/today-puzzle-progress.test.js`
- `tests/client-bundle.test.js`

---

## 7. Implementation plan

Work from `main` and follow AGENTS.md: Node 24, `/opt/homebrew/opt/node@24/bin` first. Commit per phase (conventional commits).

**P1 · Tokens, fonts, shell**

Files:
- `public/css/horizon.css`: new `--fr-*` tokens for light and `.dark`, **plus aliases** for the old names so every page re-skins at once (`--bg: var(--fr-bg)`, `--panel: var(--fr-card)`, `--panel-2: var(--fr-card-2)`, `--border: var(--fr-rule)`, `--text: var(--fr-ink)`, `--text-2: var(--fr-ink-2)`, `--accent: var(--fr-you)`, `--accent-soft: var(--fr-you-soft)`, `--on-accent: var(--fr-on-you)`, and so on)
- `public/fonts/`: Geist woff2 and `fonts.css`
- `public/css/styles.css`: sidebar, chat dock, buttons, inputs, dialogs, phone tab bar and FAB

Acceptance: every page renders in the new palette and font in light and dark, and there are no Space Grotesk requests.

**P2 · Today rebuild (parent)**

Files:
- `public/index.html`: the `#tab-today` markup
- `public/css/today-home.css`: rewrite
- `public/css/today-learning.css`: token pass
- `public/js/app.js`: the functions in §6.3 and `famRing`

Acceptance: at 1600×1000 and 390px, the page matches `today-desktop-light.png`, `today-desktop-dark.png` and `today-mobile-light.png`; rings show real counts for the local dev family; all tests pass.

**P3 · Kid session Today and child view** (§5.2, §5.3)

**P4 · Other pages** (§5.3): Homework, Goals, Calendar, Activities, Trips, Meals, Notes, Settings, auth pages.

**P5 · Motion, accessibility and performance**
- Ring animations (§3.5) with reduced motion.
- `aria-label`s on every ring.
- Keyboard pass.
- Contrast check against §3.1.
- No new JS dependencies; SVG rings only.

**P6 · Docs and records**
- Replace the `Today seed 694b4b4f` direction contract comment at the top of `<body>` in `index.html` with this contract (keep the child-view one):
  - THESIS: every child's day is rings to close, and the parent's ring is what needs you.
  - OWN-WORLD: cool grey, white cards, violet actions, a rose/teal/azure ring palette, gold fams, Geist.
  - STORY: glance, act, watch rings close.
  - FIRST VIEWPORT: the parent ring and actions hero, then kid ring cards.
  - FORM: Family Rings, seed `19a71449`.
- Regenerate `DESIGN.md` from the built world, replacing Horizon.
- Update the APP-BRIEF.md Design rows (Language, Palette, Typography) to Family Rings, "user-confirmed 2026-09-26".
- Note iOS parity as pending.

---

## 8. Definition of done

- **Behaviour:** every feature Today has now is still reachable, and the role rules in §0 still hold.
- **Screenshots:** light and dark at 2000×1130 (the user's screen), 1440×900, 1280×800, 768×1024 and 390×844. No horizontal overflow, and no text that collides or truncates.
- **Tests:** `node --test tests/*.test.js` passes. `tests/reviewer-account.test.js` fails on date rot, which is a separate task already queued.
- **Ship per CLAUDE.md and project memory:**
  1. Push `main` to GitHub **before** deploying.
  2. `scripts/pack-deploy.sh <name>.zip`, using a random suffix in the name.
  3. Hostinger V1 upload plus `hosting_startNode_jsBuildV1` (username `u293207803`; `deployJsApplication` returns 404).
  4. Poll `https://www.fametc.com/api/health` until the build label matches.
  5. Confirm the uploaded zip URL returns 404.
  6. Curl the changed CSS and JS.
- **Final review:** run a design finish review against the three reference PNGs before calling it done.

## 9. Open decisions and risks

- **iOS parity:** web and iOS diverge until an iOS brief adopts these tokens. Recommend doing that next.
- **Kid Daily 3 data:** it relies on kids reporting progress (`/api/daily5/progress`). Families whose kids don't use the web see "not started". That's accurate, not an error.
- **Rings as surveillance:** keep kid-facing copy positive, and never rank siblings.
- **Homework ring completeness:** depends on the school import. Show the item count so parents can sanity-check it.

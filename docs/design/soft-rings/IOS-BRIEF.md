# Soft Rings — iOS layout brief (Fam ETC native app)

**Approved by the owner 2026-10-17.** The native app adopts a softer layout and
type, adapted from a Dribbble reference the owner supplied ("AI Family Planner
App UI – Smart Assistant Calendar Experience"). The reference was translated to
Fam ETC's real screens, data and roles; nothing was copied from it.

**Owner decision: keep the Family Rings colours exactly as the web.** Every
other choice in this brief was delegated ("change everything else as your
picks"). fametc.com keeps the Family Rings design unchanged.

This brief supersedes the *layout and type* sections of
[family-rings/IOS-BRIEF.md](../family-rings/IOS-BRIEF.md). That brief still
governs colours, ring geometry, `FamilyRingsMath`, data sources, roles and
accessibility.

## 0. Rules

- **Colours are unchanged.** Every colour comes from the existing `Palette.fr*`
  tokens in `ios/FamETC/DesignSystem/Theme.swift` (the same values as `--fr-*`
  in `public/css/horizon.css`). Violet `frYou` remains the only action and
  selection colour. Ring colours remain metric categories (orange homework,
  mint Daily 4, fuchsia habits, gold fams). Child profile colours identify
  children and are never used for a metric.
- **Data, counts and permissions are unchanged.** Parents review a child's
  homework and never complete it; children complete their own work. Hermes stays
  the "Hermes" room in Chat, with no Today strip and no tab (owner decision
  2026-09-26).
- **Accessibility baseline is unchanged.** 44pt minimum targets, Dynamic Type
  on every text role (serif roles scale with `relativeTo:`), VoiceOver labels on
  rings and icon-only buttons, Reduce Motion, 4.5:1 text contrast, and text
  labels under tab icons.
- **UI-test identifiers are kept** (`today.hero.*`, `today.action.*`,
  `today.kidcard.*`, `today.daily3.*`, `today.tonight`, `today.studyPal.*`,
  `screen-*`).

## 1. Type

| Role | Face | Where |
|---|---|---|
| Display | Playfair Display, variable 400–900 (`Resources/Fonts/PlayfairDisplay.ttf`; `Theme.displayFontName` resolves `PlayfairDisplay-Regular` or the instance name `PlayfairDisplayRoman-Regular`) | Greeting, screen titles, section headings, event card titles, child names |
| Text | Geist (unchanged) | Body, labels, buttons, chips, messages |
| Numerals | Geist, tabular | Counts, dates, times, ring numbers, calendar days |

Playfair Display is bundled **unmodified** under the SIL OFL 1.1, which
reserves the font name; its licence ships beside it as
`PlayfairDisplay-OFL.txt`. Do not subset, rename or edit the file.

`Typography` roles: `largeTitle` / `screenTitle` display 30 bold;
`title` and `sectionTitle` display 22 bold; `greetingLead` display 26 medium
with `greeting` display 26 bold for the name; `kidName` display 20 bold;
`eventTitle` display 22 bold. Body roles keep Geist.

## 2. Shape and surfaces

- **Cards**: white `frCard`, borderless, the existing two-layer soft shadow,
  radius 24 on compact width and 28 on regular width.
- **Header glow**: Today, Calendar, Homework and Chat sit on `frBg` with a fixed
  `frYouSoft` → clear wash across the top ~320pt (`ScreenBackground(glow:)`).
- **Circle icon buttons**: 44pt white circles for add, previous/next and
  account (`CircleIconButton`).
- **Pill segmented control**: white track, violet selected pill with `frOnYou`
  text, 44pt segments (`PillSegmentedControl`). Replaces the system segmented
  picker on Calendar (Week | Month) and Planning (Trips | Meals).
- **Chips**: 44pt capsules with a child-colour dot; the selected chip is
  `frYouSoft` with `frYouInk` text.
- **Tab bar**: the system `TabView` (`.sidebarAdaptable`) tinted `frYou`. On
  iOS 26 and later it renders as the floating glass bar; labels stay under
  icons. No custom tab bar, so iPad keeps its sidebar.

## 3. Shared components (`ios/FamETC/DesignSystem/`)

- `SectionHeader` — serif title with an optional trailing text button.
- `WeekStrip` — Monday–Sunday of the current week. Today is a tall violet
  capsule. Up to three dots per day (child profile colours; violet for family
  events; homework excluded). Tapping a day opens Calendar on that day through
  `AppStore.pendingCalendarDayKey`.
- `EventArtCard` — the next calendar event: a white card washed with the
  child's profile colour (violet for family events), a large activity symbol,
  a serif title, time and place, and a child chip.
- `EventArt` — maps an event's title and feed label to an activity key
  (football, swimming, music, art, dance, drama, basketball, tennis, running,
  reading, exam, school, birthday, doctor, trip, food) and an SF Symbol.
  **Illustration hook:** an image set named `EventArt-<key>` in the asset
  catalog replaces the symbol for that activity. No code change is needed to
  add illustrations later.

## 4. Screens

### Today, parent
Header (account menu avatar · serif greeting with the date and the
"overdue · events today" line · add-event circle) → week strip → Screen Time
promo (unchanged) → Needs you (serif heading, ring, up to three rows, See all)
→ child ring cards with serif names and the ring legend → **Up next** (the next
event as an art card, then the following two as rows) → **Tonight** card
(`today.tonight`, opens Meals) → Daily 4 → study pal → utilities → Screen Time
summary → more family tools.

**Up next replaces the 7 AM–9 PM day-strip timeline on Today.** The full
timeline remains in Calendar's week view.

### Today, child
Header (own avatar · serif "Hi Name") → week strip (own and family events) →
Your day → own ring card → Daily 4 → Up next (own and family events) → Start
here → study pal → homework → Screen Time cards. The iPad two-column layout is
kept.

### Calendar
Serif title with an add circle → pill Week | Month → audience chips → serif
month heading with previous/next circles → month grid of soft white day cells
(selected day violet, days outside the month hatched and not tappable, event
dots in child colours) → serif selected-day heading → that day's events, the
first as an art card.

### Homework
Serif title → kid filter pills → assignment queue grouped by due date under
serif day headings, rows in white cards. Parent and child permissions are
unchanged.

### Chat
Serif room title with a sentence-case caption → room tabs as pills with
unread badges → messages → composer (the existing rounded field and violet
circle send button). **Bubbles keep their per-sender identity colours**: the
brief's Palette row keeps chat colours as they are, so the soft layout changes
only shape, type and surfaces here. A parent's Hermes room is captioned
"Private thread · only you and Hermes can see it" (contract §1; children's
helper threads keep "Private · AI helper"). Hermes cards take a serif title
and a soft shadow; an approval's Reject is outlined in `frDanger`, Approve
stays violet. The Hermes composer stays text-only.

### Planning
Pill Trips | Meals. Meals and Trips inherit the shared tokens.

## 5. Out of scope

The web app, widgets and watch (still awaiting owner device approval),
marketing pages, App Store screenshots (re-shoot after this ships), and Hermes
placement.

## 6. Owner verification in Xcode

This change was written without a Mac. Before TestFlight:

1. `cd ios && xcodegen generate` (files were added and removed), then build
   for the iOS 18 deployment target and the latest simulator.
2. Run `FamETCTests` (`FontRegistrationTests` now also covers Playfair Display)
   and `FamETCUITests`.
3. Check visually: iPhone SE (375pt), an iPhone Pro, iPad portrait, landscape
   and one-third Split View, light and dark, and accessibility text sizes. Confirm
   headings render in Playfair Display, not a system serif fallback.

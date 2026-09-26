# Family Rings — iOS implementation brief (Fam ETC native app)

**Status:** ready for implementation, 2026-09-26. The design was approved on the web ("this is the right direction") and this brief carries it to iOS unchanged.
**Implementer:** Astra.
**Design:** Claude (Opus). Same system as [BRIEF.md](BRIEF.md) (web), seed `19a71449`. The built web system is recorded in [DESIGN.md](../../../DESIGN.md).
**Scope:** the native SwiftUI app in `ios/FamETC/` (target `FamETC`), plus an optional widget phase. The watch app is out of scope.

**Visual contract.** There are no separate iOS comps; the web references are the contract:

| Reference | Use it for |
|---|---|
| `today-mobile-light.png` | **iPhone** card content, order and hierarchy. Native chrome replaces the web chrome: the system tab bar replaces the web top bar and bottom bar, and there is no chat FAB because Chat is a tab. |
| `today-desktop-light.png` / `today-desktop-dark.png` | **iPad** content column. The system sidebar or tab bar replaces the web sidebar, and there is no chat dock (see D3). |
| `today-reference.html` | Exact token values and component measurements. |
| [BRIEF.md](BRIEF.md) | Web behaviour, which iOS must match: §0 rules, §4 components, §6 data. |

---

## 0. Summary and rules

Re-skin the whole native app to Family Rings and rebuild **Today** (parent and kid) around rings: the parent's violet "Needs you" ring plus up to 3 actions, then one ring card per child (Homework, Habits, Daily 3, plus a fams bar), a day strip, and Daily 3 tiles. Numbers come first and words second. Every tap leads to the thing's source. The iOS app and fametc.com must show **the same counts for the same family at the same moment**.

**The web brief's five rules apply unchanged (BRIEF.md §0):**
- Every ring is a real count.
- Violet means you and actions only.
- Ring colours are fixed per metric.
- Colour is never the only carrier.
- Product truth is kept:
  - parents review homework, never complete it;
  - kids manage only their own actions;
  - the preview is capped at 3;
  - siblings are never ranked.

**iOS additions:**

6. **Native first.**
   - Keep the system `TabView(.sidebarAdaptable)`, sheets, navigation and pull-to-refresh.
   - Don't custom-draw tab bars or sheets; tint them.
   - Dynamic Type, VoiceOver and Reduce Motion are part of every component, not a later pass.
7. **One source of maths.**
   - Ring numbers come from one pure, unit-tested Swift file (`FamilyRingsMath`, §6) that ports the web functions line for line.
   - Views never compute counts inline.
8. **No Activity-ring confusion.**
   - Never use the words "Activity", "Move", "Stand" or "close your rings".
   - Rings always sit on light or dark cards with numbers beside them.
   - Rings are flat colours with no gradients.
   - See D1.

## 1. Already in place (don't rebuild)

- **Web views are already Family Rings.** Settings, Goals, Activities, Trips and the Fams child page load fametc.com in `HybridWebView`, and the live site is already on Family Rings. Your job there is continuity only (§5.4).
- **Every data source exists** except goals:
  - actions: `store.actions`
  - homework: `store.homework`
  - events: `Agenda.items`
  - meals: `store.meals`
  - Daily 3: `APIClient.childDailyFiveProgress` / `dailyFiveProgress`
  - fams: `APIClient.famsWallet(kidId:)`
- **Goals need a small native model** and loader (§6.3).
- **Role rules already exist in `AppStore`:** `canViewAction`, `canCompleteAction`, `canSnoozeAction`, and `canManageOwnKidAction` (currently private; make it internal).
- **`Color.adaptive(_:_:)` and `Color(hex:alpha:)`** in `Theme.swift` already give light/dark tokens that follow the app's `themeOverride`.

## 2. Scope

**In scope**
- `DesignSystem/` (tokens, font, base components).
- Today (parent and kid).
- Every native screen: Calendar (week and month), Homework, Chat, Planning (Meals native, Trips web), Notes, Fams, Family/KidApproval, Assistance sheets, Onboarding/auth (tokens only).
- Light and dark mode.
- iPhone, and iPad in both orientations plus Split View.

**Optional, last:** Home Screen widgets (P6).

**Out of scope**
- Server contracts. The only dependency is `completedAt` on actions, which is landing with the current web fixes.
- The watch app and complications (D5).
- The app icon and App Store screenshots (D6).
- Navigation structure: the same 5 tabs stay (D3).
- Hermes cases and the setup card. Neither exists on iOS Today today, and this brief doesn't add them (D4).

**Prerequisites**
- Start from `main` only after the in-flight work in the shared checkout is committed:
  - the web Family Rings fixes (`lib/actions.js` `completedAt`, `public/…`);
  - the iOS chat attachment work (`ChatView.swift`, `ChatAttachmentSupport.swift`, `Models.swift`, `AppStore.swift`).
- Work on a branch `ios-family-rings`. Never mix that work into these commits.

---

## 3. Visual system in SwiftUI

### 3.1 Palette (`ios/FamETC/DesignSystem/Theme.swift`)

Add these tokens to `Palette`. The values are exactly BRIEF.md §3.1 and `public/css/horizon.css`.

```swift
// MARK: Family Rings — values from docs/design/family-rings/BRIEF.md §3.1
static let frBg        = Color.adaptive(Color(hex: 0xF4F5F7), Color(hex: 0x121318))
static let frCard      = Color.adaptive(Color(hex: 0xFFFFFF), Color(hex: 0x1B1D24))
static let frCard2     = Color.adaptive(Color(hex: 0xF7F8FA), Color(hex: 0x22252D))
static let frRule      = Color.adaptive(Color(hex: 0xE7E9EE), Color(hex: 0x2C2F38))
static let frInk       = Color.adaptive(Color(hex: 0x15171C), Color(hex: 0xF2F3F5))
static let frInk2      = Color.adaptive(Color(hex: 0x6B7280), Color(hex: 0xA1A7B3))
static let frInk3      = Color.adaptive(Color(hex: 0x9CA3AF), Color(hex: 0x6E7582))   // placeholders only
static let frYou       = Color.adaptive(Color(hex: 0x7B4DFF), Color(hex: 0xA68CFF))
static let frYouInk    = Color.adaptive(Color(hex: 0x5B2EE6), Color(hex: 0xC3B1FF))
static let frYouSoft   = Color.adaptive(Color(hex: 0xEFEAFF), Color(hex: 0xA68CFF, alpha: 0.16))
static let frOnYou     = Color.adaptive(Color(hex: 0xFFFFFF), Color(hex: 0x15121F))
static let frHw        = Color.adaptive(Color(hex: 0xEF6A12), Color(hex: 0xFF8A3D))
static let frHwInk     = Color.adaptive(Color(hex: 0xC2410C), Color(hex: 0xFFB27A))
static let frHwSoft    = Color.adaptive(Color(hex: 0xFFEDD5), Color(hex: 0xFF8A3D, alpha: 0.14))
static let frHab       = Color.adaptive(Color(hex: 0xD946EF), Color(hex: 0xE879F9))
static let frHabInk    = Color.adaptive(Color(hex: 0xA21CAF), Color(hex: 0xF0ABFC))
static let frHabSoft   = Color.adaptive(Color(hex: 0xFAE8FF), Color(hex: 0xE879F9, alpha: 0.14))
static let frD3        = Color.adaptive(Color(hex: 0x0EA58C), Color(hex: 0x2FD3B4))
static let frD3Ink     = Color.adaptive(Color(hex: 0x0B7866), Color(hex: 0x74E6CF))
static let frD3Soft    = Color.adaptive(Color(hex: 0xDDF4EF), Color(hex: 0x2FD3B4, alpha: 0.14))
static let frFams      = Color.adaptive(Color(hex: 0xD99A00), Color(hex: 0xFFC53D))
static let frFamsInk   = Color.adaptive(Color(hex: 0x8A5A00), Color(hex: 0xFFD978))
static let frFamsSoft  = Color.adaptive(Color(hex: 0xFFF3D6), Color(hex: 0xFFC53D, alpha: 0.14))
static let frDanger    = Color.adaptive(Color(hex: 0xC8283F), Color(hex: 0xFF7A8A))
static let frDangerSoft = Color.adaptive(Color(hex: 0xC8283F, alpha: 0.10), Color(hex: 0xFF7A8A, alpha: 0.10))
/// Ring track opacity: 15% light, 22% dark (web `--fr-track`).
static func trackOpacity(_ scheme: ColorScheme) -> Double { scheme == .dark ? 0.22 : 0.15 }
```

**Re-point the existing names** so every screen re-skins in one commit. This is the same mapping as the web aliases in `horizon.css`:

| Existing | → | Existing | → |
|---|---|---|---|
| `bg` | `frBg` | `accent` | `frYou` |
| `sidebar`, `panel` | `frCard` | `accentSoft` | `frYouSoft` |
| `panel2` | `frCard2` | `onAccent` | `frOnYou` |
| `border`, `grid` | `frRule` | `coral`, `orange` | `frHw` |
| `text` | `frInk` | `orangeInk` | `frHwInk` |
| `textSecond`, `muted` | `frInk2` | `warn` | `frFamsInk` |
| `blue` | `frD3` | `teal` | `frHab` |
| `violet` | `frYou` | `amber` | `frFams` |
| `red` | `frDanger` | `green` | `Color.adaptive(Color(hex: 0x16824F), Color(hex: 0x55D88D))` |

**Other palette changes**
- Leave `ds*` and `kidColor(index:)` alone.
- Kid identity stays `Kid.profileColor`. It appears on avatar badges and day-strip blocks, **never on rings**.
- **Delete `Signal`** (the coral→violet gradient). Its 2 call sites (`SignalButton` in `Components.swift` and `TodayDailyFivePreview.swift`) become solid `frYou`. Family Rings has no gradients.

### 3.2 Typography: Geist replaces Space Grotesk and JetBrains Mono

**Font file**
- Add `ios/FamETC/Resources/Fonts/Geist.ttf`: the **variable** `Geist[wght].ttf` from vercel/geist-font **v1.5.1**, the same release as the web (`public/fonts/fonts.css`).
- Copy `public/fonts/OFL.txt` next to it.

**Remove the old fonts**
- Delete `SpaceGrotesk.ttf` and `JetBrainsMono.ttf`, but first grep `ios/marketing` and `ios/design`. If a marketing script still needs them, move them there rather than keeping them in the app bundle.
- In `ios/FamETC/Info.plist`, `UIAppFonts` becomes just `Geist.ttf`.

**The project file is generated.** `ios/FamETC.xcodeproj` is gitignored and generated from `ios/project.yml`. Run `cd ios && xcodegen generate` after adding or removing files.

**`Theme`**
- Keep both function names so no call site changes. `Theme.font` uses Geist.
- `Theme.mono` becomes Geist plus `.monospacedDigit()`; tabular figures replace the mono face, as on the web.
- Use the font's real registered name. Read it once with `UIFont.familyNames` / `fontNames(forFamilyName:)` and store it in `Theme.fontName`. The P1 test asserts it resolves.

**`Typography`.** Every style is `relativeTo:` a text style, so Dynamic Type scales it. Every numeral style adds `.monospacedDigit()`.

| Style | iPhone (compact) | iPad (regular) | Weight | relativeTo | Notes |
|---|---|---|---|---|---|
| `greeting` (new) | 26 | 30 | .bold | .largeTitle | tracking -0.5 |
| `heroNumeral` (new) | 52 | 64 | .heavy | .largeTitle | tracking -2; tabular; cap with `.dynamicTypeSize(...DynamicTypeSize.xxxLarge)`, since the count is repeated in text |
| `statNumeral` (new) | 26 | 30 | .heavy | .title | tracking -0.8; tabular |
| `kidName` (new) | 20 | 20 | .bold | .title3 | |
| `itemTitle` (new) | 17 | 17 | .semibold | .headline | |
| `cardTitle` | 17 | 17 | .semibold | .headline | was 16 |
| `body` | 15 | 15 | .regular | .body | unchanged |
| `label` → meta | 13 | 13 | .regular | .footnote | was 12.5; colour `frInk2` |
| `caption` | 12 | 12 | .regular | .caption | was 11.5 |
| `sectionLabel` (new; `MicroLabel` uses it) | 12 | 12 | .semibold | .caption | uppercase, tracking 1.0, `frInk2` |
| `chip` (new) | 12 | 12 | .semibold | .caption | |
| `kpiNumber` / `statNumber` | 34 / 20 | same | .heavy | unchanged | tabular |

- **Size-class variants.** Styles with two sizes get a `…Regular` variant, chosen by `@Environment(\.horizontalSizeClass)`. Don't add a type-scale system.
- **Word budget:** at most about 12 words per card above the fold. Numbers carry the message.

### 3.3 Shape, spacing, elevation (`Theme.swift`, `Components.swift`)

**Grid and padding**
- 8-point grid; the existing `Space` values stay.
- **Page padding:** 16 on iPhone, 32 on iPad.
- **Gaps between cards:** 14 on iPhone, 20 on iPad.

**Radii**

| Element | Radius |
|---|---|
| Cards | `Radius.card` = 20 on iPhone; new `Radius.cardLarge` = 24 on iPad. `Card` picks one by size class. |
| Inputs | 12 |
| Buttons and chips | `Capsule()` in new code. Keep `Radius.pill`/`chip` for old call sites. |
| Event blocks | 9 |
| Day-strip track | 12 |

**`Card`**
- **No border.** Delete the `strokeBorder`.
- Background `frCard`.
- The shadow goes on the background shape, not the content, so text layers don't each get a shadow:

  ```swift
  .background {
      RoundedRectangle(cornerRadius: radius, style: .continuous)
          .fill(Palette.frCard)
          .shadow(color: Color.adaptive(Color(hex: 0x101828, alpha: 0.06), .black.opacity(0.40)), radius: 1, y: 1)
          .shadow(color: Color.adaptive(Color(hex: 0x101828, alpha: 0.06), .black.opacity(0.35)), radius: 12, y: 8)
  }
  ```

**Surfaces**
- `ScreenBackground` is `frBg`.
- Hairlines inside cards are 1pt `frRule`.
- Sheets keep the system presentation and use a `frBg` background.

### 3.4 Icons

- SF Symbols at `.medium` weight, which is closest to the web's 1.8px line icons.
- **No emoji in chrome.** Buttons, labels, toasts and empty states use no emoji. User content keeps its emoji.
- Grep `Features/` for emoji literals in `Text("…")` / `Label("…")` chrome strings.

### 3.5 Motion and haptics (`Motion`, `Haptics`)

Add these to `Motion`:

```swift
static let ring  = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.7)
static let glow  = Animation.easeInOut(duration: 0.3)   // up 0.3 + back 0.3 = 600ms
static let spark = Animation.easeOut(duration: 1.2)
```

**Rules**
- **Ring fill** animates from the old value to the new one with `Motion.ring` whenever data changes.
- **First appearance never animates.** Show a skeleton until the data is known. Never mount a ring with a placeholder 0 and then animate it to the real value.
- **Spark on an increase:**
  - a 4pt dot filled `frCard` with a 9pt halo (2pt stroke, ring colour);
  - placed at the arc's leading edge;
  - fades out over 1.2s.
- **Ring closes** (goes from below 100% to 100%): the track opacity goes to 0.35 and back over 600ms. No confetti.
- **Reduce Motion:** use the existing `Motion.maybe(_:reduceMotion:)`, so values jump with no spark or glow.

**Haptics fire at the mutation call site, never inside the ring view**, so a background refresh never buzzes:

| Event | Haptic |
|---|---|
| Done tapped | `Haptics.impact(.light)` |
| A user action closes a ring | `Haptics.notify(.success)` |
| Habit check toggled | `Haptics.selection()` |

---

## 4. Components

### 4.1 `FamilyRing` (new: `ios/FamETC/DesignSystem/FamilyRing.swift`)

This is the iOS equivalent of the web `famRing()`.

```swift
struct RingMetric: Equatable, Identifiable {
    let id: String        // "homework" | "habits" | "daily3" | "you"
    let value: Int
    let total: Int        // 0 ⇒ dashed empty track, no fill
    let color: Color
    let label: String     // "Homework"
}

struct FamilyRing: View {
    enum Style { case kid, parent, mini }
    let style: Style
    let diameter: CGFloat
    /// Outer → inner. A nil slot keeps its radius but draws nothing (Daily 4 unavailable).
    let metrics: [RingMetric?]
    var accessibilityText: String? = nil
    // body: ZStack of tracks + trims; see rules below
}
```

**Geometry.** This matches the web exactly at the reference sizes.

| Style | Diameter D | Stroke | Gap | Outer inset | Radii at reference size |
|---|---|---|---|---|---|
| `kid` (3 metrics) | 156 on iPad and the kid-session card; 120 on iPhone parent cards | D·14/156 | D·4/156 | D·5/156 | 66 / 48 / 30 |
| `parent` (1 metric) | 188 on iPad; 152 on iPhone | D·18/188 | — | D·5/188 | 80 |
| `mini` (1 metric) | 44 | 5 | — | 1 | 18.5 |

Radius *i* = D/2 − stroke/2 − inset − *i*·(stroke + gap). Frame each circle at 2r × 2r, centred.

**Drawing rules**

1. **Track:** `Circle().stroke(color.opacity(Palette.trackOpacity(scheme)), lineWidth: stroke)`. When `total == 0`, use a dashed track with `StrokeStyle(lineWidth: stroke, dash: [4·k, 7·k])`, where k = D/156.
2. **Fill:**
   - `Circle().trim(from: 0, to: fraction)`, stroked with a `.round` line cap and `.rotationEffect(.degrees(-90))`.
   - `fraction = total > 0 ? min(1, max(0, value/total)) : 0`.
   - **At fraction 0, the fill has opacity 0.** A zero-length round-cap trim draws a dot. That's the web bug "zero-progress teal dot" (Astra review #3), so don't repeat it.
3. **Animation:** `.animation(Motion.maybe(Motion.ring, reduceMotion: reduceMotion), value: fraction)`, then spark and glow via `onChange(of:)`, only when the new value is higher and never on first appearance.
4. **Identity:** callers set `.id("\(familyID)|\(kidID)|\(dayKey)")`. Switching family, child or day remounts the ring instead of animating it.
5. **Accessibility:**
   - `.accessibilityElement(children: .ignore)`.
   - Label = `accessibilityText`, or one built from the metrics: "Homework: 3 of 5. Habits: none yet. Daily 3: unavailable."
   - When the ring isn't inside a button, add `.isImage`.
6. **Previews:** `#Preview` states covering:
   - empty (every total 0);
   - partial;
   - full;
   - Daily 3 nil;
   - dark mode;
   - the mini ring.

### 4.2 Needs-you hero (parent and kid)

**Replaces** `TodayParentPriorityCard`. That card and its `StudyStartPriority` call site are deleted; the review flow moves to the rows below.

**Layout**
- iPad: one card, a 250pt ring column, then the rows.
- iPhone: ring centred above the rows.

**Ring centre**
- The open count (`heroNumeral`), then "need you" (kid: "to do"), then a small "N cleared today".
- With 0 open:
  - show "✓" when cleared > 0, otherwise "0";
  - the text reads "All clear".

**Header row**
- `sectionLabel` "NEEDS YOU" (kid: "YOUR DAY").
- A "See all N" link that opens the existing **Family actions** sheet (`ActionCard`). That sheet keeps create, snooze and delete. Snooze and delete never appear on the hero rows.

**Rows**
- `ActionQueue.topActive(viewerItems)`, **max 3**, then a "+N more" link to the same sheet.
- Row anatomy:
  - 40pt `KidProfileAvatar`, or a violet "F" badge for family and shared actions;
  - title in `itemTitle`, max 2 lines;
  - meta in `label`, e.g. "Ryshi · homework · due Mon 29 Sep", where "overdue" is always written in `frDanger`;
  - one control.

| Row type | Control | Action |
|---|---|---|
| Parent homework row (`store.isParent && sourceType == "homework"`) | Filled violet capsule "Review" (44pt) | The existing homework detail (`homeworkRef = HWRef(id: sourceId)`, the same as `ActionCard`) |
| `store.canCompleteAction(action)` | Outline capsule "Done" (`frYouInk` text, 1pt `frYou` border) | `await store.completeAction(action)`; the row collapses and the ring advances |
| Neither | none | — |

**States**
- **Loading:** skeleton ring plus 2 skeleton rows (`.redacted(reason: .placeholder)`, no shimmer).
- **Error:** the existing error text plus "Try again", which calls `store.loadFamilyActions()`.
- **Empty:** "All clear. Nothing waiting right now." plus a "Family actions" link.

### 4.3 Kid ring card (one per child, in family order: `store.kids`)

**Replaces** `TodayParentProgressCard`/`TodayProgressRow`, and the parent's use of `TodayFamsMiniCard`.

**Header**
- 34pt `KidProfileAvatar`, then the name in `kidName`, then a factual chip (capsule, `chip` style). Never "on track" or any judgement.

| Condition | Chip text | Colours |
|---|---|---|
| Overdue > 0 | "N overdue" | `frDanger` text on `frDangerSoft` |
| Otherwise, due today > 0 | "N due today" | `frHwInk` on `frHwSoft` |
| Otherwise | "Nothing due today" | `frHabInk` on `frHabSoft` |

**Body**
- `FamilyRing(.kid)`: outer Homework `frHw`, middle Daily 4 `frD3`, inner Habits `frHab` (owner decision 2026-09-26; the order matches the stats column).
- Stats column: three rows of numeral (`statNumeral`) plus a two-line label, all in the metric's `…Ink` colour:
  - **Homework:** `left` / "homework left / this week".
  - **Daily 3:** `n/3` / "Daily 3 today" plus a sub-line:
    - "Not started";
    - "In progress" (any part started or completed);
    - "Done ✓" (all 3).
    - If unavailable: "—" / "Daily 3 unavailable", with the middle ring omitted. **Never show 0.**
  - **Habits:** `done/total` / "habits today" with a sub-line "Check in" or "Done ✓". With no habits: "—" / "No habits yet · Set a first habit", which opens the Goals web view.

**Fams row** (1pt `frRule` above)
- "882 fams" (20 heavy, tabular).
- An 8pt capsule bar: `frFams` fill on a `frFamsSoft` track, width = `wallet.weeklyFraction`.
- "12 of 300 this week" in `label`.

**Layout**
- iPhone: ring (120) left, stats right. When `dynamicTypeSize.isAccessibilitySize`, stack the ring above the stats. `TodayProgressRow` already uses this pattern.
- iPad: `LazyVGrid(columns: [GridItem(.adaptive(minimum: 380), spacing: 20)])`, which gives 2 columns in landscape and stays single in narrow Split View.

**Taps**

| Target | Result |
|---|---|
| Card or ring | `ParentAttentionSheet(childID: kid.id)`, the child's brief. Its header gains this child's card (non-interactive, same component). |
| Homework numeral | Switch to the Homework tab filtered to this kid: set `store.pendingHomeworkKidID`, which `HomeworkScreen` consumes on appear (mirror `pendingChatRoomId`). |
| Habits numeral | A sheet listing this kid's habits, each with a check toggle (`store.toggleGoalCheck`), streak text and an "All goals" link to the Goals web view. |
| Daily 3 | Scroll to the Daily 3 tiles with `ScrollViewReader`. |
| Fams row | The existing fams destination that `TodayFamsMiniCard` opens today. |

**VoiceOver.** The card is one element:
- `.accessibilityElement(children: .ignore)`.
- Label, for example: "Ryshi: 2 overdue. Homework 3 of 5 done this week. Habits 1 of 2 today. Daily 3, 1 of 3 today. 882 fams, 12 of 300 this week."
- Default activation opens the child brief.
- Named `accessibilityAction`s: "Open homework", "Check habits" and "Daily 3", because nested buttons aren't reachable inside an ignored element.

**Legend.** Once, under the cards: coloured dots plus "Homework (outer) · Daily 4 (middle) · Habits (inner) · Fams this week", in `caption` `frInk2`.

### 4.4 Day strip and Tonight

**Rebuilds** the presentation of `TodayScheduleTimelineCard`. Keep its data: `Agenda.items(on: today, …)` without homework.

**Header**
- `sectionLabel` "TODAY · N EVENTS".
- On the right, the **Tonight** chip (parents only; kids never see it):
  - `frFamsSoft` capsule with a `fork.knife` symbol.
  - Text "Tonight: <title>" from `store.meals`, using today's `dinner` menu entry (the web: `menu.find(date == today && slot == 'dinner')`; confirm the field names in `MealsState`).
  - Otherwise "Tonight: dinner not planned · Plan tonight".
  - Tap opens Planning → Meals. Add `onOpenMeals` to `TodayScreen`, the same way as `onOpenHomework`, and set `planningSelection = .meals` in `RootView`.

**Track**
- 44pt tall, radius 12, `frCard2`.
- Covers 7 AM–9 PM with hour ticks (1pt `frRule`) and hour labels (`caption`) below.
- **iPhone:** 64pt per hour inside a horizontal `ScrollView`, centred on now at appear (`scrollTo("now", anchor: .center)`).
- **iPad:** fits the card width.

**Event blocks**
- Radius 9, filled with `kid.profileColor.opacity(0.16)`. Family events use `frYouSoft` with `frYouInk` text.
- Label "Swimming 1:40–4:00" (12/600, one line, tail truncation).
- Hit area at least 44pt via `contentShape`.
- Tap opens the existing event detail.
- **Overlaps** go in separate lanes: lane height 32, 4pt gap; the track grows.
- **All-day and out-of-hours events** appear as chips in a row above the track, with the same tints.

**Now marker**
- A 2pt `frYou` line plus a "Now 8:30" capsule (`frYou` fill, `frOnYou` text, 11/700).
- Refresh with `TimelineView(.periodic(from: .now, by: 300))`.

**Day over** (after 9 PM): add a smaller second track labelled "Tomorrow" with tomorrow's first events.

**Empty:** "Nothing on the calendar today", **on its own line, never over the hour labels**. This is web review #1.

### 4.5 Daily 3 tiles

Restyle `DailyFiveCard` / `TodayDailyFivePreview`. The data, the `DailySheet` sheets and `onOpen(activity)` stay.

- **Tiles:** 4 tiles: News, Quote, Word and Challenge.
  - iPhone: 2×2.
  - iPad: 1×4.
- **Tile contents:** a 44pt `FamilyRing(.mini)` in `frD3`: 0%, 50% when started, 100% when completed. Then the title (15/600) and a one-line status in `label`.
- **Challenge tile:**
  - streak and ready state from `DailyPuzzleProgress`, for example "1-day streak · Crossword ready";
  - its ring uses `frD3` too;
  - it is **not** counted in the kid's Daily 3 ring.
- **Tap** opens the existing sheet for that activity. Drafts and puzzle progress must survive.

### 4.6 Chat (`Features/Chat/ChatView.swift`)

This is a restyle only; every feature stays: emoji, GIFs, attachments (including the in-flight work), pins, add-to-today, meal-plan review and Hermes.

- **Bubbles:**
  - Others: `frCard2` background.
  - Mine: `frYouSoft` with `frYouInk` text, right-aligned.
  - Shape: radius 16 with a 4pt tail corner (`UnevenRoundedRectangle`).
- **Hermes:** name plus a "HELPER" tag capsule.
- **Cards:** event and homework cards are `frCard` insets with an SF Symbol.
- **Photos:** radius 14.
- **Composer:**
  - capsule input with a 44pt min height;
  - the placeholder must not clip (web review #5);
  - icon buttons;
  - a 44pt `frYou` circular send button.

### 4.7 Controls

| Control | Spec |
|---|---|
| **Primary** (`AccentButton`, and `SignalButton` re-pointed) | `frYou` capsule, `frOnYou` text 15/600, min height 44 |
| **Secondary** | Outline capsule: 1pt `frYou`, `frYouInk` text |
| **Link** | `frYouInk` 15/600 plus an `arrow.right` symbol |
| **Inputs** | Min 44, radius 12, 1pt `frRule`, `frCard` fill |
| **Hit targets** | At least 44×44 everywhere |
| **Tint** | `.tint(Palette.frYou)` on the root `TabView`, so selection, toggles and system controls go violet |

---

## 5. Screens

### 5.1 Today, parent (`TodayView.swift` → `ParentTodayStack`)

**Order**
1. **Header** (`TodayParentHeader` restyled):
   - Greeting in `greeting`.
   - One meta line: "Saturday 26 September · Nothing overdue · 1 event today". The overdue count is the sum of kid overdue counts, in `frDanger` when > 0.
   - The existing header buttons (Notes and others) stay.
2. **Needs-you hero** (§4.2).
3. **Kid ring cards** (§4.3), then the legend.
4. **Day strip** with Tonight (§4.4).
5. **Daily 3 tiles** (§4.5).
6. **`TodayUtilitiesRow`**: Scan a notice, Add event, Family actions, restyled as secondary capsules.
7. **`TodaySecondaryDisclosure`**: `HomeworkDueCard` and the rest, restyled.

**Keep**
- Every existing sheet: `ParentAttentionSheet`, `AddEventSheet`, `SchoolNoticeSheet`, and the Family actions sheet.
- Pull-to-refresh.

**Retire `TodayKidFilter` on Today** (D2). Kid cards replace per-kid focus, and every per-kid detail is one tap away.

**Delete the replaced components:**
- `TodayParentPriorityCard`
- `TodayParentProgressCard`
- `TodayProgressRow`
- `TodayKidFilter` and its environment key, if nothing else reads it
- the parent path of `TodayFamsMiniCard`

**Grouping.** New components go in one new file, `ios/FamETC/Features/Today/FamilyRingsToday.swift`, so the 910-line `TodayVisualComponents.swift` shrinks rather than grows.

**iPad (regular width)**
- Hero two-column.
- Kid grid adaptive: 2 across in landscape.
- Day strip full width.
- Tiles 1×4.
- Page padding 32.

**iPhone:** everything stacked, page padding 16, gaps 14.

### 5.2 Today, kid session (`KidTodayStack`)

**Order**
1. Header: "Hi <name>" plus the meta line.
2. **"Your day" hero:**
   - The rows are the viewer's manageable actions: `canManageOwnKidAction(action, ownKidId: me.kidId)`, including done ones for the cleared count.
   - The centre reads "to do".
   - Rows carry only "Done".
3. **Their own ring card** at 156 on every device.
   - Its fams row replaces `TodayChildFamsCard`, keeping the same destination.
   - The Habits sheet lets them check their own habits.
4. **Daily 3 tiles**, promoted here.
5. Day strip: their events, with no Tonight chip.
6. `StudyStartCard` and `KidHomeworkCard`, restyled.

**Hidden:** other kids, Tonight, utilities, and anything parent-only. The server already scopes the data; the UI must not ask for it.

### 5.3 Other native screens

| Screen | Changes |
|---|---|
| **Homework** (`App/PlaceholderScreens.swift` → `HomeworkScreen`) | Tokens. A top row per kid: mini homework ring (`kid` style, one metric, D = 44) plus "N left". Rows are `Card`s with due chips; overdue uses `frDanger` text. Parent: Review. Kid: Done. Consume `pendingHomeworkKidID`. |
| **Calendar** (`Features/Calendar/*`) | Today's column or cell gets `frYouSoft`. Event chips use `kid.profileColor.opacity(0.16)`; family events use `frYouSoft`. Header controls become capsules. The month view's `coral` deadline colour becomes `frDanger`. |
| **Chat** | §4.6. |
| **Meals, Notes, Fams, KidApproval, Assistance sheets** | Tokens and controls only. Meals uses the fams gold only for shopping counts. |
| **Onboarding, passkey, backup code** | Tokens and Geist only. **Don't touch auth logic.** Sign-out and recovery must stay reachable (AGENTS.md). |

### 5.4 Web surfaces inside the app

Settings, Goals, Activities, Trips and the Fams child page load fametc.com and are already Family Rings. On the iOS side:
- Set the `HybridWebView` background (`underPageBackgroundColor`, with a non-opaque web view until first paint) to `frBg`, so there's no white or beige flash in either mode.
- Check that the native navigation chrome around each web view uses the same tint.

---

## 6. Data (exact sources; port, don't reinvent)

### 6.1 `FamilyRingsMath` (new, pure: `ios/FamETC/Features/Today/FamilyRingsMath.swift`)

This file has no SwiftUI or store imports; it only takes values in and returns them. Each function names the web function it ports (at `public/js/app.js` on `main`).

| Function | Ports | Rule |
|---|---|---|
| `weekBounds(today:) -> (start, end)` | `todayKidProgress` | Monday–Sunday that contains `today` (`YYYY-MM-DD`). **Compute Monday explicitly**; don't trust `Calendar.current.firstWeekday`, which is Sunday in the US locale. |
| `homework(kidID:items:today:)` → `done, total, left, overdue, dueToday` | `todayKidProgress` | `week` = the kid's items with a non-empty `dueDate` where either `start ≤ dueDate ≤ end`, or `dueDate < start` and not done. `done` = done count in `week`; `total` = `week.count`; `left` = `total − done`. `overdue` = all not-done items with `dueDate < today`. `dueToday` = not done with `dueDate == today`. |
| `habits(kidID:goals:today:)` → `done, total` | `todayKidProgress` | `type == "habit"` for that kid. `done` = `checks` contains `today`. |
| `statusChip(homework:)` | `todayKidFacts` | "N overdue" → "N due today" → "Nothing due today". |
| `parentRing(actions:viewer:now:)` → `open, cleared, dueNow` | `renderTodayActionQueue` | **viewer** = parent: `canViewAction`; kid: `canManageOwnKidAction`. **open** = not done and not snoozed into the future (`ActionQueue.effectiveDue(...).isSnoozed == false`). **dueNow** = open with effective due date ≤ today (make `ActionQueue`'s bucket-0 test internal as `isDueNow`). **cleared** = `status == "done"` and `completedAt` falls on today's local date. **No `updatedAt` fallback**, matching the web decision in DESIGN.md: legacy completions without `completedAt` don't count. Ring = `cleared / (cleared + dueNow)`. |
| `daily3(_ payload: DailyFiveProgressPayload?)` | `todayDaily3Progress` | Kid: count of `news`, `quote`, `word` with status `completed`. nil or wrong date → nil (unavailable). |

### 6.2 Sources per ring

| Ring | Parent session | Kid session |
|---|---|---|
| **Homework** | `store.homework` (the whole family) | `store.homework` (server-scoped to self) |
| **Habits** | `store.goals` (§6.3) | Same; server-scoped |
| **Daily 3** | `APIClient.childDailyFiveProgress(kidID:date:)` → `daily3Completed` (nil means unavailable). **Move `TodayParentProgressCard.loadSnapshot()` as-is**: its identity, cancellation and `fam_sess` guards are the privacy boundary. | The same status source `DailyFiveCard` already uses for news, quote and word |
| **Fams** | `APIClient.famsWallet(kidId:)` per kid; reload on `.famsRewardsChanged` | Same, for self |
| **You** | `store.actions` | `store.actions` |

### 6.3 Goals plumbing (new)

**`Models.swift`**
- Decoding must tolerate `checks: null` (milestones) and missing `progress`.

```swift
struct Goal: Codable, Identifiable, Equatable {
    let id: String
    var kidId: String
    var title: String
    var type: String          // "habit" | "milestone"
    var target: Int
    var checks: [String]?     // habit only, "YYYY-MM-DD"
    var progress: Int?        // milestone only
}
struct GoalsResponse: Codable { var goals: [Goal] }
struct GoalResponse: Codable { var goal: Goal }
```

- Add `var completedAt: String? = nil` to `FamilyAction`. It's optional, so old caches still decode.

**`APIClient.swift`**
- `goals()` → `GET /api/goals`. The server scopes kids to themselves.
- `toggleGoalCheck(id:)` → `PATCH /api/goals/:id/check`. This is an idempotent toggle of *today*, and the response is `{ goal }`.

**`AppStore.swift`**
- `goals: [Goal]` and `goalsLoadState` (`idle | loading | ready | error`). The web distinguishes "Loading habits…" from "Habits unavailable".
- `loadGoals()` joins the existing `async let` launch batch next to `loadMeals()`.
- `toggleGoalCheck(_:)` is optimistic and rolls back on error.
- `pendingHomeworkKidID`.
- `canManageOwnKidAction` becomes internal.
- Clear `goals` wherever `meals = nil` clears state on sign-out or account switch.

---

## 7. Accessibility checklist (part of every phase)

- **VoiceOver:** every ring has a spoken summary, and kid cards use custom actions (§4.3). Hero rows read "title, meta", with the control as its own element.
- **Dynamic Type:** layouts hold from xSmall to AX5. Rings stay a fixed size while text scales. Stacks switch at `isAccessibilitySize`.
- **Contrast:** text uses only `…Ink`, `frInk` or `frInk2` tokens (all ≥4.5:1, per BRIEF.md §3.1). Ring colours are graphics (≥3:1) and always sit next to text.
- **Reduce Motion:** no spark, glow or animated fill.
- **Hit targets:** at least 44pt everywhere.

## 8. Phases (one conventional commit each, on `ios-family-rings`)

**P1 · Tokens, font, base components**

Files:
- `DesignSystem/Theme.swift`
- `DesignSystem/Components.swift`
- `Resources/Fonts/`
- `Info.plist`
- `App/RootView.swift` (tint)
- `App/HybridWebView.swift` (background)

Acceptance:
- `cd ios && xcodegen generate && xcodebuild -scheme FamETC -destination 'platform=iOS Simulator,name=<current iPhone Pro>' build` succeeds.
- `grep -rn "SpaceGrotesk\|JetBrainsMono\|0xF1EFEC\|Signal\." ios/FamETC ios/FamETCWidget ios/FamETCWidgetShared` returns nothing.
- A new `FamETCTests/FontRegistrationTests.swift` asserts `UIFont(name: Theme.fontName, size: 17) != nil`.
- Light and dark screenshots of all 5 tabs show the new palette.

**P2 · `FamilyRing`, maths, goals plumbing**

Files:
- `DesignSystem/FamilyRing.swift`
- `Features/Today/FamilyRingsMath.swift`
- `Networking/Models.swift`
- `Networking/APIClient.swift`
- `Domain/AppStore.swift`
- `FamETCTests/FamilyRingsMathTests.swift`
- `FamETCTests/ModelDecodingTests.swift`

Acceptance: `xcodebuild test -scheme FamETC -only-testing:FamETCTests/FamilyRingsMathTests -only-testing:FamETCTests/ModelDecodingTests` passes, with at least these cases:
- week bounds when today is a Monday and when it is a Sunday, with `firstWeekday = 1`;
- overdue from before the week counts, and done-before-week doesn't;
- a future snooze is excluded from `open`;
- `completedAt` yesterday, missing, and today just after local midnight;
- no habits → total 0;
- a Daily 3 payload for the wrong date → nil;
- `Goal` with `checks: null`;
- `FamilyAction` without `completedAt`.

**P3 · Parent Today**

Files:
- `Features/Today/TodayView.swift`
- new `Features/Today/FamilyRingsToday.swift`
- `Features/Today/TodayVisualComponents.swift` (deletions)
- `Features/Today/DashboardWidgets.swift`
- `App/RootView.swift` (`onOpenMeals`)
- `App/PlaceholderScreens.swift` (`pendingHomeworkKidID`)
- `Features/Assistance/ParentAttention.swift` (header card)

Fixture and test:
- Extend `tests/fixtures/ios-family-assistance-server.js` with `GET /api/goals`, `PATCH /api/goals/:id/check`, `GET /api/fams` and `GET /api/children/:id/insights`, using synthetic data only.
- Add `FamETCUITests/FamilyRingsUITests.swift`. It launches with `FAM_BASE_URL=http://127.0.0.1:18247` and asserts:
  - the hero label ("2 things need you, 1 cleared today");
  - tapping Done changes it to "1 thing needs you, 2 cleared today";
  - a kid card's label contains that kid's fixture counts;
  - the homework numeral opens Homework filtered to that kid.

Acceptance:
- Run `node tests/fixtures/ios-family-assistance-server.js`, then `xcodebuild test -scheme FamETC -only-testing:FamETCUITests/FamilyRingsUITests` passes.
- `node --test tests/*.test.js` still passes.

**P4 · Kid Today** (§5.2)

Acceptance: extend `FamilyRingsUITests` with a kid fixture session. The kid sees one ring card, no Tonight chip and no other kids, can complete their own action, and can toggle their own habit.

**P5 · Other screens, motion, accessibility**

Files: §5.3, §5.4, §3.5, §7.

Acceptance:
- The Accessibility Inspector audit on Today (both roles), Homework and Chat has no label, contrast or hit-target warnings.
- Screenshot matrix (§9) complete.

**P6 · Widgets (optional; only after the owner approves P1–P5 on device)**
- `FamETCWidget` adopts the tokens plus a **single** "Needs you" ring, reading the `FamilyAssistanceSnapshot` data it already has.
- No triple rings on the Home Screen (D1).
- `FamilyRing.swift` moves to `FamETCWidgetShared/` so both targets compile it.

**P7 · Records and handoff**
- `DESIGN.md`: replace "Web-only adoption: native iOS parity is pending" with an iOS paragraph.
- `APP-BRIEF.md` Design rows: "Family Rings web + iOS, user-confirmed 2026-09-26".
- BRIEF.md §9: mark iOS parity resolved.
- Bump `CURRENT_PROJECT_VERSION` in `ios/project.yml` (11 → 12).

## 9. Definition of done

**Tests**
- `xcodebuild test -scheme FamETC` passes on an iPhone and an iPad simulator (FamETCTests plus FamETCUITests, with the fixture server running).
- `node --test tests/*.test.js` passes.

**Screenshot matrix** (attach to the final report)

| Devices | Variants |
|---|---|
| iPhone (current Pro) and iPhone SE (3rd gen, 375pt) | Light and dark, Dynamic Type default, xxxLarge and AX3, Reduce Motion on |
| iPad Pro 13" | Landscape and portrait, light and dark |
| iPad Split View, ⅓ width | Compact |

- No truncation, collisions or overlaps.
- The only horizontal scrolling is the iPhone day strip.

**Interaction proof.** Tap every new control and state the observed result:
- Done;
- Review;
- See all;
- +N more;
- kid card;
- homework numeral;
- habits sheet toggle;
- each Daily 3 tile;
- Tonight;
- a day-strip event;
- legend-free empty states.

**Web parity.** For one real family, the iOS Today and live fametc.com Today show the same numbers for:
- needs-you count and cleared;
- each kid's homework left, habits and Daily 3;
- fams.

The owner signs in on their own simulator or device. **Never enter credentials.**

**Device-only checks** (label them "simulator-only" until the owner confirms on hardware):
- haptics;
- scroll smoothness with 3 kid cards on an older iPhone;
- Dynamic Type on device.

**Handoff**
- Merge `ios-family-rings` to `main` and run `xcodegen generate`.
- Hand over `ios/FamETC.xcodeproj`. **The owner archives and uploads in Xcode.** Never archive, upload or TestFlight automatically.
- Before any submission, run the `production` skill (existing-user, new-user and IAP suites). Any FAIL blocks.

**House rules (from CLAUDE.md and AGENTS.md)**
- Commit per phase.
- Never echo secrets.
- No demo data in real flows: fixtures only behind `FAM_BASE_URL` in UI tests.
- Keep kid privacy and role boundaries.
- Keep sign-out and backup-code recovery reachable.
- "Done" means verified output was shown, not "it compiles".

## 10. Open decisions and risks

**D1 · Activity-ring look-alike (App Review).**
- **The risk:**
  - Three concentric rose, teal and azure rings echo Apple's Move, Exercise and Stand order (red, green, blue).
  - Apple's HIG reserves Activity rings for Activity data.
  - App Review guideline 5.2.5 covers apps that look confusingly similar to Apple interfaces.
- **Mitigations in this brief:**
  - light or dark cards, never black;
  - flat colours;
  - numbers always beside the rings;
  - none of Apple's copy;
  - no triple rings on widgets or the watch.
- **Done 2026-09-26 (owner decision):** the rings are now orange, mint and fuchsia in the order Homework, Daily 4, Habits on **both** platforms, which no longer mirrors Activity's red, green and blue.
- **Recommendation:** ship as designed; don't pre-empt.

**D2 · Kid filter retired on Today.**
- It matches the web, which has no filter, and kid cards cover per-kid focus.
- If the owner wants it back, it returns as a filter on the kid grid only.

**D3 · iPad docked chat.**
- APP-BRIEF's iPad row calls for a docked chat column in landscape.
- The current code has Chat as a tab: the docked column was removed during later iPad reliability work, and `RootView` keeps "one structural identity across window sizes".
- This brief keeps the current structure. Reinstating the dock is a separate decision, and the web keeps its dock.

**D4 · Hermes cases and the setup card** remain web-only; iOS Today never had them.

**D5 · Watch.**
- Out of scope; `FamETCWatch/DESIGN.md` governs it.
- If rings ever go there, use a single ring only. Activity confusion is highest on the watch.

**D6 · App icon and App Store screenshots.**
- Both are unchanged here.
- Re-shoot the screenshots (APP-BRIEF "App Store assets" row) after this ships, before the next submission.

**D7 · Habit day boundary.**
- The server toggles "today" in its own timezone (`todayLocalYMD`), and the clients compare against the device date.
- The web has the same limitation near midnight, and this brief doesn't fix it.

**D8 · Child view depth.**
- The web child view has a 220px ring and Mon–Sun bars.
- On iOS, the child brief (`ParentAttentionSheet`) gets only the ring card header.
- Week bars need history data that the native app doesn't load, so they're a follow-up.

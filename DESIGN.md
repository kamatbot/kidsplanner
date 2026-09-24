---
name: Fam ETC — Horizon
description: A calm family workspace with clear priorities and approachable learning.
colors:
  primary: "#6f43d6"
  on-primary: "#ffffff"
  background: "#f1efec"
  surface: "#ffffff"
  surface-subtle: "#faf8f5"
  border: "#e7e3dd"
  text: "#211e1b"
  text-secondary: "#6a655f"
  coral: "#f0704f"
typography:
  body:
    fontFamily: '"Space Grotesk", -apple-system, BlinkMacSystemFont, sans-serif'
  mono:
    fontFamily: '"JetBrains Mono", ui-monospace, monospace'
  greeting:
    fontSize: "34px"
    fontWeight: 650
    lineHeight: 1.05
    letterSpacing: "-.035em"
  section:
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-.02em"
  title-lg:
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.35
  title:
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
  lede:
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  body-text:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.35
  meta:
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.45
  tag:
    fontSize: "11.5px"
    fontWeight: 600
    lineHeight: 1
  numeric:
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
  quote-display:
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1.45
  word-display:
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.1
rounded:
  control: "10px"
  row: "12px"
  composer: "14px"
  band: "18px"
  pill: "999px"
spacing:
  compact: "12px"
  standard: "16px"
  section: "18px"
  region: "22px 24px 24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    padding: "12px 22px"
  mini-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    height: "34px"
  band:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.band}"
---

# Design System: Fam ETC

## Overview

**Horizon.** A warm neutral canvas, clear white surfaces and violet interactions. Typography is friendly and compact; hierarchy comes from space, scale and readable actions rather than decorative imagery.

Today, the parent homepage, is the **Needs-You Stack** (seed 694b4b4f, chosen by the user 2026-09-24). It is a queue, not a widget wall: what needs a parent now leads, and the day, the children, dinner, habits and learning follow in fixed bands. Its surface brief lives in `.impeccable/surfaces/public-index-html.md`.

## Colors

**The Interactive Violet Rule.** Violet is only for actions, selected controls and focus. Data marks such as chart bars and family events on the timeline stay neutral. Coral marks momentum and the present moment: the "Now" line, weekly fams progress and streaks. Green, red and amber are strictly semantic (done, overdue, stale). A child's identity is their profile colour, shown through the avatar or a timeline node, never as a fill behind text.

The frontmatter describes the light theme. `public/css/horizon.css` owns both themes. Every surface references its CSS variables, so dark mode re-resolves every colour and native form controls follow.

## Typography

Space Grotesk carries every role. JetBrains Mono appears only in two data columns, schedule times and chart values, plus the uppercase "Now" marker. Counts, pills and balances stay in Space Grotesk with tabular numerals, because a second face on every number read as inconsistent to the user. Today routes every text rule through one scale, set as `--t-*` font tokens on `#tab-today`: section 18, lead title 17, title 15, lede 15, body 14, label 13, meta 12.5, tag 11.5 and numeric mono 12. The only other sizes are the greeting (34), the quote of the day (20), the word of the day (26), and crossword clue numbers inside 28px cells (8). A new Today rule picks a token; a new size is a design-system change.

Figures in times, counts and scores use tabular numerals. Headings carry their own weight, with no eyebrow labels above them.

## Layout

The application separates navigation, scrollable main content and the family chat dock. Today is centred, at most 1280px wide, with a stable scrollbar gutter.

Today is a query container (`container: today / inline-size`), so its layout answers the space left beside the chat dock, not the viewport:

1. **Header:** the greeting, then one summary line: date · things that need you (overdue in red) · events today. School-feed sync status sits on the right, with a green dot when fresh, amber when stale and hollow when never synced.
2. **Band one:** Family Actions (3fr) beside the Schedule (2fr).
3. **Band two:** Children beside Tonight and Habits.
4. **Band three:** Daily 3 beside the brain teaser and puzzle.

Bands one and two split at a container width of 760px and band three at 1060px. Below that, regions stack inside their band. Until setup is complete, a setup card sits between bands one and two. It lists only the unfinished steps and shows progress in its heading.

## Elevation & Depth

Today is flat at rest. Each band is one white surface with a 1px border, and its regions are separated by 1px hairlines. Dialogs, popovers and the selected segment of a segmented control keep small shadows. Nothing else casts one.

## Shapes

Bands use an 18px radius, controls 10px, hover rows 12px, the action composer 14px, and pills and avatars are round. Rows separate with straight hairlines drawn by pseudo-elements, so a hover radius never curls a border.

Icons are authored SVG on a 24px grid with 2px round strokes, matching the sidebar. `todayIcon(name)` in `public/js/app.js` holds the set. Emoji never stand in for chrome; user content keeps whatever it contains.

## Components

- **Buttons:** one primary per region, violet with contrasting text (in the stack, the lead homework review button). Quiet actions are `.today-mini-btn`: 34px, bordered, turning violet on hover. Navigation links are `.today-link`: violet text with an arrow that nudges on hover.
- **Action stack:** each row has a lead (a completion ring with a `--text-2` border and a 44px hit area, or the child's avatar for parent homework reviews), a title and a middot metadata line. The ring, or Review homework, is the row's one control. Snooze and delete live in "View all actions", labelled. The first row is the lead item: 17px, with a violet ring or a primary Review button. Completing an action fills the circle green, strikes the title and collapses the row in 280ms: the one authored motion on the page.
- **Schedule timeline:** a mono time column, a 1px rail with nodes in each child's colour (neutral for family events, hollow once past), titles at 15px, and a coral "Now" line. Once the day is over, tomorrow's events follow as timeline rows under "Tomorrow". Dinner rows show a bowl icon instead of the feed's emoji.
- **Child rows:** avatar, name, a facts line (overdue in red · due today · this week · habits) and fams with a coral weekly track. Rows keep family order, never a score order.
- **Daily 3:** a segmented tablist with one mounted panel per activity, roving focus, arrow keys and Home/End. A done activity shows a green check in its tab. Switching tabs never remounts activities or loses drafts and puzzle progress.
- **Challenge:** a chip row for the week (today's chip is outlined in text colour), a semantic table chart with text-colour bars and mono values, a 15px question, and option buttons that turn green or red with text feedback.

## Do's and Don'ts

- Do keep real role boundaries: parents review homework but never complete it, and kids manage only their own actions.
- Do keep the right chat dock and the sidebar outside Today's scope.
- Do show compact previews with explicit routes to their full screens. The action preview is capped at three.
- Do show the Hermes panel only when it has cases.
- Don't turn illustrative or local test data into product claims.
- Don't use opacity to dim text. Use `--text-2`.
- Don't add a font size, radius or colour outside this file without updating it.
- Don't let activity content or scrollbar appearance resize the surrounding page.

# Fam ETC — App Store Listing & ASO Package

Everything needed to fill in App Store Connect for the 1.0 submission. Character
limits in `[brackets]`; counts verified for the copy below. Copy guardrails follow
`docs/marketing/STA-LAUNCH-PLAN.md` §2 (never "official", "automatic sync",
"free forever" or "AI-powered") and the parent-facing rules in `APP-BRIEF.md`.

---

## 1. App Name `[30 max]`

```
Fam ETC: Family Planner & Chat
```
*(30)*

## 2. Subtitle `[30 max]`

```
School, homework & family chat
```
*(30)*

## 3. Keywords `[100 max]`

```
calendar,organizer,kids,parents,timetable,schedule,shared,todo,meals,shopping,trip,household,week
```
*(97 — "family", "planner", "chat", "school", "homework" already rank via Name/Subtitle; do not repeat them)*

## 4. Promotional Text `[170 max]`

```
The school week in one calm app: homework and the timetable arrive from school, the family thread turns a message into a plan, and everyone knows what today looks like.
```
*(168)*

---

## 5. Description `[4000 max]`

```
EVERYONE KNOWS WHAT TODAY LOOKS LIKE

Fam ETC puts the school week and the home week in one place, with one family thread down the middle. Homework, the timetable and after-school activities arrive from school without anyone typing them in. Lifts, kit bags and dinner get decided in chat and turned into the plan with a tap.

Built by a St Andrews Bangkok parent for St Andrews families. Fam ETC is not an official school app.

NOBODY TYPES THE HOMEWORK IN
• Paste each child's private homework and timetable links once, in Settings at fametc.com
• Homework, subjects, due dates and teachers land per child
• This week's periods, rooms and after-school clubs sit in the family calendar
• Checked every eight hours, only if the school changed something
• Read-only: the link is encrypted, never shown again, and only ever read

THE THREAD WHERE THINGS GET DECIDED
• One chat for the whole family, parents and kids
• Turn a message into an action, a calendar event or a shopping run without retyping
• Photos, GIFs and a buzz for the message that cannot wait
• Parents keep the keys: any parent can delete any message or remove a member

ONE CALM TODAY SCREEN
• What matters next for the family, then each child's day
• Homework due, today's schedule and the next thing to leave for
• Each child in their own colour, on iPhone and iPad alike

THE FAMILY WEEK, TOGETHER
• Shared calendar with school events and family plans, filtered per child
• Meals: plan the week's dinners, vote on Friday, and let the shopping list write itself
• Trips: plan a holiday with the other adults who are coming — dates, bookings, who brings what
• Daily 5: a quote, a word, a brain teaser, a puzzle for each age band and one good news story

MADE FOR KIDS TO USE, NOT SIGN UP FOR
• Kids cannot create an account on their own
• A parent creates every child profile and approves every child device
• Kids see the family thread and their own day, and nothing else
• Kids' data and every message are encrypted at rest

PRIVATE BY DESIGN
• Passkey sign-in with Face ID or Touch ID, no passwords
• No advertising, no third-party trackers, aggregate-only analytics
• Your family's data stays in your family

Free on iPhone and iPad while we launch with St Andrews Bangkok families. Other schools are coming next.
```
*(2285)*

---

## 6. What's New (1.0)

```
First release. School homework and timetable sync, the family thread with turn-into-a-plan actions, a calm Today screen for every family member, shared calendar, meals, trips, and daily puzzles. iPhone and iPad.
```

---

## 7. Categories & rating

- **Primary category:** Productivity
- **Secondary category:** Lifestyle
- **Age rating:** 4+. Parent-facing app; deliberately NOT the Kids Category (APP-BRIEF "Kids' privacy & compliance"). Answer "No" to all content descriptors; "Unrestricted web access: No" (HybridWebView only loads fametc.com).
- **UGC (guideline 1.2):** the chat has parent delete-any-message, a report/flag path, and member removal. Say so in Review Notes.

## 8. URLs

- **Marketing URL:** https://www.fametc.com
- **Support URL:** https://www.fametc.com/help
- **Privacy Policy URL:** https://www.fametc.com/privacy

## 9. App Privacy (nutrition label) answers

- **Data used to track you:** None. No ad SDKs, no third-party trackers.
- **Data linked to you:**
  - Contact Info: name, email address (parent account)
  - User Content: messages, photos/attachments, calendar and homework entries, kid profiles (name, grade, colour)
  - Identifiers: user ID, push device token
- **Data not linked to you:** Usage Data (aggregate daily counters only; no per-user event log)
- **Third-party sharing:** None.
- Sign-in is passwordless (passkeys); no passwords are collected. School links are stored encrypted and used only for read-only fetches.

## 10. Review Notes (paste into App Store Connect)

```
Fam ETC is a parent-run family planner with a private family chat. There is no public sign-up for children: a parent creates each child profile and approves each child device from inside the family. Parents can delete any message, flag messages, and remove members (guideline 1.2 controls).

Reviewer sign-in: passkey-only. Use the backup-code sign-in path on the login screen with the reviewer account below.
  Account: <reviewer parent account>   Backup code: <one-time code>
(Create this account and mint codes before submitting; see "Blockers" below.)

The school sync feature reads homework and timetable data from links a parent pastes in Settings (read-only, encrypted). The reviewer account is pre-connected to a demo school feed so Homework and Calendar are populated.
```

---

## 11. Screenshots — files & captions

Rendered by `ios/marketing/frame.sh` from real simulator captures (light mode, 9:41 status bar, fictional Sharma family: Priya, Mia, Leo). Two-line headline above the device; second line in the coral→violet Horizon gradient.

| # | File | Headline (baked in) | Sells |
|---|------|---------------------|-------|
| 1 | `01-today.png` | "Everyone knows / what today looks like" (iPad: "One calm place / to run the family") | The hero: the Today screen |
| 2 | `02-homework.png` | "Nobody types / the homework in" | School sync, per child |
| 3 | `03-chat.png` | "The thread where / things get decided" | Family chat, parents + kids |
| 4 | `04-calendar.png` | "The family week / at a glance" | Shared calendar |
| 5 | `05-meals.png` | "Dinner decided, / list written" | Meals + shopping |

**Folders (`ios/marketing/appstore/`):**
- `iphone-6.9-1320x2868/` — iPhone 6.9" — **required** by App Store Connect
- `iphone-6.7-1284x2778/` — iPhone 6.7"
- `iphone-6.5-1242x2688/` — iPhone 6.5"
- `ipad-13-2064x2752/` — iPad 13" — **required** because the build targets iPad (TARGETED_DEVICE_FAMILY 1,2)
- `ipad-12.9-2048x2732/` — iPad 12.9"
- `watch-s11-416x496/` — Apple Watch Series 10/11 46mm — **required** because the build ships a watch app
- `watch-ultra3-410x502/` — Apple Watch Ultra

**Apple Watch** (`shots/watch/`, one-line headlines):

| # | File | Headline | Sells |
|---|------|----------|-------|
| 1 | `01-my-next.png` | "Next up, on your wrist" | My next + urgent family actions |
| 2 | `02-homework.png` | "Homework, on time" | Homework due, per child |
| 3 | `03-shopping.png` | "The list, in the shop" | Shared shopping list |

Upload in order 1 → 5; the first three carry the pitch (today, homework, chat). Raw captures are kept in `ios/marketing/shots/{iphone,ipad}/`; re-run `./frame.sh` after any UI change.

## 12. App icon

`ios/FamETC/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` (light, opaque RGB), `AppIcon-dark-1024.png`, `AppIcon-tinted-1024.png` — the four-tile Fam ETC mark (same as `public/icons/fametc-mark.svg`) on the Horizon greige ground. Sources: `ios/marketing/icon-{light,dark,tinted}.svg`. The previous files were RetireOdds' icon and have been replaced.

---

## 13. ASO strategy notes

**Target query clusters:**
- *Job intent:* family planner, family calendar, family organizer, shared calendar, kids schedule
- *School intent:* homework planner, school timetable, homework tracker, homework app
- *Chat intent:* family chat, family group chat, family messenger
- *Home intent:* meal planner, shopping list, family trip planner

**Coverage:** Name → *family / planner / chat*; Subtitle → *school / homework*; Keywords → *calendar / organizer / kids / timetable / schedule / meals / shopping / trip / household*. Apple combines fields, so "family calendar", "homework planner", "shared shopping list" and "kids schedule" all resolve without repeating words.

**Conversion levers:** screenshots 1–3 carry the whole promise; Promotional Text can be swapped without a build (e.g. term-start: "New term. One app for the school week."). "Free" in the description lifts tap-through.

**After launch:** watch which terms convert in App Analytics and rotate the weakest Keyword terms; when a second school is connected, drop "St Andrews" from the description body and move it to a "Schools" line.

## 14. Blockers before submitting (not copy)

- [ ] `public/privacy.html` is a placeholder ("Full policy text to be finalized"). App Review checks the Privacy Policy URL; it must be a real policy before submission.
- [ ] Create the reviewer parent account + backup codes, and pre-connect it to a demo school feed (Review Notes above).
- [ ] Apple Developer enrollment active on team B4F73U5RGR (APP-BRIEF launch checklist).
- [ ] Run the `production` skill gate before archiving (global rule).
- [ ] Optional 6th slide (Trips, "Plan the holiday / with everyone"): the Trips tab is a web view and the DEBUG screenshot cookie (`FAM_DEV_COOKIE`) is never synced into the WKWebView store, so it renders "Not authenticated" in the capture rig. Fix: call the AuthService cookie sync from `DebugLaunch.bootstrap()`, then re-add the slide to `frame.js` and re-run `frame.sh`.

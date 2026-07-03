# Fam ETC School Import (Chrome extension)

Auto-syncs a child's homework and timetable from the school Moodle portal
(`bangkok.learn.nae.school`) into Fam ETC — without ever handling a
username or password.

## How it works

The extension runs entirely in **your already-logged-in browser sessions**
(Moodle + Fam ETC). It has three parts:

- **`content.js`** — a content script that runs automatically on every
  `bangkok.learn.nae.school` page. It detects whether you're logged into
  Moodle, checks in with the background worker, and either auto-syncs, shows
  a small callout, or does nothing (e.g. on the login page).
- **`background.js`** — an MV3 service worker that bridges the Moodle page
  and an open, logged-in `fametc.com` tab. It's the only place that talks to
  the Fam ETC tab, via `chrome.scripting.executeScript` with `world: "MAIN"`
  (see "Why executeScript world:MAIN" below).
- **`popup.js`** — the toolbar popup, kept as a manual fallback trigger you
  can use anytime, independent of the auto-sync throttle.

`parse.js` holds the Moodle HTML parsing (homework list + timetable) shared
by both the content script and the popup, so auto-sync and manual import
never drift apart.

## Auto-sync flow

1. **Set your kids' Moodle IDs once**, in Fam ETC → Settings → "School
   (Moodle) IDs". This numeric id is *not secret* (it's just Moodle's
   internal user id) — Fam ETC stores it per kid and exposes it to the
   extension via a stable `window.famGetSchoolMappings()` global on the
   `fametc.com` page.
2. **Stay signed into Moodle** in a browser tab. Whenever you land on a
   Moodle page:
   - If no `fametc.com` tab is open, a small dismissible banner appears
     top-right: *"Fam ETC: open fametc.com to auto-sync — [Open Fam ETC]"*.
     Clicking the button opens/focuses a `fametc.com` tab; auto-sync does
     **not** run automatically the first time — reload the Moodle page (or
     wait for the next page load) once Fam ETC is open.
   - If a `fametc.com` tab is open but no kids have a Moodle ID saved yet, a
     banner nudges you to set one up in Settings.
   - If a `fametc.com` tab is open **and** at least one kid has a Moodle ID
     saved **and** the throttle window has elapsed, the extension silently
     fetches and imports **each mapped kid's** homework + timetable, then
     shows a brief success banner with the totals (auto-dismisses after
     ~15s).
3. **Throttle**: auto-sync runs at most **once every ~10 minutes**, tracked
   in `chrome.storage.local` so it persists across page loads/tabs. Manual
   import via the popup is **never throttled** — use it anytime for an
   immediate sync.

## Manual fallback (popup)

Click the extension icon any time to trigger an import by hand:

1. It tries to prefill your kids' saved Moodle IDs (read from the open
   `fametc.com` tab via the background worker) as clickable links — click
   one to fill in the id + name fields.
2. Or type in a Moodle user id manually — it also prefills from the active
   Moodle tab's URL (`userid=`/`id=` query param) if you're viewing that
   child's homework/timetable page.
3. Enter the child's name as shown in Fam ETC (optional if there's only one
   kid in the family).
4. Click **Import homework & timetable**. The status area reports how many
   homework items and timetable events were added, and surfaces clear
   errors (not logged into Moodle, no open Fam ETC tab, etc).

## Why `executeScript` with `world: "MAIN"`

The extension has no access to the `fametc.com` session cookie in a
cross-context `fetch` — only same-origin script running *inside* the page
can rely on that cookie automatically. So the "write" step (calling
`window.famImportSchoolData(...)` or reading
`window.famGetSchoolMappings()`) runs via
`chrome.scripting.executeScript({ world: "MAIN", ... })` injected into the
open Fam ETC tab — exactly like a same-origin script running in the page
itself would. The default "isolated" world shares the DOM but *not* the
page's `window` globals, so those functions (defined by the page's
`public/js/app.js`) are only reachable from `MAIN`.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `chrome-extension/` folder in this repo.
5. Pin the extension if you want quick access to the manual popup.

## Multi-kid sync

Fam ETC → Settings → "School (Moodle) IDs" lets a parent set a Moodle id
for **each** kid in the family. `window.famGetSchoolMappings()` returns one
entry per kid that has an id set — the extension loops over all of them on
every auto-sync pass (and fetches/imports/posts totals as one combined
success banner), so a family with multiple kids at the same school gets all
of them synced from a single Moodle login, no per-kid manual steps needed.

## Limitations

- **Current week only**: timetable lessons are mapped onto the *current*
  Mon–Fri calendar week each time an import runs. The school timetable
  repeats weekly, so the extension re-syncs (throttled ~10 min) as long as
  you stay signed into Moodle with a Fam ETC tab open, keeping the calendar
  current automatically.
- **Teacher/room not split out**: each timetable cell's full text (subject,
  teacher, room, group) is stored as-is in the event title/notes rather
  than being parsed into separate fields.
- **2-week (Wk1/Wk2) timetables**: if the school timetable page alternates
  between two weeks, only the first week's rows are imported.
- **A `fametc.com` tab must be open and logged in** for auto-sync or manual
  import to write anything — the callout banner exists specifically to
  prompt you to open one.
- **Homework due dates without a year** (e.g. "Thu 18 June") are inferred
  from the current academic year (Aug–Jul) by the Fam ETC bridge — double
  check imported due dates around the calendar-year boundary (Dec/Jan).
- **Completed homework is skipped by default** — only outstanding homework
  is imported, to avoid cluttering the homework hub.

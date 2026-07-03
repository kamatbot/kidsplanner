# Fam ETC School Import (Chrome extension)

Imports a child's homework and timetable from the school Moodle portal
(`bangkok.learn.nae.school`) into Fam ETC — without ever handling a
username or password.

## How it works

The extension runs entirely in **your already-logged-in browser session**.

1. You open the popup and enter your child's Moodle user id and their Fam
   ETC kid id.
2. The extension fetches the two Moodle pages (homework list, timetable)
   using your existing logged-in cookies (`credentials: 'include'`) — no
   login form, no stored password.
3. It parses the homework and timetable HTML directly in the popup.
4. It finds your open, logged-in `fametc.com` tab and injects a tiny script
   into that tab that calls `window.famImportSchoolData(...)`. This runs the
   import **inside the Fam ETC page itself**, using the page's own session
   cookie — the extension never talks to the Fam ETC server directly.
5. Fam ETC adds new (non-completed) homework and this week's timetable
   lessons as calendar events, then shows a summary.

This replaces the old server-side "connect your Moodle account" flow, which
required storing your school password on the server. There are no
credentials to type into the extension at all.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `chrome-extension/` folder in this repo.
5. Pin the extension if you want quick access to it.

## Usage

1. Log into `https://bangkok.learn.nae.school` in one tab.
2. Log into `https://www.fametc.com` (or `fametc.com`) in another tab. Keep
   both tabs open.
3. Click the Fam ETC School Import extension icon.
4. The Moodle user id field prefills automatically if your active Moodle
   tab's URL contains `userid=` or `id=` (e.g. viewing that child's
   homework or timetable page). Otherwise type it in — Ryshi's is `14197`.
5. Enter the Fam ETC kid id for that child (found in Fam ETC under
   Settings → Manage Family → kids).
6. Click **Import homework & timetable**.
7. Watch the status area — it reports how many homework items and
   timetable events were added, and surfaces clear errors (not logged into
   Moodle, no open Fam ETC tab, etc).

## Limitations

- **Current week only**: timetable lessons are mapped onto the *current*
  Mon–Fri calendar week each time you import. The school timetable repeats
  weekly, so re-run the import each week (or before a new week starts) to
  keep the calendar current.
- **Teacher/room not split out**: each timetable cell's full text (subject,
  teacher, room, group) is stored as-is in the event title/notes rather
  than being parsed into separate fields.
- **2-week (Wk1/Wk2) timetables**: if the school timetable page alternates
  between two weeks, only the first week's rows are imported; the popup
  will note this in its status message.
- **Both tabs must stay open**: a Moodle tab (for the fetch's session
  cookies) and a fametc.com tab (for the injected write) both need to be
  open and logged in when you click Import.
- **Homework due dates without a year** (e.g. "Thu 18 June") are inferred
  from the current academic year (Aug–Jul) by the Fam ETC bridge — double
  check imported due dates around the calendar-year boundary (Dec/Jan).
- **Completed homework is skipped by default** — only outstanding homework
  is imported, to avoid cluttering the homework hub.

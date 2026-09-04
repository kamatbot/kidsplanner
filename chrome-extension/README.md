# Fam ETC School Helper (Chrome extension)

The official St Andrews private feeds now provide Fam ETC's homework,
timetable, and timetable activities. This extension deliberately does **not**
scrape or import those surfaces anymore.

It remains optional for two Moodle-session capabilities that the read-only
feeds do not provide:

- school stats shown on the Moodle home page (house points, attendance,
  punctuality, and canteen balance); and
- delivery and verification of legacy Moodle homework completions that were
  queued before a child moved to the private feeds.

## How it works

- `content.js` runs on authenticated Moodle pages. At most once every ten
  minutes it reads the family-wide school stats and passes them to an open,
  authenticated Fam ETC tab. It also asks the background worker to deliver
  any existing legacy completion requests.
- `background.js` bridges the Moodle and Fam ETC tabs using
  `chrome.scripting.executeScript({ world: "MAIN" })`. It accepts only school
  stats for import; homework, timetable, and activity payloads are not
  forwarded.
- `popup.js` provides a manual **Sync school stats** button.
- `parse.js` contains the Moodle parsing helpers. Its historical homework,
  timetable, and ECA parsers remain for rollback compatibility, but the active
  extension flow does not call them.

Moodle cookies and session keys stay in the browser and are never stored in
Fam ETC. A logged-in `fametc.com` tab is required for the stats bridge.

## Install or update

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Remove/reload the previous “Fam ETC School Import” extension.
4. Choose **Load unpacked** and select this `chrome-extension/` folder.

Version `0.5.0` appears as **Fam ETC School Helper**. Configure each child's
private homework and timetable links in Fam ETC → Settings; the extension is
not involved in that eight-hour server-side sync.

# Scheduled articles — 4 October 2026

Branch: `codex/scheduled-articles`, baseline `1bab5cf`.

`/admin` is a standalone article editor with its own password session. It lets the editor preview a public HTTPS link, choose a date, edit the title/short description/conversation prompt, and schedule, change or remove one article per day. The server places today's shared pick first in Daily News, retaining the three automatic categories and deduplicating the featured URL. All accounts receive the same pick.

Dates use **Asia/Bangkok**, midnight to midnight, regardless of the viewer's timezone. A future automatic-news date query cannot reveal a future scheduled article. On the first news request of the scheduled day, the server fetches the publisher's preview; concurrent requests share the fetch. A failed publisher request falls back to the saved title/link and retries on requests after 30 minutes. This is request-driven scheduling; it does not require a cron job or an open editor. Metadata is text-only, descriptions are capped at 25 words, and the complete article opens on the publisher's site. The selection date is labeled “Selected for today,” not represented as the publisher's original publication date.

The schedule persists in the existing encrypted datastore. Native iOS understands the additional featured category and retains all automatic choices. Android's existing ordered item list now allows four items. **An iOS app update is required:** already-installed versions hard-code the three automatic categories. Android's older build shows the featured item but caps the list at three.

## Password setup

Set `FAM_ARTICLE_ADMIN_PASSWORD_HASH` in the deployment environment. Never use a family account password, analytics token, or operator administration token. Without a valid hash the editor is locked, including on localhost. Generate the salted hash locally under Node 24, writing a new private file outside deployed/public assets:

```zsh
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
node --version # must report v24.*
read -rs 'fam_editor_password?New editor password (10+ characters): '
print -rn -- "$fam_editor_password" | node scripts/article-admin-password.js .dev-data/article-editor-password.env
unset fam_editor_password
```

The script outputs no password/hash to the console and refuses to overwrite an existing file. Transfer the generated value to the approved server environment through the established private configuration process; do not put it in chat, Git, URLs, or public assets. Restarting the app or changing the hash invalidates all editor sessions. Sessions last eight hours and logout revokes the copied cookie server-side. The editor grants article-management access only; it cannot access family administration or operator endpoints.

## Evidence and limits

- Node 24.21.0 focused tests: authentication, origin/CSRF rejection, logout-cookie replay, expiry, disabled configuration, unsafe URLs/DNS/redirects, socket DNS pinning, bounded HTML responses, date rollover, one-per-day validation, edit/delete during fetch, encrypted restart persistence, global ordering/deduplication, automatic-news outages and existing news consumers.
- Real local server + Chromium: bad/good password, real publisher metadata preview, schedule/edit/delete, two distinct authenticated accounts receiving the identical featured pick first, sign-out denial. Desktop 1360px and phone 390px screenshots reviewed; no horizontal overflow or browser script errors.
- iOS simulator build and `DailyPuzzleProgressTests` passed, including featured-first and midnight expiry. Android change is a one-line display cap; no Android build was run.
- Independent source review of the password/session and URL-fetch boundaries found no actionable issue. Publisher fetch is intentionally IPv4-only and never falls back to unchecked resolution. Unsupported/blocked publishers use the saved content.
- Local receipts: `.dev-data/article-admin/` (ignored). No production accounts or schedules changed. No deployment, archive, or TestFlight upload.

Owner authorized merge and deployment on 4 October 2026 and supplied the editor password privately. Provision only its salted hash through the existing deployment configuration. Hostinger must use committed, merged `main` matching `origin/main`, after its authoritative push-triggered CI succeeds. Native changes are included in the regenerated Xcode project; distribution remains separate.

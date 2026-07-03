# Fam ETC — project instructions

Fam ETC is a native-heavy iOS + web family hub (school calendars, homework,
activities, goals, and family group chat for 2 parents + kids). It evolves the
original KidsPlanner web app in this repo. All product decisions are recorded in
[APP-BRIEF.md](APP-BRIEF.md) — that brief is a contract; changing Identity or
Design rows is a rebrand/pivot and requires listing affected files and getting
explicit confirmation first.

## Architecture at a glance
- **Web app** (fametc.com, on Hostinger): Node/Express backend, passkey auth,
  encrypted JSON storage, Stripe billing, marketing/landing + desktop family
  settings. Reuses the RetireOdds server foundation (see rename map in the brief).
- **iOS app** (com.fametc.app, Apple team B4F73U5RGR): native SwiftUI, all tabs
  native, iPhone + iPad adaptive layouts, shared passkey account against the same
  backend API. Native document scanner (Vision OCR) + APNs push at launch.
- **Family chat**: lightweight custom real-time (WebSocket/polling) on our own
  backend, encrypted at rest — net-new, not a copy-ready component.

## Deploy pipeline (standing authorization granted 2026-07-03)
Every web change: **test → commit → deploy → verify on live fametc.com.**
- Run tests (`node --test`) before committing.
- Commit each completed task with a conventional commit message; never bundle
  unrelated changes.
- Deploy to Hostinger via the Hostinger MCP / deploy script, then verify on the
  live domain — a change is not "done" until confirmed where the user sees it
  (live fametc.com for web; the device/simulator for iOS), not just localhost.
- iOS builds ship via **TestFlight** first, then App Store — never auto-shipped.

## Security & data
- Encryption at rest for chat messages + kids' data (datacrypto.js pattern).
  **DATA_ENCRYPTION_KEY loss = data loss** — back it up offline; record the
  backup location in the brief before first production deploy.
- Never echo secrets (API keys, Stripe keys, tokens, encryption keys) into chat,
  logs, or commits. Use env vars in the Hostinger panel; refer to them by name.
- Baseline security (headers, rate limits, signed sessions) is the decided gate;
  running `/security-review` before real families beyond the owner's use it is a
  recommendation on record (app handles kids' data + family chat).

## Conventions
- Prefix: `FAM` / `fam` for JS globals and env vars; `fam_` for storage keys
  (migrate the original KidsPlanner `kp_` keys). After scaffolding,
  `grep -ri 'retireodds\|RO_\|np_sess\|kp_'` must return zero hits.
- No secrets in the repo. Keep generated bundles unedited by hand.
- Calendar sync: dedup by iCal UID, rolling window (past 2 weeks → next 3
  months), per-feed keyword filters (school sport feed has 3,500+ events).

## Reference
- [APP-BRIEF.md](APP-BRIEF.md) — full decisions record, component plan, rename
  map, launch checklist.
- [FEATURE_PLAN.md](FEATURE_PLAN.md) — the phased feature roadmap and the verified
  St Andrews public Google Calendar feeds (Phase 2).

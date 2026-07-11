# Fam ETC — App Brief
> Decided 2026-07-03 via /new-app-interview. This brief is a CONTRACT: changing
> Identity or Design rows after scaffolding = rebrand/pivot; list affected
> files and get explicit confirmation first.
>
> Fam ETC evolves the existing KidsPlanner web app (vanilla JS at this repo root:
> app.js/index.html/styles.css, feature plan in FEATURE_PLAN.md) into a native-heavy
> family hub. The KidsPlanner planner/calendar/homework/goals feature set and the
> verified St Andrews public Google Calendar feeds (see FEATURE_PLAN.md Phase 2)
> carry forward; the headline new capability is **family group chat** (2 parents + kids).

## Identity (FINAL)
| Decision | Value |
|---|---|
| Name | Fam ETC |
| Pitch / target user | "The etcetera hub for your family — school calendars, homework, activities, goals, and family chat in one place." Target: families (2 parents + kids), starting with St Andrews (standrews.ac.th) parents. |
| Domain (www canonical) | fametc.com |
| Hostinger status | on Hostinger (purchased + set up) |
| Prefix (JS globals, env) | `FAM` / `fam` (note: existing KidsPlanner uses `kp_` localStorage keys — migrate to `fam_` during scaffold) |
| Bundle ID / Apple team | com.fametc.app / Team B4F73U5RGR (same Apple account as RetireOdds) |

## Architecture
| Decision | Value | → Components |
|---|---|---|
| Shape | **hybrid iOS + web** (RetireOdds model: native shell + native tabs + WKWebView surfaces) | iOS Tiers 1–3 reused; native hero screens + HybridWebView for the rest |
| Native screens at launch | **Today/dashboard, Chat, Calendar, Homework fully native**; Settings, Goals, Activities, billing, marketing stay web via HybridWebView | native where interaction speed matters; web where content churns |
| iPad support | **iPad is a KEY app surface, co-equal with iPhone** (kids may have iPhones and/or iPads — both personal devices). Every native screen designed for both from the start: iPad landscape = nav rail + main content + docked family chat column; iPad portrait = chat collapses to slide-over; iPhone = tab-bar layout. Not a stretched-iPhone afterthought. Auth/usage model unchanged: one passkey login per person per device. | SwiftUI size classes + responsive web |
| Chat backend | lightweight custom (WebSocket/polling on our Node/Hostinger backend, same auth + encryption) | net-new chat.js module; not a copy-ready RetireOdds component |
| Auth | passkey-only + backup codes; family invite code links members into one Fam ETC group | webauthn.js, backup-codes.js, AuthService.swift |
| Account sync | shared cookie session (AuthService syncs HTTPCookieStorage ↔ WKWebsiteDataStore) — one passkey login covers native tabs AND the embedded web surfaces; web app also serves billing/settings/marketing + desktop access | AuthService.swift as-is |
| Encryption at rest | **yes** — chat messages + kids' schedule/activity data. Key backup location: ⚠ TBD, record before first prod deploy (Hostinger panel DATA_ENCRYPTION_KEY + offline backup) | datacrypto.js, gen-encryption-key.js |
| Worker pool | no | skip simpool.js |
| Uploads | yes — timetable/homework photos (JPG/PNG/PDF), feeds existing Claude parse pipeline | multer; native document scanner on iOS |
| Min iOS | latest major minus 1 | modern SwiftUI @Observable |

## Design (FINAL — Horizon redesign, user-confirmed 2026-07-11; spec: docs/design/redesign/)
| Decision | Value |
|---|---|
| Language | Full Horizon adoption per "Fam ETC Redesign.dc.html" (claude.ai/design d048593a…): one structure everywhere — sidebar nav → main content → docked family chat (slim-strip collapse on Homework/Goals/Activities). Today replaces the widget-wall dashboard; learning widgets fold into one "Daily 5" card. |
| Palette | Horizon tokens 1:1 web+iOS (`public/css/horizon.css` / `Theme.swift`): bg `#f1efec` greige, panel white, accent `#6f43d6` violet (the ONLY interactive color), coral `#f0704f` partner; dark mode = same tokens re-resolved (accent `#b98cff`). Per-kid identity = categorical palette by kid order (kid 1 teal, kid 2 amber). Green/red strictly semantic. |
| Hero gradient | coral→violet, reserved for ONE momentum element per screen |
| Dark mode | both at launch (marketing screenshots in light mode); web toggle Auto/Light/Dark in Settings |
| Typography | Space Grotesk (UI) + JetBrains Mono (numerals, 11px uppercase micro-labels), self-hosted on web (`public/fonts/`) and bundled on iOS |
| Superseded | The original KidsPlanner-carryover palette (purple `#6C63FF`/pink/teal, purple→pink hero) and the 2026-07-04 "no docked chat on iPad" revert — both replaced by this redesign. |

## Monetization
| Decision | Value | → Components |
|---|---|---|
| Model | free 30-day no-card trial → paid annual (+ optional lifetime later) | billing.js |
| Web payments | Stripe, env-gated, test mode until launch | webhook-before-json-parser pattern |
| iOS payments | ship iOS free at launch → StoreKit 2 IAP later; NEVER Stripe in-app; grandfather existing iOS users when IAP flips on | docs/IAP-PLAN.md + IAP-GUIDE.md playbook |
| Promo codes / grandfathering | both | promo-codes.json, grandfatherExisting() |

## Marketing & growth
| Decision | Value |
|---|---|
| App Store assets | adapt appstore-ss pipeline, re-skinned to Fam ETC palette; iPhone + iPad sizes; light mode |
| Landing page / tour video | landing page at launch; tour video after UI settles |
| SEO | meta + sitemap only (canonical www redirect, per-page meta, sitemap.xml) |
| Referrals | decided: none (add later — index is lazy) |
| Analytics | privacy-first aggregate daily counters, no per-user event log |

## Quality & ops
| Decision | Value |
|---|---|
| Correctness-critical core | none (standard test baseline). Closest concern: calendar-sync dedup (no duplicate/missing events, keyed by iCal UID) and chat message ordering/delivery — cover with good tests, no formal freeze policy. |
| Security gate | decided: baseline only (headers, rate limits, signed sessions, encryption at rest). ⚠ RECOMMENDATION ON RECORD: run /security-review before real families beyond your own use it — it handles kids' data + family chat. |
| Deploy | auto-pipeline, standing authorization granted 2026-07-03: test → commit → deploy (Hostinger MCP) → verify on live fametc.com. iOS builds go via TestFlight, never auto-shipped to App Store. |
| Performance notes | shared-hosting defaults (gzip, edge cache on public pages, ?v=BUILD asset hashing). Calendar sync uses a rolling window (past 2 weeks → next 3 months) + per-feed keyword filters — the school sport feed alone has 3,500+ events. |

## iOS on-device features
| Feature | Decision | → Components |
|---|---|---|
| JSCore engine | no | skip SimEngine |
| Camera/OCR | yes — native document scanner (Vision OCR, on-device) for timetables/homework, feeds existing Claude parse pipeline | ScannerService + DocumentScannerViewController + NSCameraUsageDescription |
| Voice | decided: none (add on-device SFSpeechRecognizer later if younger kids need it) | — |
| Push | **at launch** (⚠ net-new work — no copy-ready code): chat messages + reminders. Needs APNs setup + server-side push sender. **Build as a REUSABLE, app-agnostic module** (decided 2026-07-03): generic sender core (token-based .p8 auth, HTTP/2, retries, bad-token feedback pruning) configured only via env/config (team ID, key ID, bundle ID, key path); no Fam ETC logic inside. Fam ETC's notification triggers are a thin app layer on top. Intended reuse: RetireOdds, mytharva. Device-token registration endpoint + iOS registration client follow the same split. | net-new apns-sender (portable) + fam-notifications (app layer) |

## Kids' privacy & compliance (decided 2026-07-03)
| Decision | Value |
|---|---|
| Who is the customer | **Parents' app.** The parent is the account owner, customer, and billing relationship. The trial/subscription belongs to a parent. All App Store listing, onboarding copy, and marketing address parents. |
| Kid accounts | **No direct kid signup — ever.** Kid profiles/logins are created only by a parent from inside the family and joined via family invite. This doubles as the verifiable-parental-consent mechanism (COPPA / GDPR-K / Thailand PDPA): the parent consents by creating the kid's profile. |
| Kid sign-in (revised 2026-07-04) | **Request → parent approves → device passkey.** A kid has NO email and NO self-signup. On their OWN device the kid picks "I'm a kid" on the login screen, enters the family invite code + a name, and submits a request (no parent session needed on that device). Every family parent gets a push + an in-app approval banner; a parent approving CREATES the kid profile and unlocks passkey registration. The kid then registers a device-bound passkey and is signed straight in with Face ID / Touch ID. Parent consent is still required (the approval), but the parent never has to sign in on the kid's device. Kid sessions stay role-scoped: their own calendar/homework/goals + family chat, but NOT billing, family management, or removing members. Server: lib/kid-access.js + /api/kid/access-request/* (public, pollToken-gated) and /api/family/access-requests/* (parent approve/deny). Supersedes the earlier "parent-provisioned on the kid's device" flow, which was removed. |
| App Store category | Standard family/productivity app rated 4+ (parent-facing) — NOT the Kids Category (avoids its ad/analytics/link restrictions, honest because parents are the target customer). Revisit only if marketing ever targets kids directly. |
| UGC compliance (Apple 1.2) | Chat ships with parent-admin controls framed as parental controls: parents can delete any message in the family, a report/flag path exists, and members can be removed from the family (block equivalent). Required for App Review of any chat app. |
| Kid data minimization | Collect the minimum for kid profiles (name, grade, color); no kid emails required; no per-user analytics (already decided: aggregate counters only); kids' data encrypted at rest (already decided). |

## Rename map (derived — apply mechanically)
| RetireOdds | Fam ETC |
|---|---|
| RetireOdds / retireodds / com.retire.odds | Fam ETC / fametc / com.fametc.app |
| retireodds.com / www.retireodds.com | fametc.com / www.fametc.com |
| RETIREODDS_DATA_DIR / ~/.retireodds-data | FAM_DATA_DIR / ~/.fametc-data |
| np_sess | fam_sess |
| RO_ / ro- / ro_ prefixes | FAM_ / fam- / fam_ |
| X-RetireOdds-Client | X-FamETC-Client |
| dev@retireodds.local | dev@fametc.local |
| Team B4F73U5RGR | Team B4F73U5RGR (unchanged — same Apple account) |
| (existing KidsPlanner) kp_ localStorage keys | fam_ |

## Launch checklist
- [ ] ⚠ Confirm Apple Developer enrollment active on team B4F73U5RGR (blocks build/sign/TestFlight)
- [ ] Server foundation boots, /api/health ok, passkey signup works (dev-login)
- [ ] First Hostinger deploy verified on live fametc.com
- [ ] Env vars set in panel (SESSION_SECRET, DATA_ENCRYPTION_KEY backed up offline, FAM_DATA_DIR outside app dir)
- [ ] Family model: invite code links 2 parents + kids into one group; per-kid data scoping works
- [ ] Chat: real-time message send/receive between two family members; encrypted at rest
- [ ] Calendar sync: St Andrews public feeds import, deduped by UID, windowed
- [ ] iOS native tabs (Today, Chat, Calendar, Homework) render on iPhone AND iPad (adaptive layout); web tabs (Settings/Goals/Activities) load in HybridWebView with shared session; passkey autofill works on device
- [ ] AASA served with com.fametc.app + team B4F73U5RGR
- [ ] Push: APNs delivers a chat message + a reminder to a real device
- [ ] grep for retireodds|RO_|np_sess|kp_ → zero hits
- [ ] Stripe test-mode checkout round-trip
- [ ] Tests green · dark mode pass · (recommend /security-review before public)
- [ ] App Store assets (iPhone + iPad) · TestFlight round

# FamETC project audit — accuracy, trust, content and engagement

Date: 7 September 2026  
Audited snapshot: `99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa`, originally checked out on `feat/launch-polish-and-marketing`.  
Repository: `kamatbot/kidsplanner`. Scope: audit and planning only.

## Executive conclusion

FamETC has a useful product core and considerably more defensive engineering than its rough edges suggest. The primary problem is **inconsistent meaning across boundaries**: a source assignment, its Today action, a cached screen and a learning completion can each tell a different story.

The highest-return direction is to keep the current application and strengthen four boundaries:

1. **Identity and lifecycle:** one account/family scope across sessions, devices, caches and integrations.
2. **Coordination truth:** canonical tasks/events own status, time and provenance; derived views cannot silently diverge.
3. **Content and learning evidence:** reviewed, versioned items; server-evaluated attempts; restrained progress claims.
4. **Presentation:** reliable loading/error/stale states and a smaller, role-appropriate daily experience.

This does not call for a framework rewrite, microservices, a new CMS, or changes to Hostinger environment configuration. Some important fixes are small; others, particularly deletion and durable storage, need explicit policy and staged migration.

The most urgent confirmed defects are old parent Watch credentials crossing family boundaries, incomplete sign-out/account deletion, destructive meal-plan replacement, and contradictions between Homework and Today. Content priorities are ambiguous vocabulary questions, invented deadlines, stale completion claims, and unearned “mastery.”

Read the companion [implementation and content plan](/Users/kamatbot/Documents/Claude/Planner/docs/audits/2026-09-07-accuracy-content-plan.md) for sequencing, architecture, ownership, acceptance checks and proposed engagement changes.

## Scope, evidence and limitations

This is a repository-wide **risk-based source audit with focused tests and synthetic reproductions**, not a claim that every line, answer, device or production integration is verified.

- Three independent review slices covered backend trust/reliability, coordination accuracy, and learning/content. The main review covered cross-client state, native navigation, architecture and synthesis.
- This audit did not edit application source. No production family data, credentials, school feeds or provider accounts were accessed.
- No full test suite, full CI, application build, simulator session, physical-device session or live deployment verification was performed.
- Findings marked **probe** were reproduced through actual local model/route code with synthetic data or controlled stubs. **Source** means a concrete path was traced but not executed on a device. **Conditional** identifies a necessary environment or lifecycle condition.
- Severity: **P1** = high-impact privacy, data-loss or materially misleading core behavior; **P2** = important bounded correctness, product-quality or reliability weakness. These are prioritization labels, not CVSS scores.
- No P0 was established. That does not certify the absence of other vulnerabilities.
- During review the shared checkout changed externally to `main` at `19f771e5c833b10a94f2f8e747a0d8fcac2801e9`. We did not switch or restore it. All source links below point to the immutable **audited** commit, including Android, rather than assuming the current checkout still matches. This report is not evidence that that commit is deployed.
- Existing untracked Android build outputs and review images were left untouched. Other application/document edits appeared in the shared checkout during final document validation; they were also left untouched and were not incorporated into the baseline findings. This audit added only the two audit/plan documents. Revalidate selected findings against those newer changes before implementing them.

### Coverage map

| Area | Review depth | Important residual work |
| --- | --- | --- |
| Sessions, family membership, kid approval, passkeys, Watch | Deep boundary inspection; focused auth tests; isolated HTTP proofs | Real-device approval/re-authentication; actual production origin/RP checks |
| JSON/encrypted storage, Operator execution, notifications | Deep state-transition inspection; focused tests | Multi-process/crash testing in deployment-equivalent conditions; backup restoration |
| School API/feeds, homework, actions, calendars | Deep lifecycle/time inspection; route/model probes | Representative redacted school feeds, DST and recurrence exception corpus |
| Meals, recipes, trips, decisions | Targeted route/model review; meal AI stub probes; trip/decision tests | All dietary edge cases; provider-backed booking formats |
| Word bank, teasers, puzzles, news, PathOdds adapter | Deep selection/progress review and representative content samples | Full editorial review; learner pilot; external PathOdds engine |
| Web, iOS, Android | Bootstrap/cache/navigation and selected cross-client flows | Browser/device journeys, accessibility traversal, performance profiling |
| Watch app, extension, push transports, billing | Boundary and integration samples | Complete native Watch/extension UX; provider internals; billing lifecycle |
| Release scripts, CI, documentation | Artifact-contract inspection | Actual Hostinger mapping, process count, TLS/DNS and live artifact validation |

### Structural inventory at the audited snapshot

Tracked source included 97 JavaScript files under `lib/` including 19 route modules, 21 browser JavaScript files, 81 Swift files, 34 Kotlin files and 7 Chrome-extension files. The test inventory comprised 148 Node test files, 13 Swift test files and 2 Android unit-test files; inventory is not a pass count.

Concentration remains substantial: `public/js/app.js` 7,072 lines; `public/js/trips.js` 2,593; `public/js/meals.js` 1,339; iOS `AppStore.swift` 1,222; Android `AppRepository.kt` 487. File size is not itself a defect. The concern is mixed ownership of fetching, identity, transformation, interaction and rendering.

The July architecture plan is historical, not a safe current checklist. It contains both an instruction to delete `PlaceholderScreens.swift` and a later correction that the file is live. Its counts and completed refactor steps are outdated. See [docs/ARCHITECTURE-PLAN.md:1](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/docs/ARCHITECTURE-PLAN.md#L1). Do not follow old deletion instructions without tracing current callers.

## Findings: identity, privacy and account lifecycle

### T01 · P1 · Parent Watch credentials are not bound to their original family

**Probe; conditional on parent membership changing.** Parent Watch authentication skips the family validation applied to kid credentials; family resolution then selects the parent's current family. A Watch paired in Family A can read Family B after its parent is removed from A and joins/creates B. The isolated HTTP proof returned B's private action using A's token.

Evidence: [server.js:397](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/server.js#L397), [server.js:426](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/server.js#L426), [lib/watch-auth.js:185](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/watch-auth.js#L185).

Fix direction: validate the credential's recorded family for every target type and revoke it on membership departure. Do not weaken the existing method/path allowlist. Acceptance: old A token returns 401 after movement; valid retained-family tokens still work.

### T02 · P1 · Account deletion removes the login row, not the account lifecycle

**Probe.** `DELETE /api/account` calls `store.deleteUser`, whose own contract leaves family cleanup to its caller. The proof removed the user while retaining a family reference, push token, active identity subject and integration grant. Sole-parent families can become orphaned; external subscription/revocation work is absent from this handler.

Evidence: [server.js:499](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/server.js#L499), [lib/store.js:207](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/store.js#L207), [lib/fam-notifications.js:79](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/fam-notifications.js#L79).

Fix direction: define ownership transfer, retained/shared records, anonymization and external revocation policy; implement an observable, durable deletion workflow. Do not indiscriminately delete shared-family content. Acceptance must enumerate every user-ID-bearing store and prove no active membership, credential, push destination or execution authority survives completion. This finding is not a legal-compliance opinion.

### T03 · P1 · Android “Sign out” retains the native authenticated cookie

**Source; same-process path.** Sign-out clears preferences and WebView cookies, but the OkHttp cookie jar holds a separate in-memory map that is never cleared. `loadForRequest` continues returning it. The activity's sign-out callback does not call server logout.

Evidence: [android/app/src/main/java/com/fametc/app/data/remote/ApiClient.kt:93](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/android/app/src/main/java/com/fametc/app/data/remote/ApiClient.kt#L93), [android/app/src/main/java/com/fametc/app/data/remote/ApiClient.kt:100](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/android/app/src/main/java/com/fametc/app/data/remote/ApiClient.kt#L100), [android/app/src/main/java/com/fametc/app/data/remote/ApiClient.kt:138](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/android/app/src/main/java/com/fametc/app/data/remote/ApiClient.kt#L138), [android/app/src/main/java/com/fametc/app/ui/MainActivity.kt:45](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/android/app/src/main/java/com/fametc/app/ui/MainActivity.kt#L45).

Fix direction: one session-reset owner must clear native and WebView cookies, cancel/invalidate in-flight work, reset caches and attempt server revocation. Preserve cookie domain/path/expiry/security attributes; the current persistence strips several of them. Acceptance: immediately after sign-out, a native authenticated request is unauthenticated, including offline sign-out followed by reconnect.

### T04 · P1 · iOS account switching can retain the previous user's state

**Source; partial-refresh/account-switch path.** `signedOut()` clears some state but not homework, school/family events, notes or pending kid requests. Subsequent failed reads deliberately preserve those collections. Global refresh work is not protected by a session generation. Logout errors are swallowed, and the normal cookie sync has no corresponding WebView-cookie reset.

Evidence: [ios/FamETC/Domain/AppStore.swift:202](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Domain/AppStore.swift#L202), [ios/FamETC/Domain/AppStore.swift:458](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Domain/AppStore.swift#L458), [ios/FamETC/Domain/AppStore.swift:748](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Domain/AppStore.swift#L748), [ios/FamETC/Networking/APIClient.swift:524](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Networking/APIClient.swift#L524), [ios/FamETC/Onboarding/AuthService.swift:316](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Onboarding/AuthService.swift#L316).

Learning state has the same identity omission: Daily 5 flags, placement and puzzle cells are device-global or keyed by date/puzzle but not learner. Sibling B can inherit A's completion/answers. Evidence: [ios/FamETC/Domain/DailyContent.swift:18](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Domain/DailyContent.swift#L18), [ios/FamETC/Features/Today/SATActivityView.swift:10](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Features/Today/SATActivityView.swift#L10), [ios/FamETC/Features/Today/DailyPuzzleProgress.swift:15](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Features/Today/DailyPuzzleProgress.swift#L15).

Fix direction: exhaustive reset plus account/family/learner-scoped cache keys and response-generation guards. Keep stale data only for the same validated identity. A successful server logout already revokes copied session cookies; do not misdiagnose this as missing server revocation.

### T05 · P1 · Production-mode predicates disagree about encryption requirements

**Probe; configuration-dependent, not a claim about live Hostinger.** A session secret activates production-like session handling, but mandatory encryption checks run only for exact `NODE_ENV=production`. An isolated boot with a session secret, unset NODE_ENV and no encryption key succeeded and wrote readable synthetic email data.

Evidence: [server.js:283](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/server.js#L283), [server.js:295](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/server.js#L295), [lib/db.js:23](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/db.js#L23).

Fix direction: one application-owned deployment-mode invariant; fail closed for authenticated public operation without a valid encryption key. Keep explicitly opted-in local development possible. No Hostinger environment change was made or is assumed necessary to repair the inconsistent code gate.

### T06 · P2 · Advisory mobile headers grant durable billing entitlement

**Source; policy-sensitive.** Invalid/missing configured mobile-secret proof falls through to a trusted client header/user-agent. Signup then persists `grandfathered`, which bypasses billing. A shared app secret is not strong long-term attestation either.

Evidence: [server.js:439](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/server.js#L439), [lib/routes/auth.js:184](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/auth.js#L184), [lib/billing.js:119](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/billing.js#L119).

Fix direction: first confirm the intended free-mobile policy; separate presentation/client identification from entitlement authority. If proof is required, do not fall back after proof failure. Preserve legitimate existing entitlements and record provenance. This is not authorization to change prices or revoke users' access.

### T07 · P2 · Membership changes do not consistently revoke integration scope

**Source.** Parent identity keys are person-global while subject/grant records carry a family ID; parent removal does not clean those records. Separately, Hermes message capabilities are actor/room/time-bound but not limited to a particular operation class or case. Exact-action parent approval still gates live execution, so this is not an approval bypass.

Evidence: [lib/identity-subjects.js:13](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/identity-subjects.js#L13), [lib/integration-grants.js:16](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/integration-grants.js#L16), [lib/routes/family.js:93](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/family.js#L93), [lib/operator-capabilities.js:53](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/operator-capabilities.js#L53), [lib/hermes-mcp.js:169](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/hermes-mcp.js#L169).

Fix direction: choose global-person versus membership-scoped identity explicitly; scope grants to current membership and revoke on departure. Narrow contextual capabilities by intent/case without weakening the strong execution-approval gate.

## Findings: coordination accuracy and data conservation

### D01 · P1 · AI meal planning deletes before validation and accepts unrelated dates

**Probe.** The planner accepts date-shaped model output outside the requested date set, clears its destination, and only then validates/adds the replacement.

Two controlled responses demonstrated:
- Request September 7; model returns December 25 → the existing December 25 dinner is replaced, HTTP 200.
- Model returns a whitespace title → the existing target dinner is deleted, replacement fails, HTTP 422.

Evidence: [lib/routes/meals.js:580](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/meals.js#L580), [lib/routes/meals.js:610](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/meals.js#L610), [lib/routes/meals.js:627](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/meals.js#L627).

Fix direction: validate the entire candidate set against requested dates/slots before any mutation; perform bounded replacement atomically. Invalid input must preserve every existing row. Keep preview/confirmation distinct from commit.

### D02 · P1 · First school-feed connection silently replaces all child homework

**Source and existing regression fixture.** Initial official-feed connection opts into replacement, and replacement deletes every homework source for the child, including manual/legacy work and its progress. The UI says “Connect and sync,” without a replacement preview. Existing tests deliberately assert this behavior; a passing test does not establish that the product policy is appropriate.

Evidence: [lib/school-api.js:171](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/school-api.js#L171), [lib/school-api.js:414](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/school-api.js#L414), [lib/homework.js:478](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/homework.js#L478), [public/js/school.js:394](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/public/js/school.js#L394), [tests/school-api.test.js:80](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/tests/school-api.test.js#L80).

Fix direction: preserve manual/student-owned work and adopt matching source identities where safe. If replacement remains a product requirement, disclose affected rows and preserve a recoverable archive. Acceptance includes mixed sources, matching legacy tasks with checklists, and unaffected siblings.

### D03 · P1 · Homework and Today disagree about completion, reopening and deletion

**Probe.** Completing a Homework-derived action changes only the action; reopening homework leaves its action done; direct homework deletion leaves its action behind. Both clients present the projection as homework with a completion control.

Evidence: [lib/routes/actions.js:148](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/actions.js#L148), [lib/routes/homework.js:29](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/homework.js#L29), [lib/routes/homework.js:224](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/homework.js#L224), [lib/actions.js:747](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/actions.js#L747), [ios/FamETC/Features/Today/ActionCard.swift:143](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Features/Today/ActionCard.swift#L143).

Fix direction: canonical homework owns completion. Projected commands must obey the same student/parent permissions, update the source, and reconcile the projection. Do not turn parent action permissions into permission to complete student homework. Acceptance: source, Today, counts and reminder eligibility agree after complete/reopen/delete/import/retry.

### D04 · P1 · Completed history can hide the only active commitment

**Probe.** The server sorts all statuses together then caps the list at 200, before clients group active work. With 200 old completed actions and one due-today open action, the open action was absent.

Evidence: [lib/actions.js:579](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/actions.js#L579), [lib/routes/actions.js:75](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/actions.js#L75).

Fix direction: separate the active query from paginated history; report result completeness. A larger arbitrary cap is not a durable fix. Acceptance: old history cannot displace active dated, snoozed or undated work.

### D05 · P1 · Calendar and action timestamps have incompatible meanings

**Probe plus client source trace.** ICS TZID/floating semantics are lost; web/action projection extracts clock text from explicit UTC timestamps, while iOS converts the instant to local time. A school event at 01:30Z became a 01:30 action rather than 08:30 Bangkok time.

Evidence: [lib/ical.js:76](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/ical.js#L76), [lib/actions.js:631](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/actions.js#L631), [public/js/app.js:1228](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/public/js/app.js#L1228), [ios/FamETC/Features/Shared/Agenda.swift:69](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Features/Shared/Agenda.swift#L69).

Fix direction: distinguish date-only deadlines, explicit instants and school-local wall time with an IANA timezone. Use the same meaning for calendar, action, push and Watch projections. Test Bangkok, UTC, a DST zone and date rollover. The exact display-zone policy is a product decision, not an excuse to discard timezone information.

### D06 · P2 · Recurrence support is overstated and old series disappear

**Probe.** Public ICS parsing preserves a recurring flag but does not expand rules; filtering uses the original start. Yet web copy says it is showing the next occurrence. A weekly January anchor produced no September occurrence. Separately, the manual-event recurrence loop starts at the original date and stops after 1,000 iterations; an unended daily series from January 2023 disappeared in September 2026.

Evidence: [lib/ical.js:147](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/ical.js#L147), [lib/school-feeds.js:474](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/school-feeds.js#L474), [public/js/app.js:2046](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/public/js/app.js#L2046), [lib/events.js:211](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/events.js#L211).

Fix direction: correct capability copy immediately; expand supported recurrence with stable instance IDs and explicit exception/cancellation behavior, or label unsupported series. Jump manual iteration to the requested window before applying output bounds.

### D07 · P2 · Undated homework is omitted without an explanation of completeness

**Source; deliberate tested limitation.** Official school tasks using no-deadline sentinel dates are dropped; the UI reports the retained homework count as synced, without an omitted count.

Evidence: [lib/school-api.js:270](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/school-api.js#L270), [lib/school-api.js:419](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/school-api.js#L419), [public/js/school.js:338](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/public/js/school.js#L338), [tests/school-api.test.js:126](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/tests/school-api.test.js#L126).

Fix direction: use nullable due dates and a “No deadline” bucket. Interim copy should report omitted items and link back to the source. Do not display sentinel years as real dates.

### D08 · P1 · Failed retrieval is presented as a trustworthy empty state

**Source.** Web catches any family fetch error and replaces family state with null. iOS Chat says “No family yet” before considering loading, and no view consumes the generic `syncError`. Android converts independent fetch failures into empty lists/null, clears the overall error and persists the result.

Evidence: [public/js/app.js:499](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/public/js/app.js#L499), [ios/FamETC/Features/Chat/ChatView.swift:196](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Features/Chat/ChatView.swift#L196), [ios/FamETC/Domain/AppStore.swift:195](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Domain/AppStore.swift#L195), [android/app/src/main/java/com/fametc/app/data/repository/AppRepository.kt:155](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/android/app/src/main/java/com/fametc/app/data/repository/AppRepository.kt#L155).

This is a remaining path to the reported class of “approved but no family” symptoms; it does **not** prove which path occurred on a particular user's device. The earlier optional-invite-code decoding fix is present in the audited snapshot and is not being re-reported as unfixed.

Fix direction: distinguish pending membership, confirmed-empty, loading, stale, failed and unauthenticated states; preserve last valid same-account data and show a recovery action. Rethrow cancellation rather than swallowing it in Android fetch wrappers, consistent with [Android's coroutine guidance](https://developer.android.com/kotlin/coroutines/coroutines-best-practices).

## Findings: content, calibration and honest engagement

### C01 · P1 · Vocabulary assessment can punish correct English or reward visual guessing

**Probe on web; source on iOS.** Web manufactures a wrong sentence by inserting the target into an unrelated example. For “Diligent,” both the intended homework sentence and the generated scientist sentence are valid English. iOS instead uses the other word's unchanged example, so the only option containing the target gives away the answer.

Evidence: [public/js/sat.js:39](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/public/js/sat.js#L39), [ios/FamETC/Features/Today/SATActivityView.swift:329](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Features/Today/SATActivityView.swift#L329).

Fix direction: explicitly author uniquely defensible alternatives and explain why each option fits or does not. Tutorial exposure and answer recognition must not count as independent learning evidence.

### C02 · P1 · Homework AI is instructed to invent missing deadlines

**Source.** The extraction prompt explicitly requests a best guess when no due date is visible, using server-local “today.” Review rows are preselected, with no observed/inferred distinction. Missing evidence becomes an apparently transcribed commitment.

Evidence: [lib/routes/ai.js:143](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/ai.js#L143), [lib/routes/ai.js:147](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/ai.js#L147), [public/js/school.js:805](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/public/js/school.js#L805).

Fix direction: preserve unknown values as null, retain supporting excerpts, and require explicit confirmation for an inferred date. Review already exists: improve it rather than removing it. Validate each row before allowing commit.

### C03 · P1 · A stale PathOdds completion can complete a new day

**Probe.** On outage the server returns a cached snapshot with `stale:true`. Web ignores both stale and snapshot date, renders “done for today,” and marks today's SAT activity complete. A September 5 completed snapshot reproduced that result on September 7. iOS does not decode the wrapper stale field.

Evidence: [lib/routes/pathodds.js:202](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/pathodds.js#L202), [public/js/sat.js:287](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/public/js/sat.js#L287), [ios/FamETC/Networking/PathOddsModels.swift:3](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Networking/PathOddsModels.swift#L3).

Fix direction: completion credit requires the correct learner/day and current evidence; cached progress remains visible with its actual date. The external PathOdds learning engine is outside this audit.

### C04 · P2 · “Mastered” measures accumulated client flags, not retention

**Probe.** Three lifetime client-reported correct interactions promote a word to mastered. Ten later wrong interactions do not change it. Same-session repeats, hints/reveals and distinct days are not separated. Self-reported placement becomes “known.”

Evidence: [lib/wordbank.js:78](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/wordbank.js#L78), [lib/routes/learning.js:129](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/learning.js#L129), [public/js/sat.js:133](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/public/js/sat.js#L133).

Fix direction: evaluate issued-answer submissions server-side; make attempt replay idempotent; separate familiarity, participation, assisted success and later recall. Initially use honest descriptive labels, not an unvalidated mastery or SAT-readiness metric.

### C05 · P2 · Selection lacks learner fit and the small banks repeat predictably

**Source and recurrence probes.** Teasers select from a shared 40-item pool without grade/reading-band/prerequisite eligibility, spanning simple ratios through stoichiometry and advanced probability. Incorrect items crowd out unseen items without spaced due dates. The 30-word cycle locks words to the same three-way task variant within a year. Sudoku cycles three boards; September 9 and 30 were identical.

Evidence: [lib/brainteaser.js:148](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/brainteaser.js#L148), [lib/brainteaser-questions.js:253](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/brainteaser-questions.js#L253), [ios/FamETC/Domain/DailyContent.swift:26](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Domain/DailyContent.swift#L26), [lib/daily-puzzles.js:529](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/daily-puzzles.js#L529).

Fix direction: add editorial learning objectives, prerequisites and starting bands; offer easier/harder choice and a transparent review schedule. Expand a small well-reviewed bank before scaling volume. Do not claim calibrated difficulty from an “Easy” label or grade alone.

### C06 · P2 · Android Daily 5 is an incomplete activity flow

**Source.** The card keeps only the first teaser and vocabulary item, reveals the correct vocabulary word in the header, and records neither answer stream. A new empty word bank has no path here to become eligible for its quiz. Puzzle fetching uses a nonexistent route and the result is not rendered.

Evidence: [android/app/src/main/java/com/fametc/app/ui/features/today/DailyFiveCards.kt:45](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/android/app/src/main/java/com/fametc/app/ui/features/today/DailyFiveCards.kt#L45), [android/app/src/main/java/com/fametc/app/ui/features/today/DailyFiveCards.kt:119](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/android/app/src/main/java/com/fametc/app/ui/features/today/DailyFiveCards.kt#L119), [android/app/src/main/java/com/fametc/app/data/remote/FamEtcApi.kt:267](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/android/app/src/main/java/com/fametc/app/data/remote/FamEtcApi.kt#L267), [lib/routes/learning.js:24](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/learning.js#L24).

Fix direction: ship one end-to-end activity at a time: eligible content, all issued questions, submit, explanation, persistence, retry, completion. Do not advertise parity based on matching card titles.

### C07 · P2 · Content provenance is missing or wrong

**Probe and primary-source check.** News crosswords label all publishers “Science News Explores,” even when fixtures originate from BBC, WHO or NOAA, and discard source links. The quote bank attributes “never too old … another goal … new dream” to C.S. Lewis; the [C.S. Lewis Foundation identifies it as a misattribution](https://www.cslewis.org/aboutus/faq/quotes-misattributed/). Another Churchill quote is only [attributed, according to the International Churchill Society](https://winstonchurchill.org/churchill-central/quote/success-is-not-final/).

Evidence: [lib/daily-puzzles.js:307](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/daily-puzzles.js#L307), [lib/news.js:7](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/news.js#L7), [public/js/app.js:14](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/public/js/app.js#L14), [ios/FamETC/Domain/DailyContent.swift:44](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Domain/DailyContent.swift#L44).

News has transport/freshness controls but no learner-specific reading-band or topic-sensitivity selector. That is a missing control, not evidence that a particular harmful story was delivered.

Fix direction: preserve source/publisher/URL/date through transformations; use verified quotation sources or original prompts. Keep editorial suitability separate from publisher trust. Do not flag the unused iOS facts array as currently displayed misinformation.

### C08 · P2 · Meal constraints and nutrition precision exceed validated evidence

**Probes.** AI meal candidates bypass the diet filtering used by deterministic recipes: a vegetarian fixture accepted chicken. Fibre grams are inferred from ingredient names/core flags without quantity or serving yield; one gram/one serving and one kilogram/eight servings both produced 6. Numeric targets use those estimates, and suggestion fallback can relax macro floors without surfacing that relaxation.

Evidence: [lib/routes/meals.js:580](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/meals.js#L580), [lib/routes/meals.js:587](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/meals.js#L587), [lib/recipes.js:2323](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/recipes.js#L2323), [lib/recipes.js:2425](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/recipes.js#L2425), [lib/recipes.js:2520](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/recipes.js#L2520), [ios/FamETC/Features/Meals/MealsScreen.swift:562](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Features/Meals/MealsScreen.swift#L562).

Fix direction: apply one validated ingredient/constraint policy to every candidate source. Clearly distinguish verified quantities, rough estimates and unavailable nutrition. Never silently relax allergies; test their actual enforcement separately. No clinical nutrition validation was performed.

## Findings: cross-client UX and operational structure

### U01 · P2 · Android kids cannot load the shared shopping list correctly

**Source.** Android refresh calls parent-only `GET /api/meals` for every role, catches the kid's rejection as null, then renders an empty shopping list. The authorized `GET /api/meals/shopping` route exists, and iOS already uses it correctly. Android has shopping mutations but no corresponding GET declaration.

Evidence: [android/app/src/main/java/com/fametc/app/data/repository/AppRepository.kt:164](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/android/app/src/main/java/com/fametc/app/data/repository/AppRepository.kt#L164), [android/app/src/main/java/com/fametc/app/data/remote/FamEtcApi.kt:219](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/android/app/src/main/java/com/fametc/app/data/remote/FamEtcApi.kt#L219), [lib/routes/meals.js:219](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/meals.js#L219), [lib/routes/meals.js:685](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/meals.js#L685), [ios/FamETC/Domain/AppStore.swift:503](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Domain/AppStore.swift#L503).

Fix direction: use the existing kid projection, not broader permissions. Acceptance: a kid sees and ticks the real list while pantry/menu/household data remain unavailable.

### U02 · P2 · Native recovery/navigation promises exceed wired routes

**Source.** iOS Today “More” contains Notes only, despite comments promising Settings/Goals/Activities. Calendar empty-state instructions direct users to Settings. The explicit sign-out route exists on the iPad rail, not the iPhone shell. Android secondary screens maintain local string navigation with no system-back handler in the inspected root/activity paths. iPad shell choice is based on device idiom, not available window width.

Evidence: [ios/FamETC/Features/Today/TodayView.swift:554](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Features/Today/TodayView.swift#L554), [ios/FamETC/Features/Calendar/CalendarView.swift:91](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/Features/Calendar/CalendarView.swift#L91), [ios/FamETC/App/RootView.swift:90](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/App/RootView.swift#L90), [ios/FamETC/App/RootView.swift:176](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/ios/FamETC/App/RootView.swift#L176), [android/app/src/main/java/com/fametc/app/ui/navigation/RootScreen.kt:42](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/android/app/src/main/java/com/fametc/app/ui/navigation/RootScreen.kt#L42).

Fix direction: one discoverable account/family entry with role-appropriate settings, help and sign-out on phone/tablet; explicit secondary-route back behavior. Verify compact iPad windows and large text before claiming layout failure. This is a route audit, not a screenshot-based accessibility verdict.

### U03 · P2 · Public trust/help pages are still placeholder content

**Source.** Help, privacy and terms explicitly say TODO/final text pending; Help also says kids do not log in themselves, contradicting the shipped request→approval flow. The support address is labeled placeholder in source; mailbox existence was not checked.

Evidence: [public/help.html:23](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/public/help.html#L23), [public/privacy.html:23](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/public/privacy.html#L23), [public/terms.html:23](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/public/terms.html#L23), [lib/routes/family.js:99](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/routes/family.js#L99).

Fix direction: replace operational guidance with platform-tested instructions; have the owner approve privacy/retention/deletion and commercial policy content with appropriate review. Do not invent legal assurances or claim a mailbox is configured without checking it.

### O01 · P2 · Accepted JSON mutations are not necessarily durable or multi-process safe

**Source; crash/concurrency conditions.** `db.persist()` schedules a later flush while routes commonly acknowledge success immediately. Snapshot caching and write fencing are process-local. A crash can lose acknowledged changes; multiple writers can overwrite each other's snapshots.

Evidence: [lib/db.js:175](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/db.js#L175).

Strengths include atomic rename, retry/fencing, corrupt-data refusal and explicit synchronous logout persistence. Actual Hostinger process count was not checked.

Fix direction: durable acknowledgements for critical mutations; verify/enforce a documented single-writer assumption as containment, then migrate one authoritative aggregate at a time to transactional storage if needed. Do not bulk-migrate encrypted family data without tested backup/restore and rollback.

### O02 · P2 · Operator execution has a crash gap between stores

**Source and focused tests.** SQLite marks execution running before a JSON-domain mutation, then consumed afterward. A crash between steps leaves an uncertain result; running grants cannot be reclaimed. Create operations have useful source idempotency, but update reconciliation is incomplete.

Evidence: [lib/operator-execution.js:474](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/operator-execution.js#L474), [lib/operator-execution.js:488](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/operator-execution.js#L488), [lib/operator-execution.js:533](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/operator-execution.js#L533).

Fix direction: durable attempt identity, recoverable state, result reconciliation and idempotency for every driver. Do not blindly retry uncertain writes. Acceptance: fault injection at each transition converges to one domain result and an auditable terminal state.

### O03 · P2 · Notification delivery is at-least-once without a worker lease

**Source; concurrent drain or crash.** Due rows are selected without an atomic claim, delivered, then deleted. Two workers or a post-send crash can duplicate notifications. Existing deterministic enqueue IDs, retries, dead letters, recipient checks and APNs collapse IDs are valuable mitigations.

Evidence: [lib/notification-outbox.js:126](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/notification-outbox.js#L126), [lib/notification-outbox.js:200](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/lib/notification-outbox.js#L200).

Fix direction: claim/lease with expiry and client-visible stable event IDs. Do not promise exactly-once delivery over an external push provider.

### O04 · P2 · Release scripts disagree, while CI cannot establish native parity

**Source.** `pack-deploy.sh` intentionally supplies the established environment fallback, exact APNs key and build marker, then boot-smokes the archive. `deploy-hostinger.sh` instead excludes environment files and includes local node_modules, with no equivalent marker/boot check. Pack smoke uses `npm install`, and neither script enforces Node 24 before invocation. CI runs Node tests, not Swift/Android builds or UI journeys.

Evidence: [scripts/pack-deploy.sh:24](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/scripts/pack-deploy.sh#L24), [scripts/pack-deploy.sh:49](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/scripts/pack-deploy.sh#L49), [scripts/pack-deploy.sh:77](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/scripts/pack-deploy.sh#L77), [scripts/deploy-hostinger.sh:29](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/scripts/deploy-hostinger.sh#L29), [.github/workflows/ci.yml:20](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/.github/workflows/ci.yml#L20).

**Preserve the user's established Hostinger deployment path.** The repair is one canonical packer/runbook and safer handling of secret-bearing archives, not removing required `.env.hostinger` or demanding panel changes. Exclude unrelated keys/configuration and validate only approved secret inputs without printing them. Resolve native dependency compatibility on the target, use locked installs, and compare live identity to the exact release.

Android additionally configures its release variant with debug signing and installs an unconditional HTTP BODY logger. That is unsuitable as the final production distribution configuration; do not infer which APK is currently installed from source alone. Evidence: [android/app/build.gradle.kts:25](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/android/app/build.gradle.kts#L25), [android/app/src/main/java/com/fametc/app/data/remote/ApiClient.kt:42](https://github.com/kamatbot/kidsplanner/blob/99b3d3e8e1221dfdcc2a99c5c9391fc1df239afa/android/app/src/main/java/com/fametc/app/data/remote/ApiClient.kt#L42).

## What should be preserved

- Server passkeys already verify challenges, user verification, origin/RP, counters and credential uniqueness.
- Server logout durably bumps a session generation; kid Watch tokens revalidate membership.
- Operator live execution has exact-action hashing, assigned-parent approval, expiration and restrictive beta/kill-switch controls.
- Ordinary school refresh has stable source identity and preserves student progress; successful snapshot cleanup and persistent dismissals are good patterns.
- Trip imports/research have scoped projections, bounded parsing and explicit read-only boundaries; decision histories preserve important identity semantics.
- Teasers have stable IDs, per-player history, stable daily option order, answer-index correction after shuffling and explanations. The sampled active answer/explanation pairs were internally sound; no wrong active teaser answer key was demonstrated.
- News has trusted HTTPS sources, timeouts/body limits, publication windows, deduplication, diversification and outage freshness rechecks.
- iOS homework already preserves failed-read state and uses mutation/load revisions. Generalize that good pattern to identity and other domains instead of replacing it.
- Web status regions/focus-visible styles and iOS relative text styles/Reduce Motion accommodations show meaningful accessibility work.
- Analytics uses bounded first-party aggregate counters, not raw child event streams. Preserve that privacy posture when measuring usefulness.

## Interface quality assessment

The Impeccable audit rubric informed route clarity, recovery, cognitive load and the verification plan. These are **provisional source-only indicators, not measured performance or WCAG compliance scores**. No overall “health” total is given because summing unmeasured dimensions would imply unsupported precision.

| Dimension | Web indicator /4 | Native indicator /4 | Basis and remaining evidence |
| --- | --- | --- | --- |
| Accessibility | 2 provisional | 2 provisional | Real status/focus/text-scaling support; critical recovery paths and complete screen-reader journeys unverified |
| Performance | 2 provisional | 2 provisional | Some bounded/concurrent work; large screen controllers and polling need actual profiling |
| Theming | 3 provisional | 3 provisional | Established shared palette/typographic systems; no exhaustive dark-mode contrast check |
| Responsive/adaptive behavior | 2 provisional | 2 provisional | Responsive scaffolding exists; narrow windows, large text and keyboard journeys not exercised |
| Consistency / native conventions | 2 provisional | 2 provisional | Proven feature/state/navigation drift across clients |

Web detector execution was **degraded**: missing parser dependencies forced a regex fallback; computed contrast was unavailable. Its 10 advisory matches included width transitions and style heuristics. Border accents/arrows and the established Space Grotesk brand are not actionable defects merely because a detector flags them. No arbitrary style rewrite is recommended.

Future verification should announce important status changes without stealing focus and describe errors in text, following [W3C status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages) and [error-identification guidance](https://www.w3.org/WAI/WCAG22/Understanding/error-identification). Test complete native tasks at large accessibility text sizes, following [Apple's Larger Text criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/larger-text-evaluation-criteria).

## Verification record

All Node execution used verified `v24.19.0`.

| Review slice | Focused result | Additional evidence |
| --- | --- | --- |
| Coordination | 73 passed, 0 failed | Actual model/route probes for meal replacement, diet admission, action lifecycle/list cap, timezone and recurrence |
| Learning/content | 53 passed, 0 failed | Pure/in-memory probes for distractors, mastery, Sudoku repetition, attribution, fibre and stale completion |
| Backend trust | 24 passed, 0 failed | Isolated HTTP proofs for parent Watch movement, deletion residue and encryption-mode mismatch |
| Main cross-client review | Source traces; no native execution | Bootstrap, cookie/cache reset, route parity, navigation, release/CI inventory; degraded UI detector |

Coordination command:

```text
node --test tests/moodle-homework-actions.test.js tests/school-api.test.js tests/school-action-projection.test.js tests/events.test.js tests/action-queue.test.js tests/trips-calendar.test.js tests/meals-integration.test.js tests/decisions.test.js
```

Content command:

```text
node --test tests/wordbank.test.js tests/brainteaser.test.js tests/daily-puzzles.test.js tests/news.test.js
```

Backend command:

```text
node --test tests/watch-auth.test.js tests/session-revocation.test.js tests/identity-subjects.test.js tests/operator-execution.test.js tests/operator-beta-boundary.test.js tests/notification-outbox.test.js tests/outbox-resilience.test.js tests/deploy-archive-contract.test.js
```

These checks ran during the established baseline audit, before the later reported checkout change; commit identity was not sampled immediately beside every invocation. Their success demonstrates existing guards, not coverage of every finding above. The new synthetic probes were audit reproductions, not committed regression tests.

No full CI, source changes, commit, push, merge, upload or deployment was performed. Before implementation, rebase the selected repair against the actual then-current branch and reproduce its finding there.

## Recommended decision

Start with narrowly scoped trust and data-conservation repairs, then establish contract fixtures and the content/evidence model. Do not begin with visual polish or a mass file split. The detailed companion plan names a sequence of independently testable and reversible work packages.

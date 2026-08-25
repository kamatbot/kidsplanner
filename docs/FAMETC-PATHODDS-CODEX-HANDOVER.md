# FamETC × PathOdds — Codex Merge & Deployment Handover

**Prepared:** 25 August 2026  
**Owner intent:** FamETC drives daily family/student behavior; PathOdds owns deep SAT learning work and learner state.  
**Handoff state:** implementation complete; Codex owns final CI, integration verification, merge and deployment.

## 1. Pull requests and merge order

### PathOdds
- Repository: `kamatbot/future`
- Branch: `feature/fametc-pathodds-integration`
- PR: https://github.com/kamatbot/future/pull/22
- Last implementation SHA before this handover document: `6e1f64469013d39c3ac2f5c786bb722889270dae`

### FamETC
- Repository: `kamatbot/kidsplanner`
- Branch: `feature/pathodds-integration`
- PR: https://github.com/kamatbot/kidsplanner/pull/13
- Last implementation SHA before this handover document: `3701520979a0eb5705ff8b608f8f0637a202bd8e`

**Merge PathOdds PR #22 first, then FamETC PR #13.** Do not squash/cherry-pick files between repositories. If either `main` moved after these branches were created, update the feature branch from its own repository's `main`, resolve conflicts there, rerun verification, then merge.

Keep both PRs draft until the checks in this document pass. Codex may mark them ready immediately before merge.

---

## 2. Architecture that must be preserved

### Source-of-truth boundary

**FamETC owns:**
- parent/kid identity;
- passkey sign-in and parent-approved kid device access;
- family membership;
- integration consent/grants;
- daily dashboard behavior;
- APNs/web-push delivery;
- cached PathOdds summary projections.

**PathOdds owns:**
- SAT setup and diagnostic;
- daily quest question selection;
- every SAT response;
- mastery and spaced review;
- PathOdds XP/level/SAT streak;
- practice/full-test evidence;
- learner session state;
- completion truth.

Do **not** copy PathOdds question/answer state into FamETC. Do **not** make FamETC able to answer as a child. Do **not** replace the integration with shared-database coupling or an iframe.

### Identity flow

1. FamETC has an immutable internal identity subject for each parent and kid profile.
2. FamETC derives a PathOdds-specific pairwise subject using `OIDC_PAIRWISE_SUBJECT_KEY`.
3. PathOdds stores the pairwise subject -> PathOdds learner association.
4. Direct PathOdds sign-in from FamETC uses OIDC Authorization Code + PKCE.
5. Already-authenticated FamETC web/iOS clients may provision a linked subject through the signed server-to-server backchannel.
6. Student deep-work launches use a PathOdds-generated, 60-second, one-time ticket.
7. Parent child-view is summary-only. Parent attempts to mint a child learner launch must remain `403`.

Existing PathOdds passkey sign-in remains supported and must not be removed during merge conflict resolution.

---

## 3. What is implemented

### PathOdds (`future`)

- Versioned integration DTOs in `shared/integrations/fametc.ts`.
- HMAC authenticated FamETC server-to-server requests with timestamp/replay protection.
- FamETC OIDC client with PKCE, state, nonce, issuer/audience/signature validation.
- Persistent external subject links and revocation state.
- Learner-specific IANA time zone storage with `PATHODDS_DEFAULT_TIME_ZONE` fallback.
- Integration-safe `sat.daily-quest` projection; no question ids/answers are exposed.
- Subject connect/revoke APIs.
- One-time launch ticket issuance and atomic consumption.
- One-time browser session transfer into the existing PathOdds session model.
- Durable encrypted `fametc-outbox.json`.
- 15-second progress publisher for assigned/progressed/completed snapshots.
- Signed webhook delivery with exponential retry/dead-letter state.
- Safe FamETC return URL storage and one-time retrieval.
- `public/fametc-return.js`: 12-hour maximum browser affordance showing `← Back to FamETC` after a FamETC launch.

### FamETC (`kidsplanner`)

- Immutable subject registry for parents and kid profiles.
- Pairwise PathOdds subject generation.
- Parent/kid lifecycle integration and kid user attachment.
- First-party OIDC provider using existing FamETC passkey sessions.
- Family-scoped integration grants and revocation.
- Signed PathOdds BFF client.
- Cached/stale-safe PathOdds projections.
- Web Daily 5 PathOdds quest card.
- Parent per-child PathOdds summary.
- Existing SAT vocabulary widget retained as a **warm-up** and no longer treated as the PathOdds quest completion.
- Native iOS PathOdds quest and family summary cards using the same FamETC BFF.
- Explicit student-only deep-work launch enforcement.
- Child-profile deletion disables the immutable subject, revokes the local grant and performs PathOdds revocation best-effort.
- Signed PathOdds webhook endpoint: `/api/integrations/pathodds/webhooks`.
- Durable inbox/deduplication in the existing encrypted FamETC datastore.
- Older/out-of-order source versions are ignored rather than rolling progress backwards.
- Event-id reuse with different payload is rejected.
- Parent-only `POST /api/pathodds/remind` endpoint:
  - child must belong to current family;
  - child must have active PathOdds grant;
  - only ready/in-progress quests may be reminded;
  - completed/setup/diagnostic states are rejected;
  - one delivered reminder per child/local-date;
  - APNs + web push use existing FamETC notification infrastructure.
- Unlink route revokes PathOdds, local grant and cached projection.

---

## 4. Environment variables — exact cross-service pairing

Generate **three independent secrets**. Do not reuse session-cookie or encryption keys.

Example generation:

```bash
openssl rand -base64 48   # service HMAC secret
openssl rand -base64 48   # webhook HMAC secret
openssl rand -base64 48   # pairwise-subject secret
```

Generate FamETC OIDC Ed25519 signing key:

```bash
openssl genpkey -algorithm ED25519 -out fametc-oidc-private.pem
```

Back up the OIDC private key and pairwise-subject key in the production secret store before enabling the feature.

### FamETC production

```text
PATHODDS_INTEGRATION_ENABLED=false              # enable only during rollout step below
PATHODDS_SERVICE_BASE_URL=https://www.pathodds.com
PATHODDS_SERVICE_SECRET=<SERVICE_SECRET>
PATHODDS_WEBHOOK_SECRET=<WEBHOOK_SECRET>

OIDC_ISSUER=https://www.fametc.com
PATHODDS_OIDC_CLIENT_ID=pathodds
PATHODDS_OIDC_REDIRECT_URI=https://www.pathodds.com/api/auth/fametc/callback
OIDC_PAIRWISE_SUBJECT_KEY=<PAIRWISE_SECRET>
OIDC_SIGNING_PRIVATE_KEY=<ED25519_PKCS8_PRIVATE_KEY>
OIDC_SIGNING_KEY_ID=fametc-2026-01
```

Preserve existing FamETC variables, particularly:

```text
DATA_ENCRYPTION_KEY=...
FAM_DATA_DIR=...
RP_ID=fametc.com
RP_ORIGIN=https://fametc.com,https://www.fametc.com   # or current verified production value
RP_NAME=Fam ETC
```

### PathOdds production

```text
PATHODDS_FAMETC_INTEGRATION_ENABLED=false       # enable only during rollout step below
FAMETC_OIDC_ISSUER=https://www.fametc.com
FAMETC_OIDC_CLIENT_ID=pathodds
FAMETC_SERVICE_SECRET=<SERVICE_SECRET>           # EXACT match for FamETC PATHODDS_SERVICE_SECRET
FAMETC_WEBHOOK_URL=https://www.fametc.com/api/integrations/pathodds/webhooks
PATHODDS_WEBHOOK_SECRET=<WEBHOOK_SECRET>         # EXACT match for FamETC PATHODDS_WEBHOOK_SECRET
PATHODDS_DEFAULT_TIME_ZONE=UTC
```

Preserve/set the PathOdds production RP and persistent data config:

```text
RP_ID=pathodds.com
RP_ORIGIN=https://www.pathodds.com
RP_NAME=PathOdds
FUTUREMAP_DATA_DIR=~/.pathodds-data              # or the existing production persistent path
DATA_ENCRYPTION_KEY=...                          # preserve current key
SESSION_SECRET=...
AUTH_COOKIE_SECRET=...
```

### Secret invariants

- `FamETC PATHODDS_SERVICE_SECRET` == `PathOdds FAMETC_SERVICE_SECRET`.
- `FamETC PATHODDS_WEBHOOK_SECRET` == `PathOdds PATHODDS_WEBHOOK_SECRET`.
- `OIDC_PAIRWISE_SUBJECT_KEY` is FamETC-only and must be stable for the lifetime of these links. **Do not rotate it without an identity migration.**
- OIDC signing keys can be rotated only with a planned JWKS overlap period.
- The service and webhook HMAC keys may be rotated with a coordinated two-service deploy.

---

## 5. Persistent data / migrations

There is no SQL migration.

### FamETC

The existing encrypted `db.json` gains lazy collections such as:

```text
identitySubjects
integrationGrants
pathOddsProjections
pathOddsInbox
pathOddsReminderState
oauthAuthorizationCodes
```

`identity-subjects.migrateAll()` backfills parent/kid profile subjects idempotently. Kid profiles—not devices—are the identity anchor.

### PathOdds

Under `FUTUREMAP_DATA_DIR` the integration adds:

```text
fametc-integration.json
fametc-outbox.json
```

They use the existing `DATA_ENCRYPTION_KEY` when encryption is configured. Existing `sessions.json` is unchanged in ownership semantics.

**Before deploy, back up both persistent data directories and confirm the encryption keys are available to the rollback environment.**

---

## 6. Codex verification before merge

The user explicitly delegated CI/integration verification to Codex. Run at least the following.

### PathOdds

```bash
npm install --no-audit --no-fund
npm run check
```

This must include TypeScript, tests and production build.

Verify the PR CI result is green at the **current** PR head, not only an earlier implementation SHA.

### FamETC web/server

```bash
npm install --no-audit --no-fund
npm test
```

Run any additional existing lint/build scripts in `package.json` that are required by current `main`.

### FamETC iOS

From `ios/`, generate the project if required by the repo workflow and compile the app/tests with the current Xcode environment. At minimum confirm these new files compile:

```text
FamETC/Networking/PathOddsModels.swift
FamETC/Networking/PathOddsAPI.swift
FamETC/Features/Today/PathOddsQuestCard.swift
FamETCTests/PathOddsModelsTests.swift
```

Do not block the web/server deployment solely on App Store distribution if native signing infrastructure is unavailable to CI; do block on Swift compile errors in the changed source.

---

## 7. Required integration test matrix

Use disposable test accounts/families. Do not use production student data for the first pass.

### A. Identity and linking

1. Parent with existing FamETC passkey signs in.
2. Parent creates/uses a kid profile.
3. Parent can pre-provision that child's PathOdds link through FamETC.
4. Pairwise subject is opaque and stable across repeat requests.
5. Kid provisions/uses their own FamETC passkey.
6. Kid reaches the already-linked PathOdds learner—not a duplicate learner.
7. Existing PathOdds passkey sign-in still works.

### B. Authorization boundary

1. Kid `GET /api/pathodds/today` sees self only.
2. Kid supplying sibling `kidId` is rejected.
3. Parent may `GET /api/pathodds/today?kidId=<own-child>`.
4. Parent cannot query a kid outside their family.
5. Parent attempt to launch the child's learner session is `403`.
6. Kid can create a launch URL for self.

### C. One-time launch

1. FamETC child taps Start/Continue.
2. PathOdds one-time ticket opens correct learner/route.
3. Reusing the same ticket fails.
4. Tampered return URL is never accepted.
5. PathOdds shows the `Back to FamETC` control after the FamETC launch.
6. Clicking it returns to `https://www.fametc.com/?tab=today` and clears the browser hint.

### D. Progress synchronization

1. Start with a PathOdds quest projection.
2. Answer several questions in PathOdds.
3. Within the publisher interval + network latency, FamETC receives `sat.quest.progressed` and projection advances.
4. Complete quest; FamETC receives `sat.quest.completed`.
5. Resend the same event -> successful duplicate/no second application.
6. Send an older learner state version after a newer one -> ignored/no rollback.
7. Reuse an event id with mutated payload -> rejected.
8. Temporarily stop FamETC, make PathOdds progress, restore FamETC -> PathOdds outbox retries and eventually drains.
9. Temporarily stop PathOdds -> FamETC serves cached projection marked stale instead of breaking Today.

### E. Reminder behavior

As parent:

```http
POST /api/pathodds/remind
Content-Type: application/json

{"kidId":"<kid-id>"}
```

Verify:
- ready/in-progress quest can send through configured APNs/web push;
- second delivered reminder for same child/local-date is deduped;
- completed quest is rejected;
- setup/diagnostic-required learner is rejected;
- child without push destination gets a clear non-success response;
- kid session cannot use the parent reminder route.

### F. Unlink/deletion

1. `DELETE /api/pathodds/connect` revokes PathOdds link, local grant and cached projection.
2. Subsequent launch requires reconnect.
3. Delete a kid profile; FamETC immutable subject becomes disabled and grant revoked.
4. Verify PathOdds subject revocation was received when PathOdds was reachable.
5. Disabled subject cannot be silently resurrected by a lookup.

### G. Privacy assertion

Inspect FamETC projection/event storage. It may contain summary fields such as:
- readiness;
- localDate;
- estimatedMinutes;
- answered/total counts;
- XP summary;
- streak;
- completion timestamp.

It must **not** contain:
- SAT question text/ids;
- selected answers;
- per-question correctness;
- error classifications;
- full mastery rows;
- PathOdds session bearer tokens.

---

## 8. Merge and deployment sequence

### Step 1 — freeze and back up

- Confirm current production heads for both repos.
- Back up FamETC persistent data directory.
- Back up PathOdds `FUTUREMAP_DATA_DIR`.
- Record current deployment revisions for rollback.

### Step 2 — merge PathOdds PR #22

- Ensure current-head CI is green.
- Merge into PathOdds `main`.
- Deploy PathOdds code with all new secrets/URLs present but:

```text
PATHODDS_FAMETC_INTEGRATION_ENABLED=false
```

- Confirm ordinary PathOdds health, SAT flow and existing passkeys still work.

### Step 3 — merge FamETC PR #13

- Ensure current-head CI and native compile checks are green.
- Merge into FamETC `main`.
- Deploy FamETC with all new secrets/OIDC keys present but:

```text
PATHODDS_INTEGRATION_ENABLED=false
```

- Confirm ordinary family/passkey/calendar/homework functionality is unaffected.

### Step 4 — enable PathOdds receiver/publisher

Set:

```text
PATHODDS_FAMETC_INTEGRATION_ENABLED=true
```

Restart/redeploy PathOdds. Confirm its integration endpoints respond and no unexpected outbox/dead-letter growth occurs.

### Step 5 — enable FamETC identity/BFF

Set:

```text
PATHODDS_INTEGRATION_ENABLED=true
```

Restart/redeploy FamETC. Verify:

```text
GET https://www.fametc.com/.well-known/openid-configuration
GET https://www.fametc.com/.well-known/jwks.json
```

Then execute the integration matrix above with one controlled family.

### Step 6 — expand rollout

After the controlled family succeeds, expose to the intended cohort. There is no need to migrate or copy PathOdds learner state into FamETC.

---

## 9. Post-deploy smoke checks

### FamETC

- Parent passkey sign-in.
- Kid passkey sign-in.
- Today page loads with PathOdds unavailable as a graceful card state, not a page failure.
- Linked child summary renders.
- Webhook endpoint rejects unsigned requests.
- Push/chat/homework existing notification paths still work.

### PathOdds

- `/api/health` remains healthy.
- Existing PathOdds passkey sign-in works.
- SAT setup/diagnostic/quest works independently of FamETC.
- FamETC-linked student gets the expected session.
- One-time launch replay fails.
- `fametc-outbox.json` does not accumulate persistent failures during normal operation.

---

## 10. Rollback

Fastest feature rollback is configuration-only:

```text
FamETC:  PATHODDS_INTEGRATION_ENABLED=false
PathOdds: PATHODDS_FAMETC_INTEGRATION_ENABLED=false
```

Restart both services. Existing FamETC and PathOdds standalone functionality remains available.

Do **not** delete:
- `identitySubjects`;
- integration grants;
- pairwise identity key;
- OIDC key material;
- `fametc-integration.json`;
- `fametc-outbox.json`;

while diagnosing. They are needed to preserve identity continuity when the feature is re-enabled.

If code rollback is required, redeploy the recorded pre-merge revisions while retaining persistent data and the original encryption keys.

---

## 11. Operational notes / intentional choices

- PathOdds progress publishing runs every ~15 seconds. This is intentionally not synchronous with answer submission; FamETC downtime cannot block learning work.
- FamETC also reconciles by direct summary read when its projection is stale, so webhooks are a freshness mechanism rather than the sole correctness path.
- The parent reminder is intentionally **parent-initiated** and limited to one successfully delivered reminder per child/local-date. An autonomous scheduled nagging system is not part of this release.
- FamETC's local Daily 5 concept and PathOdds' SAT streak are distinct. Do not merge their counters.
- Parent visibility is summary-only by design.
- PathOdds launch `returnTo` is restricted to HTTPS `fametc.com` / `www.fametc.com`.
- The browser return affordance expires after 12 hours and clears on click.
- JSON persistence assumes the current single-process deployment model. If either app moves to multiple application workers, integration tickets/inbox/outbox should move to storage with cross-process atomic compare-and-set/transactions before scaling out.

---

## 12. Codex completion checklist

Before calling the integration deployed:

- [ ] Update both feature branches from their own latest `main` if necessary.
- [ ] PathOdds current-head CI green.
- [ ] FamETC current-head CI green.
- [ ] FamETC iOS changed sources compile.
- [ ] Identity/linking matrix passes.
- [ ] Parent cannot impersonate child.
- [ ] Launch ticket replay fails.
- [ ] Progress webhook duplicate/out-of-order tests pass.
- [ ] Offline/stale reconciliation behavior passes.
- [ ] Unlink and kid deletion lifecycle passes.
- [ ] Parent reminder behavior passes.
- [ ] Back-to-FamETC behavior passes.
- [ ] FamETC stores no question/answer-level PathOdds data.
- [ ] Production secrets are purpose-separated and backed up.
- [ ] Persistent data directories backed up.
- [ ] Merge PathOdds PR #22.
- [ ] Deploy PathOdds code disabled; smoke standalone product.
- [ ] Merge FamETC PR #13.
- [ ] Deploy FamETC code disabled; smoke standalone product.
- [ ] Enable PathOdds integration flag.
- [ ] Enable FamETC integration flag.
- [ ] Run controlled-family production smoke test.
- [ ] Confirm PathOdds outbox drains and FamETC projections update.
- [ ] Record deployed SHAs and rollback revisions.

When this checklist passes, mark both PRs/rollout complete.

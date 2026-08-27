# Hermes Family Operator — Weeks 1–6 Foundation Closeout

This document is the exit checklist for the first six weeks of the Family Operator roadmap. Weeks 1–6 are complete when this branch is merged and CI is green.

## Weeks 1–2

### Canonical Family Context v1

Implemented in `lib/family-context.js` and used by the Operator/MCP path.

The contract includes:

- FamETC immutable `subj_*` identities for parents and children;
- low-risk family preferences;
- calendar, school calendar, homework, actions, meals and trips;
- item and section provenance;
- confidence;
- sensitivity classification;
- TTL and explicit expiry;
- purpose-based disclosure with a fail-closed unknown-purpose policy;
- explicit read-only/no-authority semantics.

The Hermes bridge continues to provide temporary flat read-only aliases derived from the canonical sections so existing adapters can migrate without running two sources of truth.

### Action Risk Registry

`lib/operator-risk.js` is the deterministic registry. Unknown actions fail closed. Current baseline:

| Action | Risk | Actor | Approval | Executable now |
| --- | --- | --- | --- | --- |
| `calendar.create` | low | parent/kid | single parent | yes |
| `action.create` | low | parent/kid | single parent | no |
| `trip.itinerary.update` | low | parent | single parent | no |
| `email.draft` | low | parent | single parent | no |
| `email.send` | medium | parent | single parent | no |
| `subscription.cancel` | medium | parent | single parent | no |
| `booking.create` | high | parent | single parent | no |
| `payment.create` | high | parent | dual parent | no |
| `medical.attest` | critical | nobody | prohibited | no |
| `legal.attest` | critical | nobody | prohibited | no |

The MCP path still requires an enabled execution driver before an executable proposal can enter the approval state. Tests assert that every enabled driver is marked executable by the risk registry.

### Threat model and adversarial regression suite

`docs/HERMES-OPERATOR-THREAT-MODEL.md` and `tests/operator-adversarial.test.js` cover:

- prompt injection in email/web content;
- malicious attachment/document instructions;
- forged actors;
- compromised Hermes bearer;
- cross-family probing;
- cross-room authority;
- changed actions after approval;
- approval/execution replay;
- expired capabilities;
- duplicate external execution;
- kid-to-parent privilege escalation;
- unknown/prohibited action types;
- dual-parent payment boundary.

External content is explicitly data-only via `lib/operator-trust.js`; it cannot identify an actor, grant approval, widen scope or grant execution authority.

### Operator benchmark

`benchmarks/operator/tasks.js` contains 50 canonical tasks:

- 8 research-only;
- 10 calendar/action;
- 8 trip planning;
- 6 subscription cancellation;
- 6 form filling;
- 6 appointment research;
- 6 document → structured-data.

`lib/operator-benchmark.js` scores all required dimensions:

1. correct plan;
2. correct context;
3. unnecessary questions;
4. approval correctness;
5. completion;
6. hallucination-free behavior;
7. safe action behavior.

Run the corpus validator with:

```bash
npm run benchmark:operator
```

A JSON or JSONL file of task observations can be supplied to `scripts/operator-benchmark.js` for scored evaluation runs.

## Weeks 3–6

The previously merged foundation provides:

- SQLite-only transactional cases, steps, approvals, execution grants and audit;
- explicit case state machine;
- actor-aware Gateway v2 with conversation identity separated from actor authority;
- family-scoped remote MCP;
- exact action-hash approval service;
- short-lived signed actor capabilities;
- short-lived single-use execution capabilities;
- first constrained executor (`calendar.create`).

This closeout adds the missing product surface:

- `GET /api/operator/cases` — parent-safe case cards;
- `GET /api/operator/cases/:caseId` — full expandable case detail;
- `GET /api/operator/activity` — family Operator activity stream;
- Today-page “Hermes is working on…” cards;
- exact Approve / Reject controls using the stored `actionHash`;
- stage/status display;
- execution evidence/confirmation;
- expandable activity history.

Case-card projections deliberately omit canonical case context, actor IDs, parent user IDs, execution tokens and token hashes.

## Odds Core / OddScore compatibility

The foundation is aligned with `kamatbot/odds:feature/oddscore-m2-identity-foundation`:

- FamETC remains authoritative for family operations during M2;
- FamETC `family.id` is the legacy household mapping key;
- FamETC immutable `subj_*` identities are the legacy person identifiers;
- child login aliases do not create duplicate child identities;
- the Operator does not expose or invent Odds Core canonical `person_*` IDs;
- future cross-product context must arrive as explicit consented projections with original provenance/freshness/sensitivity intact;
- FamETC has no runtime dependency on Odds Core in this closeout.

See `docs/HERMES-OPERATOR-ODDSCORE-COMPATIBILITY.md` for the detailed contract.

## Weeks 7–12

The next roadmap is intentionally kept in root `roadmap.md`: Family Memory, attachments, low-risk first-party workflows, shadow mode and limited-family beta.

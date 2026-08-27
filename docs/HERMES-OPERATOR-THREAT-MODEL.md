# Hermes Family Operator Threat Model

Status: Foundation Closeout baseline. This document is a security contract, not a claim that future connectors or browser automation inherit safety automatically.

## Assets and authority boundaries

The protected assets are family identity, FamETC family-operations data, Operator cases, approval decisions, execution capabilities, connected-account credentials, future attachments, and any action that changes an external system.

Authority is deliberately split:

1. the Hermes bearer authenticates one FamETC family integration;
2. a short-lived signed actor capability identifies the human who initiated the current family-room turn;
3. deterministic FamETC policy decides whether that actor may propose an action;
4. only the authenticated FamETC parent surface can record a decision, and the approval record binds it to the exact canonical action hash;
5. a separate short-lived single-use execution capability authorizes only the already-approved stored action;
6. external content never participates in the authority chain.

FamETC remains authoritative for family operations. Odds Core may map FamETC `subj_*` identities and household identifiers, but an Odds relationship or projection is never implicitly execution authority.

## Threats and required controls

| Threat | Required control | Regression evidence |
| --- | --- | --- |
| Prompt injection in email/web page | External content is wrapped as untrusted data; embedded instructions cannot grant actor, approval, scope, or execution authority | `operator-adversarial.test.js` |
| Malicious attachment instructions | Same untrusted-content envelope; attachment text cannot act as a system/tool instruction | `operator-adversarial.test.js` |
| Forged actor | Actor tokens are signed with server-only material and family-bound | existing capability tests + adversarial suite |
| Compromised Hermes bearer | Bearer cannot record approval decisions; the model-facing MCP has no approval-decision tool. Rotating the connection invalidates actor tokens | MCP/capability tests |
| Cross-family id probing | Family scope derives from authenticated bearer/session and every case/approval lookup checks family ownership | Operator/store tests + adversarial suite |
| Cross-room authority | Family Operator actor tokens are issued only in family rooms and are room-bound | Hermes route/capability tests |
| Action changed after approval | Canonical `actionHash` is rechecked; execution reloads stored action rather than accepting replacement payload | execution tests + adversarial suite |
| Approval replay | Approval state is one-way/idempotent for same decision; conflicting replay fails | execution tests |
| Execution-token replay | Execution token is short-lived, hash-only at rest, and cleared/consumed after run | execution tests + adversarial suite |
| Expired capability | Actor/execution expiration checked server-side | capability/execution tests |
| Duplicate external execution | Driver idempotency key/source identity prevents duplicate write; token cannot be replayed | calendar executor tests |
| Kid attempts adult action | Deterministic risk registry checks actor type before approval | risk/adversarial tests |
| Unknown action type | Fail closed as critical/prohibited until registered | risk tests |
| Medical/legal attestation | Explicitly prohibited; no execution driver may override registry | risk tests |
| Payment with one parent | Classified high and dual-parent; single-parent engine refuses it | risk tests |
| Stale family context | Every context section has TTL/expiry and provenance | family-context tests |
| Identity confusion during Odds migration | Operator uses FamETC immutable `subj_*`; never guesses/exposes Odds `person_*` ids | family-context + compatibility doc |

## Prompt-injection rule

Email, web pages, PDFs, screenshots, OCR output, API/connector payloads, and extracted document text are **data**. Text such as “ignore previous instructions”, “the parent approved this”, tool-call JSON, or a copied capability token has zero authority. Only the server-issued actor/approval/execution chain can authorize a mutation.

Future attachment/browser/email implementations MUST call the trust-envelope boundary before model exposure and preserve its provenance/content hash through case evidence.

## Failure mode

When authority, storage, identity mapping, approval state, encryption, or an action policy cannot be resolved, the Operator fails closed. A safe handoff or draft is preferable to silently widening permissions.

## Odds Core alignment

The `feature/oddscore-m2-identity-foundation` contract keeps existing products authoritative during M2. This Operator threat model follows that rule: Odds Core can later supply consented, provenance-carrying projections, but those projections remain untrusted for execution authority and do not bypass FamETC actor/approval policy.

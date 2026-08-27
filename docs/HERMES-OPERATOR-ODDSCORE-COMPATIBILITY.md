# Hermes Operator ↔ Odds Core Identity Compatibility

This note locks the Family Operator foundation to the identity contracts being built in `kamatbot/odds` on `feature/oddscore-m2-identity-foundation`.

## Ownership boundary

FamETC remains the source of truth for family operations: household membership as currently modeled in FamETC, schedule, actions, meals, trips, homework and Operator cases. Odds Core owns cross-product identity/linking/consent primitives and later cached cross-product projections. It does not become authoritative for FamETC domain facts.

## Identity contract

The Operator uses FamETC's existing immutable identity subjects as its durable person references:

- parent principal: `parent:<userId>` → immutable `subj_*`;
- child principal: `kid:<familyId>:<kidId>` → immutable `subj_*`;
- kid login aliases attach to the same child `subj_*` and do not create another person;
- disabled subjects are never silently resurrected.

Canonical Family Context v1 therefore exposes the FamETC `subj_*` value as the person subject. It may include a family-scoped `kidId` where a FamETC write tool needs to target a kid profile, but it does not expose parent user ids as cross-product identity.

Odds Core's M2 migration maps:

- `family.id` → persistent Odds Core household mapping;
- FamETC `subj_*` → primary legacy person identifier;
- authenticated FamETC user ids → aliases on that same mapped person.

The Operator must never emit or guess an Odds Core `person_*` identifier. Odds Core pairwise product subjects remain an Odds Core concern.

## Context/projection compatibility

Canonical Family Context v1 uses the same conceptual metadata required by the Odds shared projection contract:

- source product / source reference;
- generated/observed time;
- stale/expiry time;
- sensitivity;
- confidence;
- purpose-scoped disclosure.

FamETC context is still an internal Operator contract rather than an Odds projection envelope. When cross-product data arrives later, it should enter Family Memory/Operator context as a consented projection carrying its original `productId`, pairwise subject, `generatedAt`, `staleAfter`, sensitivity, version and provenance. The Operator must not strip that source metadata or rewrite the projection as a FamETC-authored fact.

## Consent and delegation

Odds Core M2 owns cross-product consent/delegation. FamETC Operator authority remains local and actor-bound:

- Hermes bridge bearer identifies the connected family integration;
- per-message actor capability identifies the initiating human;
- FamETC policy decides whether that actor may request a local action;
- external/cross-product context must additionally satisfy the relevant Odds consent grant before it is provided to FamETC.

A household relationship alone never grants cross-product authority, matching Odds Core's explicit guardian/delegation model.

## Cutover rule

This closeout does not make FamETC depend on Odds Core at runtime. That matches the M2 rehearsal rule: current child-product login and family operation remain usable if Odds Core is unavailable. The compatibility points above make future linking additive rather than requiring an identity rewrite of the Operator foundation.

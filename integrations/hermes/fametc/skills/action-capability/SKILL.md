---
name: action-capability
description: Use when FamETC must act on an external service.
version: 0.2.0
author: FamETC
license: MIT
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [FamETC, Actions, Browser, HAR, Skills]
    related_skills: [har-derived-api-client]
    requires_toolsets: [skills]
---

# FamETC Action Capability Layer

Turn an external-service request into a governed FamETC Operator case. Treat a
capability as a reusable way to satisfy an intent, not as a provider integration.

## When to Use

Load this skill for any family-room request that searches or acts inside an
external account or service, including reservation lookup, ticketing, seat
changes, product reorders and similar errands. Apply the prototype boundary
below before using any external tool.

## Prototype boundary

The only external workflow this prototype may complete is a **read-only lookup
of an existing reservation for the initiating parent**, such as locating a
United booking. It may return minimum useful itinerary facts after the parent
completes any interactive sign-in or challenge.

Do not buy tickets, reorder products, move seats, change or cancel a booking,
send a message, submit a form that changes state, or make a payment. For those
requests, research and explain the proposed next action, then stop. FamETC's
current Operator allowlist has no external-write driver, and neither a browser
session nor an `actorToken` is approval.

Account-specific lookup is parent-only. If the per-message FamETC context says
the initiating actor is not a parent, do not open or disclose the account.

## Route in this order

Choose the first available path that can satisfy the exact intent:

1. **Official connector/API.** Prefer a provider-supported connector or public
   API with appropriate account authorization.
2. **Agent-friendly MCP/API.** Prefer an already configured MCP server or
   purpose-built agent API. Keep FamETC's actor and case boundaries intact.
3. **Learned web/API workflow.** Search installed skills for a previously
   verified `fametc-action-<service>-<intent>` skill and load it with
   `skill_view` before use.
4. **Browser/computer use.** Use the browser once to discover or recover the
   path. When technically and contractually appropriate, derive a reusable
   read-only request path from the observed traffic instead of making repeated
   UI automation the permanent implementation.

Do not skip a healthier earlier path because a later path is more novel. Do not
claim a path exists until its tool or learned skill is actually available.

## Case and audit contract

Create one durable FamETC Operator case before external work. Record the route
decision with `fametc_cases_add_step` using kind `capability.route.selected`.
The step input should include only the intent, service, ordered path names and
non-secret constraints; the output should contain `selectedPath` and a short
reason. Never put cookies, authorization headers, confirmation codes, last
names, capability tokens, raw HAR data, or full reservation records in a case
step.

After a successful first learning run, add a `capability.workflow.learned`
step containing the learned skill name, service, intent, verification time and
result shape. On reuse, add `capability.workflow.reused` with the skill name and
whether the response contract still matched. Use an idempotency key for every
step.

## Learn a read-only workflow

1. Confirm the request is a parent-initiated reservation lookup and that site
   terms and local policy permit the observation and replay. Never bypass a
   CAPTCHA, bot control, rate limit, access control or account challenge.
2. Ask the parent to complete sign-in, MFA, CAPTCHA and consent-sensitive
   interactions themselves in the browser. Do not save those values.
3. Load `har-derived-api-client` with `skill_view`. If it is unavailable, stay
   on the browser path and report that the workflow was not learned.
4. Use that skill's local or CDP capture path as appropriate. Store the HAR only
   in a private temporary location. Treat it as a live secret.
5. Derive only the minimum read endpoint needed for the lookup. Reject any
   candidate request that mutates state or whose effect is uncertain.
6. Replace every credential, cookie, token, confirmation code, surname and
   account identifier with a runtime placeholder before authoring a skill or
   support script. Never place a captured secret in `skill_manage`, FamETC,
   memory, source control, logs or chat.
7. Verify the sanitized client without browser UI against the same read-only
   lookup. A response must match the expected status and minimum result schema;
   a redirect, HTML challenge, 401/403, or schema drift is not success.
8. Delete the raw HAR and any unredacted derivation immediately after the
   verification attempt, including on failure.
9. Persist the verified procedure with `skill_manage` as
   `fametc-action-<service>-<intent>`. Put the short trigger and safety boundary
   in `SKILL.md`; put deterministic client code under `scripts/`. The script
   must accept sensitive values only at runtime and must not print or persist
   them.

The learned skill must state its service, intent, read-only effect, input names,
result schema, authentication/session prerequisites, verification signal,
known expiry/drift behavior and fallback path. It must not generalize a lookup
endpoint into a write capability.

## Reuse and recovery

### Executable reservation adapter

Use the bundled `scripts/reservation_workflow.py` for the learned path. It
reuses Hermes HAR capture and `skill_manage`; do not create a parallel registry,
credential store, or provider integration service. This prototype supports one
reviewed HTTPS GET returning JSON itinerary segments, not arbitrary API calls.
A GET method alone does not establish read-only effect: review the provider's
documented/observed semantics and permission to replay before running it.

Author a non-secret recipe with these exact keys (the host/path below are
illustrative, not a working provider endpoint):

```json
{
  "service": "airline",
  "origin": "https://reservations.example.test",
  "path": "/reservations/{booking}",
  "query": ["surname"],
  "headers": ["cookie"],
  "segments": "/segments",
  "fields": {"origin": "/from", "destination": "/to", "departure": "/at"},
  "method": "GET",
  "effect": "read-only"
}
```

Paths must replace **every** account-specific value with a named placeholder;
query/header lists contain names only. Static path segments use the runner's
small reviewed route vocabulary; unsupported literals require review, not a
relaxed validator. JSON pointers select minimum itinerary
fields (origin/destination airport codes, timezone-qualified departure/arrival,
optional flight number). Never include names, booking codes or whole responses.
Do not use the upstream HAR summarizer that prints captured headers/samples.
Capture with a private directory and `umask 077`; use a dedicated mode-0600 HAR
that the adapter is explicitly allowed to consume/delete. It refuses symlinks
and non-private files. On capture failure, delete the task-owned raw HAR yourself.

Run using the installed Hermes venv and import root (substitute the verified
installation directory if different):

```sh
PYTHONPATH="$HOME/.hermes/hermes-agent" \
  "$HOME/.hermes/hermes-agent/venv/bin/python" \
  "$HOME/.hermes/plugins/fametc/skills/action-capability/scripts/reservation_workflow.py" \
  learn --recipe /private/task/recipe.json --har /private/task/capture.har
```

Supply JSON on **stdin**, never literal values in logged terminal commands:
`actorToken` (fresh parent message), `caseId` (new lookup-only family case).
Learning extracts provider session values from the private HAR in memory.
The adapter consumes the capture, replays only its single matching request,
compares projected results, then asks native `skill_manage` to create
`fametc-action-<service>-reservation-lookup`. Refused or staged saves are **not**
successful learning. Relearning first reads the existing native skill without
template execution, verifies its service/origin, and patches only its recipe
through the native write gate; custom instructions remain intact. Changed origins
or incompatible skill content require review. Do not bypass the skill-write gate.

For reuse, load that skill and run the same interpreter/import-root with
`replay --skill <saved SKILL.md>`. Stdin also supplies `inputs` (placeholder/query
values) and `headers` (fresh session headers). Keep these ephemeral; a browser
vault may fill login fields but is **not** an API-cookie exporter. If no safe
runtime-input channel exists, stay in the supervised browser and report that
limitation. Never print or persist runtime input to bridge that gap.

Verification expires after seven days. Redirects/challenges, auth expiry,
nonpublic destinations, schema drift and capture mismatches stop replay. Success
records only sanitized evidence and completes the read-only case. This does not
issue an approval or execution grant, and cases with any approval history cannot
use the read-only completion path. Return the projected itinerary through the
normal family reply; never claim the synthetic fixture is a real booking.

Load the matching learned skill and follow its verified script before opening
the browser. Supply secrets only through the runtime mechanism documented by
that skill. Return the minimum itinerary details and redact confirmation codes
and account identifiers from normal prose.

If authentication has expired, the response contract drifts, or verification
fails, stop direct replay. Fall back to the browser path, let the parent handle
interactive authentication, and relearn the same skill with `skill_manage`
patch only after a fresh read-only verification. Never stack speculative URL,
header or selector changes.

Complete the Operator case only when the requested lookup is verified. If the
site is unavailable or the capability cannot be learned safely, mark the step
blocked or failed and say what the parent must do next without claiming the
reservation was found.

---
name: action-capability
description: Use when FamETC must act on an external service.
version: 0.1.0
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

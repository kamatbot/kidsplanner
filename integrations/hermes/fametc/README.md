# FamETC Hermes Family Operator bridge

This plugin connects a local Hermes gateway to one FamETC family. The gateway
makes outbound HTTPS requests only; no inbound connection to the user's Mac is
required. FamETC remains the authority for room access, family identity,
Operator cases, approvals and execution grants.

Only human messages explicitly mentioning `@Hermes` are forwarded. A single
Hermes conversation is retained per FamETC room even when multiple family
members participate.

## What changed in v1.2

The Operator now has a first end-to-end approval/execution path in addition to
the v1.1 actor-authority foundation:

1. Hermes creates and researches a durable case.
2. Hermes proposes an exact structured action and calls
   `fametc_approvals_request`; FamETC stores and hashes that payload.
3. A parent explicitly approves or rejects the displayed proposal in a new
   FamETC message (or through the parent approval API).
4. `fametc_approvals_decide` binds that decision to the exact `actionHash`.
5. An approved action gets one execution grant. Hermes must separately call
   `fametc_execution_claim` to obtain a short-lived, single-use execution token.
6. `fametc_execution_run` accepts the token + approved hash only. It cannot
   accept a replacement action body; FamETC reloads the approved payload from
   encrypted SQLite and dispatches an allowlisted server-side executor.
7. The execution token is consumed and the case moves to verification.

The first enabled execution driver is deliberately narrow: `calendar.create`.
It writes a FamETC calendar event with an Operator source id, making retries
idempotent. Browser automation, email sends, bookings, cancellations and
payments remain disabled until they have their own constrained drivers and
risk policies.

## Actor authority stays separate from conversation identity

For every authorized inbound **family-room** message FamETC issues a short-lived
signed `actorToken`. The plugin injects that token through Hermes' ephemeral
`channel_prompt` path, not into the user's message or raw diagnostic metadata.
This lets MCP tools know whether a parent or kid initiated a task without
fragmenting the shared family conversation.

Every Operator MCP tool requires the current message's actor token. Approval,
claim and execution additionally require a parent token, and claim/execution
must be performed under the same parent who approved the action. Family
Operator tokens are never issued in shared Trip rooms.

Rotating or revoking the FamETC Hermes connection invalidates both the bearer
credential and outstanding actor tokens.

## Install the platform plugin

From the repository root, copy the plugin files to the local Hermes path:

```sh
mkdir -p ~/.hermes/plugins/fametc
cp integrations/hermes/fametc/plugin.yaml \
   integrations/hermes/fametc/adapter.py \
   integrations/hermes/fametc/operator_adapter.py \
   integrations/hermes/fametc/__init__.py \
   ~/.hermes/plugins/fametc/
```

Enable the user plugin in `~/.hermes/config.yaml` (the key may already exist):

```yaml
plugins:
  enabled:
    - fametc-platform
```

## Configure one family

A parent creates or rotates the connection in FamETC. Copy the returned
`apiBaseUrl` and raw token immediately; the status endpoint never returns the
raw bearer again.

Put the values in `~/.hermes/.env`:

```dotenv
FAMETC_HERMES_API_URL=https://www.fametc.com/api/hermes
FAMETC_HERMES_TOKEN=paste-the-returned-token-here
FAMETC_HERMES_POLL_SECONDS=10
```

Restart the Hermes gateway after changing the connection. Newly authorized Trip
rooms are discovered on the next room refresh without another restart.

## Enable Family Operator MCP tools

Hermes' native remote MCP client is optional. Install/upgrade MCP support first
if the local Hermes installation does not already include it:

```sh
pip install --upgrade mcp
```

Then add the FamETC server to `~/.hermes/config.yaml`. Hermes supports `${VAR}`
substitution from `~/.hermes/.env`, so the bearer does not need to be duplicated
as a literal in config:

```yaml
mcp_servers:
  fametc_operator:
    url: "${FAMETC_HERMES_API_URL}/mcp"
    headers:
      Authorization: "Bearer ${FAMETC_HERMES_TOKEN}"
    tools:
      resources: false
      prompts: false
    timeout: 120
    connect_timeout: 30
```

Restart Hermes (or reload MCP on versions that support it). Hermes prefixes MCP
tool names with the server name, so tools appear as names such as
`mcp_fametc_operator_fametc_context_get`.

The server exposes:

- `fametc_context_get` — minimum purpose-scoped family context.
- `fametc_cases_create` — creates a durable multi-step case.
- `fametc_cases_get` / `fametc_cases_list` — reads cases visible to the
  initiating actor.
- `fametc_cases_transition` — advances only through FamETC's allowed state
  machine.
- `fametc_cases_add_step` — appends auditable, typed work steps.
- `fametc_approvals_request` — stores and hashes an exact proposed action and
  moves the case to `waiting_for_approval`; it never executes.
- `fametc_approvals_decide` — records a parent's explicit approve/reject
  decision for that exact hash.
- `fametc_execution_claim` — issues a short-lived execution capability for an
  approved action. Only a SHA-256 digest of that capability is persisted.
- `fametc_execution_run` — consumes the capability and executes the
  server-stored approved action through an allowlisted driver.

All tools require the signed `actorToken` from the current FamETC family-room
message.

## Parent approval API

FamETC also exposes session-authenticated endpoints for web/iOS approval cards:

- `GET /api/operator/approvals`
- `GET /api/operator/approvals/:approvalId`
- `POST /api/operator/approvals/:approvalId/decision`

The decision body is `{ decision: "approve" | "reject", actionHash: "..." }`.
The family and parent identity come from the authenticated FamETC session, never
from request JSON.

## Security boundary

The family ID is derived from the authenticated bridge bearer and is never
accepted from an MCP tool argument. Every Operator tool also requires the
signed, short-lived actor token FamETC attached to the initiating family-room
message. Tokens are signed with server-only key material; the bridge bearer
cannot mint them.

Approval does not hand Hermes arbitrary authority. It authorizes exactly one
stored action hash. The execution token is short-lived, persisted only as a
hash, bound to that approved action and consumed after use. The run endpoint
cannot accept an alternative action payload.

Operator case/approval/execution/audit data is encrypted and stored
transactionally in SQLite. If SQLite or the encryption key is unavailable, the
Operator fails closed rather than falling back to plaintext or the JSON
datastore.

# FamETC Hermes Family Operator bridge

This plugin connects a local Hermes gateway to one FamETC family. The gateway
makes outbound HTTPS requests only; no inbound connection to the user's Mac is
required. FamETC remains the authority for room access, family identity,
Operator cases and approvals.

Only human messages explicitly mentioning `@Hermes` are forwarded. A single
Hermes conversation is retained per FamETC room even when multiple family
members participate.

## What changed in v1.1

The bridge now carries **actor authority separately from conversation identity**.
For every authorized inbound message FamETC issues a short-lived signed
`actorToken`. The plugin injects that token through Hermes' ephemeral
`channel_prompt` path, not into the user's message or raw diagnostic metadata.
This lets MCP tools know whether a parent or kid initiated a task without
fragmenting the shared family conversation.

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
tool names with the server name, so the first foundation tools appear as names
such as `mcp_fametc_operator_fametc_context_get` and
`mcp_fametc_operator_fametc_cases_create`.

The foundation server exposes:

- `fametc_context_get` — minimum purpose-scoped family context; requires the
  actor token from the current FamETC request.
- `fametc_cases_create` — creates a durable multi-step case; requires the actor
  token from the current request.
- `fametc_cases_get` / `fametc_cases_list` — reads family-owned cases.
- `fametc_cases_transition` — advances only through FamETC's allowed state
  machine.
- `fametc_cases_add_step` — appends auditable, typed work steps.
- `fametc_approvals_request` — records the exact action proposed for a parent;
  it **does not execute** the action.

## Security boundary

The family ID is derived from the authenticated bridge bearer and is never
accepted from an MCP tool argument. Human identity comes only from the signed,
short-lived actor token FamETC attached to the initiating message. The token is
not a general approval capability: booking, purchasing, sending, cancelling,
paying and other irreversible operations require separate policy/approval
machinery in later Operator milestones.

Operator case/approval/audit data is stored transactionally in SQLite. If
SQLite is unavailable, the Operator fails closed rather than falling back to
the JSON datastore.

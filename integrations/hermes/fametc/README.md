# FamETC Hermes bridge

This plugin lets one local Hermes gateway serve one FamETC family room and the
family's authorized Trip rooms. The gateway makes outbound HTTPS requests; no
inbound connection to the user's Mac is required. Only human text mentioning
`@Hermes` is forwarded to Hermes.

## Install

From the repository root, copy the plugin files to the local Hermes path:

```sh
mkdir -p ~/.hermes/plugins/fametc
cp integrations/hermes/fametc/plugin.yaml integrations/hermes/fametc/adapter.py integrations/hermes/fametc/__init__.py ~/.hermes/plugins/fametc/
```

Enable the user plugin in `~/.hermes/config.yaml` (the key may already exist):

```yaml
plugins:
  enabled:
    - fametc-platform
```

## Configure one family

The family parent creates or rotates the connection with the FamETC parent
connection flow. Copy the returned `apiBaseUrl` and raw `token` immediately;
the token is not shown again by the status endpoint:

```dotenv
FAMETC_HERMES_API_URL=https://www.fametc.com/api/hermes
FAMETC_HERMES_TOKEN=paste-the-returned-token-here
FAMETC_HERMES_POLL_SECONDS=10
```

Put those values in `~/.hermes/.env`, then restart the Hermes gateway. A newly
authorized Trip room is discovered on the next room refresh without a restart.
Rotating or revoking the connection invalidates the previous token.

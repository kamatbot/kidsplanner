#!/usr/bin/env bash
# Package a Hostinger deploy archive with a TIMESTAMPED build label AND the
# runtime env baked in, then smoke-test that it actually boots.
#
# Background (the 2026-07-03 outage): a deploy built from `git ls-files` alone
# excludes the gitignored `.env`. A Hostinger redeploy replaces the app dir, so
# the server-side env vanished; with NODE_ENV=production and no SESSION_SECRET
# the app throws on boot and every route returns 503. This script exists so that
# CANNOT happen again:
#   1. It REFUSES to build if there is no env source to ship.
#   2. It ALWAYS bundles `.env.hostinger` (loadenv reads it at boot; real panel
#      env still wins since loadenv only fills undefined vars).
#   3. It boots the packed archive under NODE_ENV=production and fails if the
#      app does not serve 200 — so a boot-breaking archive is never handed off.
#
# `.env.hostinger` and `*.zip`/`*.tar.gz` are gitignored: secrets never reach
# git. Output format follows the extension (.zip or .tar.gz).
set -euo pipefail

cd "$(dirname "$0")/.."

OUT="${1:-fametc-deploy.zip}"

# --- 1. Guarantee an env source, then refuse if there is genuinely none. ------
if [ ! -f .env.hostinger ]; then
  if [ -f .env ]; then
    cp .env .env.hostinger
    echo "note: created .env.hostinger from .env (deploy env fallback)"
  else
    echo "REFUSING TO PACK: no .env or .env.hostinger — the archive would boot-fail" >&2
    echo "  (missing SESSION_SECRET with NODE_ENV=production => 503). See memory:" >&2
    echo "  deploy-env-hpanel. Provide env, then re-run." >&2
    exit 1
  fi
fi
if ! grep -q '^[[:space:]]*SESSION_SECRET=' .env.hostinger; then
  echo "REFUSING TO PACK: .env.hostinger has no SESSION_SECRET — would 503 on boot" >&2
  exit 1
fi

# --- 2. Stamp a timestamped, commit-pinned build label. -----------------------
LABEL="$(date -u +%Y%m%d-%H%M%SZ)-$(git rev-parse --short HEAD)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
COMMIT="$(git rev-parse HEAD)"
printf '{"label":"%s","builtAt":"%s","commit":"%s"}\n' "$LABEL" "$BUILT_AT" "$COMMIT" > build-info.json

# --- 3. Build: tracked files (working-tree contents) + stamp + env. -----------
rm -f "$OUT"
case "$OUT" in
  *.zip)
    { git ls-files; echo build-info.json; echo .env.hostinger; } | zip -q "$OUT" -@ ;;
  *.tar.gz|*.tgz)
    { git ls-files -z; printf 'build-info.json\0.env.hostinger\0'; } | tar --null -czf "$OUT" -T - ;;
  *)
    echo "unsupported output extension: $OUT (use .zip or .tar.gz)" >&2; exit 1 ;;
esac

# --- 4. Smoke-test: the packed archive must boot in prod mode and serve 200. ---
TMP="$(mktemp -d)"; PORT_T=4788
trap 'kill "${SRV:-0}" 2>/dev/null || true; rm -rf "$TMP"' EXIT
case "$OUT" in
  *.zip) unzip -q "$OUT" -d "$TMP" ;;
  *)     tar -xzf "$OUT" -C "$TMP" ;;
esac
( cd "$TMP" && npm install --omit=dev --silent >/dev/null 2>&1 )
( cd "$TMP" && NODE_ENV=production PORT="$PORT_T" node server.js >/tmp/pack-smoke.log 2>&1 ) &
SRV=$!
disown "$SRV" 2>/dev/null || true  # keep job-control chatter out of the output
for i in $(seq 1 15); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT_T/" || true)"
  [ "$CODE" = "200" ] && break
  sleep 1
done
if [ "${CODE:-}" != "200" ]; then
  echo "SMOKE TEST FAILED: packed archive did not serve 200 under NODE_ENV=production" >&2
  echo "--- server log ---" >&2; cat /tmp/pack-smoke.log >&2
  exit 1
fi

echo "Packed $OUT  (smoke test: 200 OK under NODE_ENV=production)"
echo "  build label : $LABEL"
echo "  commit      : $COMMIT"
echo "  env bundled : .env.hostinger (panel env still overrides at runtime)"

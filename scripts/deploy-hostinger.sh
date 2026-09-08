#!/usr/bin/env bash
# Compatibility entrypoint. All archive membership and smoke checks belong to pack-deploy.sh.
set -euo pipefail

if [ "$#" -gt 1 ]; then
  echo "Usage: scripts/deploy-hostinger.sh [output.zip|output.tar.gz]" >&2
  exit 2
fi

export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
case "$(node --version)" in
  v24.*) ;;
  *) echo "Node 24 is required before packaging." >&2; exit 1 ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
OUTPUT="${1:-$REPO_ROOT/../Builds/fametc-hostinger-$(date -u +%Y%m%d-%H%M%S).zip}"
mkdir -p "$(dirname "$OUTPUT")"
echo "Legacy entrypoint: delegating to scripts/pack-deploy.sh (package only; no upload)." >&2
exec bash "$REPO_ROOT/scripts/pack-deploy.sh" "$OUTPUT"

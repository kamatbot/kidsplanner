#!/bin/sh
# Post-deploy check: bare fametc.com must serve the passkey association files
# itself (200, no redirect) and 301 everything else to www. If this fails, a
# Hostinger build regenerated public_html: re-upload deploy/hostinger-public_html/
# (see the deploy notes in CLAUDE.md).
fail=0
check() { got=$(curl -s -o /dev/null -w "%{http_code}" "$1"); [ "$got" = "$2" ] && echo "ok   $2 $1" || { echo "FAIL $got (want $2) $1"; fail=1; }; }
check https://fametc.com/.well-known/apple-app-site-association 200
check https://fametc.com/.well-known/assetlinks.json 200
check https://fametc.com/ 301
check https://www.fametc.com/api/health 200
exit $fail

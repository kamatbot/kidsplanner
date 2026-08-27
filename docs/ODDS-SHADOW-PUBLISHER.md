# Odds Core M3 shadow publisher

FamETC remains authoritative and does not consume Odds Core data. The M3 publisher is a separate, operator-invoked process; `server.js` does not import it, schedule it, or call it from a family request. An unavailable Core therefore cannot change a FamETC operation.

The publisher reads only `actions.listForFamily()` and `events.listEvents()`. It sends the counts of open actions and today’s event occurrences for one explicitly selected test family. Titles, notes, member identifiers, calendar content, and local source records never enter its journal or Odds Core.

## Required configuration

Keep publishing disabled in ordinary FamETC deployments:

```text
ODDS_SHADOW_PUBLISH_ENABLED=false
```

For a controlled operator run, configure all of these in the publisher process only:

```text
ODDS_SHADOW_PUBLISH_ENABLED=true
ODDS_SHADOW_FAMILY_ID=<explicit-test-family-id>
ODDS_SHADOW_PERSON_ID=<explicit-test-parent-id>
ODDS_SHADOW_TIME_ZONE=<IANA-time-zone>
ODDS_SHADOW_SUBJECT_KEY=<dedicated-32-plus-character-key>
ODDS_SOURCE_SECRET=<FamETC-specific-Core-signing-secret>
ODDS_CORE_URL=https://oddscore.fametc.com
ODDS_SHADOW_JOURNAL_FILE=/absolute/persistent/path/fametc-odds-shadow.json
```

The shadow-subject key and Core signing secret are different secrets. They are not the FamETC data-encryption, session, OIDC, PathOdds integration, or Hermes keys. Never commit either secret or reuse another product’s values.

## Controlled run

Verify the selected family and persistent journal path, then run under Node 24:

```bash
npm run shadow:publish
```

The command prints a redacted operational status only. Network and Core `5xx` failures remain pending with bounded backoff. A retry reuses the immutable sanitized projection and request ID while refreshing the signature timestamp. Core `4xx` responses become bounded sanitized terminal dead letters for operator review.

Disabling the flag stops future attempts without changing FamETC data. The journal is separate from `db.json`; do not place it inside a deployment bundle or share it with the FamETC datastore.

#!/usr/bin/env node
"use strict";

const { runShadowPublisher } = require("../lib/odds-shadow-publisher");

const config = {
  enabled: process.env.ODDS_SHADOW_PUBLISH_ENABLED === "true",
  familyId: process.env.ODDS_SHADOW_FAMILY_ID,
  personId: process.env.ODDS_SHADOW_PERSON_ID,
  timeZone: process.env.ODDS_SHADOW_TIME_ZONE,
  subjectKey: process.env.ODDS_SHADOW_SUBJECT_KEY,
  sourceSecret: process.env.ODDS_SOURCE_SECRET,
  coreUrl: process.env.ODDS_CORE_URL,
  journalFile: process.env.ODDS_SHADOW_JOURNAL_FILE,
};

runShadowPublisher(config)
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === "configuration-error" || result.status === "failed") process.exitCode = 1;
  })
  .catch(() => {
    process.stdout.write(`${JSON.stringify({ status: "failed", errorCode: "publisher_error" })}\n`);
    process.exitCode = 1;
  });

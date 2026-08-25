"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../lib/db");
const projections = require("../lib/pathodds-projections");

function snapshot(version, readiness = "in-progress") {
  return {
    schemaVersion: "1.0",
    moduleId: "sat.daily-quest",
    subject: "pws_projection_test",
    learnerStateVersion: version,
    generatedAt: new Date().toISOString(),
    staleAfter: new Date(Date.now() + 60_000).toISOString(),
    state: { readiness, localDate: "2026-08-25", answered: version, total: 11 },
    action: { kind: "launch", route: "sat.quest" },
  };
}

test("PathOdds projection never moves backward in source version", () => {
  const root = db.load();
  const previous = root.pathOddsProjections;
  root.pathOddsProjections = {};
  try {
    projections.apply("pws_projection_test", snapshot(10));
    projections.apply("pws_projection_test", snapshot(9));
    assert.equal(projections.get("pws_projection_test").snapshot.learnerStateVersion, 10);
  } finally {
    root.pathOddsProjections = previous || {};
  }
});

test("PathOdds projection freshness is driven by source staleAfter", () => {
  const record = { snapshot: snapshot(11), cachedAt: new Date().toISOString() };
  assert.equal(projections.isFresh(record, Date.now()), true);
  record.snapshot.staleAfter = new Date(Date.now() - 1_000).toISOString();
  assert.equal(projections.isFresh(record, Date.now()), false);
});

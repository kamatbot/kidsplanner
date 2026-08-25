"use strict";

const db = require("./db");

function root() {
  const value = db.load();
  if (!value.pathOddsProjections) value.pathOddsProjections = {};
  return value;
}

function get(pairwiseSubject) {
  const record = root().pathOddsProjections[pairwiseSubject];
  return record ? structuredClone(record) : null;
}

function apply(pairwiseSubject, snapshot) {
  if (!pairwiseSubject || !snapshot || snapshot.moduleId !== "sat.daily-quest") return null;
  const r = root();
  const current = r.pathOddsProjections[pairwiseSubject];
  const nextVersion = Number(snapshot.learnerStateVersion) || 0;
  const currentVersion = current ? Number(current.snapshot && current.snapshot.learnerStateVersion) || 0 : -1;
  if (current && nextVersion < currentVersion) return structuredClone(current);
  const record = {
    pairwiseSubject,
    snapshot,
    cachedAt: new Date().toISOString(),
  };
  r.pathOddsProjections[pairwiseSubject] = record;
  db.persist();
  return structuredClone(record);
}

function remove(pairwiseSubject) {
  const r = root();
  if (!r.pathOddsProjections[pairwiseSubject]) return false;
  delete r.pathOddsProjections[pairwiseSubject];
  db.persist();
  return true;
}

function isFresh(record, now = Date.now()) {
  if (!record || !record.snapshot) return false;
  const staleAfter = Date.parse(record.snapshot.staleAfter || "");
  return Number.isFinite(staleAfter) && staleAfter > now;
}

module.exports = { get, apply, remove, isFresh };

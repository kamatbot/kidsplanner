"use strict";

const crypto = require("crypto");
const db = require("./db");

const EVENT_TYPES = new Set([
  "sat.quest.assigned",
  "sat.quest.progressed",
  "sat.quest.completed",
  "sat.streak.changed",
  "sat.plan.changed",
  "integration.revoked",
]);
const MAX_INBOX_RECORDS = 5000;

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function collections(root) {
  if (!root.pathOddsInbox) root.pathOddsInbox = {};
  if (!root.pathOddsProjections) root.pathOddsProjections = {};
  return { inbox: root.pathOddsInbox, projections: root.pathOddsProjections };
}

function validate(event) {
  if (!event || event.schemaVersion !== "1.0" || typeof event.id !== "string" || event.id.length < 8) return "Invalid event envelope.";
  if (!EVENT_TYPES.has(event.type) || typeof event.subject !== "string" || event.subject.length < 8) return "Invalid event identity.";
  if (!Number.isFinite(Number(event.learnerStateVersion)) || Number(event.learnerStateVersion) < 0) return "Invalid learner state version.";
  if (event.type === "integration.revoked") return null;
  const snapshot = event.data && event.data.snapshot;
  if (!snapshot || snapshot.schemaVersion !== "1.0" || snapshot.moduleId !== "sat.daily-quest") return "Invalid daily quest snapshot.";
  if (snapshot.subject !== event.subject || Number(snapshot.learnerStateVersion) !== Number(event.learnerStateVersion)) return "Snapshot identity/version mismatch.";
  if (!snapshot.state || typeof snapshot.state.readiness !== "string" || typeof snapshot.state.localDate !== "string") return "Invalid daily quest state.";
  return null;
}

function prune(inbox) {
  const records = Object.values(inbox);
  if (records.length <= MAX_INBOX_RECORDS) return;
  records.sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)));
  for (const record of records.slice(0, records.length - MAX_INBOX_RECORDS)) delete inbox[record.eventId];
}

function apply(event, now = Date.now()) {
  const error = validate(event);
  if (error) return { status: "invalid", error };

  const root = db.load();
  const { inbox, projections } = collections(root);
  const serialized = JSON.stringify(event);
  const payloadHash = hash(serialized);
  const existing = inbox[event.id];
  if (existing) {
    if (existing.payloadHash !== payloadHash) return { status: "conflict", error: "An event id was reused with a different payload." };
    return { status: "duplicate", applied: existing.status === "applied", sourceVersion: existing.sourceVersion };
  }

  let status = "ignored";
  if (event.type === "integration.revoked") {
    if (projections[event.subject]) delete projections[event.subject];
    status = "applied";
  } else {
    const snapshot = event.data.snapshot;
    const current = projections[event.subject];
    const incomingVersion = Number(event.learnerStateVersion);
    const currentVersion = current ? Number(current.snapshot && current.snapshot.learnerStateVersion) || 0 : -1;
    if (!current || incomingVersion > currentVersion) {
      projections[event.subject] = {
        pairwiseSubject: event.subject,
        snapshot,
        cachedAt: new Date(now).toISOString(),
        sourceEventId: event.id,
      };
      status = "applied";
    }
  }

  inbox[event.id] = {
    eventId: event.id,
    type: event.type,
    subject: event.subject,
    sourceVersion: Number(event.learnerStateVersion),
    payloadHash,
    status,
    receivedAt: new Date(now).toISOString(),
  };
  prune(inbox);
  db.persist();
  return { status, applied: status === "applied", sourceVersion: Number(event.learnerStateVersion) };
}

function stats() {
  const root = db.load();
  const inbox = collections(root).inbox;
  const records = Object.values(inbox);
  return {
    total: records.length,
    applied: records.filter((record) => record.status === "applied").length,
    ignored: records.filter((record) => record.status === "ignored").length,
  };
}

module.exports = { apply, stats, validate, EVENT_TYPES };

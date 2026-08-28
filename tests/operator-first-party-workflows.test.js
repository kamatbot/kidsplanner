"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-first-party-workflows-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const store = require("../lib/store");
const family = require("../lib/family");
const events = require("../lib/events");
const actions = require("../lib/actions");
const trips = require("../lib/trips");
const operator = require("../lib/operator");
const executionModule = require("../lib/operator-execution");

function fixture(label) {
  const parent = store.createUser(`${label}-${crypto.randomBytes(4).toString("hex")}@example.com`, `${label} Parent`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const kid = family.addKid(fam.id, parent.id, { name: `${label} Kid` }).kid;
  return { parent, fam, kid, actor: { type: "parent", userId: parent.id, principalId: parent.id } };
}

function executeApproved(f, service, actionType, action) {
  let current = operator.createCase(f.fam.id, { actor: f.actor, roomId: "family", title: `Execute ${actionType}`, goal: "Run one approved first-party action." });
  current = operator.transitionCase(f.fam.id, current.id, "planning", { actor: f.actor, roomId: "family" });
  current = operator.transitionCase(f.fam.id, current.id, "proposal_ready", { actor: f.actor, roomId: "family" });
  const approval = operator.requestApproval(f.fam.id, current.id, {
    actor: f.actor, roomId: "family", approverUserId: f.parent.id, actionType, action,
  });
  operator.transitionCase(f.fam.id, current.id, "waiting_for_approval", { actor: f.actor, roomId: "family" });
  const decided = service.decideApproval(f.fam.id, approval.id, { actor: f.actor, decision: "approve", actionHash: approval.actionHash });
  const claimed = service.claimExecution(f.fam.id, approval.id, { actor: f.actor });
  const run = service.runExecution(f.fam.id, claimed.executionToken, approval.actionHash, { actor: f.actor });
  return { current, approval, decided, claimed, run };
}

test("M3 exposes only reversible FamETC-native write drivers", (t) => {
  let Database;
  try { Database = require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 unavailable"); return; }
  const f = fixture("Types");
  const service = executionModule.createOperatorExecution({ Database });
  t.after(() => service.close());
  assert.deepEqual(service.status().supportedActionTypes, [
    "calendar.create", "calendar.update", "action.create", "action.update", "trip.itinerary.update",
  ]);
  assert.throws(
    () => service.validateAction(f.fam.id, "email.send", { to: "x@example.com" }),
    (error) => error.code === "EXECUTION_UNSUPPORTED_ACTION",
  );
});

test("calendar create and update execute exact approved state and produce evidence", (t) => {
  let Database;
  try { Database = require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 unavailable"); return; }
  const f = fixture("Calendar");
  const service = executionModule.createOperatorExecution({ Database });
  t.after(() => service.close());
  const created = executeApproved(f, service, "calendar.create", {
    title: "School fair", date: "2026-10-04", time: "10:00", category: "school", kidId: f.kid.id,
  });
  assert.equal(created.run.result.driver, "calendar.create");
  const event = events.getById(f.fam.id, created.run.result.eventId);
  assert.equal(event.title, "School fair");

  const updated = executeApproved(f, service, "calendar.update", {
    eventId: event.id,
    patch: { time: "11:00", notes: "Confirmed new time" },
  });
  assert.equal(updated.run.result.driver, "calendar.update");
  assert.equal(events.getById(f.fam.id, event.id).time, "11:00");
  assert.equal(events.getById(f.fam.id, event.id).notes, "Confirmed new time");
});

test("family action create and update are approved, scoped and replay-safe", (t) => {
  let Database;
  try { Database = require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 unavailable"); return; }
  const f = fixture("Action");
  const service = executionModule.createOperatorExecution({ Database });
  t.after(() => service.close());
  const created = executeApproved(f, service, "action.create", {
    title: "Pack sports shoes", dueDate: "2026-10-05", assigneeType: "kid", kidId: f.kid.id,
  });
  const item = actions.getById(f.fam.id, created.run.result.actionId);
  assert.equal(item.title, "Pack sports shoes");
  assert.equal(item.kidId, f.kid.id);
  assert.equal(item.sourceId, created.run.execution.id);

  const updated = executeApproved(f, service, "action.update", {
    actionId: item.id,
    patch: { status: "done" },
  });
  assert.equal(updated.run.result.driver, "action.update");
  assert.equal(actions.getById(f.fam.id, item.id).status, "done");
});

test("trip itinerary additions and updates require a writable approving parent", (t) => {
  let Database;
  try { Database = require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 unavailable"); return; }
  const f = fixture("Trip");
  const trip = trips.createTrip(f.parent.id, f.fam.id, { name: "Krabi", destination: "Krabi", startDate: "2026-10-10", endDate: "2026-10-14" }).trip;
  const service = executionModule.createOperatorExecution({ Database });
  t.after(() => service.close());
  const added = executeApproved(f, service, "trip.itinerary.update", {
    tripId: trip.id,
    operation: "add",
    item: { date: "2026-10-11", time: "09:00", title: "Kayaking", category: "activity", note: "Morning slot" },
  });
  assert.equal(added.run.result.operation, "add");
  const item = trips.getItineraryItem(trip, added.run.result.itemId);
  assert.equal(item.title, "Kayaking");

  const updated = executeApproved(f, service, "trip.itinerary.update", {
    tripId: trip.id,
    operation: "update",
    itemId: item.id,
    item: { time: "10:00", note: "Moved later" },
  });
  assert.equal(updated.run.result.operation, "update");
  assert.equal(trips.getItineraryItem(trip, item.id).time, "10:00");
});

test("execution rechecks the deterministic risk registry at runtime", (t) => {
  let Database;
  try { Database = require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 unavailable"); return; }
  const f = fixture("Risk");
  const service = executionModule.createOperatorExecution({ Database });
  t.after(() => service.close());
  assert.throws(
    () => service.validateAction(f.fam.id, "subscription.cancel", { subscriptionId: "s_1" }),
    (error) => error.code === "EXECUTION_UNSUPPORTED_ACTION",
  );
  assert.throws(
    () => service.validateAction(f.fam.id, "payment.create", { cents: 100 }),
    (error) => error.code === "OPERATOR_DUAL_PARENT_REQUIRED",
  );
});

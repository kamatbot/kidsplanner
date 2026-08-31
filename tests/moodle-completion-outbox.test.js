"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-moodle-completion-"));
delete process.env.DATA_ENCRYPTION_KEY;

const db = require("../lib/db");
const store = require("../lib/store");
const family = require("../lib/family");
const homework = require("../lib/homework");

const ORIGIN = "https://bangkok.learn.nae.school";

function makeFamily(label) {
  const parent = store.createUser(`${label}-${Math.random()}@example.com`, `Parent ${label}`);
  const fam = family.createFamily(parent.id, `${label} Family`);
  const { kid } = family.addKid(fam.id, parent.id, { name: `${label} Kid`, grade: "8" });
  return { parent, fam, kid };
}

function moodleIdentity(taskId, userId = "14197") {
  return {
    origin: ORIGIN,
    homeworkViewId: "2",
    userId,
    taskId: String(taskId),
  };
}

function addPortalHomework(fam, kid, taskId, overrides = {}) {
  return homework.addHomework(fam.id, Object.assign({
    kidId: kid.id,
    title: `Moodle task ${taskId}`,
    subject: "Math",
    dueDate: "2026-09-12",
    source: "school-portal",
    moodleIdentity: moodleIdentity(taskId),
  }, overrides)).homework;
}

function recordsFor(familyId) {
  return db.load().moodleCompletionOutbox[familyId];
}

function pendingFor(familyId) {
  return homework.listPendingMoodleCompletions(familyId).completions;
}

test("exact portal identity creates one durable pending generation on the first done transition", () => {
  const { fam, kid } = makeFamily("one-generation");
  const item = addPortalHomework(fam, kid, "1234567");

  assert.deepEqual(item.moodleIdentity, moodleIdentity("1234567"));
  assert.equal(item.sourceUid, "moodle:2:14197:1234567");

  const first = homework.updateHomework(fam.id, item.id, { status: "done" });
  const second = homework.updateHomework(fam.id, item.id, { status: "done" });
  const pending = pendingFor(fam.id);

  assert.equal(first.completionSync.queued, true);
  assert.match(first.completionSync.requestId, /^mcr_[0-9a-f]{24}$/);
  assert.deepEqual(second.completionSync, { queued: false, reason: "already_done" });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].requestId, first.completionSync.requestId);
  assert.equal(pending[0].schemaVersion, 1);
  assert.equal(pending[0].homeworkId, item.id);
  assert.equal(pending[0].kidId, kid.id);
  assert.equal(pending[0].desiredState, "done");
  assert.deepEqual(pending[0].moodle, moodleIdentity("1234567"));
  assert.deepEqual(pending[0].display, {
    title: "Moodle task 1234567",
    subject: "Math",
    dueDate: "2026-09-12",
  });
  assert.ok(pending[0].requestedAt);

  // Public reads are copies; callers cannot mutate the persisted operation.
  pending[0].moodle.taskId = "9999999";
  pending[0].display.title = "Changed outside model";
  const reread = pendingFor(fam.id)[0];
  assert.equal(reread.moodle.taskId, "1234567");
  assert.equal(reread.display.title, "Moodle task 1234567");

  db.flushSync();
  const persisted = JSON.parse(fs.readFileSync(db.DB_FILE, "utf8"));
  assert.equal(persisted.moodleCompletionOutbox[fam.id][reread.requestId].state, "pending");
  assert.equal(persisted.homework[fam.id].find((stored) => stored.id === item.id).status, "done");
});

test("manual, school, ai, and legacy identity-free portal homework never enqueue", () => {
  const { fam, kid } = makeFamily("ineligible");
  for (const source of ["manual", "school", "ai"]) {
    const item = homework.addHomework(fam.id, {
      kidId: kid.id,
      title: `${source} task`,
      dueDate: "2026-09-12",
      source,
      moodleIdentity: moodleIdentity("2000001"),
    }).homework;
    const result = homework.updateHomework(fam.id, item.id, { status: "done" });
    assert.deepEqual(result.completionSync, { queued: false, reason: "not_moodle_homework" });
    assert.equal(item.moodleIdentity, undefined);
    assert.equal(item.sourceUid, null);
  }

  const legacy = homework.addHomework(fam.id, {
    kidId: kid.id,
    title: "Legacy portal task",
    dueDate: "2026-09-12",
    source: "school-portal",
  }).homework;
  const result = homework.updateHomework(fam.id, legacy.id, { status: "done" });
  assert.equal(result.homework.status, "done");
  assert.deepEqual(result.completionSync, { queued: false, reason: "missing_moodle_identity" });
  assert.deepEqual(pendingFor(fam.id), []);
});

test("undo cancels only pending work and re-completion creates a fresh generation", () => {
  const { fam, kid } = makeFamily("recomplete");
  const item = addPortalHomework(fam, kid, "3000001");
  const first = homework.updateHomework(fam.id, item.id, { status: "done" });
  const undone = homework.updateHomework(fam.id, item.id, { status: "todo" });
  const second = homework.updateHomework(fam.id, item.id, { status: "done" });

  assert.deepEqual(undone.completionSync.cancelledRequestIds, [first.completionSync.requestId]);
  assert.notEqual(second.completionSync.requestId, first.completionSync.requestId);
  assert.deepEqual(homework.claimMoodleCompletion(fam.id, first.completionSync.requestId), { completion: null });
  assert.deepEqual(
    homework.acknowledgeMoodleCompletions(fam.id, [first.completionSync.requestId]),
    { acknowledgedRequestIds: [] }
  );
  assert.equal(recordsFor(fam.id)[first.completionSync.requestId].state, "cancelled");
  assert.ok(recordsFor(fam.id)[first.completionSync.requestId].cancelledAt);
  assert.equal(recordsFor(fam.id)[second.completionSync.requestId].state, "pending");
  assert.equal(Object.values(recordsFor(fam.id)).some((record) => record.desiredState !== "done"), false);
});

test("a claimed generation is committed across undo, identity replacement, or deletion", () => {
  const { fam, kid } = makeFamily("claimed-races");

  const undoneItem = addPortalHomework(fam, kid, "3100001");
  const undoneRequest = homework.updateHomework(fam.id, undoneItem.id, { status: "done" }).completionSync.requestId;
  assert.equal(homework.claimMoodleCompletion(fam.id, undoneRequest).completion.requestId, undoneRequest);
  const undone = homework.updateHomework(fam.id, undoneItem.id, { status: "todo" });
  assert.deepEqual(undone.completionSync.cancelledRequestIds, []);
  assert.equal(recordsFor(fam.id)[undoneRequest].state, "dispatching");
  assert.deepEqual(homework.acknowledgeMoodleCompletions(fam.id, [undoneRequest]), {
    acknowledgedRequestIds: [undoneRequest],
  });

  const changedItem = addPortalHomework(fam, kid, "3100002");
  const oldRequest = homework.updateHomework(fam.id, changedItem.id, { status: "done" }).completionSync.requestId;
  homework.claimMoodleCompletion(fam.id, oldRequest);
  const changed = homework.setMoodleIdentity(fam.id, changedItem.id, moodleIdentity("3100003"));
  assert.deepEqual(changed.completionSync.cancelledRequestIds, []);
  assert.notEqual(changed.completionSync.requestId, oldRequest);
  assert.equal(recordsFor(fam.id)[oldRequest].state, "dispatching");
  assert.deepEqual(homework.acknowledgeMoodleCompletions(fam.id, [oldRequest]), {
    acknowledgedRequestIds: [oldRequest],
  });

  const deletedItem = addPortalHomework(fam, kid, "3100004");
  const deletedRequest = homework.updateHomework(fam.id, deletedItem.id, { status: "done" }).completionSync.requestId;
  homework.claimMoodleCompletion(fam.id, deletedRequest);
  homework.removeHomework(fam.id, deletedItem.id);
  assert.equal(recordsFor(fam.id)[deletedRequest].state, "dispatching");
  assert.deepEqual(homework.acknowledgeMoodleCompletions(fam.id, [deletedRequest]), {
    acknowledgedRequestIds: [deletedRequest],
  });
});

test("expired claims recover only while their exact local generation is still current", () => {
  const { fam, kid } = makeFamily("claim-expiry");
  const retryItem = addPortalHomework(fam, kid, "3200001");
  const retryRequest = homework.updateHomework(fam.id, retryItem.id, { status: "done" }).completionSync.requestId;
  homework.claimMoodleCompletion(fam.id, retryRequest);
  recordsFor(fam.id)[retryRequest].claimExpiresAt = "2000-01-01T00:00:00.000Z";

  assert.equal(pendingFor(fam.id)[0].requestId, retryRequest);
  assert.equal(recordsFor(fam.id)[retryRequest].state, "pending");

  const cancelledItem = addPortalHomework(fam, kid, "3200002");
  const cancelledRequest = homework.updateHomework(fam.id, cancelledItem.id, { status: "done" }).completionSync.requestId;
  homework.claimMoodleCompletion(fam.id, cancelledRequest);
  homework.updateHomework(fam.id, cancelledItem.id, { status: "todo" });
  recordsFor(fam.id)[cancelledRequest].claimExpiresAt = "2000-01-01T00:00:00.000Z";

  pendingFor(fam.id);
  assert.equal(recordsFor(fam.id)[cancelledRequest].state, "cancelled");
});

test("pending reads are server-bounded and report additional work", () => {
  const { fam, kid } = makeFamily("pending-bound");
  for (let index = 0; index < 51; index++) {
    const item = addPortalHomework(fam, kid, String(3300000 + index));
    homework.updateHomework(fam.id, item.id, { status: "done" });
  }

  const batch = homework.listPendingMoodleCompletions(fam.id, { limit: 50 });
  assert.equal(batch.completions.length, 50);
  assert.equal(batch.hasMore, true);
  assert.ok(batch.completions.every((item) => item.state === "pending"));
});

test("exact identity backfill queues one already-done legacy row and identical backfill is idempotent", () => {
  const { fam, kid } = makeFamily("backfill");
  const item = homework.addHomework(fam.id, {
    kidId: kid.id,
    title: "Legacy completed task",
    dueDate: "2026-09-12",
    source: "school-portal",
  }).homework;
  homework.updateHomework(fam.id, item.id, { status: "done" });

  const first = homework.setMoodleIdentity(fam.id, item.id, moodleIdentity("4000001"));
  const second = homework.setMoodleIdentity(fam.id, item.id, moodleIdentity("4000001"));

  assert.equal(first.completionSync.queued, true);
  assert.deepEqual(second.completionSync, { queued: false, reason: "identity_unchanged" });
  assert.equal(pendingFor(fam.id).length, 1);
  assert.equal(pendingFor(fam.id)[0].requestId, first.completionSync.requestId);
});

test("identity validation rejects fuzzy, malformed, and overlong task ids without mutating homework", () => {
  const { fam, kid } = makeFamily("identity-validation");
  const item = homework.addHomework(fam.id, {
    kidId: kid.id,
    title: "Legacy task",
    dueDate: "2026-09-12",
    source: "school-portal",
  }).homework;

  for (const invalid of [
    moodleIdentity("Essay|2026-09-12"),
    moodleIdentity("123\n456"),
    moodleIdentity(" 5000001 "),
    moodleIdentity("9".repeat(201)),
    Object.assign(moodleIdentity("5000001"), { userId: "kid-1" }),
    Object.assign(moodleIdentity("5000001"), { userId: "1".repeat(21) }),
    Object.assign(moodleIdentity("5000001"), { origin: "https://evil.example" }),
    Object.assign(moodleIdentity("5000001"), { homeworkViewId: "3" }),
  ]) {
    assert.equal(homework.setMoodleIdentity(fam.id, item.id, invalid).error, "A valid Moodle identity is required.");
  }
  assert.equal(item.moodleIdentity, undefined);
  assert.equal(item.sourceUid, null);

  const badAdd = homework.addHomework(fam.id, {
    kidId: kid.id,
    title: "Bad imported task",
    dueDate: "2026-09-12",
    source: "school-portal",
    moodleIdentity: moodleIdentity("not-numeric"),
  });
  assert.equal(badAdd.error, "A valid Moodle identity is required.");

  const manual = homework.addHomework(fam.id, {
    kidId: kid.id,
    title: "Manual task",
    dueDate: "2026-09-12",
  }).homework;
  assert.match(homework.setMoodleIdentity(fam.id, manual.id, moodleIdentity("5000001")).error, /Only Moodle-imported/);
});

test("changing identity cancels the pending generation and queues a replacement for done homework", () => {
  const { fam, kid } = makeFamily("supersede");
  const item = addPortalHomework(fam, kid, "6000001");
  const first = homework.updateHomework(fam.id, item.id, { status: "done" });
  const changed = homework.setMoodleIdentity(fam.id, item.id, moodleIdentity("6000002"));

  assert.equal(changed.completionSync.queued, true);
  assert.deepEqual(changed.completionSync.cancelledRequestIds, [first.completionSync.requestId]);
  assert.notEqual(changed.completionSync.requestId, first.completionSync.requestId);
  assert.equal(recordsFor(fam.id)[first.completionSync.requestId].state, "cancelled");
  assert.equal(homework.claimMoodleCompletion(fam.id, changed.completionSync.requestId).completion.requestId,
    changed.completionSync.requestId);
  assert.deepEqual(
    homework.acknowledgeMoodleCompletions(fam.id, [first.completionSync.requestId, changed.completionSync.requestId]),
    { acknowledgedRequestIds: [changed.completionSync.requestId] }
  );
});

test("acknowledgement is family-scoped, validates current generation, caps input, and is idempotent", () => {
  const first = makeFamily("ack-first");
  const second = makeFamily("ack-second");
  const firstItem = addPortalHomework(first.fam, first.kid, "7000001");
  const secondItem = addPortalHomework(second.fam, second.kid, "7000002", {
    moodleIdentity: moodleIdentity("7000002", "24298"),
  });
  const firstRequest = homework.updateHomework(first.fam.id, firstItem.id, { status: "done" }).completionSync.requestId;
  const secondRequest = homework.updateHomework(second.fam.id, secondItem.id, { status: "done" }).completionSync.requestId;
  assert.equal(homework.claimMoodleCompletion(first.fam.id, firstRequest).completion.requestId, firstRequest);

  assert.deepEqual(
    homework.acknowledgeMoodleCompletions(first.fam.id, [secondRequest, "unknown", firstRequest]),
    { acknowledgedRequestIds: [firstRequest] }
  );
  assert.deepEqual(
    homework.acknowledgeMoodleCompletions(first.fam.id, [firstRequest]),
    { acknowledgedRequestIds: [firstRequest] }
  );
  const undoneAfterAck = homework.updateHomework(first.fam.id, firstItem.id, { status: "todo" });
  assert.deepEqual(undoneAfterAck.completionSync.cancelledRequestIds, []);
  assert.equal(recordsFor(first.fam.id)[firstRequest].state, "acknowledged");
  assert.deepEqual(
    homework.acknowledgeMoodleCompletions(first.fam.id, [firstRequest]),
    { acknowledgedRequestIds: [firstRequest] }
  );
  assert.equal(pendingFor(second.fam.id)[0].requestId, secondRequest);

  const thirdItem = addPortalHomework(first.fam, first.kid, "7000003");
  const thirdRequest = homework.updateHomework(first.fam.id, thirdItem.id, { status: "done" }).completionSync.requestId;
  assert.deepEqual(
    homework.acknowledgeMoodleCompletions(first.fam.id, Array(100).fill("unknown").concat(thirdRequest)),
    { acknowledgedRequestIds: [] }
  );
  assert.equal(pendingFor(first.fam.id)[0].requestId, thirdRequest);
});

test("a stale current generation cannot be claimed or acknowledged", () => {
  const { fam, kid } = makeFamily("stale-current");
  const item = addPortalHomework(fam, kid, "8000001");
  const requestId = homework.updateHomework(fam.id, item.id, { status: "done" }).completionSync.requestId;

  // Simulate a stale/corrupt generation without using the supported setter,
  // which would proactively cancel it. The atomic claim gate still defends
  // the irreversible-write boundary.
  homework.getById(fam.id, item.id).moodleIdentity = moodleIdentity("8000002");
  assert.deepEqual(homework.claimMoodleCompletion(fam.id, requestId), { completion: null });
  assert.deepEqual(
    homework.acknowledgeMoodleCompletions(fam.id, [requestId]),
    { acknowledgedRequestIds: [] }
  );
  assert.equal(recordsFor(fam.id)[requestId].state, "cancelled");
});

test("removing homework cancels its pending generation before deletion", () => {
  const { fam, kid } = makeFamily("delete");
  const item = addPortalHomework(fam, kid, "9000001");
  const requestId = homework.updateHomework(fam.id, item.id, { status: "done" }).completionSync.requestId;

  assert.deepEqual(homework.removeHomework(fam.id, item.id), { ok: true });
  assert.equal(homework.getById(fam.id, item.id), null);
  assert.deepEqual(pendingFor(fam.id), []);
  assert.equal(recordsFor(fam.id)[requestId].state, "cancelled");
  assert.deepEqual(
    homework.acknowledgeMoodleCompletions(fam.id, [requestId]),
    { acknowledgedRequestIds: [] }
  );
});

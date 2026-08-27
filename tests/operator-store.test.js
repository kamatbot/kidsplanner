"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-operator-root-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const datacrypto = require("../lib/datacrypto");
datacrypto._resetKeyCache();
const {
  createOperatorStore,
  OperatorStorageUnavailableError,
  OperatorValidationError,
} = require("../lib/operator-store");

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-operator-"));
  return { dir, file: path.join(dir, "operator.sqlite") };
}

function loadSqliteOrSkip(t) {
  try {
    return require("better-sqlite3");
  } catch (error) {
    t.skip("better-sqlite3 is optional on this host");
    return null;
  }
}

test("Operator store fails closed when transactional SQLite is unavailable", () => {
  function BrokenDatabase() {
    throw new Error("sqlite unavailable");
  }
  const store = createOperatorStore({ dbFile: tempDb().file, Database: BrokenDatabase });
  assert.deepEqual(store.status(), {
    available: false,
    backend: "sqlite",
    fallback: false,
    errorCode: "OPERATOR_STORAGE_UNAVAILABLE",
  });
  assert.throws(
    () => store.createCase({ familyId: "f_1", title: "x", goal: "y" }),
    (error) => error instanceof OperatorStorageUnavailableError && error.code === "OPERATOR_STORAGE_UNAVAILABLE",
  );
});

test("Operator store fails closed when payload encryption is unavailable", () => {
  const savedKey = process.env.DATA_ENCRYPTION_KEY;
  delete process.env.DATA_ENCRYPTION_KEY;
  datacrypto._resetKeyCache();
  try {
    const store = createOperatorStore({ dbFile: tempDb().file, Database: function UnusedDatabase() {} });
    assert.deepEqual(store.status(), {
      available: false,
      backend: "sqlite",
      fallback: false,
      errorCode: "OPERATOR_STORAGE_UNAVAILABLE",
    });
    assert.throws(
      () => store.createCase({ familyId: "f_1", title: "x", goal: "y" }),
      (error) => error instanceof OperatorStorageUnavailableError,
    );
  } finally {
    process.env.DATA_ENCRYPTION_KEY = savedKey;
    datacrypto._resetKeyCache();
  }
});

test("Operator cases are durable, family scoped, encrypted and audited", (t) => {
  const Database = loadSqliteOrSkip(t);
  if (!Database) return;
  const { file } = tempDb();
  const store = createOperatorStore({ dbFile: file, Database });
  t.after(() => store.close());

  const created = store.createCase({
    familyId: "f_alpha",
    actorId: "u_parent",
    actorType: "parent",
    roomId: "family",
    title: "Cancel the forgotten subscription",
    goal: "Find the old subscription and prepare a safe cancellation.",
    riskLevel: "medium",
    budgetCents: 0,
    context: { source: "family-chat", purpose: "subscription-cancellation" },
  });

  assert.match(created.id, /^case_[0-9a-f]{24}$/);
  assert.equal(created.familyId, "f_alpha");
  assert.equal(created.state, "draft");
  assert.equal(created.title, "Cancel the forgotten subscription");
  assert.deepEqual(created.context, { source: "family-chat", purpose: "subscription-cancellation" });
  assert.deepEqual(created.steps, []);
  assert.deepEqual(created.approvals, []);

  assert.equal(store.getCase("f_other", created.id), null);
  assert.deepEqual(store.listCases("f_other"), []);
  assert.equal(store.listCases("f_alpha").length, 1);

  const raw = fs.readFileSync(file);
  assert.equal(raw.includes(Buffer.from("Cancel the forgotten subscription", "utf8")), false);
  assert.equal(raw.includes(Buffer.from("subscription-cancellation", "utf8")), false);

  const audit = store.listAudit("f_alpha", { caseId: created.id });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].eventType, "case.created");
  assert.equal(audit[0].actorId, "u_parent");
});

test("Operator steps, state transitions and approvals remain tied to the owning family", (t) => {
  const Database = loadSqliteOrSkip(t);
  if (!Database) return;
  const { file } = tempDb();
  const store = createOperatorStore({ dbFile: file, Database });
  t.after(() => store.close());

  const op = store.createCase({ familyId: "f_one", title: "Book tour", goal: "Book the tour", riskLevel: "low" });
  const step = store.addStep("f_one", op.id, {
    kind: "research",
    input: { query: "available tour times" },
    idempotencyKey: "research:tour-times",
    actorId: "hermes",
  });
  assert.equal(step.position, 0);
  assert.equal(step.state, "pending");
  const retriedStep = store.addStep("f_one", op.id, {
    kind: "research",
    input: { query: "available tour times" },
    idempotencyKey: "research:tour-times",
    actorId: "hermes",
  });
  assert.equal(retriedStep.id, step.id);
  assert.equal(store.listSteps("f_one", op.id).length, 1);
  assert.equal(store.addStep("f_two", op.id, { kind: "should-not-work" }), null);
  assert.deepEqual(store.listSteps("f_two", op.id), []);

  const planning = store.updateCaseState("f_one", op.id, "planning", { actorId: "hermes" });
  assert.equal(planning.state, "planning");
  assert.equal(store.updateCaseState("f_two", op.id, "completed"), null);

  const firstApproval = store.requestApproval("f_one", op.id, {
    requestedBy: "hermes",
    approverUserId: "u_parent",
    actionType: "booking.create",
    action: { date: "2026-09-10", amountCents: 2500, vendor: "Example Tours" },
    expiresAt: "2026-09-01T12:00:00.000Z",
  });
  const secondApproval = store.requestApproval("f_one", op.id, {
    requestedBy: "hermes",
    approverUserId: "u_parent",
    actionType: "booking.create",
    action: { vendor: "Example Tours", amountCents: 2500, date: "2026-09-10" },
  });
  assert.equal(firstApproval.actionHash, secondApproval.actionHash, "approval hash must use canonical action JSON");
  assert.equal(firstApproval.state, "pending");
  assert.equal(store.requestApproval("f_two", op.id, {
    actionType: "booking.create",
    action: { vendor: "Nope" },
  }), null);

  const hydrated = store.getCase("f_one", op.id, { includeChildren: true });
  assert.equal(hydrated.steps.length, 1);
  assert.equal(hydrated.approvals.length, 2);
  assert.equal(hydrated.approvals[0].action.vendor, "Example Tours");

  const events = store.listAudit("f_one", { caseId: op.id });
  assert.deepEqual(new Set(events.map((event) => event.eventType)), new Set([
    "case.created",
    "case.step_added",
    "case.state_changed",
    "approval.requested",
  ]));
});

test("Operator store rejects invalid structural values before persisting", (t) => {
  const Database = loadSqliteOrSkip(t);
  if (!Database) return;
  const { file } = tempDb();
  const store = createOperatorStore({ dbFile: file, Database });
  t.after(() => store.close());

  assert.throws(
    () => store.createCase({ familyId: "f_one", title: "x", goal: "y", riskLevel: "unbounded" }),
    OperatorValidationError,
  );
  assert.throws(
    () => store.createCase({ familyId: "f_one", title: "", goal: "y" }),
    OperatorValidationError,
  );
});

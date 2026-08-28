"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-beta-production-boundary-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.NODE_ENV = "production";
process.env.OPERATOR_BETA_ENFORCE = "0";

const datacrypto = require("../lib/datacrypto");
datacrypto._resetKeyCache();
const store = require("../lib/store");
const family = require("../lib/family");
const operator = require("../lib/operator");
const rawExecution = require("../lib/operator-execution");
const liveExecution = require("../lib/operator-live-execution");
const operatorBeta = require("../lib/operator-beta");

test("production cannot opt an unenrolled family into live execution", (t) => {
  try { require("better-sqlite3"); } catch (error) { t.skip("better-sqlite3 is optional on this host"); return; }

  const parent = store.createUser("production-boundary@example.com", "Production Boundary Parent");
  const fam = family.createFamily(parent.id, "Unenrolled Production Family");
  const actor = { type: "parent", userId: parent.id, principalId: parent.id };
  let current = operator.createCase(fam.id, { actor, roomId: "family", title: "Boundary test", goal: "Remain blocked until enrollment." });
  current = operator.transitionCase(fam.id, current.id, "planning", { actor, roomId: "family" });
  current = operator.transitionCase(fam.id, current.id, "proposal_ready", { actor, roomId: "family" });
  const approval = operator.requestApproval(fam.id, current.id, {
    actor,
    roomId: "family",
    approverUserId: parent.id,
    actionType: "calendar.create",
    action: { title: "Must not execute", date: "2026-10-20", time: "16:00", category: "other", repeat: "none" },
  });
  operator.transitionCase(fam.id, current.id, "waiting_for_approval", { actor, roomId: "family" });
  rawExecution.decideApproval(fam.id, approval.id, { actor, decision: "approve", actionHash: approval.actionHash });

  assert.equal(operatorBeta.statusForFamily(fam.id).config.configured, false);
  assert.throws(
    () => liveExecution.claimExecution(fam.id, approval.id, { actor, executorType: "hermes" }),
    (error) => error.code === "OPERATOR_BETA_NOT_ENROLLED",
  );
});

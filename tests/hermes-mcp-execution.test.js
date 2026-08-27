"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-hermes-mcp-exec-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const datacrypto = require("../lib/datacrypto");
datacrypto._resetKeyCache();
const store = require("../lib/store");
const family = require("../lib/family");
const events = require("../lib/events");
const hermes = require("../lib/hermes");
const actorCapabilities = require("../lib/operator-capabilities");
const operatorStore = require("../lib/operator-store");
const hermesMcp = require("../lib/hermes-mcp");

function invoke(auth, name, args, id = 1) {
  const req = {
    body: {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args || {} },
    },
    headers: {},
    get() { return ""; },
  };
  const res = {
    statusCode: 200,
    body: null,
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
  hermesMcp.handle(req, res, auth);
  return res.body.result;
}

function issueActor(auth, actor, messageId) {
  return actorCapabilities.issue({
    family: auth.family,
    connection: auth.connection,
    actor,
    messageId: messageId || "m_exec",
    roomId: "family",
  });
}

test("MCP requires explicit parent approval before running the exact stored calendar action", (t) => {
  try {
    require("better-sqlite3");
  } catch (error) {
    t.skip("better-sqlite3 is optional on this host");
    return;
  }

  const parent = store.createUser("mcp-exec-parent@example.com", "Execution Parent");
  const fam = family.createFamily(parent.id, "Execution Family");
  const { kid } = family.addKid(fam.id, parent.id, { name: "Taylor" });
  const connected = hermes.connectFamily(fam.id);
  const auth = hermes.familyForToken(connected.token);
  assert.ok(auth);

  const parentToken = issueActor(auth, {
    type: "parent",
    userId: parent.id,
    principalId: parent.id,
  }, "m_parent_request");

  const created = invoke(auth, "fametc_cases_create", {
    actorToken: parentToken,
    title: "Add confirmed tour to calendar",
    goal: "Put the confirmed tour on the family calendar after approval.",
    purpose: "tour-booking",
    riskLevel: "medium",
  });
  assert.equal(created.isError, false);
  const caseId = created.structuredContent.id;

  for (const state of ["planning", "proposal_ready"]) {
    const moved = invoke(auth, "fametc_cases_transition", {
      actorToken: parentToken,
      caseId,
      state,
    });
    assert.equal(moved.isError, false);
  }

  const action = {
    title: "Amazon fulfillment center tour",
    date: "2026-09-12",
    time: "10:00",
    endTime: "11:30",
    notes: "Confirmation held pending parent approval",
    category: "social",
    repeat: "none",
  };
  const requested = invoke(auth, "fametc_approvals_request", {
    actorToken: parentToken,
    caseId,
    approverUserId: parent.id,
    actionType: "calendar.create",
    action,
  });
  assert.equal(requested.isError, false);
  const approval = requested.structuredContent;
  assert.equal(operatorStore.getCase(fam.id, caseId).state, "waiting_for_approval");

  const kidToken = issueActor(auth, {
    type: "kid",
    principalId: kid.id,
    kidId: kid.id,
    userId: parent.id,
  }, "m_kid_approve");
  const kidDecision = invoke(auth, "fametc_approvals_decide", {
    actorToken: kidToken,
    approvalId: approval.id,
    decision: "approve",
    actionHash: approval.actionHash,
  });
  assert.equal(kidDecision.isError, true);
  assert.equal(kidDecision.structuredContent.error.code, "APPROVAL_PARENT_REQUIRED");

  // A fresh parent message supplies the authority used for decision + execution.
  const approvalTurnToken = issueActor(auth, {
    type: "parent",
    userId: parent.id,
    principalId: parent.id,
  }, "m_parent_approve");
  const decided = invoke(auth, "fametc_approvals_decide", {
    actorToken: approvalTurnToken,
    approvalId: approval.id,
    decision: "approve",
    actionHash: approval.actionHash,
  });
  assert.equal(decided.isError, false);
  assert.equal(decided.structuredContent.approval.state, "approved");
  assert.equal(operatorStore.getCase(fam.id, caseId).state, "executing");

  const claimed = invoke(auth, "fametc_execution_claim", {
    actorToken: approvalTurnToken,
    approvalId: approval.id,
  });
  assert.equal(claimed.isError, false);
  assert.deepEqual(claimed.structuredContent.action, action);
  assert.equal(claimed.structuredContent.actionHash, approval.actionHash);
  assert.match(claimed.structuredContent.executionToken, /^oprun1\./);

  const run = invoke(auth, "fametc_execution_run", {
    actorToken: approvalTurnToken,
    executionToken: claimed.structuredContent.executionToken,
    actionHash: approval.actionHash,
  });
  assert.equal(run.isError, false);
  assert.equal(run.structuredContent.execution.state, "consumed");
  assert.equal(run.structuredContent.result.driver, "calendar.create");
  assert.equal(operatorStore.getCase(fam.id, caseId).state, "verifying");

  const grantId = run.structuredContent.execution.id;
  const calendarEvent = events.getBySource(fam.id, "operator", grantId);
  assert.ok(calendarEvent);
  assert.equal(calendarEvent.title, action.title);
  assert.equal(calendarEvent.date, action.date);

  const replay = invoke(auth, "fametc_execution_run", {
    actorToken: approvalTurnToken,
    executionToken: claimed.structuredContent.executionToken,
    actionHash: approval.actionHash,
  });
  assert.equal(replay.isError, true);
  assert.equal(replay.structuredContent.error.code, "EXECUTION_TOKEN_INVALID");
});

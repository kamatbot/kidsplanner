"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const benchmark = require("../lib/operator-benchmark");

test("Operator benchmark contains exactly 50 tasks across all closeout categories", () => {
  const validation = benchmark.validateCorpus();
  assert.equal(validation.tasks, 50);
  assert.deepEqual(validation.categories, {
    "research-only": 8,
    "calendar-action": 10,
    "trip-planning": 8,
    "subscription-cancellation": 6,
    "form-filling": 6,
    "appointment-research": 6,
    "document-structured": 6,
  });
});

test("benchmark scorer covers all seven required dimensions", () => {
  assert.deepEqual(benchmark.DIMENSIONS, [
    "correctPlan",
    "correctContext",
    "unnecessaryQuestions",
    "approvalCorrectness",
    "completion",
    "hallucinationFree",
    "safeAction",
  ]);
  const result = benchmark.scoreObservation("op-001", {
    planCorrect: true,
    contextSections: ["identities", "preferences", "calendar"],
    clarifyingQuestions: 0,
    approvals: [],
    actions: [],
    completionMode: "research",
    hallucinations: [],
    unsafeActions: [],
    behaviors: [],
  });
  assert.equal(result.score, 100);
  assert.equal(result.passed, true);
});

test("benchmark penalizes missing context, extra questions, bad approvals, hallucination and unsafe actions", () => {
  const result = benchmark.scoreObservation("op-009", {
    planCorrect: true,
    contextSections: ["identities"],
    clarifyingQuestions: 2,
    approvals: [{ policy: "none", actionType: "calendar.create", actionHash: "0".repeat(64) }],
    actions: [{ actionType: "calendar.create", executed: true, approved: false, actionHash: "0".repeat(64) }],
    completionMode: "write",
    hallucinations: ["invented appointment date"],
    unsafeActions: ["unapproved write"],
    behaviors: ["invent-missing-data"],
  });
  assert.equal(result.dimensions.correctPlan, 1);
  assert.equal(result.dimensions.correctContext, 0);
  assert.equal(result.dimensions.unnecessaryQuestions, 0);
  assert.equal(result.dimensions.approvalCorrectness, 0);
  assert.equal(result.dimensions.completion, 1);
  assert.equal(result.dimensions.hallucinationFree, 0);
  assert.equal(result.dimensions.safeAction, 0);
  assert.equal(result.passed, false);
});

test("benchmark requires exact approval hashes for executable tasks", () => {
  const actionHash = "a".repeat(64);
  const result = benchmark.scoreObservation("op-009", {
    planCorrect: true,
    contextSections: ["identities", "calendar"],
    clarifyingQuestions: 0,
    approvals: [{ policy: "single-parent", actionType: "calendar.create", actionHash }],
    actions: [{ actionType: "calendar.create", executed: true, approved: true, actionHash }],
    completionMode: "write",
    hallucinations: [],
    unsafeActions: [],
    behaviors: [],
  });
  assert.equal(result.score, 100);
});

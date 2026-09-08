"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../public/js/child-progress.js"), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  const calls = [];
  const saved = {};
  const listeners = {};
  const context = { sessionUser: { id: "u", role: "kid", kidId: "k" }, currentFamily: { id: "f" }, isoDate: date => { assert.equal(typeof date?.getFullYear, 'function'); return "2026-09-08"; } };
  context.isKidSession = () => context.sessionUser?.role === "kid";
  context.window = { addEventListener: (name, fn) => { listeners[name] = fn; }, auth: {
    async getDaily5Progress() { return { parts: saved }; },
    async reportDaily5Progress(body) { calls.push(JSON.parse(JSON.stringify(body))); saved[body.part] = { status: body.status }; },
  } };
  vm.runInNewContext(source, context);
  return { context, calls, saved, listeners, reporter: context.window.famChildProgress };
}

test("parent sessions do not report and payload contains only progress", async () => {
  const { context, calls, reporter } = setup();
  context.sessionUser.role = "parent";
  await reporter.report("word", "completed");
  assert.deepEqual(calls, []);
  context.sessionUser.role = "kid";
  await reporter.report("word", "completed");
  assert.deepEqual(calls, [{ date: "2026-09-08", part: "word", status: "completed" }]);
});

test("completion survives ordinary starts while explicit puzzle reset retracts", async () => {
  const { calls, saved, reporter } = setup();
  saved.news = { status: "completed" };
  await reporter.report("news", "started");
  await reporter.report("puzzle", "completed");
  await reporter.report("puzzle", "started");
  await reporter.report("puzzle", "started", { reset: true });
  assert.deepEqual(calls.map(call => call.status), ["completed", "started"]);
});

test("in-flight completion serializes reset and discards queued work on account switch", async () => {
  const { context, calls, reporter } = setup();
  let release;
  context.window.auth.reportDaily5Progress = async body => {
    calls.push(body.status);
    await new Promise(resolve => { release = resolve; });
  };
  const first = reporter.report("puzzle", "completed");
  await reporter.report("puzzle", "started", { reset: true });
  assert.deepEqual(calls, ["completed"]);
  context.sessionUser = { id: "other", role: "kid", kidId: "other-kid" };
  release();
  await first;
  assert.deepEqual(calls, ["completed"]);
});

test("reset dispatch waits for completion and clear discards an in-flight read", async () => {
  const { context, calls, reporter } = setup();
  let release;
  context.window.auth.reportDaily5Progress = async body => {
    calls.push(body.status);
    if (body.status === "completed") await new Promise(resolve => { release = resolve; });
  };
  const first = reporter.report("puzzle", "completed");
  await reporter.report("puzzle", "started", { reset: true });
  await reporter.report("puzzle", "started");
  release();
  await first;
  assert.deepEqual(calls, ["completed", "started"]);
  context.window.auth.getDaily5Progress = () => new Promise(resolve => { release = resolve; });
  const reading = reporter.report("news", "started");
  reporter.clear();
  release({ parts: {} });
  await reading;
  assert.deepEqual(calls, ["completed", "started"]);
});

test("failure retries on next report or online without leaking old scope", async () => {
  const { context, calls, listeners, reporter } = setup();
  let fail = true;
  context.window.auth.reportDaily5Progress = async body => {
    if (fail) throw new Error("offline");
    calls.push(body.part);
  };
  await reporter.report("word", "completed");
  fail = false;
  await reporter.report("news", "completed");
  assert.deepEqual(calls, ["word", "news"]);
  fail = true;
  await reporter.report("bt", "completed");
  fail = false;
  listeners.online();
  await tick();
  assert.deepEqual(calls, ["word", "news", "bt"]);
  fail = true;
  await reporter.report("quote", "completed");
  context.currentFamily = { id: "other-family" };
  fail = false;
  listeners.online();
  await tick();
  assert.deepEqual(calls, ["word", "news", "bt"]);
});

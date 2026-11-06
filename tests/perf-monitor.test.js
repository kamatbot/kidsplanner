"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const perfMonitor = require("../lib/perf-monitor");

test("perf monitor reports event-loop maxima after a blocking stretch", async () => {
  perfMonitor.start();
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const until = Date.now() + 120;
    while (Date.now() < until) { /* block the loop */ }
    await new Promise((resolve) => setTimeout(resolve, 60));
    perfMonitor.sample();
    const status = perfMonitor.status();
    assert.ok(status.maxMsLast10s >= 100, `expected >=100ms lag, got ${status.maxMsLast10s}`);
    assert.equal(status.maxMsLast5m, status.maxMsLast10s);
  } finally {
    perfMonitor.stop();
  }
  assert.deepEqual(perfMonitor.status(), { maxMsLast10s: null, maxMsLast5m: null, p99MsLast10s: null });
});

test("slow request logger skips long-polls and logs only slow requests", () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    const makeRes = () => { const handlers = {}; return { statusCode: 200, on: (e, fn) => { handlers[e] = fn; }, fire: () => handlers.finish && handlers.finish() }; };
    let nextCalls = 0;
    const poll = makeRes();
    perfMonitor.slowRequestLogger({ method: "GET", path: "/api/chat/messages", query: { wait: "1" } }, poll, () => nextCalls++);
    poll.fire();
    const fast = makeRes();
    perfMonitor.slowRequestLogger({ method: "POST", path: "/api/chat/messages", query: {} }, fast, () => nextCalls++);
    fast.fire();
    assert.equal(nextCalls, 2);
    assert.deepEqual(warnings, []);
  } finally {
    console.warn = original;
  }
});

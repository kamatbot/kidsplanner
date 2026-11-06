"use strict";

/**
 * Lightweight production timing so slow responses can be attributed to either
 * a blocked Node event loop (our code) or the hosting proxy (nothing shows here).
 * - Event-loop delay is sampled with perf_hooks and kept as per-10s maxima for 5 min.
 * - Requests slower than SLOW_REQUEST_MS (long-polls excluded) are logged by route.
 */
const { monitorEventLoopDelay } = require("perf_hooks");

const WINDOW_MS = 10_000;
const WINDOWS = 30; // 5 minutes
const LAG_WARN_MS = 1000;
const SLOW_REQUEST_MS = 2000;

let histogram = null;
let timer = null;
const recent = []; // [{ at, maxMs, p99Ms }]

function ms(ns) { return Math.round(ns / 1e6); }

function sample() {
  if (!histogram) return;
  const maxMs = ms(histogram.max);
  const p99Ms = ms(histogram.percentile(99));
  histogram.reset();
  recent.push({ at: Date.now(), maxMs, p99Ms });
  while (recent.length > WINDOWS) recent.shift();
  if (maxMs >= LAG_WARN_MS) console.warn(`[perf] event loop blocked up to ${maxMs}ms in the last ${WINDOW_MS / 1000}s`);
}

function start() {
  if (histogram) return;
  histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  timer = setInterval(sample, WINDOW_MS);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  if (histogram) histogram.disable();
  timer = null; histogram = null; recent.length = 0;
}

function status() {
  const last = recent[recent.length - 1] || null;
  return {
    maxMsLast10s: last ? last.maxMs : null,
    maxMsLast5m: recent.length ? Math.max(...recent.map((r) => r.maxMs)) : null,
    p99MsLast10s: last ? last.p99Ms : null,
  };
}

// Express middleware: log slow non-long-poll requests by path (never the query,
// which can carry cursors) so a stall can be tied to a route.
function slowRequestLogger(req, res, next) {
  if (req.query && req.query.wait) return next();
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    if (elapsed >= SLOW_REQUEST_MS) {
      console.warn(`[perf] slow ${req.method} ${req.path} ${res.statusCode} ${Math.round(elapsed)}ms`);
    }
  });
  next();
}

module.exports = { start, stop, status, slowRequestLogger, sample, SLOW_REQUEST_MS };

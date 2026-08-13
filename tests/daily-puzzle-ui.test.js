"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const authSource = fs.readFileSync(require.resolve("../public/js/auth.js"), "utf8");
const appSource = fs.readFileSync(require.resolve("../public/js/app.js"), "utf8");
const htmlSource = fs.readFileSync(require.resolve("../public/index.html"), "utf8");

test("daily-puzzle auth wrapper sends the encoded local date", async () => {
  const calls = [];
  const payload = { date: "2026-08-15", available: true, type: "crossword" };
  const sandbox = {
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => payload };
    },
    window: {},
  };
  vm.runInNewContext(authSource, sandbox, { filename: "auth.js" });
  assert.deepEqual(await sandbox.window.auth.getDailyPuzzle("2026-08-15"), payload);
  assert.equal(calls[0].url, "/api/enrichment/puzzle/today?date=2026-08-15");
  assert.equal(calls[0].options.method, "GET");
});

test("dashboard includes one hidden, gated puzzle surface with accessible status and actions", () => {
  assert.equal((htmlSource.match(/id="widget-puzzle"/g) || []).length, 1);
  assert.match(htmlSource, /id="puzzle-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(htmlSource, /onclick="clearDailyPuzzle\(\)"/);
  assert.match(htmlSource, /onclick="checkDailyPuzzle\(\)"/);
  assert.match(appSource, /loadDailyPuzzle\(now\)/);
  assert.match(appSource, /result\.type === 'crossword'/);
  assert.match(appSource, /result\.type === 'sudoku'/);
  assert.match(appSource, /data-solution=/);
  assert.match(appSource, /'lock-puzzle'/);
});

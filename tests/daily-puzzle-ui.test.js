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

test("dashboard includes one hidden, always-accessible puzzle surface with status and actions", () => {
  assert.equal((htmlSource.match(/id="widget-puzzle"/g) || []).length, 1);
  assert.match(htmlSource, /id="puzzle-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(htmlSource, /onclick="clearDailyPuzzle\(\)"/);
  assert.match(htmlSource, /onclick="checkDailyPuzzle\(\)"/);
  assert.match(appSource, /loadDailyPuzzle\(now\)/);
  assert.match(appSource, /result\.type === 'crossword'/);
  assert.match(appSource, /result\.type === 'sudoku'/);
  assert.match(appSource, /data-solution=/);
  assert.match(appSource, /wireCrosswordTyping\(crossword, grid, clues\)/);
  assert.match(appSource, /input\.addEventListener\('input'/);
  assert.match(appSource, /focusCell\(entry, index \+ 1\)/);
  assert.match(appSource, /event\.key === 'Backspace'/);
  assert.match(appSource, /event\.inputType === 'insertFromPaste'/);
  assert.match(appSource, /class="crossword-clue"/);
  assert.match(appSource, /aria-pressed/);
  assert.doesNotMatch(appSource, /'lock-puzzle'|applyEnrichmentGating/);
});

test("crossword typing follows the selected clue, supports paste, and backs up", () => {
  const behaviorSource = appSource.slice(
    appSource.indexOf("function crosswordEntryCells"),
    appSource.indexOf("function clearDailyPuzzle"),
  );
  const focused = { input: null };
  const makeClassList = () => ({ toggle() {}, remove() {} });
  const makeControl = (dataset = {}) => ({
    dataset,
    value: "",
    classList: makeClassList(),
    listeners: {},
    attributes: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    setAttribute(name, value) { this.attributes[name] = value; },
    focus() { focused.input = this; this.listeners.focus?.({}); },
  });
  const inputs = [0, 1, 2].map((col) => makeControl({ row: "0", col: String(col) }));
  const clue = makeControl({ entryId: "1-across" });
  const grid = { querySelectorAll: () => inputs };
  const clues = { querySelectorAll: () => [clue] };
  const sandbox = {};
  vm.runInNewContext(behaviorSource, sandbox, { filename: "crossword-behavior.js" });
  sandbox.wireCrosswordTyping({ entries: [{ number: 1, direction: "across", answer: "CAT", row: 0, col: 0 }] }, grid, clues);

  clue.listeners.click();
  assert.equal(focused.input, inputs[0]);
  inputs[0].value = "c";
  inputs[0].listeners.input({ inputType: "insertText" });
  assert.equal(inputs[0].value, "C");
  assert.equal(focused.input, inputs[1]);

  inputs[1].value = "at";
  inputs[1].listeners.input({ inputType: "insertFromPaste" });
  assert.deepEqual(inputs.map((input) => input.value), ["C", "A", "T"]);
  assert.equal(focused.input, inputs[2]);

  inputs[2].value = "";
  let prevented = false;
  inputs[2].listeners.keydown({ key: "Backspace", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(focused.input, inputs[1]);
  assert.equal(inputs[1].value, "");
});

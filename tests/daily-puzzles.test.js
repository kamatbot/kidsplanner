"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const puzzles = require("../lib/daily-puzzles");
const { WORDS } = require("../lib/sat-words");

test("Wednesday serves one stable solvable Sudoku", () => {
  const first = puzzles.getDailyPuzzle("2026-08-12");
  const second = puzzles.getDailyPuzzle("2026-08-12");
  assert.deepEqual(second, first);
  assert.equal(first.type, "sudoku");
  assert.equal(first.sudoku.puzzle.length, 81);
  assert.equal(first.sudoku.solution.length, 81);
  for (let index = 0; index < 81; index++) {
    if (first.sudoku.puzzle[index] !== "0") assert.equal(first.sudoku.puzzle[index], first.sudoku.solution[index]);
  }
});

test("Saturday and Sunday serve deterministic crosswords containing exactly ten valid entries", () => {
  for (const date of ["2026-08-15", "2026-08-16"]) {
    const result = puzzles.getDailyPuzzle(date);
    assert.equal(result.type, "crossword");
    assert.match(result.instructions, /type the whole answer/i);
    assert.equal(result.crossword.entries.length, 10);
    assert.equal(new Set(result.crossword.entries.map((entry) => entry.answer)).size, 10);
    for (const entry of result.crossword.entries) {
      const dr = entry.direction === "down" ? 1 : 0;
      const dc = entry.direction === "across" ? 1 : 0;
      const answer = [...entry.answer].map((_, index) => result.crossword.solution[entry.row + dr * index][entry.col + dc * index]).join("");
      assert.equal(answer, entry.answer);
      assert.ok(entry.clue.length > 10);
    }
  }
});

test("the weekend crossword uses the seven consecutive day-of-year SAT words", () => {
  const date = new Date("2026-08-15T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() - 5);
  const expected = [];
  for (let offset = 0; offset < 7; offset++) {
    const current = new Date(date.getTime());
    current.setUTCDate(current.getUTCDate() + offset);
    const start = Date.UTC(current.getUTCFullYear(), 0, 1);
    const ordinal = Math.floor((current.getTime() - start) / (24 * 60 * 60 * 1000)) + 1;
    expected.push(WORDS[(ordinal - 1) % WORDS.length].word.toUpperCase());
  }
  const result = puzzles.getDailyPuzzle("2026-08-15");
  assert.deepEqual(result.crossword.entries.map((entry) => entry.answer).filter((answer) => expected.includes(answer)).sort(), expected.slice().sort());
  assert.deepEqual(puzzles.weeklySatWords(new Date("2026-08-15T00:00:00.000Z")), expected.map((word) => [word, WORDS.find((item) => item.word.toUpperCase() === word).def]));
});

test("a buildable same-week news fixture supplies three masked, attributed entries on both weekend days", () => {
  const items = [
    { id: "health", headline: "Healing Coral", answer: "HEALING", publishedAt: "2026-08-10T12:00:00Z" },
    { id: "tech", headline: "Robot Builders", answer: "ROBOT", publishedAt: "2026-08-11T12:00:00Z" },
    { id: "nature", headline: "Ocean Tides", answer: "OCEAN", publishedAt: "2026-08-12T12:00:00Z" },
    { id: "later", headline: "Outside Week", answer: "OUTSIDE", publishedAt: "2026-08-17T12:00:00Z" },
  ];
  const saturday = puzzles.getDailyPuzzle("2026-08-15", items);
  const sunday = puzzles.getDailyPuzzle("2026-08-16", items);
  assert.deepEqual(sunday.crossword, saturday.crossword);
  for (const answer of ["HEALING", "ROBOT", "OCEAN"]) {
    const entry = saturday.crossword.entries.find((candidate) => candidate.answer === answer);
    assert.ok(entry);
    assert.match(entry.clue, /Science News Explores/);
    assert.equal(entry.clue.includes(answer), false);
  }
  assert.equal(saturday.crossword.entries.some((entry) => entry.answer === "OUTSIDE"), false);
});

test("the current weekend crossword stays compact and identifies SAT word clues", () => {
  const newsItems = [
    { id: "cyclops", headline: "The Cyclops may be an ancient myth, but one-eyed creatures are real", answer: "CYCLOPS", publishedAt: "2026-08-24T12:00:00Z" },
    { id: "cosmic", headline: "This cosmic oddity blurs the line between planet and moon", answer: "COSMIC", publishedAt: "2026-08-25T12:00:00Z" },
    { id: "meet", headline: "Meet the world’s biggest waves — and the mysteries behind them", answer: "MEET", publishedAt: "2026-08-26T12:00:00Z" },
  ];
  const startedAt = Date.now();
  const first = puzzles.getDailyPuzzle("2026-08-30", newsItems);
  const second = puzzles.getDailyPuzzle("2026-08-30", newsItems);
  const crossword = first.crossword;

  assert.ok(Date.now() - startedAt < 2000);
  assert.deepEqual(second, first);
  assert.equal(crossword.entries.length, 10);
  assert.ok(Math.max(crossword.rows, crossword.cols) <= 14);
  assert.deepEqual(new Set(crossword.entries.map((entry) => entry.answer)), new Set([
    "TRANSIENT", "CYCLOPS", "ELOQUENT", "COSMIC", "PLACID",
    "CREDIBLE", "MEET", "WARY", "ENIGMATIC", "PERSEVERE",
  ]));
  const occupied = new Set();
  crossword.solution.forEach((row, rowIndex) => [...row].forEach((cell, colIndex) => {
    if (cell !== ".") occupied.add(`${rowIndex},${colIndex}`);
  }));
  const seen = new Set();
  const pending = [occupied.values().next().value];
  while (pending.length) {
    const cell = pending.pop();
    if (seen.has(cell)) continue;
    seen.add(cell);
    const [row, col] = cell.split(",").map(Number);
    for (const neighbor of [`${row - 1},${col}`, `${row + 1},${col}`, `${row},${col - 1}`, `${row},${col + 1}`]) {
      if (occupied.has(neighbor) && !seen.has(neighbor)) pending.push(neighbor);
    }
  }
  assert.equal(seen.size, occupied.size);
  const coverage = new Map();
  for (const entry of crossword.entries) {
    const dr = entry.direction === "down" ? 1 : 0;
    const dc = entry.direction === "across" ? 1 : 0;
    const answer = [...entry.answer].map((_, index) => {
      const row = entry.row + dr * index;
      const col = entry.col + dc * index;
      const cell = `${row},${col}`;
      coverage.set(cell, (coverage.get(cell) || 0) + 1);
      return crossword.solution[row][col];
    }).join("");
    assert.equal(answer, entry.answer);
  }
  assert.ok([...coverage.values()].filter((count) => count > 1).length >= crossword.entries.length + 1);

  for (const [answer] of puzzles.weeklySatWords(new Date("2026-08-30T00:00:00Z"))) {
    const entry = crossword.entries.find((candidate) => candidate.answer === answer);
    assert.ok(entry);
    assert.match(entry.clue, /This week's SAT word \(\d+ letters\):/);
    assert.equal(entry.clue.includes(answer), false);
  }
});

test("invalid or unbuildable news candidates never displace the weekly SAT fallback", () => {
  const result = puzzles.getDailyPuzzle("2026-08-15", [
    { id: "bad", headline: "Qzxwv", answer: "QZXWV", publishedAt: "2026-08-12T12:00:00Z" },
    { id: "stop", headline: "This Week", answer: "THIS", publishedAt: "2026-08-12T12:00:00Z" },
  ]);
  assert.equal(result.crossword.entries.length, 10);
  assert.equal(result.crossword.entries.some((entry) => entry.answer === "QZXWV"), false);
  assert.equal(result.crossword.entries.filter((entry) => WORDS.some((word) => word.word.toUpperCase() === entry.answer)).length, 7);
});

test("other weekdays have no puzzle and malformed dates are rejected", () => {
  assert.deepEqual(puzzles.getDailyPuzzle("2026-08-13"), { date: "2026-08-13", available: false, type: null });
  assert.deepEqual(puzzles.getDailyPuzzle("2026-02-30"), { error: "Use a real date in YYYY-MM-DD format." });
  assert.deepEqual(puzzles.getDailyPuzzle("not-a-date"), { error: "Use a real date in YYYY-MM-DD format." });
});

test("all crossword themes build with ten words", () => {
  for (const theme of puzzles.CROSSWORD_SETS) {
    assert.equal(puzzles.buildCrossword(theme).entries.length, 10);
  }
});

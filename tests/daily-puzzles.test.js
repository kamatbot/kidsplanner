"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const puzzles = require("../lib/daily-puzzles");

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

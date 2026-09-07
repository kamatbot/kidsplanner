"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const puzzles = require("../lib/daily-puzzles");
const { DAILY_WORDS: WORDS } = require("../lib/sat-words");

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

test("Saturday and Sunday serve deterministic crosswords containing exactly seven valid entries", () => {
  for (const date of ["2026-08-15", "2026-08-16"]) {
    const result = puzzles.getDailyPuzzle(date);
    assert.equal(result.type, "crossword");
    assert.match(result.instructions, /type the whole answer/i);
    assert.equal(result.crossword.entries.length, 7);
    assert.equal(new Set(result.crossword.entries.map((entry) => entry.answer)).size, 7);
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

test("weekend crossword ignores news content", () => {
  for (const date of ["2026-08-15", "2026-08-16"]) {
    const items = [{ headline: "Healing Coral", answer: "HEALING", source: "WHO", url: "https://www.who.int/news/story", publishedAt: "2026-08-12T12:00:00Z" }];
    assert.deepEqual(puzzles.getDailyPuzzle(date, items), puzzles.getDailyPuzzle(date));
  }
});

test('Tuesday can include a story from the previous week within the rolling seven days', () => {
  const result = puzzles.getDailyPuzzle('2026-08-11', [{ headline: 'Healing Coral', answer: 'HEALING', source: 'WHO', url: 'https://www.who.int/news/story', publishedAt: '2026-08-09T12:00:00Z' }]);
  assert.ok(result.crossword.entries.some((entry) => entry.source === 'WHO'));
});

test("the current weekend crossword stays compact and identifies SAT word clues", () => {
  const newsItems = [
    { id: "cyclops", headline: "The Cyclops may be an ancient myth, but one-eyed creatures are real", answer: "CYCLOPS", publishedAt: "2026-08-24T12:00:00Z" },
    { id: "cosmic", headline: "This cosmic oddity blurs the line between planet and moon", answer: "COSMIC", publishedAt: "2026-08-25T12:00:00Z" },
    { id: "meet", headline: "Meet the world’s biggest waves — and the mysteries behind them", answer: "MEET", publishedAt: "2026-08-26T12:00:00Z" },
  ].map((item) => ({ ...item, source: 'BBC', url: `https://www.bbc.com/news/${item.id}` }));
  const first = puzzles.getDailyPuzzle("2026-08-30", newsItems);
  const second = puzzles.getDailyPuzzle("2026-08-30", newsItems);
  const crossword = first.crossword;

  assert.deepEqual(second, first);
  assert.equal(crossword.entries.length, 7);
  assert.ok(Math.max(crossword.rows, crossword.cols) <= 14);
  assert.deepEqual(new Set(crossword.entries.map((entry) => entry.answer)), new Set([
    "TRANSIENT", "ELOQUENT", "PLACID",
    "CREDIBLE", "WARY", "ENIGMATIC", "PERSEVERE",
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
  assert.ok([...coverage.values()].filter((count) => count > 1).length >= crossword.entries.length - 1);

  for (const [answer] of puzzles.weeklySatWords(new Date("2026-08-30T00:00:00Z"))) {
    const entry = crossword.entries.find((candidate) => candidate.answer === answer);
    assert.ok(entry);
    assert.equal(entry.clue, WORDS.find((word) => word.word.toUpperCase() === answer).def);
    assert.equal(entry.clue.includes(answer), false);
  }
});

test("invalid or unbuildable news candidates never displace the weekly SAT fallback", () => {
  const result = puzzles.getDailyPuzzle("2026-08-15", [
    { id: "bad", headline: "Qzxwv", answer: "QZXWV", publishedAt: "2026-08-12T12:00:00Z" },
    { id: "stop", headline: "This Week", answer: "THIS", publishedAt: "2026-08-12T12:00:00Z" },
  ]);
  assert.equal(result.crossword.entries.length, 7);
  assert.equal(result.crossword.entries.some((entry) => entry.answer === "QZXWV"), false);
  assert.equal(result.crossword.entries.filter((entry) => WORDS.some((word) => word.word.toUpperCase() === entry.answer)).length, 7);
});

test("malformed dates are rejected", () => {
  assert.deepEqual(puzzles.getDailyPuzzle("2026-02-30"), { error: "Use a real date in YYYY-MM-DD format." });
  assert.deepEqual(puzzles.getDailyPuzzle("not-a-date"), { error: "Use a real date in YYYY-MM-DD format." });
});

test('every day has a stable puzzle and fourteen Sudoku days have different valid boards', () => {
  const boards = new Set();
  for (let offset = 0; boards.size < 14 && offset < 33; offset++) {
    const date = new Date(Date.UTC(2026, 8, 7 + offset)).toISOString().slice(0, 10);
    const first = puzzles.getDailyPuzzle(date);
    assert.equal(first.available, true);
    assert.deepEqual(puzzles.getDailyPuzzle(date), first);
    if (first.type !== 'sudoku') {
      assert.equal(first.crossword.entries.length, [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) ? 7 : 10);
      continue;
    }
    const { puzzle, solution } = first.sudoku;
    assert.ok(!boards.has(puzzle));
    boards.add(puzzle);
    for (let i = 0; i < 9; i++) {
      const row = [], col = [], box = [];
      for (let j = 0; j < 9; j++) {
        row.push(solution[i * 9 + j]);
        col.push(solution[j * 9 + i]);
        box.push(solution[(Math.floor(i / 3) * 3 + Math.floor(j / 3)) * 9 + (i % 3) * 3 + j % 3]);
      }
      for (const unit of [row, col, box]) assert.equal(unit.sort().join(''), '123456789');
    }
    for (let i = 0; i < 81; i++) if (puzzle[i] !== '0') assert.equal(puzzle[i], solution[i]);
  }
  assert.equal(boards.size, 14);
});

test('stale, future, unsafe and unattributed news use the honest static fallback', () => {
  const date = '2026-08-15';
  const base = { headline: 'Healing Coral', answer: 'HEALING', source: 'WHO', url: 'https://www.who.int/news/story', publishedAt: '2026-08-12T12:00:00Z' };
  for (const change of [{ publishedAt: '2026-08-08T23:59:59Z' }, { publishedAt: '2026-08-16T00:00:00Z' }, { url: 'http://www.who.int/story' }, { source: '' }]) {
    assert.deepEqual(puzzles.getDailyPuzzle(date, [{ ...base, ...change }]), puzzles.getDailyPuzzle(date));
  }
  assert.ok(puzzles.getDailyPuzzle(date).crossword.entries.every((entry) => !entry.source && !/recent story/.test(entry.clue)));
});

test("all crossword themes build with ten words", () => {
  for (const theme of puzzles.CROSSWORD_SETS) {
    assert.equal(puzzles.buildCrossword(theme).entries.length, 10);
  }
});

test("all weekend pools remain complete and definition-only across leap and year boundaries", () => {
  const { getDailyVocabulary } = require("../lib/vocabulary-challenges");
  for (let offset = 0; offset < 800; offset++) {
    const day = new Date(Date.UTC(2024, 0, 1 + offset));
    if (![0, 6].includes(day.getUTCDay())) continue;
    const date = day.toISOString().slice(0, 10);
    const result = puzzles.getDailyPuzzle(date);
    assert.equal(result.available, true, date);
    const expected = getDailyVocabulary(date).weekWords;
    assert.equal(result.crossword.entries.length, 7);
    assert.deepEqual(new Set(result.crossword.entries.map((entry) => entry.answer)), new Set(expected.map((word) => word.word.toUpperCase())));
    for (const entry of result.crossword.entries) assert.equal(entry.clue, expected.find((word) => word.word.toUpperCase() === entry.answer).def);
  }
});

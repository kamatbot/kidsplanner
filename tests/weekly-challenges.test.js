"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const puzzles = require("../lib/daily-puzzles");

const safeNews = [{ source: "NASA", headline: "NASA tests a Rocket engine", url: "https://www.nasa.gov/news/test", publishedAt: "2026-09-24T00:00:00Z" }];

function assertSudoku({ puzzle, solution }) {
  for (let i = 0; i < 9; i++) {
    const row = [], col = [], box = [];
    for (let j = 0; j < 9; j++) {
      row.push(solution[i * 9 + j]); col.push(solution[j * 9 + i]);
      box.push(solution[(Math.floor(i / 3) * 3 + Math.floor(j / 3)) * 9 + (i % 3) * 3 + j % 3]);
    }
    for (const unit of [row, col, box]) assert.equal(unit.sort().join(""), "123456789");
  }
  for (let i = 0; i < 81; i++) if (puzzle[i] !== "0") assert.equal(puzzle[i], solution[i]);
}

test("scheduled puzzles begin at the cutover and leave prior contracts intact", () => {
  assert.equal(puzzles.getDailyPuzzle("2026-09-20").type, "crossword");
  assert.equal(puzzles.getDailyPuzzle("2026-09-21").type, "brainteaser");
  assert.equal(puzzles.getDailyPuzzle("2026-09-22").available, false);
  const wed = puzzles.getDailyPuzzle("2026-09-23");
  assert.equal(wed.type, "sudoku"); assertSudoku(wed.sudoku);
  assert.equal(typeof wed.mentalMath.answer, "string");
  assert.match(wed.mentalMath.explanation, /25|ending in 5/i);
});

test("Thursday sources rotate through four consecutive dated primary-data questions", () => {
  const seen = new Set();
  for (const date of ["2026-09-24", "2026-10-01", "2026-10-08", "2026-10-15"]) {
    const result = puzzles.getDailyPuzzle(date);
    assert.equal(result.type, "news-analysis");
    const { chart, question } = result;
    assert.ok(chart.values.length >= 2 && chart.values.every(Number.isFinite));
    assert.equal(chart.labels.length, chart.values.length);
    assert.match(chart.source.url, /^https:\/\/www\.nasa\.gov\//);
    assert.ok(Number.isFinite(Date.parse(chart.source.publishedAt)));
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options).size, 4);
    assert.ok(question.answerIndex >= 0 && question.answerIndex < 4);
    assert.equal(question.explanations.length, 4);
    seen.add(question.id);
    const answer = question.options[question.answerIndex];
    if (/Crew-8/.test(chart.title)) assert.equal(answer, `${chart.values[0] - chart.values[1]} days`);
    if (/DART/.test(chart.title)) assert.equal(answer, `${(chart.values[0] - chart.values[1]) * 60} minutes`);
    if (/budget/.test(chart.title)) assert.equal(answer, `$${chart.values[1] - chart.values[0]} billion`);
    if (/ISS/.test(chart.title)) assert.equal(answer, `${chart.values[0] - chart.values[1]} spacecraft`);
  }
  assert.equal(seen.size, 4);
});

test("Friday SAT practice is original, varied, and explains every distractor", () => {
  const seen = new Set();
  for (const date of ["2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16"]) {
    const { question, type } = puzzles.getDailyPuzzle(date);
    assert.equal(type, "sat"); seen.add(question.id);
    assert.equal(question.options.length, 4); assert.equal(new Set(question.options).size, 4);
    assert.ok(question.answerIndex >= 0 && question.answerIndex < 4);
    assert.equal(question.explanations.length, 4);
    assert.match(question.attribution, /Original SAT-style practice; not a College Board question\./);
  }
  assert.equal(seen.size, 4);
});

function assertConnected(crossword) {
  const occupied = new Set();
  crossword.solution.forEach((row, r) => [...row].forEach((cell, c) => { if (cell !== ".") occupied.add(`${r},${c}`); }));
  const seen = new Set([occupied.values().next().value]);
  for (const cell of seen) {
    const [r, c] = cell.split(",").map(Number);
    for (const neighbor of [`${r - 1},${c}`, `${r + 1},${c}`, `${r},${c - 1}`, `${r},${c + 1}`]) if (occupied.has(neighbor)) seen.add(neighbor);
  }
  assert.equal(seen.size, occupied.size);
}

test("weekend crossword tries supplied news and trivia across all 28 root weeks", () => {
  for (let week = 0; week < 28; week++) {
    const date = new Date(Date.UTC(2026, 8, 26 + week * 7)).toISOString().slice(0, 10);
    const publishedAt = new Date(Date.UTC(2026, 8, 24 + week * 7)).toISOString();
    const news = [{ source: "Science Desk", headline: "Kelp forests support coastal habitats", answer: "KELP", url: `https://example.org/news/${week}`, publishedAt }];
    const result = puzzles.getDailyPuzzle(date, news);
    assert.equal(result.available, true, date);
    assert.equal(result.crossword.entries.length, 7);
    assert.ok(result.crossword.entries.some((entry) => entry.answer === "KELP" && entry.source === "Science Desk"));
    assert.equal(new Set(result.crossword.entries.map((entry) => entry.answer)).size, 7);
    assertConnected(result.crossword);
  }
});

test("weekend crossword is deterministic and honestly falls back without qualifying news", () => {
  for (const date of ["2026-09-26", "2026-09-27"]) {
    const withNews = puzzles.getDailyPuzzle(date, safeNews);
    assert.deepEqual(puzzles.getDailyPuzzle(date, safeNews), withNews);
    assert.equal(withNews.type, "crossword"); assert.equal(withNews.crossword.entries.length, 7);
    assert.ok(withNews.crossword.entries.some((entry) => entry.source === "NASA"));
    const roots = puzzles.weeklySatWords(new Date(`${date}T00:00:00Z`)).map(([word]) => word);
    assert.ok(withNews.crossword.entries.filter((entry) => roots.includes(entry.answer)).length >= 5);
    const fallback = puzzles.getDailyPuzzle(date, []);
    assert.match(fallback.instructions, /News unavailable; vocabulary and trivia edition/);
    assert.equal(fallback.crossword.entries.some((entry) => entry.source), false);
  }
  assert.equal(puzzles.getDailyPuzzle("2027-01-02", safeNews).crossword.entries.some((entry) => entry.source), false);
  const invalidAnswer = [{ ...safeNews[0], answer: "NASA" }];
  const result = puzzles.getDailyPuzzle("2026-09-26", invalidAnswer);
  assert.match(result.instructions, /News unavailable; vocabulary and trivia edition/);
});

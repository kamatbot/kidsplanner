"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { getDailyVocabulary, ROTATION_START } = require("../lib/vocabulary-challenges");
const { DAILY_WORDS, LEGACY_DAILY_WORDS, WORDS } = require("../lib/sat-words");
const puzzles = require("../lib/daily-puzzles");
const DAY_MS = 86400000;
const start = Date.parse(`${ROTATION_START}T00:00:00Z`);
const dateText = (time) => new Date(time).toISOString().slice(0, 10);

function legacyWord(time) {
  const date = new Date(time);
  const ordinal = Math.floor((time - Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY_MS);
  return LEGACY_DAILY_WORDS[ordinal % LEGACY_DAILY_WORDS.length];
}

test("every post-cutover day excludes words seen in the previous six calendar months, including legacy exposure", () => {
  const seen = new Map();
  // Exercise over three full years, including Feb 29, year changes and wraps.
  for (let time = start - 186 * DAY_MS; time < Date.UTC(2030, 0, 1); time += DAY_MS) {
    const word = getDailyVocabulary(dateText(time)).word.word;
    if (time >= start && seen.has(word)) {
      const earliestRepeat = new Date(seen.get(word));
      earliestRepeat.setUTCMonth(earliestRepeat.getUTCMonth() + 6);
      assert.ok(time > earliestRepeat.getTime(), `${word} repeats too soon on ${dateText(time)}`);
    }
    seen.set(word, time);
  }
});

test("the 241-day calendar has unique complete lessons and cycles continuously", () => {
  assert.equal(DAILY_WORDS.length, 241);
  assert.equal(new Set(DAILY_WORDS.map(({ word }) => word.toLowerCase())).size, 241);
  assert.equal(WORDS.length, DAILY_WORDS.length);
  const answerPositions = new Set();
  for (let i = 0; i < DAILY_WORDS.length; i++) {
    const time = start + i * DAY_MS;
    const result = getDailyVocabulary(dateText(time));
    assert.deepEqual(result.word, DAILY_WORDS[i]);
    assert.deepEqual(getDailyVocabulary(dateText(time)), result);
    assert.deepEqual(getDailyVocabulary(dateText(time + DAILY_WORDS.length * DAY_MS)).word, result.word);
    const { options, answerIndex } = result.challenge;
    assert.equal(options.length, 3);
    assert.equal(new Set(options.map(({ text }) => text)).size, 3);
    assert.ok(answerIndex >= 0 && answerIndex <= 2);
    answerPositions.add(answerIndex);
    for (const { text, explanation } of options) {
      assert.ok(text.toLowerCase().includes(result.word.word.toLowerCase()), result.word.word);
      assert.ok(explanation.length > 20);
    }
    assert.ok(WORDS.filter(({ pos, word }) => pos === result.word.pos && word !== result.word.word).length >= 3);
  }
  assert.deepEqual(answerPositions, new Set([0, 1, 2]));
  assert.equal(getDailyVocabulary("2028-02-29").date, "2028-02-29");
  assert.notEqual(getDailyVocabulary("2028-02-28").word.word, getDailyVocabulary("2028-03-01").word.word);
});

test("cutover keeps today's lesson and the issued transition-week crossword stable", () => {
  assert.deepEqual(getDailyVocabulary("2026-09-12").word, legacyWord(start - DAY_MS));
  assert.equal(getDailyVocabulary("2026-09-13").word.word, "Analyze");
  const monday = Date.UTC(2026, 8, 7);
  const expected = Array.from({ length: 7 }, (_, i) => legacyWord(monday + i * DAY_MS));
  for (let i = 0; i < 7; i++) {
    assert.deepEqual(getDailyVocabulary(dateText(monday + i * DAY_MS)).weekWords, expected);
  }
  const sunday = puzzles.getDailyPuzzle("2026-09-13");
  assert.equal(sunday.available, true);
  assert.deepEqual(new Set(sunday.crossword.entries.map(({ answer }) => answer)), new Set(expected.map(({ word }) => word.toUpperCase())));
  // More than six months of entirely new daily words before any legacy return.
  for (let i = 0; i < 211; i++) assert.ok(!LEGACY_DAILY_WORDS.some(({ word }) => word === getDailyVocabulary(dateText(start + i * DAY_MS)).word.word));
});

test("all new weekly pools agree with daily lessons across leap days, years and rotation wrap", () => {
  for (let time = Date.UTC(2026, 8, 14); time < Date.UTC(2029, 0, 1); time += 7 * DAY_MS) {
    const first = getDailyVocabulary(dateText(time));
    assert.equal(first.weekStart, dateText(time));
    assert.equal(new Set(first.weekWords.map(({ word }) => word)).size, 7);
    for (let i = 0; i < 7; i++) {
      const daily = getDailyVocabulary(dateText(time + i * DAY_MS));
      assert.deepEqual(daily.weekWords, first.weekWords);
      assert.deepEqual(daily.word, first.weekWords[i]);
    }
  }
});

test("new weekend crosswords retain all seven meanings and correct reveal letters", () => {
  for (const date of ["2026-09-19", "2026-09-20", "2027-01-02", "2027-05-15", "2028-03-04"]) {
    const result = puzzles.getDailyPuzzle(date);
    const expected = getDailyVocabulary(date).weekWords;
    assert.equal(result.available, true, date);
    assert.equal(result.crossword.entries.length, 7);
    for (const word of expected) {
      const entry = result.crossword.entries.find(({ answer }) => answer === word.word.toUpperCase());
      assert.ok(entry, `${date}: ${word.word}`);
      assert.equal(entry.clue, word.def);
      const revealed = [...entry.answer].map((_, index) => result.crossword.solution[entry.row + (entry.direction === "down" ? index : 0)][entry.col + (entry.direction === "across" ? index : 0)]).join("");
      assert.equal(revealed, entry.answer);
    }
  }
});

test("authored verb, noun and adjective impostors contradict meaning while retaining grammatical category", () => {
  for (const [word, pos, incorrect] of [
    ["Analyze", "verb", "refusing to examine"],
    ["Integrity", "noun", "deliberate cheating"],
    ["Abundant", "adjective", "only one drop"],
  ]) {
    const index = DAILY_WORDS.findIndex((item) => item.word === word);
    const result = getDailyVocabulary(dateText(start + index * DAY_MS));
    assert.equal(result.word.pos, pos);
    assert.ok(result.challenge.options[result.challenge.answerIndex].text.includes(incorrect));
    assert.match(result.challenge.options[result.challenge.answerIndex].explanation, /contradicts the meaning/);
  }
});

test("every possible seven-word rotation grouping builds a complete weekend crossword", () => {
  // 241 and 7 are coprime: 241 consecutive Saturdays exercise every possible
  // starting word, not just the first year's alignment with the calendar.
  const firstSaturday = Date.UTC(2026, 8, 19);
  for (let week = 0; week < DAILY_WORDS.length; week++) {
    const date = dateText(firstSaturday + week * 7 * DAY_MS);
    const result = puzzles.getDailyPuzzle(date);
    assert.equal(result.available, true, date);
    const expected = getDailyVocabulary(date).weekWords;
    assert.deepEqual(new Set(result.crossword.entries.map(({ answer }) => answer)), new Set(expected.map(({ word }) => word.toUpperCase())), date);
  }
});

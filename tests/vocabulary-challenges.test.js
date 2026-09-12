"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { getDailyVocabulary } = require("../lib/vocabulary-challenges");
const { LEGACY_DAILY_WORDS } = require("../lib/sat-words");

test("all thirty words have three unique authored contexts and attached explanations", () => {
  const positions = new Set();
  for (let i = 0; i < 30; i++) {
    const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    const result = getDailyVocabulary(date);
    assert.deepEqual(result.word, LEGACY_DAILY_WORDS[i]);
    assert.deepEqual(getDailyVocabulary(date), result);
    assert.equal(result.challenge.options.length, 3);
    assert.equal(new Set(result.challenge.options.map((option) => option.text)).size, 3);
    assert.ok(Number.isInteger(result.challenge.answerIndex));
    assert.ok(result.challenge.answerIndex >= 0 && result.challenge.answerIndex < 3);
    positions.add(result.challenge.answerIndex);
    for (const option of result.challenge.options) {
      assert.ok(option.text.toLowerCase().includes(result.word.word.toLowerCase()));
      assert.ok(option.explanation.length > 20);
    }
  }
  assert.deepEqual(positions, new Set([0, 1, 2]));
});

test("Monday-Sunday pool follows daily words across year and leap boundaries", () => {
  for (const start of ["2026-12-28", "2024-02-26", "2025-12-29", "2026-09-14"]) {
    const pool = getDailyVocabulary(start).weekWords;
    for (let i = 0; i < 7; i++) {
      const date = new Date(`${start}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + i);
      const result = getDailyVocabulary(date.toISOString().slice(0, 10));
      assert.equal(result.weekStart, start);
      assert.deepEqual(result.weekWords, pool);
      assert.deepEqual(result.word, pool[i]);
    }
  }
  assert.notEqual(getDailyVocabulary("2027-01-01").word.word, getDailyVocabulary("2026-12-31").word.word);
  assert.equal(getDailyVocabulary("2024-03-01").word.word, "Eloquent");
});

test("invalid dates are rejected and returned content is isolated", () => {
  for (const date of [null, {}, "2026-02-29", "2026-02-30", "2026-2-01", "2026-01-01T00:00:00Z"]) {
    assert.deepEqual(getDailyVocabulary(date), { error: "Use a real date in YYYY-MM-DD format." });
  }
  const result = getDailyVocabulary("2026-01-01");
  result.word.word = "Changed";
  result.weekWords[0].word = "Changed";
  result.challenge.options[0].text = "Changed";
  assert.equal(getDailyVocabulary("2026-01-01").word.word, "Eloquent");
  assert.notEqual(getDailyVocabulary("2026-01-01").challenge.options[0].text, "Changed");
});

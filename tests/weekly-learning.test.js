"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ROOT_WORDS, getWeeklyLearning, getWeeklyContexts } = require("../lib/weekly-learning");
const { getDailyVocabulary } = require("../lib/vocabulary-challenges");
const { LEGACY_DAILY_WORDS } = require("../lib/sat-words");

test("weekly learning aligns Monday through Sunday across the next year", () => {
  for (const monday of ["2026-09-21", "2026-12-28", "2027-01-04"]) {
    const first = getWeeklyLearning(monday);
    assert.equal(first.weekStart, monday);
    assert.equal(first.weekWords.length, 7);
    for (let day = 0; day < 7; day++) {
      const date = new Date(`${monday}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + day);
      const learning = getWeeklyLearning(date.toISOString().slice(0, 10));
      assert.equal(learning.weekStart, monday);
      assert.deepEqual(learning.weekWords, first.weekWords);
      assert.deepEqual(learning.word, first.weekWords[day]);
    }
  }
  assert.equal(getWeeklyLearning("2026-09-20"), null);
});

test("twenty-eight root families provide 196 distinct weekly words", () => {
  assert.equal(ROOT_WORDS.length, 28);
  const words = ROOT_WORDS.flatMap((root) => root.words.map(({ word }) => word.toLowerCase()));
  assert.equal(words.length, 196);
  assert.equal(new Set(words).size, 196);
  for (const root of ROOT_WORDS) {
    assert.equal(root.words.length, 7);
    assert.ok(root.form && root.meaning && root.origin);
  }
});

test("weekday lessons contain real root distinctions and original theme quotes", () => {
  const monday = "2026-09-21";
  const first = getWeeklyLearning(monday);
  assert.deepEqual(getWeeklyLearning(monday), first);
  assert.equal(first.lesson.title, "Mother Root & Anchor Word");
  const tuesday = getWeeklyLearning("2026-09-22");
  assert.equal(tuesday.lesson.title, "Tone & Connotation Meter");
  assert.ok(tuesday.lesson.grammar);
  assert.match(tuesday.lesson.explanation, /neutral|positive|negative/i);
  assert.match(tuesday.lesson.grammar.explanation, /Correct:.*Incorrect:/);
  assert.equal(getWeeklyLearning("2026-09-23").lesson.title, "Synonym Spectrum & Splitter");
  assert.match(getWeeklyLearning("2026-09-23").lesson.explanation, /inspect.*observe.*scrutinize/i);
  assert.equal(getWeeklyLearning("2026-09-24").lesson.title, "Antonym & Prefix Inversion");
  assert.match(getWeeklyLearning("2026-09-24").lesson.explanation, /Neither turns.*simple opposite/i);
  assert.equal(getWeeklyLearning("2026-09-25").lesson.title, "High-Register Academic Rare Word");
  assert.deepEqual(getWeeklyLearning("2026-09-25").lesson.examples, ["Formal: The team wrote a retrospective on the trial.", "Everyday: The team looked back at the trial."]);
  const quotes = Array.from({ length: 7 }, (_, day) => getWeeklyLearning(new Date(Date.UTC(2026, 8, 21 + day)).toISOString().slice(0, 10)).quote);
  assert.equal(new Set(quotes.map(({ text }) => text)).size, 7);
  for (const quote of quotes) assert.deepEqual({ author: quote.author, theme: quote.theme, weekStart: quote.weekStart }, { author: "Fam ETC", theme: "integrity", weekStart: monday });
});

test("weekly daily vocabulary has authored contexts, while historical dates stay unchanged", () => {
  for (let day = 0; day < 196; day++) {
    const date = new Date(Date.UTC(2026, 8, 21 + day)).toISOString().slice(0, 10);
    const result = getDailyVocabulary(date);
    assert.equal(result.challenge.options.length, 3);
    assert.equal(new Set(result.challenge.options.map(({ text }) => text)).size, 3);
    assert.ok(result.challenge.answerIndex >= 0 && result.challenge.answerIndex < 3);
    assert.ok(result.challenge.options[result.challenge.answerIndex].explanation.length > 30);
    assert.ok(result.challenge.options.every(({ text, explanation }) => text.length > 35 && explanation.length > 25));
    assert.ok(!result.challenge.options.some(({ text }) => /The team will .*task calls for/i.test(text)));
    assert.deepEqual(result.weekWords, getWeeklyLearning(date).weekWords);
    assert.ok(result.theme && result.root && result.quote && result.lesson);
  }
  assert.deepEqual(getDailyVocabulary("2026-01-01").word, LEGACY_DAILY_WORDS[0]);
  assert.equal(getDailyVocabulary("2026-09-20").theme, undefined);
});

test("Friday words are formal or less-common, and sensitive legal examples stay out", () => {
  const fridays = ROOT_WORDS.map((root) => root.words[4].word);
  assert.deepEqual(fridays.slice(0, 8), ["Retrospective", "Portage", "Superstructure", "Circumscribe", "Incredulous", "Benediction", "Protract", "Omission"]);
  const allWords = ROOT_WORDS.flatMap((root) => root.words.map(({ word }) => word));
  assert.ok(!allWords.includes("Deport"));
  assert.ok(!allWords.includes("Indict"));
  assert.ok(!allWords.includes("Remit"));
});


test("every root supplies substantive weekday contrasts and separate authored contexts", () => {
  for (let week = 0; week < ROOT_WORDS.length; week++) {
    const lessons = Array.from({ length: 7 }, (_, day) => getWeeklyLearning(new Date(Date.UTC(2026, 8, 21 + week * 7 + day)).toISOString().slice(0, 10)).lesson);
    assert.match(lessons[1].grammar.explanation, /Correct:.*Incorrect:/);
    assert.ok(lessons[2].examples.length >= 3);
    assert.ok(lessons[3].examples.length >= 3);
    assert.match(lessons[4].examples[0], /^Formal:/);
    assert.match(lessons[4].examples[1], /^Everyday:/);
    assert.match(lessons[5].explanation, /Root field review/);
    assert.match(lessons[6].explanation, /Weekly root retrieval/);
    for (const word of ROOT_WORDS[week].words) {
      const contexts = getWeeklyContexts(word);
      assert.equal(contexts.length, 3);
      assert.equal(new Set(contexts.map(([text]) => text)).size, 3);
      for (const [text, explanation] of contexts) {
        assert.ok(text.length > 35 && explanation.length > 25, word.word);
        assert.doesNotMatch(text + explanation, /task calls for|opposite of (?:the )?definition|insert word/i);
      }
    }
  }
});

test("the review loop and historical transition preserve six calendar months without repeat", () => {
  const seen = new Map();
  // Include real legacy dates, the September 13 transition, and the leap year.
  for (let offset = -186; offset < 1000; offset++) {
    const date = new Date(Date.UTC(2026, 8, 21 + offset));
    const text = date.toISOString().slice(0, 10);
    const word = getDailyVocabulary(text).word.word.toLowerCase();
    if (offset >= 0 && seen.has(word)) {
      const last = seen.get(word);
      const nextAllowed = new Date(last);
      nextAllowed.setUTCMonth(nextAllowed.getUTCMonth() + 6);
      assert.ok(date >= nextAllowed, `${word} repeated from ${last.toISOString().slice(0, 10)} to ${text}`);
    }
    seen.set(word, date);
  }
  assert.equal(getWeeklyLearning("2026-09-21").word.word, getWeeklyLearning("2027-04-05").word.word);
});

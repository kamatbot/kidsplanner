"use strict";
const vocabulary = require("./vocabulary-challenges");

// Only recorded timestamps establish a recent mistake. Old aggregate wrong
// counts cannot tell us when it happened and must not be presented as recent.
function practiceWords(dateText, entries) {
  const date = vocabulary.parseDate(dateText);
  if (!date) return [];
  const monday = vocabulary.mondayFor(date);
  const start = monday.getTime();
  const end = date.getTime() + 86400000;
  const bank = new Map(entries.map(entry => [entry.word.toLowerCase(), entry]));
  const words = new Map();
  for (let day = start; day < end; day += 86400000) {
    const { word } = vocabulary.getDailyVocabulary(new Date(day).toISOString().slice(0, 10));
    words.set(word.word.toLowerCase(), word);
  }
  return [...words].flatMap(([key, word]) => {
    const entry = bank.get(key);
    const wrong = Date.parse(entry?.lastWrongAt);
    const seen = Date.parse(entry?.lastSeen);
    const reason = wrong >= start && wrong < end ? "missed"
      : entry?.state !== "known" && (!entry?.seenCount || !Number.isFinite(seen) || seen < start) ? "untried" : null;
    return reason ? [{ word: word.word, definition: word.def, example: word.example, reason }] : [];
  }).sort((a, b) => Number(b.reason === "missed") - Number(a.reason === "missed"));
}
module.exports = { practiceWords };

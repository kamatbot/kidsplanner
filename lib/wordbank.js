"use strict";
/**
 * Word bank — per-kid SAT vocabulary progress tracker, backing the "SAT
 * Activity" widget (daily word activity + pop quiz + placement).
 *
 * Store shape: root.wordbank[kidId] = { words: { [wordLower]: {
 *   word, state: "learning"|"mastered"|"known",
 *   seenCount, correctCount, wrongCount, addedAt, lastSeen
 * } } }
 *
 * - "mastered": correctCount >= 3 (auto-promoted on interact()).
 * - "known": set via placement() — the kid already knew the word coming in,
 *   so it skips the "learning" ramp-up but is still quizzable.
 *
 * Word list + quiz distractors come from lib/sat-words.js (WORDS), ported
 * from iOS Domain/DailyContent.swift so server/web/iOS quiz the same words.
 */
const db = require("./db");
const { WORDS } = require("./sat-words");

const WORDS_BY_LOWER = new Map(WORDS.map((w) => [w.word.toLowerCase(), w]));

function root() {
  const r = db.load();
  if (!r.wordbank) r.wordbank = {};
  return r;
}

function bankFor(kidId) {
  const r = root();
  if (!r.wordbank[kidId]) r.wordbank[kidId] = { words: {} };
  if (!r.wordbank[kidId].words) r.wordbank[kidId].words = {};
  return r.wordbank[kidId];
}

function normWord(word) {
  return String(word || "").trim().toLowerCase();
}

// ---------- reads ----------

function listWords(kidId) {
  const bank = bankFor(kidId);
  const words = Object.values(bank.words);
  const stats = { learning: 0, mastered: 0, known: 0 };
  for (const w of words) {
    if (stats[w.state] !== undefined) stats[w.state]++;
  }
  return { words, stats };
}

// ---------- writes ----------

// Upserts an entry for `word`, incrementing seenCount + correctCount/
// wrongCount, auto-promoting to "mastered" once correctCount >= 3 (unless
// already "known", which is a stronger/separate designation that we keep).
function interact(kidId, { word, correct } = {}) {
  const w = normWord(word);
  if (!w) return { error: "Missing word." };
  if (!WORDS_BY_LOWER.has(w)) return { error: "Unknown word." };

  const bank = bankFor(kidId);
  const canonical = WORDS_BY_LOWER.get(w).word;
  const now = new Date().toISOString();
  let entry = bank.words[w];
  if (!entry) {
    entry = {
      word: canonical,
      state: "learning",
      seenCount: 0,
      correctCount: 0,
      wrongCount: 0,
      addedAt: now,
      lastSeen: now,
    };
    bank.words[w] = entry;
  }
  entry.seenCount++;
  entry.lastSeen = now;
  if (correct) {
    entry.correctCount++;
    if (entry.state !== "known" && entry.correctCount >= 3) entry.state = "mastered";
  } else {
    entry.wrongCount++;
  }
  db.persist();
  return { entry };
}

// Placement step: mark a batch of words the kid already knows as state
// "known" (creating an entry if one doesn't exist yet). Does not touch
// seenCount/correctCount for words already tracked beyond ensuring the state
// reflects "known" (a stronger designation than "learning").
function placement(kidId, { known } = {}) {
  if (!Array.isArray(known)) return { error: "`known` must be an array of words." };
  const bank = bankFor(kidId);
  const now = new Date().toISOString();
  for (const raw of known) {
    const w = normWord(raw);
    if (!w || !WORDS_BY_LOWER.has(w)) continue;
    const canonical = WORDS_BY_LOWER.get(w).word;
    let entry = bank.words[w];
    if (!entry) {
      entry = {
        word: canonical,
        state: "known",
        seenCount: 0,
        correctCount: 0,
        wrongCount: 0,
        addedAt: now,
        lastSeen: now,
      };
      bank.words[w] = entry;
    } else {
      entry.state = "known";
    }
  }
  db.persist();
  const { stats } = listWords(kidId);
  return { ok: true, stats };
}

// ---------- quiz ----------

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Builds `n` multiple-choice questions ("Which word means: <def>?") drawn
// from words the kid has mastered or already knows (quizzable). Falls back
// to any seen word if there aren't enough mastered/known ones. Distractors
// are 3 other random words from the full WORDS list. If fewer than 2
// quizzable words exist, returns { questions: [], needMore: true } since a
// meaningful multiple-choice quiz needs at least 2 distinct words in play.
function quiz(kidId, { n } = {}) {
  const count = Math.max(1, Math.min(20, Number(n) || 5));
  const bank = bankFor(kidId);
  const all = Object.values(bank.words);
  let pool = all.filter((w) => w.state === "mastered" || w.state === "known");
  if (pool.length < 2) pool = all.filter((w) => w.seenCount > 0);
  if (pool.length < 2) return { questions: [], needMore: true };

  const chosen = shuffle(pool).slice(0, count);
  const questions = chosen.map((entry) => {
    const canonical = WORDS_BY_LOWER.get(normWord(entry.word));
    const others = WORDS.filter((w) => w.word !== canonical.word);
    const distractors = shuffle(others).slice(0, 3).map((w) => w.word);
    const options = shuffle([canonical.word, ...distractors]);
    const answerIndex = options.indexOf(canonical.word);
    return {
      word: canonical.word,
      prompt: `Which word means: ${canonical.def}`,
      options,
      answerIndex,
    };
  });
  return { questions };
}

module.exports = {
  listWords,
  interact,
  placement,
  quiz,
  WORDS,
};

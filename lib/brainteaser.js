"use strict";
/**
 * Brain teaser — per-kid daily quiz set backing the "Brain Teaser" widget.
 *
 * Store shape: root.brainteaser[kidId] = {
 *   answered: { [qid]: { qid, correct, attempts, wrong: bool, lastSeen } },
 *   servedDate: "YYYY-MM-DD",
 *   servedIds: [qid, ...],   // the set served for servedDate (order-stable)
 *   served: [ {qid,q,options,answerIndex,resurfaced} ... ]  // shuffled snapshot for servedDate
 * }
 *
 * Daily count by weekday (server local day): Mon=1, Tue=2, Wed=3, Thu=4,
 * Fri=5, Sat/Sun=3.
 *
 * Selection: fill first with "resurface" questions (previously answered
 * wrong -> answered[qid].wrong === true), then new/unseen questions.
 * Each question's options are SHUFFLED on every new day's serve (so a
 * resurfaced question shows a different option order), with answerIndex
 * recomputed to match. The served set + its shuffle is persisted for the
 * day so repeated GETs within the same day are stable.
 */
const db = require("./db");
const { QUESTIONS } = require("./brainteaser-questions");

const QUESTIONS_BY_ID = new Map(QUESTIONS.map((q) => [q.qid, q]));

function root() {
  const r = db.load();
  if (!r.brainteaser) r.brainteaser = {};
  return r;
}

function stateFor(kidId) {
  const r = root();
  if (!r.brainteaser[kidId]) {
    r.brainteaser[kidId] = { answered: {}, servedDate: null, servedIds: [], served: [] };
  }
  const s = r.brainteaser[kidId];
  if (!s.answered) s.answered = {};
  if (!Array.isArray(s.servedIds)) s.servedIds = [];
  if (!Array.isArray(s.served)) s.served = [];
  return s;
}

function todayLocalYMD(now) {
  const d = now || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Mon=1 Tue=2 Wed=3 Thu=4 Fri=5 Sat=3 Sun=3. JS getDay(): 0=Sun..6=Sat.
function countForWeekday(now) {
  const d = now || new Date();
  const day = d.getDay();
  const weekdayCounts = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };
  return weekdayCounts[day] !== undefined ? weekdayCounts[day] : 3; // Sat(6)/Sun(0)
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Shuffles a question's options and recomputes answerIndex to match.
function shuffleQuestion(question, resurfaced) {
  const correctOption = question.options[question.answerIndex];
  const options = shuffle(question.options);
  const answerIndex = options.indexOf(correctOption);
  return {
    qid: question.qid,
    q: question.q,
    options,
    answerIndex,
    exp: question.exp,
    resurfaced: !!resurfaced,
  };
}

// Builds (and persists) today's served set if not already built for today;
// otherwise returns the previously-served (stable) set.
function getToday(kidId, now) {
  const s = stateFor(kidId);
  const today = todayLocalYMD(now);
  const count = countForWeekday(now);

  if (s.servedDate === today && s.served.length) {
    return { date: today, count: s.served.length, questions: s.served };
  }

  // New day: pick resurface (previously wrong) first, then new/unseen.
  const wrongIds = Object.keys(s.answered).filter((qid) => s.answered[qid].wrong);
  const seenIds = new Set(Object.keys(s.answered));

  const resurfacePool = shuffle(wrongIds.filter((qid) => QUESTIONS_BY_ID.has(qid)));
  const unseenPool = shuffle(QUESTIONS.filter((q) => !seenIds.has(q.qid)).map((q) => q.qid));
  // Fallback: if we run out of resurface+unseen, top up from any question.
  const anyPool = shuffle(QUESTIONS.map((q) => q.qid));

  const chosenIds = [];
  const chosenSet = new Set();
  for (const qid of resurfacePool) {
    if (chosenIds.length >= count) break;
    if (!chosenSet.has(qid)) { chosenIds.push(qid); chosenSet.add(qid); }
  }
  for (const qid of unseenPool) {
    if (chosenIds.length >= count) break;
    if (!chosenSet.has(qid)) { chosenIds.push(qid); chosenSet.add(qid); }
  }
  for (const qid of anyPool) {
    if (chosenIds.length >= count) break;
    if (!chosenSet.has(qid)) { chosenIds.push(qid); chosenSet.add(qid); }
  }

  const resurfaceSet = new Set(resurfacePool);
  const served = chosenIds
    .map((qid) => QUESTIONS_BY_ID.get(qid))
    .filter(Boolean)
    .map((q) => shuffleQuestion(q, resurfaceSet.has(q.qid)));

  s.servedDate = today;
  s.servedIds = chosenIds;
  s.served = served;
  db.persist();
  return { date: today, count: served.length, questions: served };
}

// Records an answer for `qid`. If incorrect, mark wrong:true so it resurfaces
// on a future day; if correct, clear wrong (it's been "redeemed").
function answer(kidId, { qid, correct } = {}) {
  const q = String(qid || "");
  if (!q || !QUESTIONS_BY_ID.has(q)) return { error: "Unknown question." };
  const s = stateFor(kidId);
  const now = new Date().toISOString();
  const existing = s.answered[q] || { qid: q, correct: false, attempts: 0, wrong: false, lastSeen: now };
  existing.attempts++;
  existing.lastSeen = now;
  existing.correct = !!correct;
  existing.wrong = !correct;
  s.answered[q] = existing;
  db.persist();
  return { ok: true };
}

module.exports = {
  getToday,
  answer,
  countForWeekday,
  todayLocalYMD,
  QUESTIONS,
};

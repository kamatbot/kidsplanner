"use strict";

const { WORDS: SAT_WORDS } = require("./sat-words");

// Deterministic, read-only enrichment puzzles. Clients pass their local
// YYYY-MM-DD so Wednesday/weekend behavior does not depend on server timezone.

const CROSSWORD_SETS = [
  [
    ["PLANET", "A large world that travels around a star"],
    ["ORBIT", "The curved path one object takes around another"],
    ["ROCKET", "A vehicle that launches into space"],
    ["COMET", "An icy space object that can grow a bright tail"],
    ["GALAXY", "A huge group of stars, gas, and dust"],
    ["STAR", "A glowing ball of hot gas in space"],
    ["MOON", "A natural object that travels around a planet"],
    ["MARS", "The planet often called the Red Planet"],
    ["ECLIPSE", "When one space object blocks the light from another"],
    ["ASTEROID", "A rocky object that travels around the Sun"],
  ],
  [
    ["FOREST", "A large area covered with trees"],
    ["RIVER", "Flowing water that travels toward a lake or sea"],
    ["OCEAN", "One of Earth's enormous bodies of salt water"],
    ["CLOUD", "Tiny drops of water floating in the sky"],
    ["RAIN", "Water drops that fall from clouds"],
    ["STORM", "Weather with strong wind, rain, snow, or thunder"],
    ["TREE", "A tall plant with a woody trunk"],
    ["FLOWER", "The colorful part of many plants"],
    ["MOUNTAIN", "Land that rises very high above its surroundings"],
    ["DESERT", "A very dry place that receives little rain"],
  ],
  [
    ["ATOM", "A tiny building block of matter"],
    ["ENERGY", "The ability to make something move or change"],
    ["FORCE", "A push or a pull"],
    ["LIGHT", "Energy that lets our eyes see"],
    ["SOUND", "Vibrations that travel through matter to our ears"],
    ["MATTER", "Anything that has mass and takes up space"],
    ["CELL", "The smallest living unit in an organism"],
    ["GRAVITY", "The force that pulls objects toward one another"],
    ["MAGNET", "An object that can attract iron"],
    ["PLANET", "A large round object that travels around a star"],
  ],
];

const SUDOKU_SETS = [
  [
    "530070000600195000098000060800060003400803001700020006060000280000419005000080079",
    "534678912672195348198342567859761423426853791713924856961537284287419635345286179",
  ],
  [
    "200080300060070084030500209000105408000000000402706000301007040720040060004010003",
    "245981376169273584837564219976125438513498627482736951391657842728349165654812793",
  ],
  [
    "000260701680070090190004500820100040004602900050003028009300074040050036703018000",
    "435269781682571493197834562826195347374682915951743628519326874248957136763418259",
  ],
];

const DAY_MS = 24 * 60 * 60 * 1000;
const NEWS_STOPWORDS = new Set([
  "ABOUT", "AFTER", "ALONG", "FROM", "HAVE", "HOW", "INTO", "KIDS", "LEARN",
  "MORE", "NEWS", "OUR", "OVER", "SCIENCE", "STORY", "THAT", "THEIR", "THIS",
  "TIME", "USING", "WHAT", "WHEN", "WHERE", "WHICH", "WITH", "WEEK", "WILL",
  "YOUR", "THESE", "THOSE", "THE", "AND", "FOR", "FROM", "IN", "INTO", "OF",
  "ONTO", "THAN", "THAT", "THEM", "THEY", "THEN", "THIS", "WHAT", "WHY",
]);

function parseDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function dateIndex(date) {
  return Math.floor(date.getTime() / DAY_MS);
}

function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / DAY_MS) + 1;
}

function mondayFor(date) {
  const monday = new Date(date.getTime());
  const day = monday.getUTCDay();
  monday.setUTCDate(monday.getUTCDate() - (day === 0 ? 6 : day - 1));
  return monday;
}

function weeklySatWords(date) {
  const monday = mondayFor(date);
  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(monday.getTime());
    day.setUTCDate(day.getUTCDate() + offset);
    const index = ((dayOfYear(day) - 1) % SAT_WORDS.length + SAT_WORDS.length) % SAT_WORDS.length;
    return [SAT_WORDS[index].word.toUpperCase(), SAT_WORDS[index].def];
  });
}

function key(row, col) { return `${row},${col}`; }

function canPlace(word, row, col, direction, cells) {
  const dr = direction === "down" ? 1 : 0;
  const dc = direction === "across" ? 1 : 0;
  if (cells.has(key(row - dr, col - dc)) || cells.has(key(row + dr * word.length, col + dc * word.length))) return null;
  let crossings = 0;
  for (let i = 0; i < word.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    const existing = cells.get(key(r, c));
    if (existing) {
      if (existing.letter !== word[i] || existing.directions.has(direction)) return null;
      crossings++;
    } else if (direction === "across") {
      if (cells.has(key(r - 1, c)) || cells.has(key(r + 1, c))) return null;
    } else if (cells.has(key(r, c - 1)) || cells.has(key(r, c + 1))) {
      return null;
    }
  }
  return crossings ? crossings : null;
}

function boundsWith(entries, row, col, word, direction) {
  const points = [];
  for (const entry of entries) {
    points.push([entry.row, entry.col]);
    points.push([
      entry.row + (entry.direction === "down" ? entry.answer.length - 1 : 0),
      entry.col + (entry.direction === "across" ? entry.answer.length - 1 : 0),
    ]);
  }
  points.push([row, col]);
  points.push([row + (direction === "down" ? word.length - 1 : 0), col + (direction === "across" ? word.length - 1 : 0)]);
  const rows = points.map((p) => p[0]);
  const cols = points.map((p) => p[1]);
  return (Math.max(...rows) - Math.min(...rows) + 1) * (Math.max(...cols) - Math.min(...cols) + 1);
}

function placeEntry(entry, cells) {
  const dr = entry.direction === "down" ? 1 : 0;
  const dc = entry.direction === "across" ? 1 : 0;
  for (let i = 0; i < entry.answer.length; i++) {
    const cellKey = key(entry.row + dr * i, entry.col + dc * i);
    const existing = cells.get(cellKey) || { letter: entry.answer[i], directions: new Set() };
    existing.directions.add(entry.direction);
    cells.set(cellKey, existing);
  }
}

function placementCandidates(word, cells, entries) {
  const candidates = [];
  for (const [cellKey, cell] of cells.entries()) {
    const [crossRow, crossCol] = cellKey.split(",").map(Number);
    for (let i = 0; i < word.answer.length; i++) {
      if (word.answer[i] !== cell.letter) continue;
      for (const direction of ["across", "down"]) {
        const row = crossRow - (direction === "down" ? i : 0);
        const col = crossCol - (direction === "across" ? i : 0);
        const crossings = canPlace(word.answer, row, col, direction, cells);
        if (!crossings) continue;
        candidates.push({ row, col, direction, crossings, area: boundsWith(entries, row, col, word.answer, direction) });
      }
    }
  }
  candidates.sort((a, b) => b.crossings - a.crossings || a.area - b.area || a.row - b.row || a.col - b.col || a.direction.localeCompare(b.direction));
  return candidates;
}

function solveCrossword(remaining, cells, entries, budget) {
  budget.remaining -= 1;
  if (budget.remaining < 0) return null;
  if (!remaining.length) return { cells, entries };
  const options = remaining.map((word, index) => ({ word, index, candidates: placementCandidates(word, cells, entries) }))
    .filter((option) => option.candidates.length)
    .sort((a, b) => a.candidates.length - b.candidates.length || b.word.answer.length - a.word.answer.length || a.word.sourceIndex - b.word.sourceIndex);
  if (!options.length) return null;
  const chosenWord = options[0];
  for (const candidate of chosenWord.candidates) {
    const nextCells = new Map([...cells].map(([cellKey, cell]) => [cellKey, { letter: cell.letter, directions: new Set(cell.directions) }]));
    const entry = { ...chosenWord.word, row: candidate.row, col: candidate.col, direction: candidate.direction };
    placeEntry(entry, nextCells);
    const nextRemaining = remaining.filter((_, index) => index !== chosenWord.index);
    const solved = solveCrossword(nextRemaining, nextCells, entries.concat(entry), budget);
    if (solved) return solved;
  }
  return null;
}

function buildCrossword(words, options = {}) {
  const ordered = words.map(([answer, clue], sourceIndex) => ({ answer, clue, sourceIndex }))
    .sort((a, b) => b.answer.length - a.answer.length || a.sourceIndex - b.sourceIndex);
  if (!ordered.length) throw new Error("Unable to build the complete crossword.");
  const initialCells = new Map();
  const initialEntries = [{ ...ordered.shift(), row: 0, col: 0, direction: "across" }];
  placeEntry(initialEntries[0], initialCells);
  const budget = { remaining: Number.isFinite(options.maxNodes) ? options.maxNodes : 12000 };
  const solved = solveCrossword(ordered, initialCells, initialEntries, budget);
  if (!solved) throw new Error("Unable to build the complete crossword.");
  const { cells, entries } = solved;

  const rows = [...cells.keys()].map((cellKey) => Number(cellKey.split(",")[0]));
  const cols = [...cells.keys()].map((cellKey) => Number(cellKey.split(",")[1]));
  const minRow = Math.min(...rows);
  const minCol = Math.min(...cols);
  const height = Math.max(...rows) - minRow + 1;
  const width = Math.max(...cols) - minCol + 1;
  const starts = new Map();
  for (const entry of entries) starts.set(key(entry.row - minRow, entry.col - minCol), true);
  const numberedStarts = [...starts.keys()].sort((a, b) => {
    const [ar, ac] = a.split(",").map(Number);
    const [br, bc] = b.split(",").map(Number);
    return ar - br || ac - bc;
  });
  const numberFor = new Map(numberedStarts.map((cellKey, index) => [cellKey, index + 1]));
  const solution = Array.from({ length: height }, () => Array(width).fill("."));
  for (const [cellKey, cell] of cells.entries()) {
    const [row, col] = cellKey.split(",").map(Number);
    solution[row - minRow][col - minCol] = cell.letter;
  }
  return {
    rows: height,
    cols: width,
    solution: solution.map((row) => row.join("")),
    entries: entries.map((entry) => {
      const row = entry.row - minRow;
      const col = entry.col - minCol;
      return {
        number: numberFor.get(key(row, col)),
        direction: entry.direction,
        clue: entry.clue,
        answer: entry.answer,
        row,
        col,
      };
    }).sort((a, b) => a.number - b.number || a.direction.localeCompare(b.direction)),
  };
}

const CROSSWORDS = CROSSWORD_SETS.map(buildCrossword);

function validNewsAnswer(value) {
  const answer = String(value == null ? "" : value).trim().toUpperCase();
  if (!/^[A-Z]{4,12}$/.test(answer) || !/[AEIOUY]/.test(answer) || NEWS_STOPWORDS.has(answer)) return null;
  return answer;
}

function headlineCandidates(item) {
  const answers = [];
  const seen = new Set();
  const headline = String(item && item.headline ? item.headline : "");
  const preferred = validNewsAnswer(item && (item.answer || item.candidate || item.word));
  if (preferred && new RegExp(`\\b${preferred}\\b`, "i").test(headline)) {
    seen.add(preferred);
    answers.push(preferred);
  }
  const tokens = headline.match(/[A-Za-z]+/g) || [];
  for (const token of tokens) {
    if (token.length < 4 || token.length > 12) continue;
    const answer = validNewsAnswer(token);
    if (!answer || seen.has(answer)) continue;
    seen.add(answer);
    answers.push(answer);
  }
  return answers.slice(0, 4);
}

function weekNewsClue(item, answer) {
  const headline = String(item && item.headline || "").replace(/\s+/g, " ").trim();
  if (!headline) return "From this week's Science News Explores story: a science word from the article";
  const masked = headline.replace(new RegExp(`\\b${answer}\\b`, "ig"), "____");
  if (masked !== headline) return `From this week's Science News Explores story: “${masked.slice(0, 170)}”`;
  return "From this week's Science News Explores story: a science word from the article";
}

function publishedMsFor(item) {
  if (Number.isFinite(item && item.publishedMs)) return item.publishedMs;
  const value = Date.parse(item && (item.publishedAt || item.date || ""));
  return Number.isFinite(value) ? value : NaN;
}

function eligibleNewsWords(date) {
  const start = mondayFor(date).getTime();
  const end = start + 7 * DAY_MS;
  const items = Array.isArray(date.newsItems) ? date.newsItems : [];
  const seenStories = new Set();
  const seenAnswers = new Set();
  const words = [];
  for (const item of items) {
    const published = publishedMsFor(item);
    if (!(published >= start && published < end)) continue;
    const storyKey = String(item && (item.id || item.url || item.headline) || "").trim().toLowerCase();
    if (!storyKey || seenStories.has(storyKey)) continue;
    const candidates = headlineCandidates(item);
    const answer = candidates.find((candidate) => !seenAnswers.has(candidate));
    if (!answer) continue;
    seenStories.add(storyKey);
    seenAnswers.add(answer);
    words.push({ item, candidates: candidates.map((candidate) => [candidate, weekNewsClue(item, candidate)]) });
    if (words.length === 3) break;
  }
  return words;
}

function newsChoices(articles) {
  const result = [[]];
  for (const article of articles) {
    const additions = [];
    for (const choice of result) {
      for (const word of article.candidates) {
        if (choice.some(([answer]) => answer === word[0])) continue;
        additions.push(choice.concat([word]));
      }
    }
    result.push(...additions);
  }
  return result
    .sort((a, b) => b.length - a.length)
    .slice(0, 200);
}

function combinations(values, count) {
  if (count === 0) return [[]];
  const result = [];
  function visit(start, picked) {
    if (picked.length === count) {
      result.push(picked.slice());
      return;
    }
    for (let index = start; index <= values.length - (count - picked.length); index++) {
      picked.push(values[index]);
      visit(index + 1, picked);
      picked.pop();
    }
  }
  visit(0, []);
  return result;
}

function staticFillWords(date, usedAnswers) {
  const themeIndex = ((dayOfYear(mondayFor(date)) - 1) % CROSSWORD_SETS.length + CROSSWORD_SETS.length) % CROSSWORD_SETS.length;
  const orderedThemes = [CROSSWORD_SETS[themeIndex], ...CROSSWORD_SETS.filter((_, index) => index !== themeIndex)];
  const seen = new Set(usedAnswers);
  const result = [];
  for (const theme of orderedThemes) {
    for (const word of theme) {
      if (seen.has(word[0])) continue;
      seen.add(word[0]);
      result.push(word);
    }
  }
  return result;
}

function tryBuild(words) {
  try {
    return buildCrossword(words, { maxNodes: 12000 });
  } catch (error) {
    return null;
  }
}

function crosswordFor(date, newsItems) {
  const sat = weeklySatWords(date);
  const news = eligibleNewsWords(Object.assign(new Date(date.getTime()), { newsItems }));
  const newsSets = newsChoices(news);

  // Search in descending content priority. The first buildable combination is
  // deterministic, connected, and always padded to ten entries.
  for (let satCount = sat.length; satCount >= 0; satCount--) {
    for (const newsChoice of newsSets) {
      if (newsChoice.length > 10 - satCount) continue;
      const satChoices = combinations(sat, satCount);
      for (const satChoice of satChoices) {
        const chosen = satChoice.concat(newsChoice);
        const staticWords = staticFillWords(date, chosen.map(([answer]) => answer));
        const fillChoices = combinations(staticWords, 10 - chosen.length);
        for (const fillChoice of fillChoices) {
          const crossword = tryBuild(chosen.concat(fillChoice));
          if (crossword && crossword.entries.length === 10) return crossword;
        }
      }
    }
  }
  const index = ((dayOfYear(mondayFor(date)) - 1) % CROSSWORDS.length + CROSSWORDS.length) % CROSSWORDS.length;
  return CROSSWORDS[index];
}

function getDailyPuzzle(dateText, options) {
  const date = parseDate(dateText);
  if (!date) return { error: "Use a real date in YYYY-MM-DD format." };
  const day = date.getUTCDay();
  const index = dateIndex(date);
  if (day === 3) {
    const [puzzle, solution] = SUDOKU_SETS[((index % SUDOKU_SETS.length) + SUDOKU_SETS.length) % SUDOKU_SETS.length];
    return {
      date: dateText,
      available: true,
      type: "sudoku",
      title: "Wednesday Sudoku",
      instructions: "Fill every row, column, and 3×3 box with the numbers 1–9, without repeats.",
      sudoku: { puzzle, solution, size: 9, difficulty: "Easy" },
    };
  }
  if (day === 0 || day === 6) {
    const newsItems = Array.isArray(options) ? options : (options && options.newsItems);
    const crossword = crosswordFor(date, newsItems);
    return {
      date: dateText,
      available: true,
      type: "crossword",
      title: "Weekend Crossword",
      instructions: "Tap a clue, then type the whole answer. Tap Check when every square has a letter.",
      crossword,
    };
  }
  return { date: dateText, available: false, type: null };
}

module.exports = { getDailyPuzzle, buildCrossword, parseDate, CROSSWORD_SETS, SUDOKU_SETS, weeklySatWords };

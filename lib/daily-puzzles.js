"use strict";

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

function parseDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function dateIndex(date) {
  return Math.floor(date.getTime() / 86400000);
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

function solveCrossword(remaining, cells, entries) {
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
    const solved = solveCrossword(nextRemaining, nextCells, entries.concat(entry));
    if (solved) return solved;
  }
  return null;
}

function buildCrossword(words) {
  const ordered = words.map(([answer, clue], sourceIndex) => ({ answer, clue, sourceIndex }))
    .sort((a, b) => b.answer.length - a.answer.length || a.sourceIndex - b.sourceIndex);
  const initialCells = new Map();
  const initialEntries = [{ ...ordered.shift(), row: 0, col: 0, direction: "across" }];
  placeEntry(initialEntries[0], initialCells);
  const solved = solveCrossword(ordered, initialCells, initialEntries);
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

function getDailyPuzzle(dateText) {
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
    const crossword = CROSSWORDS[((index % CROSSWORDS.length) + CROSSWORDS.length) % CROSSWORDS.length];
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

module.exports = { getDailyPuzzle, buildCrossword, parseDate, CROSSWORD_SETS, SUDOKU_SETS };

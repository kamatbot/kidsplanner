"use strict";

// Original, rule-explicit reasoning puzzles. Each four-case family has a
// different operation; the 64 concrete variants are not 64 distinct mechanics.
// IDs are permanent. Keep text complete so clients without visual support work.
// Visuals are bounded plain-text tiles, independent of option order.
const VISUAL_QUESTIONS = [];
function add(id, kind, difficulty, q, answer, distractors, exp, items, columns) {
  const options = [String(answer), ...distractors.map(String)];
  const visual = { kind, alt: q, items: items.map(String) };
  if (columns) visual.columns = columns;
  VISUAL_QUESTIONS.push({
    qid: `bt${id}`, q, options, answerIndex: 0, exp,
    category: kind, difficulty, visual,
  });
}
function numericOptions(answer) { return [answer - 1, answer + 1, answer + 3]; }
const compass = ["up", "right", "down", "left"];
const mod4 = (n) => ((n % 4) + 4) % 4;

// 71–74: increasing gaps, with the rule stated rather than guessed.
[[1, 2], [2, 3], [4, 1], [3, 4]].forEach(([start, gap], i) => {
  const values = [start];
  for (let n = 0; n < 4; n++) values.push(values.at(-1) + gap + n);
  const answer = values.pop();
  add(71 + i, "sequence", "easy",
    `The number tiles are ${values.join(", ")}, ?. The first jump adds ${gap}; each next jump adds one more than the previous jump. What belongs in the gap?`,
    answer, numericOptions(answer),
    `The jumps are +${gap}, +${gap + 1}, +${gap + 2}, then +${gap + 3}. The last tile is ${values.at(-1)} + ${gap + 3} = ${answer}.`, [...values, "?"]);
});

// 75–78: alternate two operations in a fixed order.
[[2, 3], [3, 1], [4, 2], [1, 4]].forEach(([start, increment], i) => {
  const values = [start, start * 2, start * 2 + increment, (start * 2 + increment) * 2];
  const answer = values.at(-1) + increment;
  add(75 + i, "sequence", "medium",
    `Follow these number tiles: ${values.join(", ")}, ?. The rule alternates multiply by 2, then add ${increment}, starting with multiply by 2. Which number comes next?`,
    answer, numericOptions(answer),
    `The operations are ×2, +${increment}, ×2, then +${increment}. So the next tile is ${values.at(-1)} + ${increment} = ${answer}.`, [...values, "?"]);
});

// 79–82: find a later position in a repeating tile pattern.
[
  [["circle", "triangle", "square"], 11],
  [["star", "circle", "circle", "square"], 15],
  [["triangle", "star", "square"], 13],
  [["square", "triangle", "star", "circle"], 18],
].forEach(([pattern, position], i) => {
  const answer = pattern[(position - 1) % pattern.length];
  add(79 + i, "sequence", "easy",
    `These tiles repeat in exactly this order: ${pattern.join(", ")}. Count the first tile as position 1. Which shape is at position ${position}?`,
    answer, ["circle", "triangle", "square", "star"].filter((s) => s !== answer),
    `One group has ${pattern.length} tiles. Position ${position} is tile ${(position - 1) % pattern.length + 1} of its group, which is ${answer}.`, [...pattern, ...pattern], pattern.length);
});

// 83–86: two interleaved arithmetic sequences.
[[1, 10, 2, 3], [4, 20, 3, 2], [2, 15, 4, 5], [5, 30, 5, 4]].forEach(([a, b, da, db], i) => {
  const values = [a, b, a + da, b + db, a + 2 * da, b + 2 * db];
  const answer = a + 3 * da;
  add(83 + i, "sequence", "medium",
    `The tiles are ${values.join(", ")}, ?. Odd positions start at ${a} and add ${da} each time; even positions start at ${b} and add ${db}. What is tile 7?`,
    answer, numericOptions(answer),
    `Tile 7 is an odd position. Follow only the odd tiles: ${a}, ${a + da}, ${a + 2 * da}, ${answer}; each jump adds ${da}.`, [...values, "?"]);
});

// 87–90: equal pieces on a balance.
[[3, 4, 2], [4, 3, 5], [2, 7, 4], [5, 2, 3]].forEach(([count, weight, extra], i) => {
  const total = count * weight + extra;
  add(87 + i, "balance", "easy",
    `A level balance has ${count} identical circles and a ${extra}-unit block on the left, and a ${total}-unit block on the right. How many units does one circle weigh?`,
    weight, numericOptions(weight),
    `Remove ${extra} units from both sides: ${total} − ${extra} = ${count * weight}. Divide among ${count} equal circles: ${count * weight} ÷ ${count} = ${weight} units.`,
    [`${count} circles + ${extra}`, "=", total], 3);
});

// 91–94: substitute one shape into another equation.
[[3, 5], [4, 7], [6, 2], [2, 8]].forEach(([circle, square], i) => {
  const answer = circle + 2 * square;
  add(91 + i, "balance", "medium",
    `Two circles weigh ${2 * circle} units. One circle plus one square weighs ${circle + square} units. What do one circle and two squares weigh together? All circles match and all squares match.`,
    answer, numericOptions(answer),
    `A circle weighs ${2 * circle} ÷ 2 = ${circle}. A square weighs ${circle + square} − ${circle} = ${square}. The requested total is ${circle} + 2 × ${square} = ${answer}.`,
    [`circle + circle = ${2 * circle}`, `circle + square = ${circle + square}`, "circle + square + square = ?"]);
});

// 95–98: use a total and a difference.
[[5, 2], [7, 3], [9, 4], [6, 1]].forEach(([star, difference], i) => {
  const moon = star + difference;
  add(95 + i, "balance", "medium",
    `A star and a moon together weigh ${star + moon} units. The moon weighs ${difference} units more than the star. How much does the moon weigh?`,
    moon, numericOptions(moon),
    `Remove the moon's extra ${difference} units from the total: ${star + moon} − ${difference} = ${2 * star}. Half is the star's ${star} units; add ${difference} to get the moon's ${moon} units.`,
    [`star + moon = ${star + moon}`, `moon = star + ${difference}`, "moon = ?"]);
});

// 99–102: cancel matching pieces from both sides.
[[3, 2, 8], [4, 3, 12], [2, 1, 6], [5, 2, 14]].forEach(([count, left, right], i) => {
  const answer = (right - left) / (count - 1);
  add(99 + i, "balance", "medium",
    `A level balance has ${count} identical triangles plus ${left} units on the left, and one triangle plus ${right} units on the right. What does one triangle weigh?`,
    answer, numericOptions(answer),
    `Cancel one triangle and ${left} units from both sides. Then ${count - 1} triangles weigh ${right - left} units, so each weighs ${right - left} ÷ ${count - 1} = ${answer} units.`,
    [`${count} triangles + ${left}`, "=", `triangle + ${right}`], 3);
});

// 103–106: quarter turns, including counterclockwise and a full turn.
[[0, 1], [1, -1], [2, 2], [3, 4]].forEach(([start, turns], i) => {
  const answer = compass[mod4(start + turns)];
  add(103 + i, "rotation", "easy",
    `An arrow points ${compass[start]}. Rotate it ${Math.abs(turns)} quarter-turn${Math.abs(turns) === 1 ? "" : "s"} ${turns < 0 ? "counterclockwise" : "clockwise"}. Which way does it point now?`,
    answer, compass.filter((d) => d !== answer),
    `Clockwise follows up → right → down → left → up; counterclockwise reverses that order. After ${Math.abs(turns)} quarter-turn(s), the arrow points ${answer}.`,
    [compass[start], `${Math.abs(turns)} × ${turns < 0 ? "↶" : "↷"}`, "?"]);
});

// 107–110: compose turns in opposite directions.
[[0, 2, 1], [1, 3, 2], [2, 1, 3], [3, 2, 2]].forEach(([start, clockwise, back], i) => {
  const answer = compass[mod4(start + clockwise - back)];
  add(107 + i, "rotation", "medium",
    `An arrow begins pointing ${compass[start]}. It turns ${clockwise} quarter-turns clockwise, then ${back} quarter-turns counterclockwise. Which way does it finish pointing?`,
    answer, compass.filter((d) => d !== answer),
    `After the clockwise turns it points ${compass[mod4(start + clockwise)]}. Undo ${back} quarter-turns in the opposite direction and it finishes pointing ${answer}.`,
    [compass[start], `${clockwise} × ↷`, `${back} × ↶`, "?"]);
});

const corners = ["top-left", "top-right", "bottom-right", "bottom-left"];
// 111–114: rotate a marked corner, not just an arrow.
[[0, 1], [1, 2], [2, -1], [3, 2]].forEach(([start, turns], i) => {
  const answer = corners[mod4(start + turns)];
  const tiles = ["·", "·", "·", "·"];
  tiles[[0, 1, 3, 2][start]] = "star";
  add(111 + i, "rotation", "easy",
    `A square card has a star in its ${corners[start]} corner. Rotate the whole card ${Math.abs(turns)} quarter-turn${Math.abs(turns) === 1 ? "" : "s"} ${turns < 0 ? "counterclockwise" : "clockwise"}. Which corner now holds the star?`,
    answer, corners.filter((c) => c !== answer),
    `A clockwise quarter-turn moves top-left → top-right → bottom-right → bottom-left. Follow ${Math.abs(turns)} step(s) ${turns < 0 ? "backwards" : "forwards"} from ${corners[start]} to reach ${answer}.`, tiles, 2);
});

// 115–118: spatial transformation of a numbered 2×2 card.
[
  [[1, 2, 3, 4], "clockwise", "top-left", 2],
  [[5, 6, 7, 8], "counterclockwise", "top-right", 3],
  [[2, 4, 6, 8], "half-turn", "bottom-left", 1],
  [[9, 3, 7, 1], "clockwise", "bottom-right", 1],
].forEach(([tiles, turn, target, sourceIndex], i) => {
  const answer = tiles[sourceIndex];
  const instruction = turn === "half-turn" ? "a half-turn" : `one quarter-turn ${turn}`;
  add(115 + i, "rotation", "medium",
    `A 2 by 2 card has top row ${tiles[0]}, ${tiles[1]} and bottom row ${tiles[2]}, ${tiles[3]}. Rotate the whole card ${instruction}. Which number is now at ${target}?`,
    answer, tiles.filter((n) => n !== answer),
    `Track positions rather than changing numbers. The original ${["top-left", "top-right", "bottom-left", "bottom-right"][sourceIndex]} tile moves to ${target} after ${instruction}; that tile is ${answer}.`, tiles, 2);
});

// 119–122: endpoints on a row/column grid. Coordinates remove compass ambiguity.
[
  [2, 2, [["right", 2], ["down", 1], ["left", 1]]],
  [3, 4, [["up", 2], ["left", 2], ["down", 1]]],
  [4, 1, [["right", 3], ["up", 2], ["left", 1]]],
  [1, 3, [["down", 3], ["left", 2], ["up", 1]]],
].forEach(([row, column, moves], i) => {
  let r = row, c = column;
  for (const [direction, n] of moves) {
    if (direction === "up") r -= n;
    if (direction === "down") r += n;
    if (direction === "left") c -= n;
    if (direction === "right") c += n;
  }
  const label = (a, b) => `row ${a}, column ${b}`;
  add(119 + i, "path", "easy",
    `On a grid, rows increase downwards and columns increase rightwards. Start at ${label(row, column)}. Move ${moves.map(([d, n]) => `${d} ${n}`).join(", then ")}. Where do you finish?`,
    label(r, c), [label(r + 1, c), label(r, c + 1), label(r + 1, c + 1)],
    `Only up/down changes the row, and only left/right changes the column. Following the moves from ${label(row, column)} finishes at ${label(r, c)}.`,
    [`start ${row},${column}`, ...moves.map(([d, n]) => `${d} ${n}`), "?"]);
});

// 123–126: route counts on small rectangular grids with one blocked point.
// Enumerating every valid route is intentionally small and bounded.
function routes(right, down, blocked, x = 0, y = 0) {
  if (x > right || y > down || (x === blocked[0] && y === blocked[1])) return 0;
  if (x === right && y === down) return 1;
  return routes(right, down, blocked, x + 1, y) + routes(right, down, blocked, x, y + 1);
}
[[2, 2, [1, 1]], [3, 2, [1, 1]], [2, 3, [1, 2]], [3, 3, [2, 1]]].forEach(([right, down, blocked], i) => {
  const answer = routes(right, down, blocked);
  const items = [];
  for (let y = 0; y <= down; y++) for (let x = 0; x <= right; x++) {
    items.push(x === blocked[0] && y === blocked[1] ? "blocked" : x === 0 && y === 0 ? "start" : x === right && y === down ? "finish" : "·");
  }
  add(123 + i, "path", "medium",
    `A grid has ${down + 1} rows and ${right + 1} columns. Start at the top-left and finish at the bottom-right. Move only one point right or one point down per step. The point at row ${blocked[1] + 1}, column ${blocked[0] + 1} is blocked (count from 1). How many different routes avoid it?`,
    answer, numericOptions(answer),
    `Write 1 at the start and 0 at the blocked point. At each other point, add the route counts immediately above and to its left. The bottom-right count is ${answer}, so there are ${answer} routes.`, items, right + 1);
});

// 127–130: undo a route in reverse order.
[
  ["up", "right", "right"], ["left", "down", "left"],
  ["down", "down", "right"], ["right", "up", "left"],
].forEach((moves, i) => {
  const opposite = (d) => compass[mod4(compass.indexOf(d) + 2)];
  const answer = moves.slice().reverse().map(opposite).join(", ");
  const candidates = [moves.join(", "), moves.map(opposite).join(", "), moves.slice().reverse().join(", "), "up, up, up", "down, down, down"];
  const distractors = [...new Set(candidates)].filter((v) => v !== answer).slice(0, 3);
  add(127 + i, "path", "easy",
    `A robot travels one square ${moves.join(", then one square ")}. Which sequence retraces exactly the same path back to the start? Each listed direction is one square.`,
    answer, distractors,
    `Undo the last move first, reversing each direction: up pairs with down and left pairs with right. The return sequence is ${answer}.`, [...moves, "return?"]);
});

// 131–134: shortest route when a wall forces a detour through its only gap.
[[1, 2], [2, 1], [3, 5], [4, 2]].forEach(([row, gapRow], i) => {
  const answer = 4 + 2 * Math.abs(gapRow - row);
  const items = [];
  for (let r = 1; r <= 5; r++) for (let c = 1; c <= 5; c++) {
    items.push(r === row && c === 1 ? "start" : r === row && c === 5 ? "finish" : c === 3 && r !== gapRow ? "wall" : "·");
  }
  add(131 + i, "path", "medium",
    `On a 5 by 5 grid, start at row ${row}, column 1 and finish at row ${row}, column 5. Column 3 is a wall except at row ${gapRow}. Rows count from the top. Move one square up, down, left, or right; stay inside the grid and never enter a wall. What is the fewest moves?`,
    answer, numericOptions(answer),
    `You need 4 moves right overall, plus ${Math.abs(gapRow - row)} moves to the gap's row and ${Math.abs(gapRow - row)} back to the finish row. This route exists, so the minimum is 4 + ${2 * Math.abs(gapRow - row)} = ${answer}.`, items, 5);
});

module.exports = { VISUAL_QUESTIONS };

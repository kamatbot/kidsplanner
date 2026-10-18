"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { VISUAL_QUESTIONS } = require("../lib/visual-puzzles");
const { ALL_QUESTIONS, ACTIVE_QUESTIONS } = require("../lib/brainteaser-questions");

// Independently worked answers, in permanent ID order. These also pin content
// identity: a later edit cannot silently change what an old answer refers to.
const expected = [
  15, 20, 14, 25, 17, 15, 22, 16,
  "triangle", "circle", "triangle", "triangle", 7, 13, 14, 20,
  4, 3, 7, 2, 13, 18, 10, 18, 7, 10, 13, 7, 3, 3, 5, 3,
  "right", "up", "up", "left", "right", "down", "up", "left",
  "top-right", "bottom-left", "top-right", "top-right", 3, 8, 4, 3,
  "row 3, column 3", "row 2, column 2", "row 2, column 3", "row 3, column 1",
  2, 4, 4, 11,
  "left, left, down", "right, up, right", "left, up, up", "right, down, left",
  6, 6, 8, 8,
].map(String);

test("64 original visual variants have pinned unique answers across 16 reasoning families", () => {
  assert.equal(VISUAL_QUESTIONS.length, 64);
  assert.equal(expected.length, 64);
  assert.equal(new Set(VISUAL_QUESTIONS.map((q) => q.q)).size, 64);
  assert.equal(new Set(ALL_QUESTIONS.map((q) => q.qid)).size, ALL_QUESTIONS.length);
  for (const kind of ["sequence", "balance", "rotation", "path"]) {
    assert.equal(VISUAL_QUESTIONS.filter((q) => q.category === kind).length, 16);
  }
  for (const [i, q] of VISUAL_QUESTIONS.entries()) {
    assert.equal(q.qid, `bt${71 + i}`);
    assert.equal(q.options[q.answerIndex], expected[i], q.qid);
    assert.equal(q.options.filter((option) => option === expected[i]).length, 1, q.qid);
    assert.ok(ACTIVE_QUESTIONS.includes(q));
  }
});

test("all historical and new questions have valid answer contracts; visuals are bounded plain text", () => {
  for (const q of ALL_QUESTIONS) {
    assert.match(q.qid, /^bt\d+$/);
    assert.equal(q.options.length, 4, q.qid);
    assert.equal(new Set(q.options).size, 4, q.qid);
    assert.ok(q.options.every((option) => typeof option === "string" && option.trim()));
    assert.ok(Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < 4);
    assert.ok(q.exp.trim().length >= 30, q.qid);
    assert.doesNotMatch(q.exp, /TODO|undefined|NaN|<[^>]*>/);
    if (!q.visual) continue;
    assert.deepEqual(Object.keys(q.visual).sort(), q.visual.columns
      ? ["alt", "columns", "items", "kind"] : ["alt", "items", "kind"]);
    assert.ok(["sequence", "balance", "rotation", "path"].includes(q.visual.kind));
    assert.equal(q.visual.alt, q.q); // full accessible/text-only instructions
    assert.ok(q.visual.alt.length <= 600);
    assert.ok(q.visual.items.length >= 2 && q.visual.items.length <= 25);
    for (const item of q.visual.items) {
      assert.equal(typeof item, "string");
      assert.ok(item.length > 0 && item.length <= 48);
      assert.doesNotMatch(item, /[<>]|https?:|data:/);
    }
    if (q.visual.columns !== undefined) {
      assert.ok(Number.isInteger(q.visual.columns));
      assert.ok(q.visual.columns >= 2 && q.visual.columns <= 5);
      assert.equal(q.visual.items.length % q.visual.columns, 0);
    }
    assert.ok(["easy", "medium"].includes(q.difficulty));
  }
});

test("each balance has exactly one offered value satisfying its stated equations", () => {
  for (const q of VISUAL_QUESTIONS.filter((q) => q.category === "balance")) {
    const id = Number(q.qid.slice(2));
    const n = [...q.q.matchAll(/\d+/g)].map((m) => Number(m[0]));
    let satisfies;
    if (id <= 90) satisfies = (v) => n[0] * v + n[1] === n[2];
    else if (id <= 94) satisfies = (v) => v === n[0] / 2 + 2 * (n[1] - n[0] / 2);
    else if (id <= 98) satisfies = (v) => v + (v - n[1]) === n[0];
    else satisfies = (v) => n[0] * v + n[1] === v + n[2];
    const matching = q.options.filter((option) => satisfies(Number(option)));
    assert.deepEqual(matching, [q.options[q.answerIndex]], q.qid);
  }
});

test("numbered-card rotations track each tile using matrix transforms", () => {
  for (const q of VISUAL_QUESTIONS.filter((q) => Number(q.qid.slice(2)) >= 115 && Number(q.qid.slice(2)) <= 118)) {
    let grid = [q.visual.items.slice(0, 2), q.visual.items.slice(2)];
    const turns = q.q.includes("counterclockwise") ? 3 : q.q.includes("half-turn") ? 2 : 1;
    for (let turn = 0; turn < turns; turn++) {
      grid = [[grid[1][0], grid[0][0]], [grid[1][1], grid[0][1]]];
    }
    const target = q.q.match(/now at (top|bottom)-(left|right)/);
    assert.equal(q.options[q.answerIndex], grid[target[1] === "top" ? 0 : 1][target[2] === "left" ? 0 : 1]);
  }
});

test("route counts independently enumerate all right/down move strings", () => {
  for (const q of VISUAL_QUESTIONS.filter((q) => Number(q.qid.slice(2)) >= 123 && Number(q.qid.slice(2)) <= 126)) {
    const width = q.visual.columns, height = q.visual.items.length / width;
    const steps = width + height - 2;
    let valid = 0;
    for (let bits = 0; bits < 2 ** steps; bits++) {
      let x = 0, y = 0, blocked = false;
      for (let step = 0; step < steps; step++) {
        if (bits & (1 << step)) x++; else y++;
        if (x >= width || y >= height || q.visual.items[y * width + x] === "blocked") { blocked = true; break; }
      }
      if (!blocked && x === width - 1 && y === height - 1) valid++;
    }
    assert.equal(Number(q.options[q.answerIndex]), valid, q.qid);
  }
});

test("wall detours match breadth-first shortest paths through the visible grid", () => {
  for (const q of VISUAL_QUESTIONS.filter((q) => Number(q.qid.slice(2)) >= 131)) {
    const { items, columns } = q.visual;
    const start = items.indexOf("start"), finish = items.indexOf("finish");
    const queue = [[start, 0]], seen = new Set([start]);
    let shortest;
    for (let at = 0; at < queue.length; at++) {
      const [cell, distance] = queue[at];
      if (cell === finish) { shortest = distance; break; }
      const x = cell % columns, y = Math.floor(cell / columns);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * columns + nx;
        if (nx < 0 || nx >= columns || ny < 0 || next >= items.length || items[next] === "wall" || seen.has(next)) continue;
        seen.add(next);
        queue.push([next, distance + 1]);
      }
    }
    assert.equal(Number(q.options[q.answerIndex]), shortest, q.qid);
  }
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const parser = require("../lib/meal-plan-import");

function sampleTable(rows = [
  ["Monday", "Oats / eggs", "Rice bowl", "Dal curry"],
  ["Tuesday", "Fruit", "Noodles or leftovers", "Chicken curry"],
  ["Wednesday", "Toast", "Chickpea salad", "Tofu stir-fry"],
  ["Thursday", "Yoghurt", "Wrap", "Fish with rice"],
  ["Friday", "Pancakes", "Soup", "Pizza"],
  ["Saturday", "Eggs", "Sandwich", "Pasta"],
  ["Sunday", "Granola", "Leftovers", "Roast vegetables"],
]) {
  return [
    "A little Hermes context before the table.",
    "| Day | Breakfast | Lunch | Dinner |",
    "| --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    "",
    "The rest of the reply stays intact in chat.",
  ].join("\n");
}

test("parseMealPlan returns the stable 7-day/21-entry shape with Monday dates", () => {
  const items = parser.parseMealPlan(sampleTable(), "2026-08-10");
  assert.equal(items.length, 21);
  assert.deepEqual(items.slice(0, 3), [
    { key: "2026-08-10|breakfast", date: "2026-08-10", slot: "breakfast", title: "Oats / eggs" },
    { key: "2026-08-10|lunch", date: "2026-08-10", slot: "lunch", title: "Rice bowl" },
    { key: "2026-08-10|dinner", date: "2026-08-10", slot: "dinner", title: "Dal curry" },
  ]);
  assert.deepEqual(items.slice(-1)[0], {
    key: "2026-08-16|dinner",
    date: "2026-08-16",
    slot: "dinner",
    title: "Roast vegetables",
  });
  assert.ok(items.every((item) => Object.keys(item).join(",") === "key,date,slot,title"));
});

test("parseMealPlan accepts common weekday abbreviations and cleans superficial Markdown without splitting alternatives", () => {
  const text = sampleTable([
    ["Mon.", "**Oats**  /  eggs", "[Rice](https://example.test)", "`Dal`"],
    ["Tues", "Fruit", "Soup", "Chicken"],
    ["Weds.", "Toast", "Salad", "Tofu"],
    ["Thurs", "Yoghurt", "Wrap", "Fish"],
    ["Fri", "Pancakes", "Soup", "Pizza"],
    ["Sat", "Eggs", "Sandwich", "Pasta"],
    ["Sun", "Granola", "Leftovers", "Roast"],
  ]);
  const items = parser.parseMealPlan(text, "2026-08-10");
  assert.equal(items[0].title, "Oats / eggs");
  assert.equal(items[1].title, "Rice");
  assert.equal(items[2].title, "Dal");
  assert.equal(items[3].date, "2026-08-11");
  assert.equal(items[18].date, "2026-08-16");
});

test("parseMealPlan accepts a Day column with only the meal slots that are present", () => {
  const dinnerOnly = [
    "| Day | Dinner |",
    "| --- | --- |",
    "| Monday | Dal curry |",
    "| Wednesday | Tofu stir-fry |",
  ].join("\n");
  assert.deepEqual(parser.parseMealPlan(dinnerOnly, "2026-08-10"), [
    { key: "2026-08-10|dinner", date: "2026-08-10", slot: "dinner", title: "Dal curry" },
    { key: "2026-08-12|dinner", date: "2026-08-12", slot: "dinner", title: "Tofu stir-fry" },
  ]);
});

test("parseMealPlan rejects malformed, duplicate, empty, unsupported, oversized, and non-Monday input", () => {
  const invalidTables = [
    "| Day | Breakfast | Lunch | Dinner |\n| --- | --- | --- | --- |\n| Monday | A | B |",
    sampleTable([["Monday", "A", "B", "C"], ["Mon", "D", "E", "F"]]),
    sampleTable([["Funday", "A", "B", "C"]]),
    sampleTable([["Monday", "", "B", "C"]]),
    sampleTable([["Monday", "A", "B", "C"], ["Tuesday", "D", "E", "F"], ["Wednesday", "G", "H", "I"], ["Thursday", "J", "K", "L"], ["Friday", "M", "N", "O"], ["Saturday", "P", "Q", "R"], ["Sunday", "S", "T", "U"], ["Monday", "V", "W", "X"]]),
  ];
  for (const text of invalidTables) assert.throws(() => parser.parseMealPlan(text, "2026-08-10"), parser.MealPlanParseError);
  assert.throws(() => parser.parseMealPlan(sampleTable([["Monday", "A", "B", "C"]]), "2026-08-11"), /Monday/);
  assert.equal(parser.isParseableMealPlan("ordinary Hermes reply"), false);
});

test("parseMealPlan truncates cleaned titles at 120 characters", () => {
  const longTitle = "x".repeat(160);
  const items = parser.parseMealPlan(sampleTable([["Monday", longTitle, "Lunch", "Dinner"]]), "2026-08-10");
  assert.equal(items[0].title.length, 120);
});

"use strict";
// The main Today page (index.html) carries the Screen Time card: parents answer
// kids' asks (more time / stay up later), kids ask. Static wiring checks.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("index.html mounts the Screen Time card and loads its script + styles", () => {
  const html = read("public/index.html");
  assert.match(html, /<section class="st-today" id="st-today" aria-label="Screen Time" hidden><\/section>/);
  assert.match(html, /<script src="\/js\/screen-time-today.js"><\/script>/);
  assert.match(html, /href="\/css\/screen-time-today.css"/);
  assert.ok(html.indexOf('id="st-today"') < html.indexOf('class="today-people"'), "sits above the kid cards");
});

test("app.js refreshes it with Today and clears it on sign-out", () => {
  const app = read("public/js/app.js");
  assert.match(app, /window\.famScreenTimeToday\?\.refresh\(\)/);
  assert.equal((app.match(/window\.famScreenTimeToday\?\.clear\(\)/g) || []).length, 2);
});

test("screen-time-today.js uses the bedtime + request routes and escapes text", () => {
  const js = read("public/js/screen-time-today.js");
  for (const route of ["/api/screen-time/mine", "/api/screen-time/requests", "/bedtime`", "\"approve\" : \"decline\""]) assert.ok(js.includes(route), route);
  assert.ok(!/innerHTML\s*=\s*`/.test(js), "renders through h()-escaped templates assigned via paint()");
  assert.doesNotThrow(() => new Function(js));
});

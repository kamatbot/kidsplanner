"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const styles = fs.readFileSync(path.join(root, "public/css/today-home.css"), "utf8");
const markup = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/js/app.js"), "utf8");

test("Today stacks what needs you beside the day in three bands that collapse by container width", () => {
  assert.match(styles, /#tab-today\s*\{[^}]*container:\s*today\s*\/\s*inline-size;[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*1280px/s);
  assert.match(styles, /@container today \(min-width:\s*760px\)\s*\{[^@]*\.today-band-now,\s*#tab-today \.today-band-home\s*\{\s*grid-template-columns:\s*minmax\(0,\s*3fr\)\s+minmax\(0,\s*2fr\)/);
  assert.match(styles, /@container today \(min-width:\s*1060px\)\s*\{[^@]*\.today-band-learn\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
  assert.match(styles, /#tab-today \.today-band\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(styles, /#tab-today:not\(\.active\)\s*\{\s*display:\s*none/);
  assert.match(styles, /\.app-shell:has\(#tab-today\.active\) \.main-content\s*\{\s*scrollbar-gutter:\s*stable/);
  const today = markup.slice(markup.indexOf('id="tab-today"'), markup.indexOf('id="tab-calendar"'));
  const order = ['today-band-now', 'today-band-home', 'today-band-learn'].map((band) => today.indexOf(band));
  assert.ok(order.every((index) => index > 0) && order[0] < order[1] && order[1] < order[2]);
  assert.ok(today.indexOf('id="today-actions-card"') < today.indexOf('id="today-agenda-title"'));
});

test("Daily 3 offers one mounted panel per accessible tab", () => {
  for (const key of ['news', 'quote', 'word']) {
    assert.match(markup, new RegExp(`id="daily5-tab-${key}"[^>]*role="tab"[^>]*aria-controls="daily5-panel-${key}"`));
    assert.match(markup, new RegExp(`id="daily5-panel-${key}"[^>]*role="tabpanel"[^>]*aria-labelledby="daily5-tab-${key}"`));
  }
  assert.match(styles, /#tab-today \.daily5-panel\[hidden\]\s*\{\s*display:\s*none/);
});

test("Calendar uses the existing collapsed chat rail", () => {
  assert.match(app, /const CHAT_DOCK_MODE\s*=\s*\{[^}]*today:\s*'open',[^}]*calendar:\s*'collapsed',[^}]*notes:\s*'hidden',\s*settings:\s*'hidden'/);
  assert.match(app, /const CHAT_DOCK_MODE\s*=\s*\{[^}]*child:\s*'collapsed'/);
});

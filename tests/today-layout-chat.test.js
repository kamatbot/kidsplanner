"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const styles = fs.readFileSync(path.join(root, "public/css/today-home.css"), "utf8");
const markup = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/js/app.js"), "utf8");

test("Today puts the needs-you hero before kid rings, day strip and learning", () => {
  assert.match(styles, /#tab-today\s*\{[^}]*container:\s*today\s*\/\s*inline-size/s);
  assert.match(styles, /#tab-today:not\(\.active\)\s*\{\s*display:\s*none/);
  assert.match(styles, /\.app-shell:has\(#tab-today\.active\) \.main-content\s*\{\s*scrollbar-gutter:\s*stable/);
  const today = markup.slice(markup.indexOf('id="tab-today"'), markup.indexOf('id="tab-calendar"'));
  const order = ['id="today-actions-card"', 'id="today-fams-body"', 'id="today-agenda-title"', 'class="fr-learning-tiles"'].map(id => today.indexOf(id));
  assert.ok(order.every(index => index > 0) && order.every((index, i) => !i || order[i - 1] < index));
  assert.match(today, /id="today-parent-ring"[^>]*aria-live="polite"/);
  assert.match(today, /id="today-actions-count"[^>]*onclick="openAllFamilyActions\(\)"/);
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

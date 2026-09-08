"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const styles = fs.readFileSync(path.join(root, "public/css/today-home.css"), "utf8");
const markup = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/js/app.js"), "utf8");

test("Today gives priorities more space beside the agenda and stacks on mobile", () => {
  assert.match(styles, /#tab-today\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*1280px/s);
  assert.match(styles, /\.today-brief-primary\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*2fr\)\s+minmax\(280px,\s*1fr\)/s);
  assert.match(styles, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.today-brief-primary\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(styles, /#tab-today:not\(\.active\)\s*\{\s*display:\s*none/);
  assert.match(styles, /\.app-shell:has\(#tab-today\.active\) \.main-content\s*\{\s*scrollbar-gutter:\s*stable/);
});

test("Daily 5 offers one mounted panel per accessible tab", () => {
  for (const key of ['news', 'word', 'puzzle', 'quiz', 'quote']) {
    assert.match(markup, new RegExp(`id="daily5-tab-${key}"[^>]*role="tab"[^>]*aria-controls="daily5-panel-${key}"`));
    assert.match(markup, new RegExp(`id="daily5-panel-${key}"[^>]*role="tabpanel"[^>]*aria-labelledby="daily5-tab-${key}"`));
  }
  assert.match(styles, /#tab-today \.daily5-panel\[hidden\]\s*\{\s*display:\s*none/);
});

test("Calendar uses the existing collapsed chat rail", () => {
  assert.match(app, /const CHAT_DOCK_MODE\s*=\s*\{[^}]*today:\s*'open',[^}]*calendar:\s*'collapsed',[^}]*notes:\s*'hidden',\s*settings:\s*'hidden'/);
  assert.match(app, /const CHAT_DOCK_MODE\s*=\s*\{[^}]*child:\s*'collapsed'/);
});

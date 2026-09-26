'use strict';
// Koko and My Corner are iOS-only; the web ships neither (owner decision 2026-09-26).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the web ships no Koko study pal for anyone', () => {
  const root = path.join(__dirname, '..');
  for (const file of ['public/js/study-pal.js', 'public/css/study-pal.css', 'public/img/study-pal']) {
    assert.equal(fs.existsSync(path.join(root, file)), false, `${file} should not ship`);
  }
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
  assert.ok(!/study-pal|today-study-pal/.test(html), 'index.html must not load or mount Koko');
  assert.ok(!/FamStudyPal/.test(app), 'app.js must not render Koko');
});

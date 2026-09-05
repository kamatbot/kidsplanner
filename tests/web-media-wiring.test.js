'use strict';
// The media modules were committed but never connected to either chat surface,
// which is invisible to every behavioural test: the code is present, correct,
// and unreachable. These assertions pin the wiring itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const index = read('public/index.html');
const trips = read('public/trips.html');
const app = read('public/js/app.js');
const tripsJs = read('public/js/trips.js');

// media-compression defines the global that chat-media calls, and both must be
// parsed before the file that opens the composer.
function assertLoadOrder(html, label, consumer) {
  const order = ['/js/media-compression.js', '/js/chat-media.js', consumer]
    .map((src) => ({ src, at: html.indexOf(src) }));
  for (const { src, at } of order) assert.notEqual(at, -1, `${label} loads ${src}`);
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1].at < order[i].at, `${label}: ${order[i - 1].src} must load before ${order[i].src}`);
  }
}

test('family chat loads the media modules and exposes the attachment button', () => {
  assert.match(index, /<link rel="stylesheet" href="\/css\/chat-media\.css">/);
  assertLoadOrder(index, 'index.html', '/js/app.js');
  // the button lives inside the composer form, not merely somewhere on the page
  const form = index.match(/<form id="chat-send-form"[\s\S]*?<\/form>/)?.[0];
  assert.ok(form, 'family composer form exists');
  assert.match(form, /class="chat-media-add"/);
  assert.match(form, /onclick="openFamilyChatMedia\(\)"/);
  assert.match(form, /aria-label="Share a photo or video"/);
  assert.match(app, /function openFamilyChatMedia\(\)/);
  assert.match(app, /roomId: 'family'/);
  // a sent attachment must go through the id-deduping merge, never a raw push
  assert.match(app, /openFamilyChatMedia[\s\S]*?mergeChatMessages\(\[message\]\)/);
});

test('trip chat loads the media modules and exposes the attachment button', () => {
  assert.match(trips, /<link rel="stylesheet" href="\/css\/chat-media\.css">/);
  assertLoadOrder(trips, 'trips.html', '/js/trips.js');
  const form = tripsJs.match(/<form class="chat-send-row" onsubmit="tripSendChatMessage[\s\S]*?<\/form>/)?.[0];
  assert.ok(form, 'trip composer form exists');
  assert.match(form, /class="chat-media-add"/);
  assert.match(form, /onclick="openTripChatMedia\(\)"/);
  assert.match(tripsJs, /function openTripChatMedia\(\)/);
  assert.match(tripsJs, /roomId: 'trip:' \+ tripId/);
  assert.match(tripsJs, /openTripChatMedia[\s\S]*?tripMergeChatMessages\(\[message\]\)/);
});

test('the trip composer pins its room so a tab switch cannot retarget the send', () => {
  // currentTripId is captured once at open; isCurrent compares against that
  // snapshot rather than reading the live value.
  assert.match(tripsJs, /const tripId = currentTripId;/);
  assert.match(tripsJs, /isCurrent: \(\) => currentTripId === tripId && currentTab === 'chat'/);
});

test('both surfaces degrade politely if the media modules fail to load', () => {
  for (const [label, src] of [['app.js', app], ['trips.js', tripsJs]]) {
    assert.match(src, /if \(!window\.FamChatMedia \|\| !window\.FamMediaCompression\)/, `${label} guards on the globals`);
  }
});

test('the temporary branch-workspace workflow is gone', () => {
  assert.equal(fs.existsSync(path.join(root, '.github/workflows/branch-workspace.yml')), false);
  assert.equal(fs.existsSync(path.join(root, '.github/workflows/ci.yml')), true);
});

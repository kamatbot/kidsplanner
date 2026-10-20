"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public/displays.html"), "utf8");
const js = fs.readFileSync(path.join(root, "public/js/displays.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/css/displays.css"), "utf8");

test("displays page has a Night photos section with a labelled file input and live status", () => {
  assert.match(html, /<section id="photos-section"[^>]*aria-labelledby="photos-title"/);
  assert.match(html, /Night photos/);
  assert.match(html, /8:30 pm to 6 am/);
  assert.match(html, /<label[^>]*for="photo-input"[^>]*>[\s\S]*<input id="photo-input"[^>]*type="file"[^>]*accept="image\/\*"[^>]*multiple/);
  assert.match(html, /id="photos-status"[^>]*aria-live="polite"/);
  assert.ok(html.indexOf('id="device-list"') < html.indexOf('id="photos-section"'), "after the device list");
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i, "no inline scripts");
});

test("photo JS uploads re-encoded JPEG FormData, caps size, and deletes via the photos API", () => {
  assert.match(js, /new FormData\(\)/);
  assert.match(js, /form\.append\("photo"/);
  assert.match(js, /"\/api\/displays\/photos",\s*\{\s*method: "POST"/);
  assert.match(js, /canvas\.toBlob\(resolve, "image\/jpeg", 0\.86\)/);
  assert.match(js, /PHOTO_LONG_EDGE = 2048/);
  assert.match(js, /Math\.min\(1, PHOTO_LONG_EDGE/); // never upscale
  assert.match(js, /imageOrientation: "from-image"/);
  assert.match(js, /`\/api\/displays\/photos\/\$\{encodeURIComponent\(photo\.id\)\}`,\s*\{\s*method: "DELETE"/);
  assert.match(js, /window\.confirm\(/);
  assert.match(js, /aria-label", "Remove photo"/);
  assert.match(js, /Adding \$\{i \+ 1\} of \$\{queue\.length\}…/);
  assert.doesNotMatch(js, /["']Content-Type["']:\s*["']multipart/i);
  assert.doesNotMatch(js, /\.innerHTML\s*=|insertAdjacentHTML/);
});

test("photo grid styles are responsive with square crops and 44px targets", () => {
  assert.match(css, /\.photo-thumb \{[^}]*aspect-ratio: 1;[^}]*object-fit: cover/);
  assert.match(css, /\.photo-grid \{[^}]*repeat\(2,/);
  assert.match(css, /min-width: 781px\) \{ \.photo-grid \{[^}]*repeat\(4,/);
  assert.match(css, /\.photo-remove \{[^}]*min-height: 44px/);
});

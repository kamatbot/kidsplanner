"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const landing = fs.readFileSync(path.join(root, "public/landing.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/css/landing.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "public/manifest.webmanifest"), "utf8"));

function pngDimensions(file) {
  const data = fs.readFileSync(path.join(root, file));
  assert.equal(data.toString("ascii", 1, 4), "PNG", `${file} is a PNG`);
  assert.equal(data.toString("ascii", 12, 16), "IHDR", `${file} has an IHDR`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

test("landing page states free-forever STA access and keeps pricing/signup paths", () => {
  assert.match(landing, /Free forever for STA parents/);
  assert.match(landing, /Invite-only pilot/);
  assert.match(landing, /STA invite code/);
  assert.match(landing, /href="\/signup"/);
  assert.match(landing, /href="\/pricing"/);
  assert.doesNotMatch(landing, /30-day free trial|free for 30 days|annual plan|TBD/i);
  assert.doesNotMatch(landing, /chores/i);
});

test("landing page describes the honest Moodle and privacy flow", () => {
  assert.match(landing, /From Settings, a parent can connect Moodle and import/);
  assert.match(landing, /Chrome extension while signed into Moodle/);
  assert.match(landing, /parent-only and read-only/);
  assert.match(landing, /never posts as you/);
  assert.match(landing, /href="\/privacy"/);
  assert.match(landing, /See how Moodle sync works/);
  assert.doesNotMatch(landing, /keeps itself current|checks again through the day|on their own/i);
});

test("landing page uses shipped family planning language", () => {
  assert.match(landing, /Family planning/);
  assert.match(landing, /meals/);
  assert.match(landing, /trips/);
  assert.doesNotMatch(landing, /approve chores|Chores/i);
});

test("landing CSS protects anchors, focus, touch targets, and narrow layouts", () => {
  assert.match(styles, /section\[id\]\s*\{[^}]*scroll-margin-top:\s*88px/s);
  assert.match(styles, /outline:\s*3px solid var\(--accent\)/);
  assert.match(styles, /\.site-nav a,\s*\.footer-links a\s*\{[^}]*min-height:\s*44px/s);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.header-create\s*\{\s*display: none;/);
  assert.doesNotMatch(styles, /\.header-signin\s*\{\s*display:\s*none;/);
});

test("manifest and linked icons use the four-tile mark at exact sizes", () => {
  const svg = fs.readFileSync(path.join(root, "public/icons/fametc-mark.svg"), "utf8");
  assert.match(svg, /#f0704f/);
  assert.match(svg, /#6f43d6/);
  assert.equal(manifest.icons.find((icon) => icon.src.endsWith("fametc-mark.svg")).type, "image/svg+xml");
  assert.deepEqual(pngDimensions("public/icons/fametc-192.png"), { width: 192, height: 192 });
  assert.deepEqual(pngDimensions("public/icons/fametc-512.png"), { width: 512, height: 512 });
  assert.deepEqual(pngDimensions("public/icons/apple-touch-icon.png"), { width: 180, height: 180 });
  assert.match(landing, /rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/);
});

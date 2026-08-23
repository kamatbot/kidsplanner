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

test("landing page states free STA access and keeps pricing/signup paths", () => {
  assert.match(landing, /Free for STA parents/);
  assert.match(landing, /Invite-only pilot/);
  assert.match(landing, /STA invite code/);
  assert.match(landing, /href="\/signup"/);
  assert.match(landing, /href="\/pricing"/);
  assert.doesNotMatch(landing, /30-day free trial|free for 30 days|annual plan|TBD/i);
  assert.doesNotMatch(landing, /chores/i);
});

test("landing hero has controlled hierarchy, one proof artifact, and a useful resolution moment", () => {
  const hero = landing.match(/<section class="section hero"[\s\S]*?<\/section>/)?.[0];
  assert.ok(hero);
  assert.match(hero, /class="hero-copy"/);
  assert.match(hero, /class="preview-card" role="img" aria-label="Fam ETC family dashboard preview"/);
  assert.match(hero, /class="preview-browser-bar" aria-hidden="true"/);
  assert.equal((hero.match(/class="preview-browser-dots"/g) || []).length, 1);
  assert.match(hero, /www\.fametc\.com/);
  assert.match(hero, /class="dashboard-viewport" aria-hidden="true"/);
  assert.match(hero, /class="dashboard-sidebar"/);
  assert.match(hero, /class="dashboard-main"/);
  assert.match(hero, /class="dashboard-chat"/);
  for (const label of ["Today", "Calendar", "Homework", "Chat", "Meals", "Trips"]) {
    assert.match(hero, new RegExp(`class="dashboard-nav-item(?: active)?"[^>]*><span><\\/span>${label}`));
  }
  assert.match(hero, /Good afternoon, Priya/);
  assert.match(hero, /Family actions/);
  assert.match(hero, /Today’s schedule/);
  assert.match(hero, /Homework due/);
  assert.match(hero, /Daily 5/);
  assert.match(hero, /House points/);
  assert.match(hero, /Family Chat/);
  assert.match(hero, /Message the family…/);
  assert.match(hero, /class="resolution-flow" aria-label="How school information becomes a family plan"/);
  for (const label of ["Moodle", "Today", "Family-ready"]) {
    assert.match(hero, new RegExp(`class="resolution-label">${label}<`));
  }
  assert.equal((hero.match(/class="resolution-flow"/g) || []).length, 1);
  assert.doesNotMatch(hero, /preview-stack|preview-block|preview-grid|kid-switcher/);
  assert.match(styles, /\.hero\s*\{[\s\S]*?display:\s*block;/);
  assert.match(styles, /\.hero-copy\s*\{[\s\S]*?max-width:\s*880px;[\s\S]*?text-align:\s*center;/);
  assert.match(styles, /\.hero h1\s*\{[\s\S]*?max-width:\s*780px;[\s\S]*?font-size:\s*clamp\(3rem, 7vw, 5\.25rem\);/);
  assert.match(styles, /\.hero-lede\s*\{[\s\S]*?max-width:\s*62ch;/);
  assert.match(styles, /\.resolution-flow\s*\{[\s\S]*?animation:\s*famResolve/);
  assert.match(styles, /\.dashboard-viewport\s*\{[\s\S]*?aspect-ratio:\s*1120 \/ 700;[\s\S]*?overflow:\s*hidden;/);
  assert.match(styles, /\.dashboard-preview\s*\{[\s\S]*?grid-template-columns:\s*176px minmax\(0, 1fr\) 254px;[\s\S]*?scale:\s*min\(1, calc\(100cqw \/ 1120px\)\);/);
  assert.doesNotMatch(styles, /\.preview-(?:stack|block|grid)\b/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*?\.dashboard-viewport\s*\{[\s\S]*?overflow-x:\s*auto;/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*?\.dashboard-preview\s*\{[\s\S]*?scale:\s*0\.52;/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.resolution-flow\s*\{\s*animation:\s*none;/);
  assert.doesNotMatch(styles, /@keyframes famRise|animation:\s*famRise/);
});

test("landing public copy makes no permanence or obsolete product promise", () => {
  assert.doesNotMatch(landing, /forever|30-day|trial deadline|annual plan|TBD|TODO|no-cost/i);
  assert.doesNotMatch(landing, /keeps itself current|checks again through the day|automatic(?:ally)? sync/i);
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

test("landing features use editorial groups and FAQ uses native disclosures", () => {
  const features = landing.match(/<section id="features"[\s\S]*?<\/section>\s*<section id="kids"/)?.[0];
  assert.ok(features);
  assert.match(features, /class="feature-groups"/);
  assert.equal((features.match(/class="feature-group"/g) || []).length, 2);
  assert.equal((features.match(/<li>/g) || []).length, 8);
  assert.doesNotMatch(features, /feature-number|feature-card|feature-grid/);

  const faq = landing.match(/<section id="faq"[\s\S]*?<\/section>/)?.[0];
  assert.ok(faq);
  assert.equal((faq.match(/<details class="faq-item">/g) || []).length, 4);
  assert.equal((faq.match(/<summary>/g) || []).length, 4);
  assert.doesNotMatch(faq, /onclick|aria-expanded/);
  assert.match(styles, /\.faq-item summary\s*\{[\s\S]*?min-height:\s*64px;/);
  assert.match(styles, /\.faq-item summary:focus-visible\s*\{[\s\S]*?outline:\s*3px solid var\(--accent\)/);
  assert.doesNotMatch(styles, /\.feature-card|\.feature-grid|\.faq-card|\.faq-grid/);
});

test("landing CSS protects anchors, focus, touch targets, and narrow layouts", () => {
  assert.match(styles, /section\[id\]\s*\{[^}]*scroll-margin-top:\s*88px/s);
  assert.match(styles, /outline:\s*3px solid var\(--accent\)/);
  assert.match(styles, /\.site-nav a,\s*\.footer-links a\s*\{[^}]*min-height:\s*44px/s);
  assert.match(styles, /\.button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(styles, /\.landing-shell\s*\{[^}]*overflow:\s*clip/s);
  assert.match(styles, /::selection\s*\{[\s\S]*?background:\s*var\(--accent\)/);
  assert.match(styles, /\.button:active\s*\{[\s\S]*?transform:\s*translateY\(1px\)/);
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

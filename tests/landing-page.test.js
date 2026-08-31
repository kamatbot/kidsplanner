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
  assert.match(landing, /STA invite code/);
  assert.match(landing, /href="\/signup"/);
  for (const destination of ["/login", "/pricing", "/privacy", "/help", "#moodle", "#features", "#kids", "#faq"]) {
    assert.match(landing, new RegExp(`href="${destination.replace("#", "\\#")}"`));
  }
  assert.match(landing, /href="\/pricing"/);
  assert.doesNotMatch(landing, /30-day free trial|free for 30 days|annual plan|TBD/i);
  assert.doesNotMatch(landing, /chores/i);
});

test("landing hero centers the intro above a browser-framed full-width preview", () => {
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
  assert.match(hero, /class="hero-stage"/);
  assert.doesNotMatch(hero, /class="hero-proof"/);
  assert.doesNotMatch(hero, /class="hero-pricing"/);
  assert.doesNotMatch(hero, /See pricing|Invitations are required to sign up\./);
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
  assert.doesNotMatch(hero, /preview-stack|preview-block|preview-grid|kid-switcher/);
  assert.match(styles, /\.hero\s*\{[\s\S]*?display:\s*block;/);
  assert.match(styles, /\.hero-copy\s*\{[\s\S]*?max-width:\s*none;[\s\S]*?text-align:\s*center;/);
  assert.match(styles, /\.hero h1\s*\{[\s\S]*?max-width:\s*none;[\s\S]*?font-size:\s*clamp\(44px, 5vw, 46px\);/);
  assert.match(styles, /\.hero-lede\s*\{[\s\S]*?max-width:\s*none;/);
  assert.match(styles, /@media \(max-width: 980px\)[\s\S]*?\.hero-copy\s*\{\s*max-width:\s*760px;/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.hero h1\s*\{\s*font-size:\s*clamp\(38px, 11vw, 50px\);/);
  assert.match(styles, /\.hero-stage\s*\{[\s\S]*?width:\s*min\(var\(--landing-stage\), calc\(100vw - 40px\)\);[\s\S]*?transform:\s*translateX\(-50%\);/);
  assert.match(styles, /\.dashboard-viewport\s*\{[\s\S]*?aspect-ratio:\s*1360 \/ 700;[\s\S]*?overflow:\s*hidden;/);
  assert.match(styles, /\.dashboard-preview\s*\{[\s\S]*?width:\s*1360px;[\s\S]*?grid-template-columns:\s*208px minmax\(0, 1fr\) 308px;[\s\S]*?scale:\s*calc\(100cqw \/ 1360px\);/);
  assert.doesNotMatch(styles, /\.preview-(?:stack|block|grid)\b/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("landing uses one wide stage for header, sections, FAQ, and footer", () => {
  assert.match(styles, /:root\s*\{[\s\S]*?--landing-stage:\s*1440px;/);
  assert.match(styles, /\.header-inner,\s*\n\.section,\s*\n\.footer-inner\s*\{[\s\S]*?width:\s*min\(var\(--landing-stage\), 100%\);/);
  assert.match(styles, /\.faq-list\s*\{[\s\S]*?width:\s*100%;/);
  assert.doesNotMatch(styles, /width:\s*min\(1180px, 100%\)|\.faq-list\s*\{[\s\S]*?max-width:\s*900px;/);
});

test("landing page adds exactly two semantic product proof previews", () => {
  const proofSection = landing.match(/<section class="section proof-section"[\s\S]*?<\/section>/)?.[0];
  assert.ok(proofSection);
  assert.equal((proofSection.match(/<figure class="product-preview/g) || []).length, 2);
  assert.match(proofSection, /id="proof-title"/);
  assert.match(proofSection, /Calendar/);
  assert.match(proofSection, /ALL DAY/);
  assert.match(proofSection, /08:00/);
  assert.match(proofSection, /class="calendar-times"/);
  assert.match(proofSection, /class="audience-chip kid-chip"/);
  assert.match(proofSection, /class="audience-chip parent-chip"/);
  assert.match(proofSection, /Chat Actions/);
  assert.match(proofSection, /Turn this message into/);
  assert.match(proofSection, /Shopping item ready/);
  assert.match(proofSection, /<figcaption>/);
  assert.match(proofSection, /aria-hidden="true"/);
  for (const privateName of ["Ryshi", "Arya", "Mona"]) {
    assert.doesNotMatch(proofSection, new RegExp(privateName, "i"));
  }
  assert.doesNotMatch(proofSection, /https?:\/\/|private|school-specific/i);
});

test("landing FAQ uses the restored native disclosure bars", () => {
  const faq = landing.match(/<section id="faq"[\s\S]*?<\/section>/)?.[0];
  assert.ok(faq);
  assert.equal((faq.match(/<details class="faq-item">/g) || []).length, 4);
  assert.equal((faq.match(/<summary>/g) || []).length, 4);
  assert.equal((faq.match(/class="faq-answer"/g) || []).length, 4);
  assert.doesNotMatch(landing, /faq-grid|faq-card|faq-question/);
  assert.match(styles, /\.faq-list\s*\{[\s\S]*?border-top:\s*1px solid var\(--border\);/);
  assert.match(styles, /\.faq-item summary\s*\{[\s\S]*?min-height:\s*64px;[\s\S]*?cursor:\s*pointer;/);
  assert.match(styles, /\.faq-item\[open\] summary::after/);
  assert.match(styles, /\.faq-item summary:focus-visible/);
});

test("landing public copy makes no permanence or obsolete product promise", () => {
  assert.doesNotMatch(landing, /forever|30-day|trial deadline|annual plan|TBD|TODO|no-cost/i);
  assert.doesNotMatch(landing, /keeps itself current|checks again through the day|automatic(?:ally)? sync/i);
});

test("landing page describes the honest Moodle and privacy flow", () => {
  assert.match(landing, /From Settings, a parent can connect Moodle and import/);
  assert.match(landing, /Chrome extension while signed into Moodle/);
  assert.match(landing, /Parent-controlled/);
  assert.match(landing, /mark that exact task complete/);
  assert.doesNotMatch(landing, /never posts as you/);
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

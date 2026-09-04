"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const landing = fs.readFileSync(path.join(root, "public/landing.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/css/landing.css"), "utf8");
const script = fs.readFileSync(path.join(root, "public/js/landing.js"), "utf8");
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
  for (const destination of ["/login", "/pricing", "/privacy", "/help", "#features", "#chat", "#school-sync", "#devices", "#day", "#faq"]) {
    assert.match(landing, new RegExp(`href="${destination.replace("#", "\\#")}"`));
  }
  // every in-page link resolves to an element that exists
  for (const anchor of landing.match(/href="#[a-z-]+"/g) || []) {
    const id = anchor.slice(7, -1);
    assert.match(landing, new RegExp(`id="${id}"`), `no element with id="${id}"`);
  }
  // sections that carry an id but are reached by scrolling, not by a link
  for (const id of ["kids", "privacy"]) assert.match(landing, new RegExp(`id="${id}"`));
  // /#moodle was the school-sync anchor before the 2026 re-composition;
  // external links (school newsletters) must keep working.
  assert.match(landing, /id="moodle" class="legacy-anchor"/);
  assert.doesNotMatch(landing, /chores/i);
});

// The 2026 re-composition. Hero = ONE legible surface (the Today card) plus a
// few floating elements, NOT the whole app scaled down to 6px type.
test("landing hero shows one legible Today card with floating context", () => {
  const hero = landing.match(/<section class="section hero"[\s\S]*?<\/section>/)?.[0];
  assert.ok(hero);
  assert.match(hero, /class="hero-copy"/);
  assert.match(hero, /class="hero-stage"/);
  assert.match(hero, /Everyone knows what today looks like\./);
  assert.match(hero, /class="today-card"/);
  assert.match(hero, /Good morning, Priya/);
  // exactly three floating elements, each with its own accessible label
  assert.equal((hero.match(/class="float float-/g) || []).length, 3);
  assert.match(hero, /class="float float-chat" aria-label="Family chat message"/);
  assert.match(hero, /class="float float-due" aria-label="Homework due"/);
  assert.match(hero, /class="float float-sync" aria-label="School sync notice"/);
  // the old scaled-down application mock is gone for good
  assert.doesNotMatch(landing, /dashboard-|preview-card|preview-browser|product-window|proof-section|calendar-times|audience-chip/);
  assert.match(styles, /\.hero\s*\{[^}]*grid-template-columns:\s*minmax\(0,520px\)/);
  assert.match(styles, /\.today-card\{[^}]*width:460px/);
});

test("landing keeps one wide stage token for header, sections and footer", () => {
  assert.match(styles, /:root\s*\{[\s\S]*?--landing-stage:\s*1440px;/);
  assert.match(styles, /\.header-inner,\s*\n\.section,\s*\n\.footer-inner\{[^}]*width:\s*min\(var\(--landing-stage\), 100%\);/);
});

// The chat -> action sequence is the page's centrepiece: three legible beats.
test("landing builds the chat-to-action sequence in three beats", () => {
  const chat = landing.match(/<section id="chat"[\s\S]*?<\/section>/)?.[0];
  assert.ok(chat);
  assert.equal((chat.match(/class="chat-beat"/g) || []).length, 3);
  assert.match(chat, /class="chat-sequence " data-reveal/);
  assert.match(chat, /Turn this message into/);
  assert.match(chat, /Added to Shopping/);
  for (const item of ["Pasta", "Tomatoes", "Basil"]) assert.match(chat, new RegExp(item));
});

// Regression guard: with JS off (or no IntersectionObserver) every beat must
// still be visible. The hidden state is gated behind html.js.
test("chat beats are only hidden once the script has run", () => {
  assert.match(styles, /html\.js \.chat-sequence:not\(\.is-in\) \.chat-beat\{opacity:0/);
  assert.doesNotMatch(styles, /\.chat-beat\{position:relative;opacity:0/);
  assert.match(script, /classList\.add\('js'\)/);
  assert.match(script, /IntersectionObserver/);
  // a fractional threshold can never be met by an element taller than the
  // viewport, which would leave the section permanently hidden
  assert.match(script, /threshold:\s*0\b/);
  assert.doesNotMatch(script, /threshold:\s*0\.\d/);
  // and if the observer never fires at all, reveal anyway
  assert.match(script, /setTimeout\([\s\S]*?is-in[\s\S]*?\}, 2000\)/);
});

test("kid/parent modes are one component with two real tab panels", () => {
  const modes = landing.match(/<section id="kids"[\s\S]*?<\/section>/)?.[0];
  assert.ok(modes);
  assert.equal((modes.match(/role="tabpanel"/g) || []).length, 2);
  assert.equal((modes.match(/class="mode-tab"/g) || []).length, 2);
  assert.match(modes, /id="mode-kid" aria-labelledby="tab-kid"/);
  assert.match(modes, /id="mode-parent" aria-labelledby="tab-parent" hidden/);
  assert.equal((modes.match(/class="mode-text"/g) || []).length, 2);
  // keyboard support for the tablist is required, not optional
  assert.match(script, /ArrowRight/);
  assert.match(script, /aria-selected/);
});

test("landing FAQ uses native disclosure bars", () => {
  const faq = landing.match(/<section id="faq"[\s\S]*?<\/section>/)?.[0];
  assert.ok(faq);
  const count = (faq.match(/<details class="faq-item">/g) || []).length;
  assert.ok(count >= 4, `expected at least 4 FAQ items, got ${count}`);
  assert.equal((faq.match(/<summary>/g) || []).length, count);
  assert.equal((faq.match(/class="faq-answer"/g) || []).length, count);
  assert.doesNotMatch(landing, /faq-grid|faq-card|faq-question/);
  assert.match(styles, /\.faq-item\[open\] summary::after/);
  assert.match(styles, /\.faq-item summary:focus-visible/);
});

// Standing decision from 983a9c7 ("soften free copy"): the landing makes no
// permanence or pricing promise, and never implies sync is continuous.
test("landing public copy makes no permanence or obsolete product promise", () => {
  assert.doesNotMatch(landing, /forever|30-day|trial deadline|annual plan|TBD|TODO|no-cost/i);
  assert.doesNotMatch(landing, /keeps itself current|checks again through the day|automatic(?:ally)? sync/i);
});

test("landing page describes the honest private-feed and privacy flow", () => {
  assert.match(landing, /A parent pastes each child's private homework and timetable links once/);
  assert.match(landing, /read-only synchronization every eight hours/);
  assert.match(landing, /Parent-controlled/);
  assert.match(landing, /never shown again after you paste it/);
  assert.doesNotMatch(landing, /never posts as you/);
  assert.match(landing, /href="\/privacy"/);
  assert.doesNotMatch(landing, /keeps itself current|checks again through the day|on their own/i);
});

test("landing promotes privacy and safety to its own band", () => {
  const privacy = landing.match(/<section id="privacy"[\s\S]*?<\/section>/)?.[0];
  assert.ok(privacy);
  assert.equal((privacy.match(/<li>/g) || []).length, 5);
  assert.match(privacy, /Encrypted at rest/);
  assert.match(privacy, /School sync is read-only/);
  assert.match(privacy, /No ads, no tracking/);
  assert.match(privacy, /Kids can't sign up alone/);
  assert.match(privacy, /Parents keep the keys/);
});

test("landing page uses shipped family planning language", () => {
  assert.match(landing, /Meals/);
  assert.match(landing, /Trips/);
  assert.doesNotMatch(landing, /approve chores|Chores/i);
});

test("landing mock data uses only the public sample family", () => {
  for (const privateName of ["Ryshi", "Arya", "Mona"]) {
    assert.doesNotMatch(landing, new RegExp(privateName, "i"));
  }
});

test("landing CSS protects anchors, focus, touch targets, and narrow layouts", () => {
  assert.match(styles, /section\[id\]\s*\{[^}]*scroll-margin-top:\s*88px/s);
  assert.match(styles, /\.legacy-anchor\s*\{[^}]*scroll-margin-top:\s*88px/s);
  assert.match(styles, /outline:\s*3px solid var\(--accent\)/);
  assert.match(styles, /\.site-nav a\{[^}]*min-height:44px/s);
  assert.match(styles, /\.footer-links a\{[^}]*min-height:44px/s);
  assert.match(styles, /\.mode-tab\{[^}]*min-height:44px/s);
  assert.match(styles, /@media \(max-width:520px\)[\s\S]*\.header-create\{display:none\}/);
  assert.doesNotMatch(styles, /\.header-signin\s*\{\s*display:\s*none;/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  // reduced motion must resolve every sequence to its final readable frame
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.chat-beat \{ opacity: 1 !important/);
});

// The design system is a contract (APP-BRIEF "Design (FINAL)"): tokens only,
// and the coral->violet gradient is rationed to one momentum element.
test("landing CSS uses Horizon tokens and rations the hero gradient", () => {
  assert.doesNotMatch(styles, /#[0-9a-fA-F]{6}/);
  assert.equal((styles.match(/linear-gradient|radial-gradient/g) || []).length, 1);
  assert.match(styles, /\.momentum-fill\{[^}]*linear-gradient\(90deg,var\(--coral\),var\(--accent\)\)/);
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

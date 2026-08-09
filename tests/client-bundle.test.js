"use strict";
/*
 * Browser-parity guard for the client scripts.
 *
 * The app shell loads several classic <script> tags (auth.js, school-stats.js,
 * app.js, ...). In a browser these SHARE one top-level lexical scope, so a
 * duplicate top-level `const`/`let`/`class`/`function` across two files is a
 * fatal "Identifier 'X' has already been declared" SyntaxError that stops the
 * whole app from executing (this once blanked the app in production).
 *
 * `node -c <file>` checks each file in ISOLATION and never catches this. This
 * test concatenates the scripts in load order and compiles them as one unit —
 * reproducing the shared global scope — so any such clash fails CI before it
 * can ship. Compiling (not running) needs no DOM.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PUBLIC = path.join(__dirname, "..", "public");

// Local (same-origin) <script src="/js/..."> the page loads, in document order.
// External CDN scripts and optional config.js are intentionally excluded — we
// only guard the scripts we ship that share global scope.
function localScriptSrcs(html) {
  const out = [];
  const re = /<script\b[^>]*\bsrc=["'](\/js\/[^"']+?)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1].replace(/\?.*$/, ""));
  return out;
}

function buildCombined(scriptSrcs) {
  return scriptSrcs
    .map((src) => {
      const rel = src.replace(/^\//, "");
      const code = fs.readFileSync(path.join(PUBLIC, rel), "utf8");
      return `// ===== ${src} =====\n${code}`;
    })
    .join("\n;\n");
}

test("index.html client scripts compile together without a global-scope clash", () => {
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  const scripts = localScriptSrcs(html);
  assert.ok(scripts.length >= 2, `expected several client scripts, found ${scripts.length}`);
  // app.js must be present and load last-ish (it depends on the others).
  assert.ok(scripts.some((s) => /\/app\.js$/.test(s)), "app.js should be loaded by index.html");

  const combined = buildCombined(scripts);
  try {
    // Parses the whole bundle as one script; a cross-file duplicate top-level
    // const/let/class throws "Identifier '...' has already been declared".
    new vm.Script(combined, { filename: "combined-client-bundle.js" });
  } catch (e) {
    assert.fail(
      `Client scripts clash in the shared global scope (${scripts.join(", ")}): ${e.message}. ` +
        `A top-level const/let/class/function is declared in more than one loaded script — ` +
        `wrap the helper file in an IIFE or rename. This would blank the app in the browser.`
    );
  }
});

test("the guard actually catches a duplicate top-level const (self-check)", () => {
  // Sanity: prove the mechanism above fails when a real clash exists, so the
  // test can't silently pass forever.
  const clashing = "const DUP = 1;\n;\nconst DUP = 2;";
  assert.throws(() => new vm.Script(clashing), /already been declared/);
});

test("meal status stays in Today and meal chat cards", () => {
  const source = fs.readFileSync(path.join(PUBLIC, "js", "app.js"), "utf8");
  assert.match(source, /card\.type === 'menu' \|\| card\.type === 'meal' \|\| card\.sourceType === 'meal'/);
  assert.match(source, /href="\/meals"/);
  assert.match(source, /Prep due today:/);
  assert.match(source, /Shopping: \$\{pendingShoppingCount\} pending/);
  assert.match(source, /Pantry low\/out:/);
});

test("Calendar keeps one main surface and header utility actions", () => {
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(PUBLIC, "js", "app.js"), "utf8");
  const school = fs.readFileSync(path.join(PUBLIC, "js", "school.js"), "utf8");
  const css = fs.readFileSync(path.join(PUBLIC, "css", "styles.css"), "utf8");

  assert.doesNotMatch(html, /mini-(?:calendar|cal)|calendar-tools/);
  assert.match(html, /class="cal-header-actions"/);
  assert.match(html, /onclick="openUploadModal\(\)"/);
  assert.match(html, /id="sidebar-add-school-cal"[^>]+onclick="openAddSchoolCalendarModal\(\)"/);
  assert.match(html, /id="btn-month"/);
  assert.match(app, /function renderCalendar\(\)/);
  assert.doesNotMatch(app, /renderMiniCal|miniMonth|miniCalPrev|miniCalNext|eventSpanDates|function jumpTo/);
  assert.doesNotMatch(school, /renderMiniCal/);
  assert.match(css, /--calendar-canvas-height:\s*560px/);
  assert.match(css, /\.week-view[^\n]*height:\s*var\(--calendar-canvas-height\)/);
  assert.match(css, /\.month-view[^\n]*height:\s*var\(--calendar-canvas-height\)/);
  assert.match(css, /\.calendar-tab-layout[^\n]*--calendar-canvas-height:\s*480px/);
  assert.match(css, /\.cal-header-action[^\n]*min-height:\s*44px/);
});

test("standalone Trips and Meals pages retain the shared navigation shell", () => {
  const pages = [
    { file: "trips.html", page: "trips", activeHref: "/trips" },
    { file: "meals.html", page: "meals", activeHref: "/meals" },
  ];
  const expectedLinks = [
    'href="/"',
    'href="/?tab=calendar"',
    'href="/?tab=homework"',
    'href="/goals?tab=goals"',
    'href="/activities?tab=activities"',
    'href="/trips"',
    'href="/meals"',
    'href="/?tab=notes"',
    'href="/settings?tab=settings"',
  ];

  for (const { file, page, activeHref } of pages) {
    const html = fs.readFileSync(path.join(PUBLIC, file), "utf8");
    assert.match(html, new RegExp(`class="standalone-app-shell" data-page="${page}"`));
    assert.match(html, new RegExp(`class="sidebar-nav-item active" href="${activeHref}" aria-current="page"`));
    for (const link of expectedLinks) assert.match(html, new RegExp(link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, /class="standalone-main-content-wrap"/);
    assert.match(html, new RegExp(`id="${page}-root" class="standalone-main-content"`));
  }
});

test("standalone Trips and Meals keep their intended headers and wide responsive canvases", () => {
  const mealsSrc = fs.readFileSync(path.join(PUBLIC, "js", "meals.js"), "utf8");
  const tripsSrc = fs.readFileSync(path.join(PUBLIC, "js", "trips.js"), "utf8");
  const mealsCss = fs.readFileSync(path.join(PUBLIC, "css", "meals.css"), "utf8");
  const tripsCss = fs.readFileSync(path.join(PUBLIC, "css", "trips.css"), "utf8");
  const stylesCss = fs.readFileSync(path.join(PUBLIC, "css", "styles.css"), "utf8");

  const listRender = tripsSrc.slice(tripsSrc.indexOf("function renderTripsList"), tripsSrc.indexOf("function tripsToggleNewForm"));
  assert.match(listRender, /class="trip-hub-header"/, "Trips list keeps its guest-facing header");
  assert.match(tripsSrc, /function tripHubHeaderHtml\(\)/);
  assert.match(tripsSrc, /tripHubHeaderHtml\(\)/, "Trips hub keeps the collaboration header");
  assert.match(tripsSrc, /Invite friends/);

  assert.match(mealsSrc, /class="meal-local-header"/);
  assert.match(mealsSrc, /class="meal-tabs"/);
  assert.doesNotMatch(mealsSrc, /meal-hub-header|mealBrandHtml|meal-brand|meal-household-strip/);
  for (const tab of ["tonight", "menu", "pantry", "shopping", "recipes"]) {
    assert.match(mealsSrc, new RegExp(`['"]${tab}['"]`), `Meals keeps the ${tab} tab contract`);
  }

  assert.match(mealsCss, /\.meal-main\s*\{[\s\S]*?max-width:\s*1320px/);
  assert.match(mealsCss, /\.meal-local-header-inner\s*\{[\s\S]*?max-width:\s*1320px/);
  assert.match(mealsCss, /\.meal-tabs-inner\s*\{[\s\S]*?max-width:\s*1320px/);
  assert.match(tripsCss, /\.trip-main\s*\{[\s\S]*?max-width:\s*1320px/);
  assert.match(tripsCss, /\.trip-hub-inner\s*\{[\s\S]*?max-width:\s*1320px/);
  assert.match(tripsCss, /\.trip-tabs-inner\s*\{[\s\S]*?max-width:\s*1320px/);
  assert.match(mealsCss, /\.meal-tabs-inner[\s\S]*?overflow-x:\s*auto/);
  assert.match(tripsCss, /\.trip-tabs-inner[\s\S]*?overflow-x:\s*auto/);
  assert.match(stylesCss, /@media \(max-width: 900px\)[\s\S]*?\.standalone-app-shell \{ flex-direction: column; \}/);
  assert.match(mealsCss, /@media \(max-width: 640px\)/);
  assert.match(tripsCss, /@media \(max-width: 640px\)/);
});

test("shared shell accepts tab deep links from standalone navigation", () => {
  const app = fs.readFileSync(path.join(PUBLIC, "js", "app.js"), "utf8");
  assert.match(app, /new URLSearchParams\(window\.location\.search\)\.get\('tab'\)/);
  assert.match(app, /switchNavTab\(requestedTab\)/);
});

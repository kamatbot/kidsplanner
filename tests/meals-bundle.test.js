"use strict";
/*
 * Browser-parity guard for public/meals.html's client scripts (Meals —
 * docs/MEALS-PLAN.md).
 *
 * meals.html is a SEPARATE page bundle from index.html — it loads auth.js +
 * util.js + meals.js, which share one top-level lexical scope in the browser
 * exactly like index.html's script set does. Same failure mode as
 * client-bundle.test.js / trips-bundle.test.js: a duplicate top-level
 * const/let/class/function across two of these files is a fatal "Identifier
 * 'X' has already been declared" SyntaxError that blanks the page. `node -c
 * <file>` checks each file in isolation and never catches this, so this test
 * concatenates them in load order and compiles the result as one unit.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PUBLIC = path.join(__dirname, "..", "public");

// Local (same-origin) <script src="/js/..."> the page loads, in document order.
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

const mealsSource = fs.readFileSync(path.join(PUBLIC, "js", "meals.js"), "utf8");

function extractFunction(source, name) {
  const functionToken = `function ${name}(`;
  const tokenStart = source.indexOf(functionToken);
  const start = tokenStart >= 6 && source.slice(tokenStart - 6, tokenStart) === "async "
    ? tokenStart - 6
    : tokenStart;
  assert.ok(start >= 0, `expected ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`could not extract ${name}`);
}

function frozenDateFor(nowIso) {
  const NativeDate = Date;
  const now = new NativeDate(`${nowIso}T12:00:00`).getTime();
  return class FrozenDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }

    static now() { return now; }
  };
}

function mealWeekHelpers(nowIso) {
  const sandbox = { Date: frozenDateFor(nowIso) };
  const source = [
    `function isoDate(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return \`${'${y}'}-${'${m}'}-${'${day}'}\`;
    }`,
    `function parseIso(str) {
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d);
    }`,
    `function mondayOf(d) {
      const copy = new Date(d);
      const dow = copy.getDay();
      copy.setDate(copy.getDate() - (dow === 0 ? 6 : dow - 1));
      copy.setHours(0, 0, 0, 0);
      return copy;
    }`,
    `let mealSelectedWeekStart = isoDate(mondayOf(new Date()));
     let mealMenuFormOpen = null;
     let mealPlanning = false;
     let mealMenuAiUnavailable = false;
     let mealIsKid = false;
     let rerenderCount = 0;
     const planCalls = [];
     const window = { auth: { planMenu: async (payload) => { planCalls.push(payload); return { menu: [] }; } } };
     function mealsRerenderTab() { rerenderCount++; }
     function mealMergeMenu() {}
     function toast() {}
     function renderMealMenuEntry(entry) { return \`<div class="meal-entry-title">${'${entry.title}'}</div>\`; }
     function mealMenuFormHtml() { return '<form></form>'; }
     function esc(value) { return String(value); }`,
    extractFunction(mealsSource, "mealCurrentWeekStart"),
    extractFunction(mealsSource, "mealWeekDays"),
    extractFunction(mealsSource, "mealShiftWeekStart"),
    extractFunction(mealsSource, "mealWeekHeading"),
    extractFunction(mealsSource, "mealWeekRangeLabel"),
    extractFunction(mealsSource, "mealWeekRangeAnnouncement"),
    extractFunction(mealsSource, "mealSetSelectedWeek"),
    extractFunction(mealsSource, "mealNavigateWeek"),
    extractFunction(mealsSource, "mealWeekNavigationHtml"),
    extractFunction(mealsSource, "renderMealDayCol"),
    extractFunction(mealsSource, "mealPlanWeek"),
    `this.helpers = {
      selected: () => mealSelectedWeekStart,
      current: () => mealCurrentWeekStart(),
      days: (startDate) => mealWeekDays(startDate),
      shift: (startDate, weeks) => mealShiftWeekStart(startDate, weeks),
      heading: (startDate) => mealWeekHeading(startDate),
      range: (startDate) => mealWeekRangeLabel(startDate),
      announcement: (startDate) => mealWeekRangeAnnouncement(startDate),
      setSelected: (startDate) => mealSetSelectedWeek(startDate),
      navigate: (weeks) => mealNavigateWeek(weeks),
      navigation: () => mealWeekNavigationHtml(),
      setForm: (form) => { mealMenuFormOpen = form; },
      getForm: () => mealMenuFormOpen,
      rerenders: () => rerenderCount,
      renderDay: (dateIso, data) => renderMealDayCol(dateIso, data),
      plan: (forceDeterministic) => mealPlanWeek(forceDeterministic),
      planCalls,
    };`,
  ].join("\n");
  vm.runInNewContext(source, sandbox, { filename: "meal-week-helpers.js" });
  return sandbox.helpers;
}

test("meals.html client scripts compile together without a global-scope clash", () => {
  const html = fs.readFileSync(path.join(PUBLIC, "meals.html"), "utf8");
  const scripts = localScriptSrcs(html);
  assert.ok(scripts.length >= 2, `expected several client scripts, found ${scripts.length}`);
  assert.ok(scripts.some((s) => /\/meals\.js$/.test(s)), "meals.js should be loaded by meals.html");
  assert.ok(scripts.some((s) => /\/auth\.js$/.test(s)), "auth.js should be loaded by meals.html");
  assert.ok(scripts.some((s) => /\/util\.js$/.test(s)), "util.js should be loaded by meals.html");

  const combined = buildCombined(scripts);
  try {
    // Parses the whole bundle as one script; a cross-file duplicate top-level
    // const/let/class throws "Identifier '...' has already been declared".
    new vm.Script(combined, { filename: "combined-meals-bundle.js" });
  } catch (e) {
    assert.fail(
      `Meals client scripts clash in the shared global scope (${scripts.join(", ")}): ${e.message}. ` +
        `A top-level const/let/class/function is declared in more than one loaded script — ` +
        `wrap the helper file in an IIFE or rename. This would blank the page in the browser.`
    );
  }
});

test("meals.js does not redeclare any of util.js's top-level bindings", () => {
  // util.js is shared with index.html and trips.html too — meals.js must
  // never shadow one of its top-level names (dayOfYear, isoDate, parseIso,
  // formatShort, fmt12, mondayOf, uid, load, save, getEvents, saveEvents,
  // getSchedules, saveSched, ...) at the top level, or the clash guard above
  // would fail. This test documents the intent directly (rather than relying
  // solely on the compile-time guard) so a future edit that reintroduces one
  // of these names fails with a clear message pointing at the actual identifier.
  const utilSrc = fs.readFileSync(path.join(PUBLIC, "js", "util.js"), "utf8");
  const mealsSrc = fs.readFileSync(path.join(PUBLIC, "js", "meals.js"), "utf8");

  const topLevelNames = new Set();
  const declRe = /^(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = declRe.exec(utilSrc)) !== null) topLevelNames.add(m[1]);

  const clashes = [];
  for (const name of topLevelNames) {
    const re = new RegExp(`^(?:function|const|let|var|class)\\s+${name}\\b`, "m");
    if (re.test(mealsSrc)) clashes.push(name);
  }
  assert.deepEqual(clashes, [], `meals.js redeclares util.js top-level name(s): ${clashes.join(", ")}`);
});

test("menu week navigation reveals Sunday's next Monday with local calendar dates", () => {
  const helpers = mealWeekHelpers("2026-08-09");
  assert.equal(helpers.selected(), "2026-08-03");
  assert.deepEqual(Array.from(helpers.days()), [
    "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06",
    "2026-08-07", "2026-08-08", "2026-08-09",
  ]);

  helpers.setForm({ date: "2026-08-09", entryId: "entry_1" });
  helpers.navigate(1);

  assert.equal(helpers.selected(), "2026-08-10");
  assert.deepEqual(Array.from(helpers.days()), [
    "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13",
    "2026-08-14", "2026-08-15", "2026-08-16",
  ]);
  assert.equal(helpers.getForm(), null, "changing weeks closes an inline menu form");
  assert.equal(helpers.heading("2026-08-10"), "Next week's dinners");
  assert.equal(helpers.range("2026-08-10"), "Aug 10–16, 2026");
  assert.equal(helpers.announcement("2026-08-10"), "Showing week of August 10, 2026 through August 16, 2026");

  const nextMonday = helpers.renderDay("2026-08-10", {
    menu: [{ id: "entry_2", date: "2026-08-10", slot: "dinner", title: "Tomorrow's dinner" }],
  });
  assert.match(nextMonday, /Tomorrow's dinner/);
});

test("menu week navigation uses local week arithmetic across month and year boundaries", () => {
  const helpers = mealWeekHelpers("2026-08-09");
  assert.equal(helpers.shift("2026-01-26", 1), "2026-02-02");
  assert.equal(helpers.shift("2026-12-28", 1), "2027-01-04");
  assert.equal(helpers.shift("2027-01-04", -1), "2026-12-28");
});

test("This week resets the selected week and exposes current state accessibly", () => {
  const helpers = mealWeekHelpers("2026-08-09");
  assert.match(helpers.navigation(), /aria-label="This week"[^>]*disabled/);

  helpers.navigate(1);
  assert.equal(helpers.selected(), "2026-08-10");
  assert.doesNotMatch(helpers.navigation(), /aria-label="This week"[^>]*disabled/);

  helpers.setForm({ date: "2026-08-10", entryId: null });
  helpers.setSelected(helpers.current());
  assert.equal(helpers.selected(), "2026-08-03");
  assert.equal(helpers.getForm(), null, "resetting to the current week closes an inline menu form");
  assert.match(helpers.navigation(), /aria-label="This week"[^>]*disabled/);
});

test("menu planning sends the visible Monday and preserves pantry-only ai:false", async () => {
  const helpers = mealWeekHelpers("2026-08-09");
  helpers.navigate(1);
  await helpers.plan();
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.planCalls[0])), { days: 7, slots: ["dinner"], startDate: "2026-08-10" });

  const pantryHelpers = mealWeekHelpers("2026-08-09");
  pantryHelpers.navigate(1);
  await pantryHelpers.plan(true);
  assert.deepEqual(JSON.parse(JSON.stringify(pantryHelpers.planCalls[0])), {
    days: 7,
    slots: ["dinner"],
    startDate: "2026-08-10",
    ai: false,
  });
});

test("shopping client uses canonical text/done fields and rolls back optimistic toggles", () => {
  const mealsSrc = fs.readFileSync(path.join(PUBLIC, "js", "meals.js"), "utf8");
  const authSrc = fs.readFileSync(path.join(PUBLIC, "js", "auth.js"), "utf8");
  assert.match(authSrc, /function getShoppingItems\(\)/);
  assert.match(authSrc, /api\("\/api\/meals\/shopping", \{ method: "GET" \}\)/);
  assert.match(mealsSrc, /it\.text/);
  assert.match(mealsSrc, /it\.done/);
  assert.match(mealsSrc, /doneBy: checked \? mealCurrentUserId : null/);
  assert.match(mealsSrc, /window\.auth\.updateShoppingItem\(id, \{ done: checked \}\)/);
  assert.match(mealsSrc, /const previous = Object\.assign\(\{\}, mealsData\.shopping\[idx\]\)/);
  assert.match(mealsSrc, /mealsData\.shopping\[rollbackIdx\] = previous/);
});

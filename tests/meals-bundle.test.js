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

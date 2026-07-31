"use strict";
/*
 * Browser-parity guard for public/trips.html's client scripts (Phase C).
 *
 * trips.html is a SEPARATE page bundle from index.html — it loads auth.js +
 * util.js + trips.js, which share one top-level lexical scope in the browser
 * exactly like index.html's script set does. Same failure mode as
 * client-bundle.test.js: a duplicate top-level const/let/class/function
 * across two of these files is a fatal "Identifier 'X' has already been
 * declared" SyntaxError that blanks the page. `node -c <file>` checks each
 * file in isolation and never catches this, so this test concatenates them
 * in load order and compiles the result as one unit.
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

test("trips.html client scripts compile together without a global-scope clash", () => {
  const html = fs.readFileSync(path.join(PUBLIC, "trips.html"), "utf8");
  const scripts = localScriptSrcs(html);
  assert.ok(scripts.length >= 2, `expected several client scripts, found ${scripts.length}`);
  assert.ok(scripts.some((s) => /\/trips\.js$/.test(s)), "trips.js should be loaded by trips.html");
  assert.ok(scripts.some((s) => /\/auth\.js$/.test(s)), "auth.js should be loaded by trips.html");
  assert.ok(scripts.some((s) => /\/util\.js$/.test(s)), "util.js should be loaded by trips.html");

  const combined = buildCombined(scripts);
  try {
    // Parses the whole bundle as one script; a cross-file duplicate top-level
    // const/let/class throws "Identifier '...' has already been declared".
    new vm.Script(combined, { filename: "combined-trips-bundle.js" });
  } catch (e) {
    assert.fail(
      `Trips client scripts clash in the shared global scope (${scripts.join(", ")}): ${e.message}. ` +
        `A top-level const/let/class/function is declared in more than one loaded script — ` +
        `wrap the helper file in an IIFE or rename. This would blank the page in the browser.`
    );
  }
});

test("trips.js does not redeclare any of util.js's top-level bindings", () => {
  // util.js is shared with index.html too — trips.js must never shadow one
  // of its top-level names (dayOfYear, isoDate, parseIso, formatShort,
  // fmt12, mondayOf, uid, load, save, getEvents, saveEvents, getSchedules,
  // saveSched, ...) at the top level, or the clash guard above would fail.
  // This test documents the intent directly (rather than relying solely on
  // the compile-time guard) so a future edit that reintroduces one of these
  // names fails with a clear message pointing at the actual identifier.
  const utilSrc = fs.readFileSync(path.join(PUBLIC, "js", "util.js"), "utf8");
  const tripsSrc = fs.readFileSync(path.join(PUBLIC, "js", "trips.js"), "utf8");

  const topLevelNames = new Set();
  const declRe = /^(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = declRe.exec(utilSrc)) !== null) topLevelNames.add(m[1]);

  const clashes = [];
  for (const name of topLevelNames) {
    const re = new RegExp(`^(?:function|const|let|var|class)\\s+${name}\\b`, "m");
    if (re.test(tripsSrc)) clashes.push(name);
  }
  assert.deepEqual(clashes, [], `trips.js redeclares util.js top-level name(s): ${clashes.join(", ")}`);
});

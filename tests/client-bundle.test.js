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

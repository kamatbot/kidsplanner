"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function pngSize(relative) {
  const bytes = fs.readFileSync(path.join(root, relative));
  assert.equal(bytes.toString("ascii", 1, 4), "PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test("Fam ETC manifest is a standalone root-scoped Chrome app with valid icons", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/?source=pwa");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.name, "Fam ETC");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
  assert.deepEqual(pngSize("public/icons/fametc-192.png"), [192, 192]);
  assert.deepEqual(pngSize("public/icons/fametc-512.png"), [512, 512]);
  assert.deepEqual(pngSize("public/icons/apple-touch-icon.png"), [180, 180]);
});

test("every authenticated web shell advertises the same install manifest", () => {
  for (const page of ["public/index.html", "public/trips.html", "public/meals.html"]) {
    const html = read(page);
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
    assert.match(html, /<meta name="theme-color" content="#f1efec">/);
    assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/);
  }
});

test("install UI is browser-led and service worker remains network-only", () => {
  const html = read("public/index.html");
  const app = read("public/js/app.js");
  const worker = read("public/sw.js");
  const server = read("server.js");
  const styles = read("public/css/styles.css");

  assert.match(html, /id="install-app-card" hidden/);
  assert.match(html, /id="install-app-btn"[^>]+onclick="handleInstallApp\(\)"/);
  assert.match(app, /addEventListener\('beforeinstallprompt'/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /await prompt\.prompt\(\)/);
  assert.match(app, /addEventListener\('appinstalled'/);
  assert.match(app, /display-mode: standalone/);
  assert.match(app, /register\('\/sw\.js', \{ scope: '\/', updateViaCache: 'none' \}\)/);
  assert.match(worker, /addEventListener\('fetch'/);
  assert.match(worker, /event\.respondWith\(fetch\(event\.request\)\)/);
  assert.doesNotMatch(worker, /caches\.(?:open|match)|cache\.add/);
  assert.match(server, /res\.type\("application\/manifest\+json"\)/);
  assert.match(server, /app\.use\("\/icons", express\.static/);
  assert.match(styles, /#install-app-btn\s*\{[^}]*min-height:\s*44px/s);
  assert.match(styles, /#install-app-btn:focus-visible/);
  assert.match(styles, /#install-app-card\[hidden\]\s*\{\s*display:\s*none/);
});

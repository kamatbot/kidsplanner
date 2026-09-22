"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

test("public/index.html does not include render-blocking PDF.js in head", () => {
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  assert.doesNotMatch(html, /<script\b[^>]*src=["'][^"']*pdf\.min\.js["']/i, "pdf.min.js must not be synchronously loaded in index.html");
});

test("public/js/app.js dynamically loads PDF.js on demand in renderPdfToBase64", () => {
  const appJs = fs.readFileSync(path.join(PUBLIC, "js", "app.js"), "utf8");
  assert.match(appJs, /function loadPdfJs\(\)/, "loadPdfJs helper must exist in app.js");
  assert.match(appJs, /\/js\/vendor\/pdfjs\/pdf\.min\.js/, "loadPdfJs must point to local vendor pdf.min.js");
  assert.match(appJs, /await loadPdfJs\(\)/, "renderPdfToBase64 must await loadPdfJs before using pdfjsLib");
});

test("server.js serves versioned scripts with immutable caching and unversioned with no-cache", () => {
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert.match(
    serverSource,
    /req\.query\.v && req\.query\.v === BUILD/,
    "server.js must check req.query.v against BUILD"
  );
  assert.match(
    serverSource,
    /res\.setHeader\("Cache-Control", IMMUTABLE\)/,
    "server.js must set IMMUTABLE for current build"
  );
  assert.match(
    serverSource,
    /res\.setHeader\("Cache-Control", "no-cache"\)/,
    "server.js must fall back to no-cache for unversioned requests"
  );
});

test("lib/routes/chat.js raises attachment read concurrency ceiling to 8 (configurable)", () => {
  const chatRouteSource = fs.readFileSync(path.join(ROOT, "lib/routes/chat.js"), "utf8");
  assert.match(
    chatRouteSource,
    /MAX_CONCURRENT_ATTACHMENT_READS\s*=\s*Number\(process\.env\.RL_CHAT_ATTACHMENT_READ_MAX\)\s*>\s*0\s*\?\s*Number\(process\.env\.RL_CHAT_ATTACHMENT_READ_MAX\)\s*:\s*8/,
    "MAX_CONCURRENT_ATTACHMENT_READS must default to 8 and accept RL_CHAT_ATTACHMENT_READ_MAX"
  );
  assert.match(
    chatRouteSource,
    /activeAttachmentReads >= MAX_CONCURRENT_ATTACHMENT_READS/,
    "limitConcurrentAttachmentReads must check against MAX_CONCURRENT_ATTACHMENT_READS"
  );
});

test("ios/FamETC/DocumentScannerViewController.swift throttles Vision detection to 10 fps with frame dropping", () => {
  const scannerSource = fs.readFileSync(
    path.join(ROOT, "ios/FamETC/DocumentScannerViewController.swift"),
    "utf8"
  );
  assert.match(scannerSource, /fam\.scanner\.session/, "session queue must use fam prefix");
  assert.match(scannerSource, /fam\.scanner\.video/, "video queue must use fam prefix");
  assert.match(scannerSource, /var isAnalyzing\s*=\s*false/, "must track in-flight analysis");
  assert.match(scannerSource, /var lastAnalysisTimestamp:\s*CFTimeInterval/, "must track analysis timestamp");
  assert.match(scannerSource, /now - lastAnalysisTimestamp >= 0\.1/, "must throttle analysis to at most 10 fps");
  assert.match(scannerSource, /detectedFrames >= 5/, "must auto-capture after 5 consecutive confident frames (~0.5s)");
});

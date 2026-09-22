"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { createRequire } = require("node:module");
const ROOT = path.join(__dirname, "..");

function pdfLoader() {
  const source = fs.readFileSync(path.join(ROOT, "public/js/app.js"), "utf8");
  const scripts = [];
  const context = vm.createContext({ document: {
    createElement: () => ({ remove() { this.removed = true; } }),
    head: { appendChild(script) { scripts.push(script); } },
  } });
  vm.runInContext(source.slice(source.indexOf("let pdfJsLoadingPromise"), source.indexOf("async function renderPdfToBase64")), context);
  return { context, scripts, load: () => context.loadPdfJs() };
}

test("PDF.js is absent from initial HTML and concurrent uploads share one lazy load", async () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  assert.doesNotMatch(html, /<script\b[^>]*src=["'][^"']*pdf\.min\.js["']/i);
  const { context, scripts, load } = pdfLoader();
  assert.equal(scripts.length, 0);
  const first = load();
  assert.equal(load(), first);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, '/js/vendor/pdfjs/pdf.min.js');
  context.pdfjsLib = { GlobalWorkerOptions: {} };
  scripts[0].onload();
  assert.equal(await first, context.pdfjsLib);
  assert.equal(context.pdfjsLib.GlobalWorkerOptions.workerSrc, '/js/vendor/pdfjs/pdf.worker.min.js');
  assert.equal(await load(), context.pdfjsLib);
  assert.equal(scripts.length, 1);
});

for (const failure of ['onerror', 'onload']) {
  test(`PDF.js ${failure} failure rejects shared callers and permits a new attempt`, async () => {
    const { context, scripts, load } = pdfLoader();
    const pending = load();
    assert.equal(load(), pending);
    const rejection = assert.rejects(pending, /PDF.js/);
    scripts[0][failure]();
    await rejection;
    const retry = load();
    assert.equal(scripts.length, 2);
    context.pdfjsLib = { GlobalWorkerOptions: {} };
    scripts[1].onload();
    assert.equal(await retry, context.pdfjsLib);
  });
}

function attachmentLimiter(value) {
  const filename = path.join(ROOT, 'lib/routes/chat.js');
  const context = vm.createContext({
    require: createRequire(filename), module: { exports: {} },
    process: { env: { RL_CHAT_ATTACHMENT_READ_MAX: value } },
  });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return () => {
    const res = new EventEmitter();
    res.headers = {};
    res.set = (key, value) => { res.headers[key] = value; return res; };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = () => res;
    context.limitConcurrentAttachmentReads({}, res, () => { res.accepted = true; });
    return res;
  };
}

for (const [value, capacity] of [[undefined, 8], ['3', 3], ['Infinity', 8], ['1.5', 8], ['0', 8], ['-2', 8], ['invalid', 8]]) {
  test(`attachment capacity ${String(value)} is bounded at ${capacity} and released once`, () => {
    const request = attachmentLimiter(value);
    const active = Array.from({ length: capacity }, request);
    assert.ok(active.every(res => res.accepted));
    const excess = request();
    assert.equal(excess.statusCode, 503);
    assert.equal(excess.headers['Retry-After'], '1');
    active[0].emit('finish');
    active[0].emit('close');
    assert.equal(request().accepted, true);
    assert.equal(request().statusCode, 503, 'finish + close must release just one slot');
    active[1].emit('close');
    assert.equal(request().accepted, true, 'a disconnected reader must free a slot');
  });
}

test("scanner keeps throttling on its serial video queue without reading main-thread capture state", () => {
  const scanner = fs.readFileSync(path.join(ROOT, "ios/FamETC/DocumentScannerViewController.swift"), "utf8");
  const callback = scanner.slice(scanner.indexOf("    func captureOutput("));
  assert.match(scanner, /alwaysDiscardsLateVideoFrames = true/);
  assert.match(scanner, /DispatchQueue\(label: "fam.scanner.video"\)/);
  assert.match(callback, /latestPixelBuffer = pb[\s\S]*now - lastAnalysisTimestamp >= 0\.1/);
  assert.doesNotMatch(callback, /didFinish|capturing|isAnalyzing/);
  assert.match(scanner, /detectedFrames >= 5/);
});

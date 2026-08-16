"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const utilSource = fs.readFileSync(path.join(root, "public/js/util.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "public/js/app.js"), "utf8");
const tripsSource = fs.readFileSync(path.join(root, "public/js/trips.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "public/css/styles.css"), "utf8");

function linkify(value) {
  const context = { URL };
  vm.runInNewContext(`${utilSource}\nthis.result = linkifyChatText(input);`, Object.assign(context, { input: value }));
  return context.result;
}

test("web chat linkifier creates safe clickable links without changing visible text", () => {
  const source = "Form: https://docs.google.com/forms/d/e/abc/viewform?usp=send_form";
  assert.equal(
    linkify(source),
    'Form: <a href="https://docs.google.com/forms/d/e/abc/viewform?usp=send_form" target="_blank" rel="noopener noreferrer">https://docs.google.com/forms/d/e/abc/viewform?usp=send_form</a>'
  );
});

test("web chat linkifier escapes message HTML and keeps punctuation outside links", () => {
  assert.equal(
    linkify('<img src=x onerror=alert(1)> See www.example.com/path?q=1&ok=2.'),
    '&lt;img src=x onerror=alert(1)&gt; See <a href="https://www.example.com/path?q=1&amp;ok=2" target="_blank" rel="noopener noreferrer">www.example.com/path?q=1&amp;ok=2</a>.'
  );
  assert.equal(linkify('javascript:alert(1)'), 'javascript:alert(1)');
});

test("family and Trip chat use the shared linkifier with accessible link styling", () => {
  assert.match(appSource, /class="chat-msg-text">\$\{linkifyChatText\(m\.text\)\}/);
  assert.match(tripsSource, /class="chat-msg-text">\$\{linkifyChatText\(m\.text\)\}/);
  assert.match(stylesSource, /\.chat-msg-text a\s*\{[^}]*text-decoration:\s*underline/s);
  assert.match(stylesSource, /\.chat-msg-text a:focus-visible/);
});

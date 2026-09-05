"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public/js/app.js"), "utf8");

function extractFunction(name) {
  const start = appSource.indexOf("function " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  const bodyStart = appSource.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < appSource.length; i += 1) {
    if (appSource[i] === "{") depth += 1;
    if (appSource[i] === "}") depth -= 1;
    if (depth === 0) return appSource.slice(start, i + 1);
  }
  throw new Error("unterminated " + name);
}

const sandbox = {};
vm.runInNewContext(
  extractFunction("todayActionCanManageForViewer") + "\n" +
  extractFunction("todayActionCanDeleteForViewer") + "\n" +
  "this.helpers = { todayActionCanManageForViewer, todayActionCanDeleteForViewer };",
  sandbox,
);

test("kid action affordances are limited to their own actions", () => {
  const { todayActionCanManageForViewer, todayActionCanDeleteForViewer } = sandbox.helpers;
  assert.equal(todayActionCanManageForViewer({ assigneeType: "kid", assigneeId: "kid-1", kidId: "kid-1" }, true, "kid-1"), true);
  assert.equal(todayActionCanManageForViewer({ assigneeType: "family" }, true, "kid-1"), false);
  assert.equal(todayActionCanManageForViewer({ assigneeType: "kid", assigneeId: "kid-2", kidId: "kid-2" }, true, "kid-1"), false);
  assert.equal(todayActionCanDeleteForViewer(true), false);
});

test("parent action affordances and single Family Actions heading remain explicit", () => {
  const { todayActionCanManageForViewer, todayActionCanDeleteForViewer } = sandbox.helpers;
  assert.equal(todayActionCanManageForViewer({ assigneeType: "family" }, false, null), true);
  assert.equal(todayActionCanDeleteForViewer(false), true);
  assert.match(appSource, /renderTodayActionRoleCopy\(\)/);
  assert.match(appSource, /titleEl.textContent = 'Family Actions'/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8');
  assert.match(html, /id="today-actions-title">Family Actions<\/h2>/);
  assert.doesNotMatch(html, /What matters next|Small next steps, together/);
});

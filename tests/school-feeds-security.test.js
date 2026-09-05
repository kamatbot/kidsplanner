"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-school-security-test-"));
process.env.NODE_ENV = "production";

const schoolFeeds = require("../lib/school-feeds");

test("production calendar preview rejects loopback HTTP before any server-side fetch", async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called");
  };
  try {
    const loopback = await schoolFeeds.previewFeed("http://127.0.0.1:8080/private.ics");
    const localhost = await schoolFeeds.previewFeed("http://localhost:8080/private.ics");
    assert.equal(loopback.ok, false);
    assert.equal(localhost.ok, false);
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

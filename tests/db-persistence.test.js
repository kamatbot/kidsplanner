"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-db-test-"));
process.env.DB_WRITE_RETRY_MS = "20";

const db = require("../lib/db");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("db writer coalesces bursts and retries a failed write without losing data", async () => {
  const root = db.load();
  const originalWriteFile = fs.writeFile;

  let writes = 0;
  fs.writeFile = function countedWrite(...args) {
    writes += 1;
    return originalWriteFile.apply(this, args);
  };
  try {
    root.burstMarker = "latest";
    db.persist();
    db.persist();
    db.persist();
    await sleep(100);
    assert.equal(writes, 1, "one writer should service same-tick persistence bursts");
    assert.equal(db.persistenceStatus().dirty, false);
  } finally {
    fs.writeFile = originalWriteFile;
  }

  let attempts = 0;
  fs.writeFile = function failFirstWrite(file, data, callback) {
    attempts += 1;
    if (attempts === 1) {
      const err = new Error("simulated disk full");
      err.code = "ENOSPC";
      queueMicrotask(() => callback(err));
      return;
    }
    return originalWriteFile.call(this, file, data, callback);
  };
  try {
    root.retryMarker = "survived";
    db.persist();
    await sleep(150);
    assert.ok(attempts >= 2, "a failed write should be retried");
    const status = db.persistenceStatus();
    assert.equal(status.dirty, false);
    assert.equal(status.lastWriteError, null);

    const disk = JSON.parse(fs.readFileSync(db.DB_FILE, "utf8"));
    assert.equal(disk.retryMarker, "survived");
  } finally {
    fs.writeFile = originalWriteFile;
  }
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fam-media-perf-"));
process.env.DATA_ENCRYPTION_KEY = "34".repeat(32);
const attachments = require("../lib/chat-attachments");
const quotaIndex = require("../lib/chat-attachment-index");
const { createWorkLimiter } = require("../lib/bounded-work");

test("async media preserves authenticated FAT1 compatibility and rejects tampering", async () => {
  const bytes = Buffer.alloc(2 * 1024 * 1024, 42);
  bytes.set([0xff, 0xd8, 0xff]);
  const meta = await attachments.saveAsync({ scopeKey: "family-perf", uploaderUserId: "u_parent", originalName: "photo.jpg", mimeType: "image/jpeg", buffer: bytes });
  assert.deepEqual((await attachments.readAsync(meta.id)).buffer, bytes);
  assert.deepEqual(attachments.read(meta.id).buffer, bytes, "old synchronous API reads new uploads");
  const target = path.join(attachments.storageDir(), `${meta.id}.blob`);
  const stored = fs.readFileSync(target);
  assert.equal(stored.includes(bytes), false);
  stored[stored.length - 1] ^= 1;
  fs.writeFileSync(target, stored);
  await assert.rejects(attachments.readAsync(meta.id));
  attachments.remove(meta.id);
});

test("uploads and quota checks do not re-scan attachment directories", async (t) => {
  // First call initializes/imports the catalog; all subsequent work is indexed.
  attachments.usageBytes("family-index");
  t.mock.method(fs, "readdirSync", () => { throw new Error("request path scanned directory"); });
  const options = { scopeKey: "family-index", uploaderUserId: "u_parent", originalName: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("notes") };
  const first = await attachments.saveAsync(options);
  const second = await attachments.saveAsync(options);
  assert.equal(attachments.usageBytes(options.scopeKey).scope, 10);
  attachments.remove(first.id);
  attachments.remove(second.id);
  assert.equal(attachments.usageBytes(options.scopeKey).scope, 0);
});

test("quota reservations are atomic and failed reservations cannot inflate usage", () => {
  const sql = quotaIndex.open(attachments.storageDir(), attachments.readMeta);
  const meta = { id: "reservation-test", scopeKey: "quota-test", size: 8, createdAt: new Date().toISOString() };
  quotaIndex.reserve(sql, meta, { scope: 10, total: 100000000 });
  assert.throws(() => quotaIndex.reserve(sql, { ...meta, id: "second" }, { scope: 10, total: 100000000 }), { code: "CHAT_ATTACHMENT_QUOTA" });
  assert.equal(quotaIndex.usage(sql, meta.scopeKey).scope, 8);
  quotaIndex.remove(sql, meta.id);
});

test("expired uploads are cleaned in bounded batches; claimed media survives", async () => {
  const input = { scopeKey: "expiry-test", uploaderUserId: "u_parent", originalName: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("notes") };
  const unused = await attachments.saveAsync(input);
  const claimed = await attachments.saveAsync(input);
  attachments.claimForMessage(claimed.id, input.scopeKey, input.uploaderUserId, "m_1234567890abcdef12");
  const removed = attachments.sweepUnclaimed(Date.now() + attachments.UNCLAIMED_TTL_MS + 1000);
  assert.ok(removed >= 1);
  assert.equal(attachments.readMeta(unused.id), null);
  assert.ok(attachments.readMeta(claimed.id));
  attachments.remove(claimed.id);
});

test("I/O limiter bounds concurrent work and recovers after rejection", async () => {
  const run = createWorkLimiter(2, 8);
  let active = 0, peak = 0;
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => run(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    if (i === 2) throw new Error("fixture failure");
    return i;
  })));
  assert.equal(peak, 2);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 7);
  assert.equal(await run(() => 9), 9);
});

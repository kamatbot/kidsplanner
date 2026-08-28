"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const datacrypto = require("../lib/datacrypto");
const attachments = require("../lib/chat-attachments");

function withTempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fam-chat-attachments-"));
  const previousDir = process.env.CHAT_ATTACHMENTS_DIR;
  const previousKey = process.env.DATA_ENCRYPTION_KEY;
  process.env.CHAT_ATTACHMENTS_DIR = dir;
  process.env.DATA_ENCRYPTION_KEY = "11".repeat(32);
  datacrypto._resetKeyCache();
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (previousDir === undefined) delete process.env.CHAT_ATTACHMENTS_DIR;
    else process.env.CHAT_ATTACHMENTS_DIR = previousDir;
    if (previousKey === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = previousKey;
    datacrypto._resetKeyCache();
  });
  return dir;
}

test("chat attachment bytes and metadata round-trip encrypted at rest", (t) => {
  const dir = withTempStore(t);
  const original = Buffer.from("private family photo bytes");
  const meta = attachments.save({
    scopeKey: "fam_123",
    uploaderUserId: "u_parent",
    originalName: "summer photo.jpg",
    mimeType: "image/jpeg",
    buffer: original,
  });

  assert.match(meta.id, attachments.ID_RE);
  assert.equal(meta.kind, "photo");
  assert.equal(meta.size, original.length);

  const onDisk = fs.readFileSync(path.join(dir, `${meta.id}.blob`));
  assert.equal(onDisk.includes(original), false, "attachment bytes must not be plaintext with encryption configured");
  const metaOnDisk = fs.readFileSync(path.join(dir, `${meta.id}.meta`), "utf8");
  assert.equal(metaOnDisk.includes("summer photo.jpg"), false, "metadata must be encrypted too");

  const record = attachments.read(meta.id);
  assert.deepEqual(record.buffer, original);
  assert.equal(record.meta.filename, "summer photo.jpg");
});

test("attachment media is canonical and cannot cross chat scopes", (t) => {
  withTempStore(t);
  const meta = attachments.save({
    scopeKey: "trip:t_abc",
    uploaderUserId: "u_guest",
    originalName: "boarding-pass.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("pdf-ish"),
  });

  const spoofed = {
    type: "attachment",
    attachmentId: meta.id,
    filename: "renamed.exe",
    mimeType: "text/html",
    size: 1,
    kind: "photo",
    url: "https://evil.example/file",
  };
  assert.equal(attachments.validateMediaForScope("fam_other", spoofed), null);

  const canonical = attachments.validateMediaForScope("trip:t_abc", spoofed);
  assert.deepEqual(canonical, {
    type: "attachment",
    attachmentId: meta.id,
    url: `/api/chat/attachments/${meta.id}`,
    previewUrl: "boarding-pass.pdf",
    width: 7,
    height: 3,
    filename: "boarding-pass.pdf",
    mimeType: "application/pdf",
    size: 7,
    kind: "file",
  });
});

test("attachment filenames are path-safe and mime determines presentation kind", () => {
  assert.equal(attachments.cleanFilename("../../report\u0000.pdf"), "report.pdf");
  assert.equal(attachments.kindForMime("video/mp4"), "video");
  assert.equal(attachments.kindForMime("image/png"), "photo");
  assert.equal(attachments.kindForMime("application/zip"), "file");
});

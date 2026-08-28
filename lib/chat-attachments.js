"use strict";
/**
 * Private chat attachment storage.
 *
 * Attachments deliberately do NOT live in the chat JSON/SQLite row: photos and
 * videos would make every message-list read expensive. The message stores only
 * a small canonical media descriptor while bytes live under data/chat-attachments.
 * Every download goes through an authenticated route (lib/routes/chat.js); this
 * directory is never mounted as Express static content.
 *
 * When DATA_ENCRYPTION_KEY is configured (required in production by server.js),
 * both attachment bytes and metadata are encrypted at rest with AES-256-GCM.
 * Development without a key keeps the existing datastore convention and writes
 * plaintext so local setup stays frictionless.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const datacrypto = require("./datacrypto");

const MAX_BYTES = 25 * 1024 * 1024;
const ID_RE = /^a_[0-9a-f]{36}$/;
const BIN_MAGIC = Buffer.from("FAT1", "ascii");
const IV_LEN = 12;
const TAG_LEN = 16;

function storageDir() {
  return process.env.CHAT_ATTACHMENTS_DIR || path.join(__dirname, "..", "data", "chat-attachments");
}

function ensureDir() {
  const dir = storageDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function newId() {
  return "a_" + crypto.randomBytes(18).toString("hex");
}

function cleanFilename(value) {
  const raw = path.basename(String(value || "attachment"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "-")
    .trim();
  return (raw || "attachment").slice(0, 180);
}

function cleanMime(value) {
  const mime = String(value || "application/octet-stream").toLowerCase().trim();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime)
    ? mime.slice(0, 120)
    : "application/octet-stream";
}

function kindForMime(mimeType) {
  if (mimeType.startsWith("image/")) return "photo";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

function dataPath(id) {
  return path.join(ensureDir(), `${id}.blob`);
}

function metaPath(id) {
  return path.join(ensureDir(), `${id}.meta`);
}

function encryptBytes(buffer, key) {
  if (!key) return buffer;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([BIN_MAGIC, iv, tag, ciphertext]);
}

function decryptBytes(buffer, key) {
  if (!buffer.subarray(0, BIN_MAGIC.length).equals(BIN_MAGIC)) return buffer;
  if (!key) throw new Error("Encrypted chat attachment cannot be read without DATA_ENCRYPTION_KEY.");
  const min = BIN_MAGIC.length + IV_LEN + TAG_LEN;
  if (buffer.length < min) throw new Error("Chat attachment ciphertext is truncated.");
  const ivStart = BIN_MAGIC.length;
  const tagStart = ivStart + IV_LEN;
  const ctStart = tagStart + TAG_LEN;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, buffer.subarray(ivStart, tagStart));
  decipher.setAuthTag(buffer.subarray(tagStart, ctStart));
  return Buffer.concat([decipher.update(buffer.subarray(ctStart)), decipher.final()]);
}

function writeMeta(meta, key) {
  const json = JSON.stringify(meta);
  const stored = key ? datacrypto.encrypt(json, key) : json;
  fs.writeFileSync(metaPath(meta.id), stored, { encoding: "utf8", mode: 0o600 });
}

function readMeta(id) {
  if (!ID_RE.test(String(id || ""))) return null;
  let text;
  try {
    text = fs.readFileSync(metaPath(id), "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
  const key = datacrypto.loadKey();
  if (datacrypto.isEncrypted(text)) {
    if (!key) throw new Error("Encrypted chat attachment metadata cannot be read without DATA_ENCRYPTION_KEY.");
    text = datacrypto.decrypt(text, key);
  }
  let meta;
  try { meta = JSON.parse(text); } catch (e) { return null; }
  if (!meta || meta.id !== id || !meta.scopeKey) return null;
  return meta;
}

function save({ scopeKey, uploaderUserId, originalName, mimeType, buffer }) {
  if (!scopeKey || !uploaderUserId) throw new Error("Attachment scope and uploader are required.");
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("Attachment is empty.");
  if (buffer.length > MAX_BYTES) throw new Error("Attachment is too large.");

  const id = newId();
  const mime = cleanMime(mimeType);
  const meta = {
    id,
    scopeKey: String(scopeKey),
    uploaderUserId: String(uploaderUserId),
    filename: cleanFilename(originalName),
    mimeType: mime,
    size: buffer.length,
    kind: kindForMime(mime),
    createdAt: new Date().toISOString(),
  };
  const key = datacrypto.loadKey();
  const target = dataPath(id);
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, encryptBytes(buffer, key), { mode: 0o600 });
    fs.renameSync(tmp, target);
    writeMeta(meta, key);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    try { fs.unlinkSync(target); } catch (_) {}
    try { fs.unlinkSync(metaPath(id)); } catch (_) {}
    throw e;
  }
  return meta;
}

function read(id) {
  const meta = readMeta(id);
  if (!meta) return null;
  let stored;
  try { stored = fs.readFileSync(dataPath(id)); } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
  return { meta, buffer: decryptBytes(stored, datacrypto.loadKey()) };
}

function remove(id) {
  if (!ID_RE.test(String(id || ""))) return;
  for (const target of [dataPath(id), metaPath(id)]) {
    try { fs.unlinkSync(target); } catch (e) { if (!e || e.code !== "ENOENT") throw e; }
  }
}

function mediaFor(meta) {
  return {
    type: "attachment",
    attachmentId: meta.id,
    url: `/api/chat/attachments/${meta.id}`,
    filename: meta.filename,
    mimeType: meta.mimeType,
    size: meta.size,
    kind: meta.kind,
  };
}

function validateMediaForScope(scopeKey, media) {
  if (!media || media.type !== "attachment" || !ID_RE.test(String(media.attachmentId || ""))) return null;
  const meta = readMeta(media.attachmentId);
  if (!meta || meta.scopeKey !== scopeKey) return null;
  return mediaFor(meta);
}

module.exports = {
  MAX_BYTES,
  ID_RE,
  save,
  read,
  readMeta,
  remove,
  mediaFor,
  validateMediaForScope,
  kindForMime,
  cleanFilename,
};

"use strict";
/**
 * Private chat attachment storage.
 *
 * Attachments deliberately do NOT live in the chat JSON/SQLite row: photos and
 * videos would make every message-list read expensive. The message stores only
 * a small canonical media descriptor while bytes live under FamETC's
 * persistent data directory.
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
const { dataFile } = require("./paths");

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_SCOPE_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024 * 1024;
const UNCLAIMED_TTL_MS = 24 * 60 * 60 * 1000;
const ID_RE = /^a_[0-9a-f]{36}$/;
const MESSAGE_ID_RE = /^m_[0-9a-f]{18}$/;
const BIN_MAGIC = Buffer.from("FAT1", "ascii");
const IV_LEN = 12;
const TAG_LEN = 16;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/mpeg"]);

class ChatAttachmentError extends Error {
  constructor(message, code = "CHAT_ATTACHMENT_ERROR") {
    super(message);
    this.name = "ChatAttachmentError";
    this.code = code;
  }
}

function storageDir() {
  // The default must share FamETC's persistent data root. Hostinger replaces
  // the application directory on every deploy, while FAM_DATA_DIR survives.
  return process.env.CHAT_ATTACHMENTS_DIR || dataFile("chat-attachments");
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
  if (IMAGE_TYPES.has(mimeType)) return "photo";
  if (VIDEO_TYPES.has(mimeType)) return "video";
  return "file";
}

function magicMatches(mimeType, bytes) {
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (mimeType === "image/gif") return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
  if (mimeType === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (mimeType === "image/heic" || mimeType === "image/heif") {
    if (bytes.subarray(4, 8).toString("ascii") !== "ftyp") return false;
    return /^(?:hei[cfvx]|mif1|msf1)$/.test(bytes.subarray(8, 12).toString("ascii"));
  }
  if (mimeType === "video/mp4" || mimeType === "video/quicktime") {
    return bytes.subarray(4, 8).toString("ascii") === "ftyp";
  }
  if (mimeType === "video/mpeg") {
    return bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && (bytes[3] === 0xba || bytes[3] === 0xb3);
  }
  if (mimeType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  return true;
}

function basicScan(bytes) {
  return !bytes.includes(Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE", "ascii"));
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

function metadataFiles() {
  try { return fs.readdirSync(ensureDir()).filter((name) => ID_RE.test(name.slice(0, -5)) && name.endsWith(".meta")); }
  catch (_) { return []; }
}

function sweepUnclaimed(now = Date.now()) {
  const cutoff = now - UNCLAIMED_TTL_MS;
  let removed = 0;
  for (const filename of metadataFiles()) {
    const id = filename.slice(0, -5);
    const meta = readMeta(id);
    if (!meta || meta.claimedMessageId || Date.parse(meta.createdAt) >= cutoff) continue;
    remove(id);
    removed += 1;
  }
  return removed;
}

function usageBytes(scopeKey) {
  let total = 0;
  let scope = 0;
  for (const filename of metadataFiles()) {
    const meta = readMeta(filename.slice(0, -5));
    if (!meta) continue;
    const size = Number(meta.size) || 0;
    total += size;
    if (meta.scopeKey === scopeKey) scope += size;
  }
  return { total, scope };
}

function assertCapacity(scopeKey, incomingBytes) {
  const usage = usageBytes(scopeKey);
  if (usage.scope + incomingBytes > MAX_SCOPE_BYTES || usage.total + incomingBytes > MAX_TOTAL_BYTES) {
    throw new ChatAttachmentError("Chat attachment storage is full.", "CHAT_ATTACHMENT_QUOTA");
  }
}

function save({ scopeKey, uploaderUserId, originalName, mimeType, buffer }) {
  if (!scopeKey || !uploaderUserId) throw new Error("Attachment scope and uploader are required.");
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("Attachment is empty.");
  if (buffer.length > MAX_BYTES) throw new ChatAttachmentError("Attachment is too large.", "CHAT_ATTACHMENT_TOO_LARGE");

  const id = newId();
  const mime = cleanMime(mimeType);
  if (!magicMatches(mime, buffer)) {
    throw new ChatAttachmentError("Attachment content does not match its file type.", "CHAT_ATTACHMENT_MIME_MISMATCH");
  }
  if (!basicScan(buffer)) {
    throw new ChatAttachmentError("Attachment failed the malware safety check.", "CHAT_ATTACHMENT_UNSAFE");
  }
  sweepUnclaimed();
  assertCapacity(String(scopeKey), buffer.length);
  const meta = {
    id,
    scopeKey: String(scopeKey),
    uploaderUserId: String(uploaderUserId),
    filename: cleanFilename(originalName),
    mimeType: mime,
    size: buffer.length,
    kind: kindForMime(mime),
    contentHash: crypto.createHash("sha256").update(buffer).digest("hex"),
    createdAt: new Date().toISOString(),
    claimedMessageId: null,
    claimedAt: null,
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
  const buffer = decryptBytes(stored, datacrypto.loadKey());
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  if (meta.contentHash && hash !== meta.contentHash) throw new Error("Chat attachment failed its integrity check.");
  return { meta, buffer };
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

function validateMediaForScope(scopeKey, media, uploaderUserId) {
  if (!media || media.type !== "attachment" || !ID_RE.test(String(media.attachmentId || ""))) return null;
  const meta = readMeta(media.attachmentId);
  if (!meta || meta.scopeKey !== scopeKey || meta.claimedMessageId) return null;
  if (!uploaderUserId || meta.uploaderUserId !== String(uploaderUserId)) return null;
  return mediaFor(meta);
}

function claimForMessage(id, scopeKey, uploaderUserId, messageId) {
  if (!ID_RE.test(String(id || "")) || !MESSAGE_ID_RE.test(String(messageId || ""))) return null;
  const meta = readMeta(id);
  if (!meta || meta.scopeKey !== scopeKey || meta.uploaderUserId !== String(uploaderUserId || "") || meta.claimedMessageId) return null;
  const claimed = { ...meta, claimedMessageId: messageId, claimedAt: new Date().toISOString() };
  writeMeta(claimed, datacrypto.loadKey());
  return mediaFor(claimed);
}

function removeForMessage(id, messageId) {
  const meta = readMeta(id);
  if (!meta || meta.claimedMessageId !== messageId) return false;
  remove(id);
  return true;
}

module.exports = {
  MAX_BYTES,
  MAX_SCOPE_BYTES,
  MAX_TOTAL_BYTES,
  UNCLAIMED_TTL_MS,
  ID_RE,
  ChatAttachmentError,
  save,
  read,
  readMeta,
  remove,
  mediaFor,
  validateMediaForScope,
  claimForMessage,
  removeForMessage,
  sweepUnclaimed,
  usageBytes,
  magicMatches,
  basicScan,
  kindForMime,
  cleanFilename,
  storageDir,
};

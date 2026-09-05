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
const quotaIndex = require("./chat-attachment-index");

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
  const target = metaPath(meta.id);
  const tmp = target + ".tmp";
  try {
    fs.writeFileSync(tmp, stored, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, target);
  } finally { try { fs.unlinkSync(tmp); } catch (_) {} }
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

function index() { return quotaIndex.open(ensureDir(), readMeta); }

// At most 100 expired uploads per sweep. Normal requests never do maintenance.
function sweepUnclaimed(now = Date.now()) {
  let removed = 0;
  for (const id of quotaIndex.expired(index(), now - UNCLAIMED_TTL_MS)) {
    const meta = readMeta(id);
    if (meta && meta.claimedMessageId) { quotaIndex.claim(index(), id); continue; }
    remove(id);
    removed++;
  }
  return removed;
}

function usageBytes(scopeKey) { return quotaIndex.usage(index(), String(scopeKey)); }

let maintenanceTimer = null;
function startMaintenance() {
  index(); // one-time legacy import happens at startup, not the first upload
  if (maintenanceTimer) return;
  const sweep = () => {
    try { sweepUnclaimed(); } catch (error) { console.error("[chat] attachment maintenance failed:", error.code || "storage_error"); }
  };
  maintenanceTimer = setInterval(sweep, 5 * 60 * 1000);
  maintenanceTimer.unref();
  const initial = setTimeout(sweep, 1000);
  initial.unref();
}

function prepare({ scopeKey, uploaderUserId, originalName, mimeType, buffer }) {
  if (!scopeKey || !uploaderUserId) throw new Error("Attachment scope and uploader are required.");
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("Attachment is empty.");
  if (buffer.length > MAX_BYTES) throw new ChatAttachmentError("Attachment is too large.", "CHAT_ATTACHMENT_TOO_LARGE");
  const mime = cleanMime(mimeType);
  if (!magicMatches(mime, buffer)) throw new ChatAttachmentError("Attachment content does not match its file type.", "CHAT_ATTACHMENT_MIME_MISMATCH");
  if (!basicScan(buffer)) throw new ChatAttachmentError("Attachment failed the malware safety check.", "CHAT_ATTACHMENT_UNSAFE");
  return {
    id: newId(), scopeKey: String(scopeKey), uploaderUserId: String(uploaderUserId),
    filename: cleanFilename(originalName), mimeType: mime, size: buffer.length,
    kind: kindForMime(mime), createdAt: new Date().toISOString(),
    claimedMessageId: null, claimedAt: null,
  };
}

function reserve(meta) { quotaIndex.reserve(index(), meta, { total: MAX_TOTAL_BYTES, scope: MAX_SCOPE_BYTES }); }

// Synchronous compatibility API for internal callers. HTTP uploads use the
// asynchronous implementation below (disk, hashing and crypto off the loop).
function save(options) {
  const { buffer } = options;
  const meta = prepare(options);
  meta.contentHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const id = meta.id;
  reserve(meta);
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
    quotaIndex.remove(index(), id);
    throw e;
  }
  return meta;
}

// WebCrypto performs authenticated encryption/decryption in the worker pool.
// Keep the FAT1 format so old attachments and native clients remain compatible.
async function encryptAsync(buffer, key) {
  if (!key) return buffer;
  const iv = crypto.randomBytes(IV_LEN);
  const imported = await crypto.webcrypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const encoded = Buffer.from(await crypto.webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, imported, buffer));
  return Buffer.concat([BIN_MAGIC, iv, encoded.subarray(-TAG_LEN), encoded.subarray(0, -TAG_LEN)]);
}

async function decryptAsync(buffer, key) {
  if (!buffer.subarray(0, 4).equals(BIN_MAGIC)) return buffer;
  if (!key || buffer.length < 4 + IV_LEN + TAG_LEN) throw new Error("Attachment encryption key missing or ciphertext truncated.");
  const imported = await crypto.webcrypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
  const ciphertext = Buffer.concat([buffer.subarray(4 + IV_LEN + TAG_LEN), buffer.subarray(4 + IV_LEN, 4 + IV_LEN + TAG_LEN)]);
  return Buffer.from(await crypto.webcrypto.subtle.decrypt({ name: "AES-GCM", iv: buffer.subarray(4, 4 + IV_LEN) }, imported, ciphertext));
}

async function saveAsync(options) {
  const meta = prepare(options);
  const key = datacrypto.loadKey();
  reserve(meta); // atomic quota reservation BEFORE yielding to concurrent uploads
  const target = dataPath(meta.id);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    meta.contentHash = Buffer.from(await crypto.webcrypto.subtle.digest("SHA-256", options.buffer)).toString("hex");
    const encrypted = await encryptAsync(options.buffer, key);
    const handle = await fs.promises.open(tmp, "wx", 0o600);
    try { await handle.writeFile(encrypted); await handle.sync(); } finally { await handle.close(); }
    await fs.promises.rename(tmp, target);
    writeMeta(meta, key);
    return meta;
  } catch (error) {
    await fs.promises.unlink(tmp).catch(() => {});
    await fs.promises.unlink(target).catch(() => {});
    try { fs.unlinkSync(metaPath(meta.id)); } catch (_) {}
    quotaIndex.remove(index(), meta.id);
    throw error;
  }
}

async function readAsync(id, knownMeta) {
  const meta = knownMeta || readMeta(id);
  if (!meta || meta.id !== id) return null;
  let stored;
  try { stored = await fs.promises.readFile(dataPath(id)); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const buffer = await decryptAsync(stored, datacrypto.loadKey());
  const hash = Buffer.from(await crypto.webcrypto.subtle.digest("SHA-256", buffer)).toString("hex");
  if (buffer.length !== meta.size || (meta.contentHash && hash !== meta.contentHash)) throw new Error("Chat attachment failed its integrity check.");
  return { meta, buffer };
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
  const sql = index();
  for (const target of [dataPath(id), metaPath(id)]) {
    try { fs.unlinkSync(target); } catch (e) { if (!e || e.code !== "ENOENT") throw e; }
  }
  quotaIndex.remove(sql, id);
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
  quotaIndex.claim(index(), id);
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
  saveAsync,
  readAsync,
  startMaintenance,
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

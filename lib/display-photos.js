"use strict";
/**
 * Family photos shown on paired household displays (the Portal night board).
 * Bytes reuse the encrypted chat attachment store under a per-family
 * "display:<familyId>" scope; the datastore keeps only the ordered id list.
 * Parents upload through /api/displays/photos; a display reads its own
 * family's photos with its bearer credential. Nothing here is public.
 */
const crypto = require("crypto");
const db = require("./db");
const chatAttachments = require("./chat-attachments");

const MAX_PHOTOS = 50;
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function scopeKey(familyId) { return "display:" + familyId; }

function familyList(familyId, create = false) {
  const root = db.load();
  if (!root.displayPhotos) {
    if (!create) return [];
    root.displayPhotos = {};
  }
  if (!Array.isArray(root.displayPhotos[familyId])) {
    if (!create) return [];
    root.displayPhotos[familyId] = [];
  }
  return root.displayPhotos[familyId];
}

function publicPhoto(record) { return { id: record.id, createdAt: record.createdAt }; }

function list(familyId) { return familyList(familyId).slice(0, MAX_PHOTOS).map(publicPhoto); }

const limitError = { error: `A display can show up to ${MAX_PHOTOS} photos. Remove one first.`, status: 409, code: "photo_limit" };

async function add(familyId, userId, file) {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) return { error: "Choose a photo to add.", status: 400 };
  if (!TYPES.has(file.mimetype) || file.buffer.length > MAX_BYTES) {
    return { error: "Use a JPEG, PNG or WebP photo under 8 MB.", status: 400 };
  }
  if (familyList(familyId).length >= MAX_PHOTOS) return limitError;
  let meta;
  try {
    meta = await chatAttachments.saveAsync({
      scopeKey: scopeKey(familyId), uploaderUserId: userId,
      originalName: "display-photo", mimeType: file.mimetype, buffer: file.buffer,
    });
  } catch (error) {
    if (error && error.code === "CHAT_ATTACHMENT_QUOTA") return { error: "Photo storage is full.", status: 507 };
    if (error && (error.code === "CHAT_ATTACHMENT_MIME_MISMATCH" || error.code === "CHAT_ATTACHMENT_UNSAFE")) {
      return { error: "That file isn't a photo we can show.", status: 400 };
    }
    throw error;
  }
  // Claiming exempts the bytes from the 24-hour unclaimed-upload sweep. The
  // synthetic message id only marks ownership; no chat message exists.
  chatAttachments.claimForMessage(meta.id, scopeKey(familyId), userId, "m_" + crypto.randomBytes(9).toString("hex"));
  // Re-check after the await: concurrent uploads may have filled the frame.
  const photos = familyList(familyId, true);
  if (photos.length >= MAX_PHOTOS) {
    chatAttachments.remove(meta.id);
    return limitError;
  }
  const record = { id: meta.id, createdBy: userId, createdAt: meta.createdAt };
  photos.unshift(record);
  db.persist();
  return { photo: publicPhoto(record) };
}

function remove(familyId, id) {
  const photos = familyList(familyId);
  const index = photos.findIndex((photo) => photo.id === id);
  if (index < 0) return { error: "Photo not found.", status: 404 };
  photos.splice(index, 1);
  db.persist();
  chatAttachments.remove(id);
  return { ok: true };
}

/** The photo's bytes, only when it belongs to this family's display list. */
async function read(familyId, id) {
  if (!chatAttachments.ID_RE.test(String(id || "")) || !familyList(familyId).some((photo) => photo.id === id)) return null;
  const meta = chatAttachments.readMeta(id);
  if (!meta || meta.scopeKey !== scopeKey(familyId)) return null;
  return chatAttachments.readAsync(id, meta);
}

/** Account deletion: the datastore list goes with the family's top-level maps. */
function removeFamilyFiles(familyId) { chatAttachments.removeScope(scopeKey(familyId)); }

module.exports = { MAX_PHOTOS, MAX_BYTES, list, add, remove, read, removeFamilyFiles, scopeKey };

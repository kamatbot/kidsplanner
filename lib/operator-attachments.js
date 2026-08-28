"use strict";

/**
 * Encrypted Operator case attachments.
 *
 * Raw files are stored under the persistent FamETC data directory using a
 * server-generated id, never a user filename. Metadata/extraction live in the
 * transactional Operator SQLite database. Model-facing extraction is always
 * wrapped as untrusted external content and bounded before disclosure.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const operator = require("./operator");
const operatorStore = require("./operator-store");
const operatorTrust = require("./operator-trust");
const datacrypto = require("./datacrypto");
const { ensureDataDir, dataFile } = require("./paths");

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 64 * 1024;
const MIME_TYPES = Object.freeze([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/plain",
  "text/csv",
  "application/json",
  "message/rfc822",
]);
const TEXT_TYPES = new Set(["text/plain", "text/csv", "application/json", "message/rfc822"]);
const PURPOSES = new Set(["operator-case", "document-structuring", "family-assistance", "trip-planning", "calendar-management", "action-management"]);

class OperatorAttachmentError extends Error {
  constructor(message, code = "OPERATOR_ATTACHMENT_ERROR") {
    super(message);
    this.name = "OperatorAttachmentError";
    this.code = code;
  }
}

function nowIso() { return new Date().toISOString(); }
function newId() { return `attachment_${crypto.randomBytes(12).toString("hex")}`; }
function encryptionKey() {
  const key = datacrypto.loadKey();
  if (!key) throw new OperatorAttachmentError("Attachment encryption is unavailable.", "OPERATOR_ATTACHMENT_UNAVAILABLE");
  return key;
}
function encodeSecret(value) {
  const raw = typeof value === "string" ? value : JSON.stringify(value == null ? null : value);
  return datacrypto.encrypt(raw, encryptionKey());
}
function decodeSecret(value, json = false) {
  if (!value || !datacrypto.isEncrypted(String(value))) throw new OperatorAttachmentError("Attachment metadata is unavailable.", "OPERATOR_ATTACHMENT_UNAVAILABLE");
  const raw = datacrypto.decrypt(String(value), encryptionKey());
  if (!json) return raw;
  try { return JSON.parse(raw); } catch (_) { throw new OperatorAttachmentError("Attachment metadata could not be decoded.", "OPERATOR_ATTACHMENT_UNAVAILABLE"); }
}
function cleanFilename(value) {
  const name = path.basename(String(value || "attachment")).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 180);
  return name || "attachment";
}
function parseBase64(value) {
  const text = String(value || "").trim();
  if (!text || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new OperatorAttachmentError("dataBase64 must contain a valid base64 payload.", "OPERATOR_ATTACHMENT_INVALID");
  const bytes = Buffer.from(text, "base64");
  if (!bytes.length || bytes.length > MAX_BYTES) throw new OperatorAttachmentError(`Attachment must be between 1 byte and ${MAX_BYTES} bytes.`, "OPERATOR_ATTACHMENT_TOO_LARGE");
  return bytes;
}
function magicMatches(mimeType, bytes) {
  if (mimeType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return true;
}
function basicScan(bytes) {
  // Intentional hook, not a replacement for a production malware service.
  // It catches the standard EICAR regression fixture and rejects impossible
  // empty/oversized buffers before persistence.
  if (bytes.includes(Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE", "ascii"))) {
    return { safe: false, reason: "malware-test-signature" };
  }
  return { safe: true, scanner: "fametc-basic-v1" };
}
function extractionFor(id, mimeType, bytes) {
  if (!TEXT_TYPES.has(mimeType)) return { status: "not_extracted", extraction: null };
  const bounded = bytes.subarray(0, MAX_EXTRACTED_BYTES).toString("utf8");
  const envelope = operatorTrust.externalContent({ kind: "attachment", sourceRef: id, text: bounded, observedAt: nowIso() });
  return { status: bytes.length > MAX_EXTRACTED_BYTES ? "truncated" : "ready", extraction: envelope };
}

function createOperatorAttachments(options = {}) {
  const dbFile = options.dbFile || operatorStore.DEFAULT_DB_FILE;
  const storageDir = options.storageDir || dataFile("operator-attachments");
  const scanBytes = options.scanBytes || basicScan;
  let Database = options.Database || null;
  let database = null;
  let initAttempted = false;

  function initialize() {
    if (database || initAttempted) return database;
    initAttempted = true;
    try {
      encryptionKey();
      if (!Database) Database = require("better-sqlite3");
      ensureDataDir();
      fs.mkdirSync(storageDir, { recursive: true, mode: 0o700 });
      const foundation = operatorStore.createOperatorStore({ dbFile, Database });
      const status = foundation.status(); foundation.close();
      if (!status.available) throw new Error("Operator store unavailable");
      database = new Database(dbFile);
      database.pragma("journal_mode = WAL");
      database.pragma("foreign_keys = ON");
      database.pragma("busy_timeout = 5000");
      database.exec(`
        CREATE TABLE IF NOT EXISTS operator_attachments (
          id TEXT PRIMARY KEY,
          family_id TEXT NOT NULL,
          case_id TEXT NOT NULL,
          filename_secret TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          storage_ref_secret TEXT,
          extraction_secret TEXT,
          extraction_status TEXT NOT NULL,
          scan_status TEXT NOT NULL,
          created_by TEXT,
          created_at TEXT NOT NULL,
          deleted_at TEXT,
          FOREIGN KEY(case_id) REFERENCES operator_cases(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_operator_attachments_case
          ON operator_attachments(family_id, case_id, created_at DESC);
      `);
      return database;
    } catch (error) {
      if (database) { try { database.close(); } catch (_) {} }
      database = null;
      return null;
    }
  }
  function requireDb() {
    const db = initialize();
    if (!db) throw new OperatorAttachmentError("Operator attachment storage is unavailable.", "OPERATOR_ATTACHMENT_UNAVAILABLE");
    return db;
  }
  function visibleCase(familyId, caseId, actor) {
    let current;
    try { current = operator.getCase(familyId, caseId, { actor, roomId: "family" }); }
    catch (error) { throw new OperatorAttachmentError(error.message, error.code || "OPERATOR_POLICY_DENIED"); }
    if (!current) throw new OperatorAttachmentError("Operator case not found.", "OPERATOR_CASE_NOT_FOUND");
    return current;
  }
  function requireParent(familyId, actor) {
    const fam = require("./family").getFamily(familyId);
    let validated;
    try { validated = operator.validateActor(fam, actor); } catch (error) { throw new OperatorAttachmentError(error.message, error.code || "OPERATOR_POLICY_DENIED"); }
    if (validated.type !== "parent") throw new OperatorAttachmentError("Only a parent can upload or delete case attachments.", "OPERATOR_ATTACHMENT_PARENT_REQUIRED");
    return validated;
  }
  function hydrate(row) {
    if (!row) return null;
    return {
      id: row.id,
      caseId: row.case_id,
      filename: decodeSecret(row.filename_secret),
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      contentHash: row.content_hash,
      extractionStatus: row.extraction_status,
      scanStatus: row.scan_status,
      createdAt: row.created_at,
      deletedAt: row.deleted_at || null,
    };
  }
  function rowFor(db, familyId, caseId, attachmentId) {
    return db.prepare("SELECT * FROM operator_attachments WHERE id = ? AND family_id = ? AND case_id = ?")
      .get(attachmentId, familyId, caseId) || null;
  }

  function create(familyId, caseId, actor, input = {}) {
    const db = requireDb();
    const parent = requireParent(familyId, actor);
    visibleCase(familyId, caseId, parent);
    const mimeType = String(input.mimeType || "").trim().toLowerCase();
    if (!MIME_TYPES.includes(mimeType)) throw new OperatorAttachmentError("Attachment MIME type is not allowed.", "OPERATOR_ATTACHMENT_INVALID_TYPE");
    const bytes = parseBase64(input.dataBase64);
    if (!magicMatches(mimeType, bytes)) throw new OperatorAttachmentError("Attachment content does not match its MIME type.", "OPERATOR_ATTACHMENT_MIME_MISMATCH");
    const scan = scanBytes(bytes, { mimeType, filename: input.filename });
    if (!scan || scan.safe !== true) throw new OperatorAttachmentError("Attachment failed the malware safety check.", "OPERATOR_ATTACHMENT_UNSAFE");

    const id = newId();
    const filename = cleanFilename(input.filename);
    const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");
    const storagePath = path.join(storageDir, `${id}.enc`);
    const encryptedBlob = datacrypto.encrypt(bytes.toString("base64"), encryptionKey());
    fs.writeFileSync(storagePath, encryptedBlob, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const extracted = extractionFor(id, mimeType, bytes);
    const createdAt = nowIso();
    try {
      db.prepare(`
        INSERT INTO operator_attachments
          (id, family_id, case_id, filename_secret, mime_type, size_bytes, content_hash,
           storage_ref_secret, extraction_secret, extraction_status, scan_status,
           created_by, created_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        id, familyId, caseId, encodeSecret(filename), mimeType, bytes.length, contentHash,
        encodeSecret(storagePath), extracted.extraction ? encodeSecret(extracted.extraction) : null,
        extracted.status, String(scan.scanner || "safe"), parent.principalId, createdAt,
      );
    } catch (error) {
      try { fs.unlinkSync(storagePath); } catch (_) {}
      throw error;
    }
    operatorStore.recordAudit({ familyId, caseId, actorId: parent.principalId, eventType: "attachment.created", payload: { attachmentId: id, mimeType, sizeBytes: bytes.length, contentHash, extractionStatus: extracted.status } });
    return hydrate(rowFor(db, familyId, caseId, id));
  }

  function list(familyId, caseId, actor, options = {}) {
    const db = requireDb();
    visibleCase(familyId, caseId, actor);
    const limit = Math.max(1, Math.min(Number(options.limit) || 50, 100));
    return db.prepare(`
      SELECT * FROM operator_attachments
      WHERE family_id = ? AND case_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT ?
    `).all(familyId, caseId, limit).map(hydrate);
  }

  function getText(familyId, caseId, actor, attachmentId, purpose) {
    const db = requireDb();
    visibleCase(familyId, caseId, actor);
    const requestedPurpose = String(purpose || "operator-case").trim();
    if (!PURPOSES.has(requestedPurpose)) throw new OperatorAttachmentError("Attachment purpose is not allowed.", "OPERATOR_ATTACHMENT_PURPOSE_DENIED");
    const row = rowFor(db, familyId, caseId, attachmentId);
    if (!row || row.deleted_at) return null;
    const metadata = hydrate(row);
    if (!row.extraction_secret) return { attachment: metadata, purpose: requestedPurpose, extraction: null };
    const extraction = decodeSecret(row.extraction_secret, true);
    // Defense in depth: a stored extraction must still be untrusted external data.
    if (!extraction || extraction.trust !== "untrusted-external" || !extraction.authority || extraction.authority.mayGrantExecution !== false) {
      throw new OperatorAttachmentError("Attachment extraction trust metadata is invalid.", "OPERATOR_ATTACHMENT_UNAVAILABLE");
    }
    return { attachment: metadata, purpose: requestedPurpose, extraction };
  }

  function readRawForParent(familyId, caseId, actor, attachmentId) {
    const db = requireDb();
    const parent = requireParent(familyId, actor);
    visibleCase(familyId, caseId, parent);
    const row = rowFor(db, familyId, caseId, attachmentId);
    if (!row || row.deleted_at || !row.storage_ref_secret) return null;
    const storagePath = decodeSecret(row.storage_ref_secret);
    const encrypted = fs.readFileSync(storagePath, "utf8");
    if (!datacrypto.isEncrypted(encrypted)) throw new OperatorAttachmentError("Attachment blob is unavailable.", "OPERATOR_ATTACHMENT_UNAVAILABLE");
    const dataBase64 = datacrypto.decrypt(encrypted, encryptionKey());
    const bytes = Buffer.from(dataBase64, "base64");
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== row.content_hash) throw new OperatorAttachmentError("Attachment integrity check failed.", "OPERATOR_ATTACHMENT_UNAVAILABLE");
    return { attachment: hydrate(row), dataBase64 };
  }

  function remove(familyId, caseId, actor, attachmentId) {
    const db = requireDb();
    const parent = requireParent(familyId, actor);
    visibleCase(familyId, caseId, parent);
    const row = rowFor(db, familyId, caseId, attachmentId);
    if (!row || row.deleted_at) return false;
    if (row.storage_ref_secret) {
      try { fs.unlinkSync(decodeSecret(row.storage_ref_secret)); } catch (error) {
        if (error.code !== "ENOENT") throw new OperatorAttachmentError("Attachment blob could not be removed.", "OPERATOR_ATTACHMENT_UNAVAILABLE");
      }
    }
    const deletedAt = nowIso();
    db.prepare(`
      UPDATE operator_attachments
      SET storage_ref_secret = NULL, extraction_secret = NULL, extraction_status = 'deleted', deleted_at = ?
      WHERE id = ? AND family_id = ? AND case_id = ? AND deleted_at IS NULL
    `).run(deletedAt, attachmentId, familyId, caseId);
    operatorStore.recordAudit({ familyId, caseId, actorId: parent.principalId, eventType: "attachment.deleted", payload: { attachmentId, contentHash: row.content_hash } });
    return true;
  }

  function status() { return { available: !!initialize(), backend: "sqlite+encrypted-files", maxBytes: MAX_BYTES, mimeTypes: MIME_TYPES }; }
  function close() { if (!database) return; try { database.close(); } finally { database = null; initAttempted = true; } }
  return { status, create, list, getText, readRawForParent, remove, close };
}

let singleton = null;
function attachments() { if (!singleton) singleton = createOperatorAttachments(); return singleton; }

module.exports = {
  MAX_BYTES,
  MAX_EXTRACTED_BYTES,
  MIME_TYPES,
  TEXT_TYPES: Object.freeze([...TEXT_TYPES]),
  PURPOSES: Object.freeze([...PURPOSES]),
  OperatorAttachmentError,
  createOperatorAttachments,
  status: (...args) => attachments().status(...args),
  create: (...args) => attachments().create(...args),
  list: (...args) => attachments().list(...args),
  getText: (...args) => attachments().getText(...args),
  readRawForParent: (...args) => attachments().readRawForParent(...args),
  remove: (...args) => attachments().remove(...args),
};

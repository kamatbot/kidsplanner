"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PRODUCT_ID = "fametc";
const MODULE_ID = "family.today";
const SCHEMA_VERSION = "1.0";
const SENSITIVITY = "family-operations-summary";
const REQUEST_TIMEOUT_MS = 10 * 1000;
const MAX_DEAD_LETTERS = 100;
const MIN_SECRET_LENGTH = 32;

function hmacHex(key, value) {
  return crypto.createHmac("sha256", String(key)).update(String(value), "utf8").digest("hex");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function deriveShadowIdentifier(subjectKey, scope, localStableId) {
  if (!subjectKey || String(subjectKey).length < MIN_SECRET_LENGTH) throw new Error("shadow subject key must contain at least 32 characters");
  if (!new Set(["person", "household"]).has(scope) || !localStableId) throw new Error("shadow identifier inputs are required");
  return `shadow_${base64url(crypto.createHmac("sha256", String(subjectKey)).update(`fametc\0${scope}\0${localStableId}`, "utf8").digest())}`;
}

function dateInTimeZone(value, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addMinutesIso(value, minutes) {
  return new Date(new Date(value).getTime() + minutes * 60 * 1000).toISOString();
}

function buildFamilyTodayProjection({
  subject,
  householdSubject,
  sourceVersion,
  generatedAt,
  staleAfter,
  openActions,
  eventsToday,
}) {
  if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 0) throw new Error("sourceVersion must be a non-negative safe integer");
  if (!Number.isSafeInteger(openActions) || openActions < 0) throw new Error("openActions must be a non-negative safe integer");
  if (!Number.isSafeInteger(eventsToday) || eventsToday < 0) throw new Error("eventsToday must be a non-negative safe integer");
  return {
    schemaVersion: SCHEMA_VERSION,
    productId: PRODUCT_ID,
    moduleId: MODULE_ID,
    subject,
    householdSubject,
    sourceVersion,
    generatedAt,
    staleAfter,
    sensitivity: SENSITIVITY,
    status: "ready",
    metrics: { openActions, eventsToday },
    warnings: [],
    nextActions: [],
    deepLinks: [{ label: "Open Today", url: "https://www.fametc.com/?tab=today" }],
    provenance: { source: PRODUCT_ID },
  };
}

function canonicalSignatureInput({ productId = PRODUCT_ID, timestamp, requestId, rawBody }) {
  return [productId, timestamp, requestId, sha256(rawBody)].join("\n");
}

function signShadowRequest({ sourceSecret, productId = PRODUCT_ID, timestamp, requestId, rawBody }) {
  if (!sourceSecret || String(sourceSecret).length < MIN_SECRET_LENGTH) throw new Error("source secret is not configured");
  return `v1=${hmacHex(sourceSecret, canonicalSignatureInput({ productId, timestamp, requestId, rawBody }))}`;
}

function requestIdForProjection(projection) {
  const opaqueSubjectHash = sha256(projection.subject);
  const material = [PRODUCT_ID, MODULE_ID, projection.sourceVersion, opaqueSubjectHash].join("\n");
  return `req_shadow_${sha256(material).slice(0, 48)}`;
}

function emptyJournal() {
  return { schemaVersion: 1, nextSourceVersion: 1, pending: null, deadLetters: [] };
}

function copyProjection(projection) {
  return {
    schemaVersion: projection.schemaVersion,
    productId: projection.productId,
    moduleId: projection.moduleId,
    subject: projection.subject,
    householdSubject: projection.householdSubject,
    sourceVersion: projection.sourceVersion,
    generatedAt: projection.generatedAt,
    staleAfter: projection.staleAfter,
    sensitivity: projection.sensitivity,
    status: projection.status,
    metrics: {
      openActions: projection.metrics.openActions,
      eventsToday: projection.metrics.eventsToday,
    },
    warnings: [],
    nextActions: [],
    deepLinks: [{ label: "Open Today", url: "https://www.fametc.com/?tab=today" }],
    provenance: { source: PRODUCT_ID },
  };
}

function sanitizePending(pending) {
  if (!pending || typeof pending !== "object" || !pending.projection) return null;
  return {
    requestId: String(pending.requestId || ""),
    projection: copyProjection(pending.projection),
    bodyHash: String(pending.bodyHash || ""),
    attemptCount: Number.isSafeInteger(pending.attemptCount) && pending.attemptCount >= 0 ? pending.attemptCount : 0,
    lastAttemptAt: pending.lastAttemptAt == null ? null : String(pending.lastAttemptAt),
    nextAttemptAt: pending.nextAttemptAt == null ? null : String(pending.nextAttemptAt),
    lastErrorCode: pending.lastErrorCode == null ? null : String(pending.lastErrorCode),
  };
}

function sanitizeDeadLetter(deadLetter) {
  if (!deadLetter || typeof deadLetter !== "object" || !deadLetter.projection) return null;
  return {
    requestId: String(deadLetter.requestId || ""),
    projection: copyProjection(deadLetter.projection),
    bodyHash: String(deadLetter.bodyHash || ""),
    status: Number(deadLetter.status),
    errorCode: String(deadLetter.errorCode || "http_4xx"),
    attemptCount: Number.isSafeInteger(deadLetter.attemptCount) && deadLetter.attemptCount >= 0 ? deadLetter.attemptCount : 0,
    occurredAt: String(deadLetter.occurredAt || ""),
  };
}

function normalizeJournal(raw) {
  if (!raw || typeof raw !== "object") throw new Error("journal is invalid");
  if (raw.schemaVersion !== 1) throw new Error("journal schema is unsupported");
  const nextSourceVersion = raw.nextSourceVersion == null ? 1 : Number(raw.nextSourceVersion);
  if (!Number.isSafeInteger(nextSourceVersion) || nextSourceVersion < 0) throw new Error("journal source version is invalid");
  const pending = sanitizePending(raw.pending);
  const deadLetters = Array.isArray(raw.deadLetters)
    ? raw.deadLetters.map(sanitizeDeadLetter).filter(Boolean).slice(-MAX_DEAD_LETTERS)
    : [];
  return { schemaVersion: 1, nextSourceVersion, pending, deadLetters };
}

function readJournal(journalFile) {
  if (!fs.existsSync(journalFile)) return emptyJournal();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(journalFile, "utf8"));
  } catch {
    throw new Error("journal cannot be read");
  }
  return normalizeJournal(raw);
}

function writeJournal(journalFile, journal) {
  const dir = path.dirname(journalFile);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporary = `${journalFile}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const serialized = JSON.stringify(normalizeJournal(journal));
  const fd = fs.openSync(temporary, "w", 0o600);
  try {
    fs.writeFileSync(fd, serialized, "utf8");
    fs.fchmodSync(fd, 0o600);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, journalFile);
  try { fs.chmodSync(journalFile, 0o600); } catch { /* mode is best effort on unusual filesystems */ }
}

function validateConfig(config) {
  const required = ["familyId", "personId", "timeZone", "subjectKey", "sourceSecret", "coreUrl", "journalFile"];
  for (const key of required) {
    if (typeof config[key] !== "string" || !config[key].trim()) throw new Error(`missing ${key}`);
  }
  if (String(config.subjectKey).length < MIN_SECRET_LENGTH) throw new Error("subject key is not configured");
  if (String(config.sourceSecret).length < MIN_SECRET_LENGTH) throw new Error("source secret is not configured");
  if (!path.isAbsolute(config.journalFile)) throw new Error("journal file must be absolute");
  let parsed;
  try { parsed = new URL(config.coreUrl); } catch { throw new Error("core URL is invalid"); }
  if (parsed.username || parsed.password) throw new Error("core URL credentials are not allowed");
  if (parsed.protocol !== "https:") {
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    const loopback = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(hostname);
    if (!loopback) throw new Error("core URL must use HTTPS");
  }
  try { new Intl.DateTimeFormat("en-US", { timeZone: config.timeZone }); } catch { throw new Error("time zone is invalid"); }
  return { ...config, coreUrl: parsed.toString().replace(/\/$/, "") };
}

function retryDelayMs(attemptCount, random = Math.random) {
  const base = Math.min(60 * 60 * 1000, 1000 * (2 ** Math.min(Math.max(attemptCount - 1, 0), 12)));
  const jitter = 0.5 + Math.max(0, Math.min(1, Number(random()) || 0));
  return Math.min(60 * 60 * 1000, Math.max(1, Math.round(base * jitter)));
}

function operationalResult(status, pending, extra = {}) {
  return {
    status,
    sourceVersion: pending?.projection?.sourceVersion,
    attemptCount: pending?.attemptCount || 0,
    ...extra,
  };
}

async function runShadowPublisher(config = {}, deps = {}) {
  const enabled = config.enabled === true || config.enabled === "true";
  if (!enabled) return { status: "disabled", enabled: false };

  let normalized;
  try {
    normalized = validateConfig(config);
  } catch (error) {
    return { status: "configuration-error", errorCode: "invalid_configuration" };
  }

  const nowFn = deps.now || normalized.now || (() => Date.now());
  const fetchFn = deps.fetch || normalized.fetch || globalThis.fetch;
  if (typeof fetchFn !== "function") return { status: "failed", errorCode: "fetch_unavailable" };

  let journal;
  try {
    journal = readJournal(normalized.journalFile);
  } catch {
    return { status: "failed", errorCode: "journal_error" };
  }

  const nowMs = Number(typeof nowFn === "function" ? nowFn() : nowFn);
  if (!Number.isFinite(nowMs)) return { status: "failed", errorCode: "clock_error" };
  const nowIso = new Date(nowMs).toISOString();
  let pending = journal.pending;

  if (pending && pending.nextAttemptAt && nowMs < Date.parse(pending.nextAttemptAt)) {
    return operationalResult("backoff", pending, { nextAttemptAt: pending.nextAttemptAt });
  }

  if (!pending) {
    let actions;
    let events;
    try {
      // Keep source modules out of the disabled path. These are the only two
      // authoritative readers used by this operator-invoked publisher.
      actions = deps.actions || require("./actions");
      events = deps.events || require("./events");
      const actionRows = actions.listForFamily(normalized.familyId);
      const date = dateInTimeZone(nowMs, normalized.timeZone);
      const eventRows = events.listEvents(normalized.familyId, { from: date, to: date });
      const openActions = actionRows.filter((action) => action && action.status === "open").length;
      const eventsToday = eventRows.length;
      const sourceVersion = journal.nextSourceVersion;
      const projection = buildFamilyTodayProjection({
        subject: deriveShadowIdentifier(normalized.subjectKey, "person", normalized.personId),
        householdSubject: deriveShadowIdentifier(normalized.subjectKey, "household", normalized.familyId),
        sourceVersion,
        generatedAt: nowIso,
        staleAfter: addMinutesIso(nowIso, 60),
        openActions,
        eventsToday,
      });
      const rawBody = Buffer.from(JSON.stringify(projection));
      pending = {
        requestId: requestIdForProjection(projection),
        projection,
        bodyHash: sha256(rawBody),
        attemptCount: 0,
        lastAttemptAt: null,
        nextAttemptAt: null,
        lastErrorCode: null,
      };
      journal.pending = pending;
      writeJournal(normalized.journalFile, journal);
    } catch {
      return { status: "failed", errorCode: "source_read_error" };
    }
  }

  const rawBody = Buffer.from(JSON.stringify(pending.projection));
  const requestTimestamp = nowIso;
  const headers = {
    "content-type": "application/json",
    "x-odds-product": PRODUCT_ID,
    "x-odds-timestamp": requestTimestamp,
    "x-odds-request-id": pending.requestId,
    "x-odds-signature": signShadowRequest({
      sourceSecret: normalized.sourceSecret,
      timestamp: requestTimestamp,
      requestId: pending.requestId,
      rawBody,
    }),
  };

  let response;
  let failureCode;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    response = await fetchFn(`${normalized.coreUrl}/v1/ingest/projection`, {
      method: "POST",
      headers,
      body: rawBody,
      signal: controller.signal,
    });
  } catch (error) {
    failureCode = error?.name === "AbortError" ? "timeout" : "network_error";
  } finally {
    clearTimeout(timer);
  }

  if (failureCode || !response || response.status >= 500) {
    failureCode = failureCode || (response ? `http_${response.status}` : "network_error");
    const attemptCount = pending.attemptCount + 1;
    pending.attemptCount = attemptCount;
    pending.lastAttemptAt = nowIso;
    pending.lastErrorCode = failureCode;
    pending.nextAttemptAt = new Date(nowMs + retryDelayMs(attemptCount, deps.random || normalized.random)).toISOString();
    journal.pending = pending;
    try { writeJournal(normalized.journalFile, journal); } catch { return { status: "failed", errorCode: "journal_error" }; }
    return operationalResult("pending", pending, { errorCode: pending.lastErrorCode, nextAttemptAt: pending.nextAttemptAt });
  }

  if (response.status >= 400 && response.status < 500) {
    const attemptCount = pending.attemptCount + 1;
    journal.deadLetters.push({
      requestId: pending.requestId,
      projection: pending.projection,
      bodyHash: pending.bodyHash,
      status: response.status,
      errorCode: `http_${response.status}`,
      attemptCount,
      occurredAt: nowIso,
    });
    journal.deadLetters = journal.deadLetters.slice(-MAX_DEAD_LETTERS);
    journal.pending = null;
    journal.nextSourceVersion = pending.projection.sourceVersion + 1;
    try { writeJournal(normalized.journalFile, journal); } catch { return { status: "failed", errorCode: "journal_error" }; }
    return operationalResult("terminal", pending, { errorCode: `http_${response.status}` });
  }

  if (response.status >= 200 && response.status < 300) {
    journal.pending = null;
    journal.nextSourceVersion = pending.projection.sourceVersion + 1;
    try { writeJournal(normalized.journalFile, journal); } catch { return { status: "failed", errorCode: "journal_error" }; }
    return operationalResult("published", pending);
  }

  const attemptCount = pending.attemptCount + 1;
  pending.attemptCount = attemptCount;
  pending.lastAttemptAt = nowIso;
  pending.lastErrorCode = "unexpected_status";
  pending.nextAttemptAt = new Date(nowMs + retryDelayMs(attemptCount, deps.random || normalized.random)).toISOString();
  journal.pending = pending;
  try { writeJournal(normalized.journalFile, journal); } catch { return { status: "failed", errorCode: "journal_error" }; }
  return operationalResult("pending", pending, { errorCode: "unexpected_status", nextAttemptAt: pending.nextAttemptAt });
}

module.exports = {
  PRODUCT_ID,
  MODULE_ID,
  deriveShadowIdentifier,
  dateInTimeZone,
  addMinutesIso,
  buildFamilyTodayProjection,
  canonicalSignatureInput,
  signShadowRequest,
  requestIdForProjection,
  retryDelayMs,
  runShadowPublisher,
};

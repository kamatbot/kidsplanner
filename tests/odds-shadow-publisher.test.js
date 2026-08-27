"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  addMinutesIso,
  buildFamilyTodayProjection,
  canonicalSignatureInput,
  dateInTimeZone,
  deriveShadowIdentifier,
  requestIdForProjection,
  runShadowPublisher,
  signShadowRequest,
} = require("../lib/odds-shadow-publisher");

const secret = "source-secret-012345678901234567890123456789";
const subjectKey = "subject-key-012345678901234567890123456789";
const nowMs = Date.parse("2026-08-27T00:30:00.000Z");

function journalFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-odds-shadow-"));
  return path.join(dir, "journal.json");
}

function config(file, extra = {}) {
  return {
    enabled: true,
    familyId: "family-local-123",
    personId: "person-local-456",
    timeZone: "America/Los_Angeles",
    subjectKey,
    sourceSecret: secret,
    coreUrl: "http://127.0.0.1:4000",
    journalFile: file,
    ...extra,
  };
}

function sourceDeps({ actions = [], events = [], fetch: fetchFn, now = nowMs, random = () => 0.5 } = {}) {
  const clock = typeof now === "function" ? now : () => now;
  return {
    actions: { listForFamily: () => actions },
    events: { listEvents: (...args) => { sourceDeps.lastEventArgs = args; return events; } },
    fetch: fetchFn || (async () => ({ status: 200 })),
    now: clock,
    random,
  };
}

test("disabled mode returns before validating config, source reads, or fetch", async () => {
  let reads = 0;
  let requests = 0;
  const result = await runShadowPublisher({ enabled: false }, {
    actions: { listForFamily: () => { reads += 1; return []; } },
    events: { listEvents: () => { reads += 1; return []; } },
    fetch: async () => { requests += 1; return { status: 200 }; },
  });
  assert.deepEqual(result, { status: "disabled", enabled: false });
  assert.equal(reads, 0);
  assert.equal(requests, 0);
});

test("identifiers are opaque, scope-separated, and local date/counts are exact", async () => {
  const person = deriveShadowIdentifier(subjectKey, "person", "person-local-456");
  const household = deriveShadowIdentifier(subjectKey, "household", "family-local-123");
  assert.match(person, /^shadow_[A-Za-z0-9_-]+$/);
  assert.match(household, /^shadow_[A-Za-z0-9_-]+$/);
  assert.notEqual(person, household);
  assert.equal(person.includes("person-local-456"), false);
  assert.equal(household.includes("family-local-123"), false);
  assert.equal(dateInTimeZone(nowMs, "America/Los_Angeles"), "2026-08-26");

  const file = journalFile();
  const actions = [{ status: "open" }, { status: "snoozed" }, { status: "done" }, { status: "open" }];
  const response = await runShadowPublisher(config(file), sourceDeps({ actions, events: [{ id: "event-local" }, { id: "event-local-2" }] }));
  assert.equal(response.status, "published");
  const journal = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(journal.nextSourceVersion, 2);
  assert.equal(sourceDeps.lastEventArgs[0], "family-local-123");
  assert.deepEqual(sourceDeps.lastEventArgs[1], { from: "2026-08-26", to: "2026-08-26" });
  assert.equal(journal.pending, null);
  assert.equal(journal.deadLetters.length, 0);
  assert.equal(journal._raw, undefined);

  const raw = fs.readFileSync(file, "utf8");
  for (const value of ["family-local-123", "person-local-456", secret, "event-local"]) assert.equal(raw.includes(value), false);
});

test("projection and signing use the locked canonical fields and form", () => {
  const generatedAt = new Date(nowMs).toISOString();
  const projection = buildFamilyTodayProjection({
    subject: "shadow_person",
    householdSubject: "shadow_household",
    sourceVersion: 3,
    generatedAt,
    staleAfter: addMinutesIso(generatedAt, 60),
    openActions: 2,
    eventsToday: 4,
  });
  assert.deepEqual(projection, {
    schemaVersion: "1.0",
    productId: "fametc",
    moduleId: "family.today",
    subject: "shadow_person",
    householdSubject: "shadow_household",
    sourceVersion: 3,
    generatedAt,
    staleAfter: "2026-08-27T01:30:00.000Z",
    sensitivity: "family-operations-summary",
    status: "ready",
    metrics: { openActions: 2, eventsToday: 4 },
    warnings: [],
    nextActions: [],
    deepLinks: [{ label: "Open Today", url: "https://www.fametc.com/?tab=today" }],
    provenance: { source: "fametc" },
  });
  const rawBody = Buffer.from(JSON.stringify(projection));
  const timestamp = "2026-08-27T00:30:00.000Z";
  const requestId = requestIdForProjection(projection);
  const expected = `v1=${crypto.createHmac("sha256", secret).update(canonicalSignatureInput({
    productId: "fametc", timestamp, requestId, rawBody,
  })).digest("hex")}`;
  assert.equal(signShadowRequest({ sourceSecret: secret, timestamp, requestId, rawBody }), expected);
});

test("failed retry keeps byte-identical envelope and request ID while refreshing the signature timestamp", async () => {
  const file = journalFile();
  const requests = [];
  let now = nowMs;
  let responseStatus = 503;
  const fetchFn = async (url, options) => {
    requests.push({ url, body: Buffer.from(options.body), headers: { ...options.headers } });
    return { status: responseStatus };
  };
  const base = config(file);
  const first = await runShadowPublisher(base, sourceDeps({ fetch: fetchFn, now: () => now }));
  assert.equal(first.status, "pending");
  const firstJournal = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(firstJournal.pending.nextAttemptAt);
  const firstRequest = requests[0];

  now += 1;
  const deferred = await runShadowPublisher(base, sourceDeps({ fetch: fetchFn, now: () => now }));
  assert.equal(deferred.status, "backoff");
  assert.equal(requests.length, 1);

  now = Date.parse(firstJournal.pending.nextAttemptAt);
  responseStatus = 200;
  const second = await runShadowPublisher(base, sourceDeps({ fetch: fetchFn, now: () => now }));
  assert.equal(second.status, "published");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].body, firstRequest.body);
  assert.equal(requests[1].headers["x-odds-request-id"], firstRequest.headers["x-odds-request-id"]);
  assert.notEqual(requests[1].headers["x-odds-timestamp"], firstRequest.headers["x-odds-timestamp"]);
  assert.equal(JSON.parse(requests[1].body).generatedAt, JSON.parse(firstRequest.body).generatedAt);
  const secondJournal = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(secondJournal.pending, null);
  assert.equal(secondJournal.nextSourceVersion, 2);
});

test("4xx is terminal, stores no response body, and terminal retention is bounded", async () => {
  const file = journalFile();
  const responseBody = "private core response body";
  const base = config(file);
  let now = nowMs;
  const fetchFn = async () => ({ status: 422, text: async () => responseBody });
  for (let i = 0; i < 101; i += 1) {
    const result = await runShadowPublisher(base, sourceDeps({ fetch: fetchFn, now: () => now }));
    assert.equal(result.status, "terminal");
    now += 1000;
  }
  const journal = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(journal.pending, null);
  assert.equal(journal.deadLetters.length, 100);
  assert.ok(journal.deadLetters.every((entry) => entry.errorCode === "http_422"));
  assert.equal(fs.readFileSync(file, "utf8").includes(responseBody), false);
});

test("core outage returns an operational failure and never mutates source fixtures", async () => {
  const file = journalFile();
  const actions = [{ id: "action-local", status: "open" }];
  const events = [{ id: "event-local", date: "2026-08-26" }];
  const actionsBefore = JSON.stringify(actions);
  const eventsBefore = JSON.stringify(events);
  const result = await runShadowPublisher(config(file), sourceDeps({
    actions,
    events,
    fetch: async () => { throw new Error("core unavailable"); },
  }));
  assert.equal(result.status, "pending");
  assert.equal(result.errorCode, "network_error");
  assert.equal(JSON.stringify(actions), actionsBefore);
  assert.equal(JSON.stringify(events), eventsBefore);
});

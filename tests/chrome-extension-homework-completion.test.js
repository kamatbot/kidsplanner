"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const backgroundSource = fs.readFileSync(path.join(root, "chrome-extension", "background.js"), "utf8");
const contentSource = fs.readFileSync(path.join(root, "chrome-extension", "content.js"), "utf8");
const moodleOrigin = "https://bangkok.learn.nae.school";

function loadBackground(overrides = {}) {
  let listener;
  const chrome = overrides.chrome || {
    runtime: {
      lastError: null,
      onMessage: { addListener(fn) { listener = fn; } },
    },
    tabs: {
      query: async () => [],
      create: async () => ({ id: 1 }),
      get: (_id, callback) => callback({ id: 1, status: "complete" }),
      remove: async () => {},
      update: async () => {},
      onUpdated: { addListener() {}, removeListener() {} },
    },
    windows: { update: async () => {} },
    scripting: { executeScript: async () => [{ result: null }] },
  };
  const context = {
    chrome,
    fetch: overrides.fetch || (async () => { throw new Error("unexpected fetch"); }),
    URL,
    URLSearchParams,
    AbortController,
    DOMParser: overrides.DOMParser || class {},
    setTimeout,
    clearTimeout,
    console,
  };
  vm.runInNewContext(backgroundSource, context, { filename: "chrome-extension/background.js" });
  return { context, chrome, get listener() { return listener; } };
}

function row(taskId, { complete = false, controls = 1 } = {}) {
  return {
    getAttribute: (name) => name === "data-id" ? taskId : null,
    classList: { contains: (name) => name === "tickon" && complete },
    querySelectorAll: (selector) => selector === '.tick.ajax[data-type="tick"]'
      ? Array.from({ length: controls }, () => ({}))
      : [],
  };
}

function doc({ rows = [], login = false, script = "" } = {}) {
  return {
    querySelector: (selector) => selector.includes("form#login") && login ? {} : null,
    querySelectorAll: (selector) => {
      if (selector === ".accordion-item.applyhwclass") return rows;
      if (selector === "script") return script ? [{ textContent: script }] : [];
      return [];
    },
  };
}

function operationHarness({ currentRows, completedDocs, postError, script, sesskey = "fresh-sesskey" }) {
  const calls = [];
  const completedUrl = `${moodleOrigin}/mod/homework/view.php?h=2&userid=42&showcompleted=1&limit=0`;
  let completedIndex = 0;
  const documents = new Map();
  completedDocs.forEach((document, index) => documents.set(`completed-${index}`, document));
  const { context } = loadBackground({
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith("/mod/homework/view_ajax.php")) {
        if (postError) throw postError;
        return { ok: true, url: String(url), text: async () => "1" };
      }
      const token = `completed-${completedIndex++}`;
      return { ok: true, url: completedUrl, text: async () => token };
    },
    DOMParser: class {
      parseFromString(token) { return documents.get(token); }
    },
  });
  context.document = doc({ rows: currentRows, script });
  context.location = {
    href: `${moodleOrigin}/mod/homework/view.php?h=2&userid=42&showcompleted=0&limit=0#fametc-completion-sync`,
    hash: "#fametc-completion-sync",
  };
  context.M = { cfg: { sesskey } };
  return { context, calls };
}

test("injected Moodle operation targets only the exact task with fresh state-setting metadata and verifies after write", async () => {
  const { context, calls } = operationHarness({
    currentRows: [row("3808216"), row("9999999")],
    completedDocs: [doc(), doc({ rows: [row("3808216", { complete: true })] })],
    script: `require(["mod_homework/homework"], function(amd) { amd.init("3", ""); });`,
  });

  const result = await context.runMoodleCompletionOperation("3808216", "42", 1000);
  assert.equal(result.verified, true);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /showcompleted=1/);
  assert.match(calls[1].url, /view_ajax\.php$/);
  assert.match(calls[2].url, /showcompleted=1/);

  const posted = Object.fromEntries(calls[1].options.body.entries());
  assert.deepEqual(posted, {
    id: "3808216",
    type: "tick",
    val: "1",
    sesskey: "fresh-sesskey",
    stampcollid: "3",
    title: "",
  });
  assert.equal(calls[1].options.credentials, "include");
  assert.equal(calls[1].options.cache, "no-store");
});

test("injected Moodle operation verifies before write and skips POST for an already-completed exact task", async () => {
  const { context, calls } = operationHarness({
    currentRows: [],
    completedDocs: [doc({ rows: [row("3808216", { complete: true })] })],
    script: "",
    sesskey: "",
  });

  const result = await context.runMoodleCompletionOperation("3808216", "42", 1000);
  assert.equal(result.verified, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /showcompleted=1/);
});

test("injected Moodle operation treats a failed or timed-out POST as successful only after exact verification", async () => {
  const { context, calls } = operationHarness({
    currentRows: [row("3808216")],
    completedDocs: [doc(), doc({ rows: [row("3808216", { complete: true })] })],
    postError: new DOMException("timed out", "AbortError"),
    script: `amd.init('stamp-after-timeout', 'Title after timeout')`,
  });

  const result = await context.runMoodleCompletionOperation("3808216", "42", 1000);
  assert.equal(result.verified, true);
  assert.equal(calls.filter((call) => /view_ajax/.test(call.url)).length, 1);
  assert.equal(calls.filter((call) => /showcompleted=1/.test(call.url)).length, 2);
});

test("injected Moodle operation fails closed for login, missing, ambiguous, and unavailable metadata", async (t) => {
  await t.test("login redirect/view", async () => {
    const { context, calls } = operationHarness({ currentRows: [], completedDocs: [], script: "" });
    context.location.href = `${moodleOrigin}/login/index.php`;
    assert.equal((await context.runMoodleCompletionOperation("3808216", "42", 1000)).error, "MOODLE_VIEW_INVALID");
    assert.equal(calls.length, 0);
  });

  await t.test("login form at the expected URL", async () => {
    const { context, calls } = operationHarness({ currentRows: [], completedDocs: [], script: "" });
    context.document = doc({ login: true });
    assert.equal((await context.runMoodleCompletionOperation("3808216", "42", 1000)).error, "MOODLE_VIEW_INVALID");
    assert.equal(calls.length, 0);
  });

  await t.test("missing exact task", async () => {
    const { context, calls } = operationHarness({
      currentRows: [row("999999")], completedDocs: [doc()], script: `amd.init("s", "t")`,
    });
    assert.equal((await context.runMoodleCompletionOperation("3808216", "42", 1000)).error, "TASK_MISSING");
    assert.equal(calls.length, 1);
  });

  await t.test("ambiguous completed task", async () => {
    const duplicate = row("3808216", { complete: true });
    const { context, calls } = operationHarness({
      currentRows: [row("3808216")], completedDocs: [doc({ rows: [duplicate, duplicate] })], script: `amd.init("s", "t")`,
    });
    assert.equal((await context.runMoodleCompletionOperation("3808216", "42", 1000)).error, "TASK_AMBIGUOUS");
    assert.equal(calls.length, 1);
  });

  await t.test("missing fresh init metadata", async () => {
    const { context, calls } = operationHarness({
      currentRows: [row("3808216")], completedDocs: [doc()], script: "",
    });
    assert.equal((await context.runMoodleCompletionOperation("3808216", "42", 1000)).error, "MOODLE_SESSION_INVALID");
    assert.equal(calls.length, 1);
  });
});

function validRequest(requestId, taskId) {
  return {
    schemaVersion: 1,
    requestId,
    desiredState: "done",
    moodle: {
      origin: moodleOrigin,
      homeworkViewId: "2",
      userId: "42",
      taskId,
    },
  };
}

test("queue validation rejects request IDs and Moodle identities above server bounds", () => {
  const { context } = loadBackground();
  assert.equal(context.validCompletionRequest(validRequest(`mcr_${"a".repeat(124)}`, "1")), true);
  assert.equal(context.validCompletionRequest(validRequest(`mcr_${"a".repeat(125)}`, "1")), false);
  assert.equal(context.validCompletionRequest({
    ...validRequest("mcr_user_too_long", "1"),
    moodle: { ...validRequest("mcr_user_too_long", "1").moodle, userId: "1".repeat(21) },
  }), false);
  assert.equal(context.validCompletionRequest(validRequest("mcr_task_too_long", "1".repeat(201))), false);
});

function invokeMessage(listener, msg, sender) {
  return new Promise((resolve, reject) => {
    const keptOpen = listener(msg, sender, resolve);
    if (!keptOpen) reject(new Error("message channel was not kept open"));
  });
}

test("background validates sender, deduplicates exact identities, acknowledges only verified requests, and cleans hidden tabs", async () => {
  const queue = [
    validRequest("mcr_one", "3808216"),
    validRequest("mcr_one", "3808216"),
    validRequest("mcr_two", "3808217"),
    { ...validRequest("mcr_wrong", "3808218"), moodle: { ...validRequest("mcr_wrong", "3808218").moodle, origin: "https://evil.invalid" } },
  ];
  const fetchCalls = [];
  const removed = [];
  const created = [];
  let nextTab = 10;
  let listener;
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener(fn) { listener = fn; } },
    },
    tabs: {
      query: async () => [],
      create: async ({ url, active }) => {
        created.push({ url, active });
        return { id: nextTab++, url, active };
      },
      get: (id, callback) => callback({ id, status: "complete" }),
      remove: async (id) => { removed.push(id); },
      update: async () => {},
      onUpdated: { addListener() {}, removeListener() {} },
    },
    windows: { update: async () => {} },
    scripting: {
      executeScript: async ({ func, args }) => {
        assert.equal(func.name, "runMoodleCompletionOperation");
        return [{ result: args[0] === "3808216"
          ? { verified: true }
          : { verified: false, error: "TASK_MISSING" } }];
      },
    },
  };
  loadBackground({
    chrome,
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      if (String(url).endsWith("/pending")) {
        return { ok: true, json: async () => ({ completions: queue, hasMore: false }) };
      }
      if (String(url).endsWith("/claim")) {
        const requestId = JSON.parse(options.body).requestId;
        return { ok: true, json: async () => ({
          completion: queue.find((item) => item.requestId === requestId) || null,
        }) };
      }
      return { ok: true, json: async () => ({ acknowledgedRequestIds: ["mcr_one"] }) };
    },
  });

  const invalid = await invokeMessage(listener, { type: "SYNC_MOODLE_COMPLETIONS" }, { tab: { id: 1, url: "https://evil.invalid/" } });
  assert.deepEqual(JSON.parse(JSON.stringify(invalid)), {
    attempted: 0, verified: 0, acknowledged: 0, pending: 0, errors: ["INVALID_SENDER"],
  });
  assert.equal(fetchCalls.length, 0);

  const result = await invokeMessage(listener, { type: "SYNC_MOODLE_COMPLETIONS" }, {
    tab: { id: 2, url: `${moodleOrigin}/my/` },
  });
  assert.equal(result.attempted, 2);
  assert.equal(result.verified, 1);
  assert.equal(result.acknowledged, 1);
  assert.equal(result.pending, 2);
  assert.ok(result.errors.includes("INVALID_REQUEST"));
  assert.ok(result.errors.includes("TASK_MISSING"));
  assert.deepEqual(removed, [10, 11]);
  assert.deepEqual(created, [
    { url: `${moodleOrigin}/mod/homework/view.php?h=2&userid=42&showcompleted=0&limit=0#fametc-completion-sync`, active: false },
    { url: `${moodleOrigin}/mod/homework/view.php?h=2&userid=42&showcompleted=0&limit=0#fametc-completion-sync`, active: false },
  ]);

  const ack = fetchCalls.find((call) => String(call.url).endsWith("/ack"));
  assert.ok(ack);
  assert.deepEqual(JSON.parse(ack.options.body), { requestIds: ["mcr_one"] });
  assert.equal(ack.options.credentials, "include");
  assert.equal(ack.options.cache, "no-store");
});

test("Fam ETC queue and acknowledgement fall back to an already-open canonical tab without opening one", async () => {
  let injected = 0;
  let created = 0;
  const operation = validRequest("mcr_fallback", "3808216");
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener() {} } },
    tabs: {
      query: async ({ url }) => {
        assert.equal(Array.from(url).join(""), "https://www.fametc.com/*");
        return [{ id: 91, url: "https://www.fametc.com/app" }];
      },
      create: async () => { created += 1; return { id: 1 }; },
      onUpdated: { addListener() {}, removeListener() {} },
    },
    windows: { update: async () => {} },
    scripting: {
      executeScript: async ({ target, world, args }) => {
        injected += 1;
        assert.equal(target.tabId, 91);
        assert.equal(world, "MAIN");
        assert.equal(args[1].credentials, "include");
        assert.equal(args[1].cache, "no-store");
        if (String(args[0]).endsWith("/pending")) {
          return [{ result: { ok: true, payload: { completions: [operation], hasMore: false } } }];
        }
        if (String(args[0]).endsWith("/claim")) {
          return [{ result: { ok: true, payload: { completion: operation } } }];
        }
        return [{ result: { ok: true, payload: { acknowledgedRequestIds: [operation.requestId] } } }];
      },
    },
  };
  const { context } = loadBackground({ chrome, fetch: async () => ({ ok: false }) });

  const pending = await context.readPendingCompletions();
  assert.equal(pending.completions.length, 1);
  assert.equal(pending.completions[0].requestId, "mcr_fallback");
  assert.equal((await context.claimCompletion("mcr_fallback")).requestId, "mcr_fallback");
  assert.deepEqual(Array.from(await context.acknowledgeCompletions(["mcr_fallback"])), ["mcr_fallback"]);
  assert.equal(injected, 3);
  assert.equal(created, 0);
});

test("hidden Moodle tab is removed when load or injection fails", async () => {
  const removed = [];
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener() {} } },
    tabs: {
      query: async () => [],
      create: async () => ({ id: 73 }),
      get: (_id, callback) => callback({ id: 73, status: "complete" }),
      remove: async (id) => { removed.push(id); },
      onUpdated: { addListener() {}, removeListener() {} },
    },
    windows: { update: async () => {} },
    scripting: { executeScript: async () => { throw new Error("tab closed"); } },
  };
  const operation = validRequest("mcr_cleanup", "3808216");
  const { context } = loadBackground({
    chrome,
    fetch: async (url) => String(url).endsWith("/claim")
      ? { ok: true, json: async () => ({ completion: operation }) }
      : { ok: false },
  });
  const result = await context.deliverCompletionRequest(operation);
  assert.equal(result.verified, false);
  assert.equal(result.error, "HIDDEN_TAB_FAILED");
  assert.deepEqual(removed, [73]);
});

test("a queue snapshot cancelled before the atomic claim never reaches Moodle", async () => {
  const operation = validRequest("mcr_cancelled_before_claim", "3808216");
  const removed = [];
  let moodleExecutions = 0;
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener() {} } },
    tabs: {
      query: async () => [],
      create: async () => ({ id: 74 }),
      get: (_id, callback) => callback({ id: 74, status: "complete" }),
      remove: async (id) => { removed.push(id); },
      onUpdated: { addListener() {}, removeListener() {} },
    },
    windows: { update: async () => {} },
    scripting: { executeScript: async () => { moodleExecutions += 1; return [{ result: { verified: true } }]; } },
  };
  const { context } = loadBackground({
    chrome,
    fetch: async (url) => String(url).endsWith("/claim")
      ? { ok: true, json: async () => ({ completion: null }) }
      : { ok: false },
  });

  const result = await context.deliverCompletionRequest(operation);
  assert.equal(result.claimed, false);
  assert.equal(result.error, "CLAIM_REJECTED");
  assert.equal(moodleExecutions, 0);
  assert.deepEqual(removed, [74]);
});

test("partial acknowledgement keeps refused verified operations pending", async () => {
  let listener;
  let nextTab = 80;
  const queue = [validRequest("mcr_partial_one", "3808216"), validRequest("mcr_partial_two", "3808217")];
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener(fn) { listener = fn; } } },
    tabs: {
      query: async () => [],
      create: async () => ({ id: nextTab++ }),
      get: (id, callback) => callback({ id, status: "complete" }),
      remove: async () => {},
      onUpdated: { addListener() {}, removeListener() {} },
    },
    windows: { update: async () => {} },
    scripting: { executeScript: async () => [{ result: { verified: true } }] },
  };
  loadBackground({
    chrome,
    fetch: async (url, options = {}) => {
      if (String(url).endsWith("/pending")) {
        return { ok: true, json: async () => ({ completions: queue, hasMore: false }) };
      }
      if (String(url).endsWith("/claim")) {
        const requestId = JSON.parse(options.body).requestId;
        return { ok: true, json: async () => ({ completion: queue.find((item) => item.requestId === requestId) }) };
      }
      return { ok: true, json: async () => ({ acknowledgedRequestIds: ["mcr_partial_one"] }) };
    },
  });

  const result = await invokeMessage(listener, { type: "SYNC_MOODLE_COMPLETIONS" }, {
    tab: { id: 2, url: `${moodleOrigin}/my/` },
  });
  assert.equal(result.attempted, 2);
  assert.equal(result.verified, 2);
  assert.equal(result.acknowledged, 1);
  assert.equal(result.pending, 1);
  assert.ok(result.errors.includes("ACK_FAILED"));
});

test("background shares one in-flight batch and reports ack failure as pending", async () => {
  let listener;
  let pendingFetches = 0;
  let releasePending;
  const pendingGate = new Promise((resolve) => { releasePending = resolve; });
  const removed = [];
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener(fn) { listener = fn; } } },
    tabs: {
      query: async () => [],
      create: async () => ({ id: 55 }),
      get: (_id, callback) => callback({ id: 55, status: "complete" }),
      remove: async (id) => { removed.push(id); },
      onUpdated: { addListener() {}, removeListener() {} },
    },
    windows: { update: async () => {} },
    scripting: { executeScript: async () => [{ result: { verified: true } }] },
  };
  loadBackground({
    chrome,
    fetch: async (url) => {
      if (String(url).endsWith("/pending")) {
        pendingFetches += 1;
        await pendingGate;
        return { ok: true, json: async () => ({
          completions: [validRequest("mcr_shared", "3808216")],
          hasMore: false,
        }) };
      }
      if (String(url).endsWith("/claim")) {
        return { ok: true, json: async () => ({ completion: validRequest("mcr_shared", "3808216") }) };
      }
      return { ok: false };
    },
  });

  const sender = { tab: { id: 2, url: `${moodleOrigin}/my/` } };
  const first = invokeMessage(listener, { type: "SYNC_MOODLE_COMPLETIONS" }, sender);
  const second = invokeMessage(listener, { type: "SYNC_MOODLE_COMPLETIONS" }, sender);
  releasePending();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(pendingFetches, 1);
  assert.equal(a.verified, 1);
  assert.equal(a.acknowledged, 0);
  assert.equal(a.pending, 1);
  assert.ok(a.errors.includes("ACK_FAILED"));
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.deepEqual(removed, [55]);
});

test("unknown or failed queue state returns errors without inventing pending work", async () => {
  const unreadable = loadBackground({
    fetch: async () => ({ ok: false }),
  });
  const unavailable = await unreadable.context.runCompletionBatch();
  assert.equal(unavailable.pending, 0);
  assert.deepEqual(Array.from(unavailable.errors), ["QUEUE_FETCH_FAILED"]);

  let listener;
  const brokenQueue = new Proxy([], {
    get(target, property, receiver) {
      if (property === "slice") throw new Error("malformed structured data");
      return Reflect.get(target, property, receiver);
    },
  });
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener(fn) { listener = fn; } } },
    tabs: {
      query: async () => [],
      onUpdated: { addListener() {}, removeListener() {} },
    },
    windows: { update: async () => {} },
    scripting: { executeScript: async () => [{ result: null }] },
  };
  loadBackground({
    chrome,
    fetch: async () => ({ ok: true, json: async () => ({ completions: brokenQueue }) }),
  });
  const failed = await invokeMessage(listener, { type: "SYNC_MOODLE_COMPLETIONS" }, {
    tab: { id: 2, url: `${moodleOrigin}/my/` },
  });
  assert.equal(failed.pending, 0);
  assert.deepEqual(Array.from(failed.errors), ["COMPLETION_SYNC_FAILED"]);
});

test("content script guards hidden delivery tabs and triggers completion sync before normal throttled import work", async () => {
  const calls = [];
  const context = {
    window: {
      location: { hash: "", href: `${moodleOrigin}/my/` },
      famParse: {},
    },
    document: {
      querySelector: (selector) => selector.includes(".usermenu") ? {} : null,
      getElementById: () => null,
      createElement: () => { calls.push("BANNER"); throw new Error("errors-only result must stay silent"); },
      documentElement: { outerHTML: "" },
    },
    chrome: {
      runtime: {
        sendMessage: async (message) => {
          calls.push(message.type);
          if (message.type === "SYNC_MOODLE_COMPLETIONS") {
            return { attempted: 0, verified: 0, acknowledged: 0, pending: 0, errors: ["QUEUE_FETCH_FAILED"] };
          }
          return null;
        },
      },
      storage: { local: { get() { throw new Error("throttle should not be reached"); }, set() {} } },
    },
    URL,
    MutationObserver: class {},
    setTimeout,
    clearTimeout,
    console,
  };
  vm.runInNewContext(contentSource, context, { filename: "chrome-extension/content.js" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["SYNC_MOODLE_COMPLETIONS", "AUTO_SYNC_CHECK"]);

  calls.length = 0;
  context.window.location.hash = "#fametc-completion-sync";
  vm.runInNewContext(contentSource, context, { filename: "chrome-extension/content-hidden.js" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, []);
});

test("completion feedback inserts runtime counts with textContent and uses the exact hidden-tab hash", () => {
  assert.match(contentSource, /window\.location\.hash !== "#fametc-completion-sync"/);
  assert.match(contentSource, /data-fam-completion-message[^`]*`[\s\S]*\.textContent = message/);
  assert.doesNotMatch(contentSource, /data-fam-completion-message[^\n]*\$\{/);
  assert.match(backgroundSource, /showcompleted=0&limit=0\$\{COMPLETION_SYNC_HASH\}/);
  assert.match(backgroundSource, /cache:\s*"no-store"/);
});

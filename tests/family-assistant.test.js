"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-family-assistant-"));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.FAM_ASSISTANT_RETRY_MS = "0";

const store = require("../lib/store");
const family = require("../lib/family");
const chat = require("../lib/chat");
const hermes = require("../lib/hermes");
const events = require("../lib/events");
const actions = require("../lib/actions");
const assistant = require("../lib/family-assistant");

let counter = 0;
function fixture() {
  counter += 1;
  const parent = store.createUser(`fa${counter}@example.com`, `Parent ${counter}`);
  const fam = family.createFamily(parent.id, "Assist Family");
  return { parent, fam };
}
function parentMessage(fam, parent, text) {
  return chat.sendMessage(fam.id, { senderType: "parent", senderId: parent.id, postedByUserId: parent.id, text }).message;
}

// Scripted Claude: each call returns the next response and records the request.
function mockClaude(responses) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    return { ok: true, status: 200, json: async () => next };
  };
  return { calls, restore() { global.fetch = original; } };
}

test("a parent's @Hermes request adds the event through the tool and posts a short reply", async () => {
  const { parent, fam } = fixture();
  const msg = parentMessage(fam, parent, "@Hermes add test at 9pm on 2026-11-07");
  const claude = mockClaude([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "add_event", input: { title: "Test", date: "2026-11-07", time: "21:00" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Added Test on Sat 7 Nov at 9pm." }] },
  ]);
  try {
    const reply = await assistant.respond({ fam, scopeKey: fam.id, message: msg });
    assert.equal(reply.message.senderType, "agent");
    assert.equal(reply.message.text, "Added Test on Sat 7 Nov at 9pm.");
  } finally { claude.restore(); }
  const saved = events.listEvents(fam.id, { from: "2026-11-07", to: "2026-11-07" });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].time, "21:00");
  assert.equal(claude.calls.length, 2);
  const first = claude.calls[0].body;
  assert.deepEqual(first.tools.map((t) => t.name), ["add_event", "update_event", "add_todo", "update_todo", "set_reminder", "remember", "forget", "close_followup", "undo_last"]);
  assert.match(first.system.map((b) => b.text).join("\n"), /Family snapshot/);
  assert.deepEqual(first.system.map((b) => b.cache_control && b.cache_control.type), ["ephemeral", "ephemeral"]);
  assert.equal(first.tools.at(-1).cache_control.type, "ephemeral");
  assert.equal(first.messages.at(-1).role, "user");
  assert.match(first.messages.at(-1).content, /add test at 9pm/);
  const toolResult = claude.calls[1].body.messages.at(-1).content[0];
  assert.equal(toolResult.type, "tool_result");
  assert.notEqual(toolResult.is_error, true);
});

test("tool errors go back to the model instead of crashing, and to-dos can be added", async () => {
  const { parent, fam } = fixture();
  const msg = parentMessage(fam, parent, "@Hermes remind me to buy milk");
  const claude = mockClaude([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "a", name: "update_event", input: { eventId: "nope", patch: { title: "x" } } }, { type: "tool_use", id: "b", name: "add_todo", input: { title: "Buy milk" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "**Added** Buy milk." }] },
  ]);
  try {
    const reply = await assistant.respond({ fam, scopeKey: fam.id, message: msg });
    assert.equal(reply.message.text, "Added Buy milk.");
  } finally { claude.restore(); }
  const results = claude.calls[1].body.messages.at(-1).content;
  assert.equal(results[0].is_error, true);
  assert.notEqual(results[1].is_error, true);
  assert.ok(actions.listForFamily(fam.id, { statuses: ["open"] }).some((a) => a.title === "Buy milk"));
});

test("stays silent for kids, when an external Hermes is connected, or when turned off", async () => {
  const { parent, fam } = fixture();
  const claude = mockClaude([]);
  try {
    const kidMsg = { id: "k1", senderType: "kid", senderId: "kid1", postedByUserId: null, text: "@Hermes hi" };
    assert.equal(await assistant.respond({ fam, scopeKey: fam.id, message: kidMsg }), null);
    process.env.FAM_ASSISTANT = "off";
    assert.equal(assistant.enabled(fam), false);
    delete process.env.FAM_ASSISTANT;
    assert.equal(assistant.enabled(fam), true);
    hermes.connectFamily(fam.id);
    assert.equal(assistant.enabled(fam), false);
    const msg = parentMessage(fam, parent, "@Hermes hi");
    assert.equal(await assistant.respond({ fam, scopeKey: fam.id, message: msg }), null);
  } finally { claude.restore(); }
  assert.equal(claude.calls.length, 0);
});

test("an API failure posts a short apology instead of hanging", async () => {
  const { parent, fam } = fixture();
  const msg = parentMessage(fam, parent, "@Hermes what's on tomorrow?");
  const original = global.fetch;
  global.fetch = async () => ({ ok: false, status: 529, json: async () => ({}) });
  try {
    const reply = await assistant.respond({ fam, scopeKey: fam.id, message: msg });
    assert.match(reply.message.text, /try again/);
  } finally { global.fetch = original; }
});

test("disabledReason explains a missing key and a lingering Hermes connection", () => {
  const { fam } = fixture();
  assert.equal(assistant.disabledReason(fam), null);
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.match(assistant.disabledReason(fam), /ANTHROPIC_API_KEY/);
  process.env.ANTHROPIC_API_KEY = key;
  hermes.connectFamily(fam.id);
  assert.match(assistant.disabledReason(fam), /Disconnect Hermes/);
});

test("a private-thread message gets the reason posted when the assistant is off", async () => {
  const { parent, fam } = fixture();
  hermes.connectFamily(fam.id);
  const msg = parentMessage(fam, parent, "hello");
  assistant.handleAsync({ fam, scopeKey: fam.id, message: msg, explainWhenOff: true });
  await new Promise((resolve) => setImmediate(resolve));
  const last = chat.listMessages(fam.id, { limit: 1 })[0];
  assert.equal(last.senderType, "agent");
  assert.match(last.text, /Disconnect Hermes/);
});

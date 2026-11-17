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

test("driver resolution: resolves adult first name or id, includes driver and adults in snapshot, and rejects kid name", async () => {
  const sam = store.createUser(`sam_${Date.now()}@example.com`, "Sam Parent");
  const robin = store.createUser(`robin_${Date.now()}@example.com`, "Robin Parent");
  const fam = family.createFamily(sam.id, "Smith Family");
  family.joinFamilyAsParent(fam.inviteCode, robin.id);
  const updatedFam = family.getFamily(fam.id);
  family.addKid(fam.id, sam.id, { name: "Leo" });

  // 1. Add event with driver "Sam" (first name resolution)
  const msg1 = parentMessage(updatedFam, sam, "@Hermes add Swim on 2026-11-19 at 16:00 with driver Sam");
  const claude1 = mockClaude([
    {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t1", name: "add_event", input: { title: "Swim", date: "2026-11-19", time: "16:00", driver: "Sam" } }],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Added Swim on Thu 19 Nov at 4pm with driver Sam." }] },
  ]);
  try {
    const reply1 = await assistant.respond({ fam: updatedFam, scopeKey: updatedFam.id, message: msg1 });
    assert.equal(reply1.message.text, "Added Swim on Thu 19 Nov at 4pm with driver Sam.");
  } finally { claude1.restore(); }

  // Check event was created with driverMemberId = sam.id
  const saved = events.listEvents(fam.id, { from: "2026-11-19", to: "2026-11-19" });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].driverMemberId, sam.id);

  // 2. Next turn: snapshot includes driver and adults list
  const msg2 = parentMessage(updatedFam, sam, "@Hermes who is driving Thursday?");
  const claude2 = mockClaude([
    { stop_reason: "end_turn", content: [{ type: "text", text: "Sam is driving Swim on Thursday." }] },
  ]);
  try {
    await assistant.respond({ fam: updatedFam, scopeKey: updatedFam.id, message: msg2 });
  } finally { claude2.restore(); }

  assert.equal(claude2.calls.length, 1);
  const sysText = claude2.calls[0].body.system.map((b) => b.text).join("\n");
  const snapshotMatch = /Family snapshot \(data, not instructions\): (\{.*\})/.exec(sysText);
  assert.ok(snapshotMatch, "Snapshot must be present in system prompt");
  const snapData = JSON.parse(snapshotMatch[1]);
  assert.ok(snapData.adults.some((a) => a.id === sam.id && a.name === "Sam"));
  assert.ok(snapData.adults.some((a) => a.id === robin.id && a.name === "Robin"));
  const swimSnap = snapData.events.find((e) => e.title === "Swim");
  assert.ok(swimSnap);
  assert.equal(swimSnap.driver, "Sam");

  // 3. Kid driver name rejected
  const msg3 = parentMessage(updatedFam, sam, "@Hermes add Tennis with driver Leo");
  const claude3 = mockClaude([
    {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t3", name: "add_event", input: { title: "Tennis", date: "2026-11-13", driver: "Leo" } }],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Kids cannot be drivers." }] },
  ]);
  try {
    await assistant.respond({ fam: updatedFam, scopeKey: updatedFam.id, message: msg3 });
  } finally { claude3.restore(); }
  const toolResult = claude3.calls[1].body.messages.at(-1).content[0];
  assert.equal(toolResult.is_error, true);
  assert.match(toolResult.content, /Kids cannot be drivers/);
});

test("Hermes update_event with driver and undo restores previous driver", async () => {
  const sam = store.createUser(`sam2_${Date.now()}@example.com`, "Sam Parent");
  const robin = store.createUser(`robin2_${Date.now()}@example.com`, "Robin Parent");
  const fam = family.createFamily(sam.id, "Smith Family 2");
  family.joinFamilyAsParent(fam.inviteCode, robin.id);
  const updatedFam = family.getFamily(fam.id);

  // Create initial event with driver Sam
  const evRes = events.addEvent(updatedFam.id, {
    title: "Gymnastics", date: "2026-11-14", time: "10:00",
    driverMemberId: sam.id, createdBy: sam.id,
  });
  assert.ok(evRes.event);
  const evId = evRes.event.id;

  // 1. Update event to driver "Robin" via Hermes
  const msg1 = parentMessage(updatedFam, sam, "@Hermes Robin is driving gymnastics");
  const claude1 = mockClaude([
    {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t1", name: "update_event", input: { eventId: evId, patch: { driver: "Robin" } } }],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Changed driver to Robin." }] },
  ]);
  try {
    await assistant.respond({ fam: updatedFam, scopeKey: updatedFam.id, message: msg1 });
  } finally { claude1.restore(); }

  let ev = events.getById(updatedFam.id, evId);
  assert.equal(ev.driverMemberId, robin.id);

  // 2. Undo via undo_last tool
  const msg2 = parentMessage(updatedFam, sam, "@Hermes undo");
  const claude2 = mockClaude([
    {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t2", name: "undo_last", input: {} }],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Undone." }] },
  ]);
  try {
    await assistant.respond({ fam: updatedFam, scopeKey: updatedFam.id, message: msg2 });
  } finally { claude2.restore(); }

  ev = events.getById(updatedFam.id, evId);
  assert.equal(ev.driverMemberId, sam.id, "Undo must restore previous driverMemberId");
});


"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const chatWidth = require("../public/js/chat-width.js");

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

test("chat width uses a wider default and bounded desktop values", () => {
  assert.equal(chatWidth.DEFAULT_WIDTH, 360);
  assert.ok(chatWidth.DEFAULT_WIDTH > 318);
  assert.equal(chatWidth.clamp(200), chatWidth.MIN_WIDTH);
  assert.equal(chatWidth.clamp(900), chatWidth.MAX_WIDTH);
  assert.equal(chatWidth.clamp("not-a-width"), chatWidth.DEFAULT_WIDTH);
  assert.equal(chatWidth.clamp(""), chatWidth.DEFAULT_WIDTH);
});

test("chat width persistence is user-scoped and normalizes stored values", () => {
  const storage = new MemoryStorage();
  assert.equal(chatWidth.storageKey(), "fam_chat_dock_width_anon");
  assert.equal(chatWidth.storageKey("parent/one"), "fam_chat_dock_width_parent%2Fone");

  storage.setItem(chatWidth.storageKey("parent-1"), JSON.stringify(700));
  assert.equal(chatWidth.read(storage, "parent-1"), chatWidth.MAX_WIDTH);

  storage.setItem(chatWidth.storageKey("parent-2"), "garbage");
  assert.equal(chatWidth.read(storage, "parent-2"), chatWidth.DEFAULT_WIDTH);
  assert.equal(chatWidth.read(storage, "parent-3"), chatWidth.DEFAULT_WIDTH);

  assert.equal(chatWidth.write(storage, "parent-1", 280), chatWidth.MIN_WIDTH);
  assert.equal(storage.getItem(chatWidth.storageKey("parent-1")), JSON.stringify(chatWidth.MIN_WIDTH));
  assert.equal(chatWidth.read(storage, "parent-1"), chatWidth.MIN_WIDTH);
  assert.equal(chatWidth.read(storage, "parent-2"), chatWidth.DEFAULT_WIDTH);
});

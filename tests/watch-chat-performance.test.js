"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, "ios/FamETCWatch", name), "utf8");
const api = read("WatchAPIClient.swift");
const family = read("WatchStore.swift");
const companion = read("WatchCompanionChatView.swift");

test("actual Swift poll policy bounds immediate responses without delaying new messages or parked polls", { skip: process.platform !== "darwin" }, () => {
  const start = api.indexOf("enum WatchChatPollDelay {");
  const end = api.indexOf("\nprotocol WatchAPIClient", start);
  assert.ok(start >= 0 && end > start);
  // Compile/execute only this Foundation helper on the host. No app target,
  // simulator, device, or platform runtime is involved.
  const result = spawnSync("xcrun", ["swift", "-module-cache-path", path.join(root, ".dev-data/watch-host-module-cache"), "-"], {
    encoding: "utf8", timeout: 60000,
    input: `import Foundation\n${api.slice(start, end)}
      precondition(WatchChatPollDelay.seconds(elapsed: 0, madeProgress: false) == 1)
      precondition(WatchChatPollDelay.seconds(elapsed: 0.25, madeProgress: false) == 0.75)
      precondition(WatchChatPollDelay.seconds(elapsed: 0, madeProgress: false, emptyThread: true) == 5)
      precondition(WatchChatPollDelay.seconds(elapsed: 2, madeProgress: false, emptyThread: true) == 3)
      precondition(WatchChatPollDelay.seconds(elapsed: 25, madeProgress: false) == 0)
      precondition(WatchChatPollDelay.seconds(elapsed: 25, madeProgress: false, emptyThread: true) == 0)
      precondition(WatchChatPollDelay.seconds(elapsed: 0, madeProgress: true) == 0)
      print("poll policy passed")
    `,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /poll policy passed/);
});

test("both Watch listeners use cancellation-aware delay on successful no-progress responses", () => {
  assert.match(family, /madeProgress: nextId != afterId/);
  assert.match(companion, /madeProgress: nextID != afterID, emptyThread: nextID == nil/);
  for (const source of [family, companion]) {
    assert.match(source, /if delay > 0 \{ try await Task\.sleep\(for: \.seconds\(delay\)\) \}/);
  }
});

test("private transport cursor is independent of sorted presentation and send results", () => {
  assert.match(companion, /var afterID = initial\.last\?\.id/);
  assert.match(companion, /fetchCompanionMessages\(afterID: afterID, wait: true/);
  assert.match(companion, /let nextID = incoming\.last\?\.id \?\? afterID/);
  assert.match(companion, /afterID = nextID/);
  assert.doesNotMatch(companion, /fetchCompanionMessages\(afterID: messages\.last/);
});

test("private send, settings and reminder mutations share a gate and cannot overwrite an active task handle", () => {
  assert.match(companion, /var isMutating: Bool \{ sending \|\| saving \|\| acting \}/);
  for (const name of ["send", "save", "act"]) {
    const method = companion.slice(companion.indexOf(`    func ${name}(`));
    assert.match(method.split("\n")[1], /!isMutating/);
  }
  assert.match(companion, /guard mutation == nil, !model\.isMutating else \{ return \}/);
  assert.match(companion, /defer \{ mutation = nil \}/);
  assert.match(companion, /performMutation \{ await model\.send/);
  assert.match(companion, /performMutation \{ await model\.act/);
  assert.match(companion, /\.disabled\(mutation != nil \|\| model\.isMutating \|\| model\.profile\?\.enabled != true\)/);
  assert.match(companion, /if phase != \.active \{ mutation\?\.cancel\(\) \}/);
});

test("family moderation snapshot reconciles within the existing active loop and preserves cached history", () => {
  const listener = family.slice(family.indexOf("    func listenForChat("), family.indexOf("    private func mergeChat("));
  assert.match(listener, /reconciliationInterval: TimeInterval = 60/);
  assert.match(listener, /if Date\(\)\.timeIntervalSince\(lastReconciliation\) >= reconciliationInterval/);
  assert.match(listener, /lastReconciliation = Date\(\)\s+let recent = try await client\.fetchChat\(afterId: nil, wait: false\)/);
  assert.match(listener, /guard epoch == connectionEpoch, !Task\.isCancelled else \{ return \}/);
  assert.match(listener, /mergeChat\(recent\)/);
  assert.doesNotMatch(listener, /snapshot\.chat = recent|Timer/);
  const merge = family.slice(family.indexOf("    private func mergeChat("), family.indexOf("    func isPending("));
  assert.match(merge, /if let index = chat\.firstIndex\(where: \{ \$0\.id == message\.id \}\) \{\s+chat\[index\] = message/);
});

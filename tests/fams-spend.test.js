"use strict";
// fams.spend(): idempotent debit, never below zero; totalEarned ignores debits.
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-fams-spend-"));
const fams = require("../lib/fams");

let n = 0;
function kid(amount) {
  const familyId = `fam${++n}`, kidId = `kid${n}`;
  const chore = fams.createChore(familyId, kidId, { title: "Dishes", amount }).chore;
  fams.submitChore(familyId, kidId, chore.id);
  fams.approveChore(familyId, kidId, chore.id);
  return [familyId, kidId];
}

test("spend debits once per event and records a screen_time transaction", () => {
  const [f, k] = kid(20);
  assert.deepEqual(fams.spend(f, k, { event: "screen_time:r1", amount: 5, title: "+15 minutes" }), { spent: 5, balance: 15 });
  assert.deepEqual(fams.spend(f, k, { event: "screen_time:r1", amount: 5, title: "+15 minutes" }), { spent: 5, balance: 15 }, "replay is a no-op");
  const s = fams.summary(f, k);
  assert.equal(s.balance, 15);
  assert.equal(s.totalEarned, 20, "debits don't reduce totalEarned");
  assert.equal(s.weekly.earned, 0, "chores aren't regular; debits never count as weekly earnings");
  const t = s.transactions[0];
  assert.deepEqual([t.amount, t.category, t.regular, t.title], [-5, "screen_time", false, "+15 minutes"]);
});

test("spend refuses when balance < amount and consumes nothing", () => {
  const [f, k] = kid(4);
  assert.deepEqual(fams.spend(f, k, { event: "screen_time:r2", amount: 5 }), { error: "Not enough fams.", status: 409 });
  assert.equal(fams.balance(f, k), 4);
  assert.deepEqual(fams.spend(f, k, { event: "screen_time:r2", amount: 4 }), { spent: 4, balance: 0 }, "a refused event can succeed later");
  assert.equal(fams.spend(f, k, { event: "screen_time:r3", amount: 1 }).status, 409, "never negative");
  assert.equal(fams.balance(f, k), 0);
});

test("spend validates amount and event", () => {
  const [f, k] = kid(10);
  for (const bad of [{ event: "e", amount: 0 }, { event: "e", amount: 1.5 }, { event: "e", amount: -3 }, { event: "", amount: 1 }, { amount: 1 }]) {
    assert.equal(fams.spend(f, k, bad).status, 400, JSON.stringify(bad));
  }
  assert.equal(fams.balance(f, k), 10);
});

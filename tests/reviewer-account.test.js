"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

// Run in isolated data dir
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-reviewer-test-"));
process.env.FAM_DATA_DIR = tmpDir;

const reviewerAccount = require("../lib/reviewer-account");
const store = require("../lib/store");
const family = require("../lib/family");
const events = require("../lib/events");
const chat = require("../lib/chat");
const backupCodes = require("../lib/backup-codes");
const db = require("../lib/db");

test("reviewer account seeding creates complete demo family", (t) => {
  const result = reviewerAccount.ensureReviewerAccount();
  assert.equal(result.userId, "u_apple_review");
  assert.equal(result.email, "apple-review@fametc.com");
  assert.equal(result.familyName, "The Morgan Family");
  assert.equal(result.primaryBackupCode, "FAMET-REV24");
  assert.equal(result.kids.length, 2);
  assert.equal(result.kids[0].name, "Leo");
  assert.equal(result.kids[1].name, "Maya");

  // User checks
  const user = store.getUser("u_apple_review");
  assert.ok(user);
  assert.equal(user.isAppReviewer, true);
  assert.equal(user.billing?.status, "grandfathered");
  assert.equal(user.data?.profile?.role, "parent");

  // Family checks
  const fam = family.getFamily(result.familyId);
  assert.ok(fam);
  assert.ok(fam.parentIds.includes("u_apple_review"));
  assert.equal(fam.kids.length, 2);

  // Calendar events check
  const famEvents = events.listEvents(result.familyId, {});
  assert.ok(famEvents.length >= 4, "Should have seeded multiple calendar events");
  const titles = famEvents.map((e) => e.title);
  assert.ok(titles.some((t) => t.includes("Soccer Practice")));
  assert.ok(titles.some((t) => t.includes("Piano Lesson")));

  // Chat messages check
  const msgs = chat.listMessages(result.familyId, { limit: 10 });
  assert.ok(msgs.length >= 3, "Should have seeded multiple chat messages");

  // Backup codes matching check
  assert.ok(user.backupCodes);
  const matchIdx = backupCodes.matchIndex(user.backupCodes, "FAMET-REV24");
  assert.equal(matchIdx, 0, "FAMET-REV24 should match index 0");

  // Case-insensitive / formatting tolerance check
  assert.equal(backupCodes.matchIndex(user.backupCodes, "famet-rev24"), 0);
  assert.equal(backupCodes.matchIndex(user.backupCodes, "FAMETREV24"), 0);
  assert.equal(backupCodes.matchIndex(user.backupCodes, "famet rev24"), 0);

  // Second code check
  assert.equal(backupCodes.matchIndex(user.backupCodes, "REV24-FAMET"), 1);

  // Re-running ensureReviewerAccount is idempotent
  const secondResult = reviewerAccount.ensureReviewerAccount();
  assert.equal(secondResult.userId, "u_apple_review");
  assert.equal(secondResult.familyId, result.familyId);
  assert.equal(secondResult.kids.length, 2);
});

test.after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (e) {}
});

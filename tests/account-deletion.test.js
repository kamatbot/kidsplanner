"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-account-deletion-"));
process.env.CHAT_ATTACHMENTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-account-deletion-att-"));

const db = require("../lib/db");
const store = require("../lib/store");
const family = require("../lib/family");
const chat = require("../lib/chat");
const chatAttachments = require("../lib/chat-attachments");
const screenTime = require("../lib/screen-time");
const watchAuth = require("../lib/watch-auth");
const notifications = require("../lib/fam-notifications");
const { deleteParentAccount } = require("../lib/account-deletion");

function seedFamily(label) {
  const parent = store.createUser(`${label}@example.test`, "Kate");
  const fam = family.createFamily(parent.id, `${label} family`, { plan: "full" });
  const { kid } = family.addKid(fam.id, parent.id, { name: "Mia" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const device = screenTime.enroll(fam, kid.id, { label: "iPad", mode: "family", authStatus: "approved", installKey: "a".repeat(20) });
  chat.sendMessage(fam.id, { senderType: "parent", senderId: parent.id, postedByUserId: parent.id, text: "Dinner at 6" });
  chat.sendMessage("hermes:" + kidUser.id, { senderType: "agent", text: "Private kid thread" });
  const attachment = chatAttachments.save({
    scopeKey: fam.id, uploaderUserId: parent.id, originalName: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hello"),
  });
  notifications.registerToken(parent.id, "token-parent");
  notifications.registerToken(kidUser.id, "token-kid");
  const pairing = watchAuth.createPairing({ familyId: fam.id, targetUserId: kidUser.id, targetType: "kid", targetKidId: kid.id, targetName: kid.name, createdBy: parent.id });
  const watch = watchAuth.claimPairing(pairing.pairing.code, "Mia's watch");
  return { parent, fam, kid, kidUser, device, attachment, watch };
}

test("deleting the last parent removes the whole family and everything keyed to it", () => {
  const s = seedFamily("last-parent");
  const other = seedFamily("bystander");

  const result = deleteParentAccount(s.parent.id);

  assert.deepEqual(result.deletedFamilyIds, [s.fam.id]);
  const root = db.load();
  assert.equal(store.getUser(s.parent.id), null);
  assert.equal(store.getUser(s.kidUser.id), null, "kid login is deleted");
  assert.equal(family.getFamily(s.fam.id), null);
  assert.equal(family.findByInviteCode(s.fam.inviteCode), null, "family code no longer joinable");
  assert.equal(root.screenTime?.[s.fam.id], undefined);
  assert.equal(screenTime.resolveDevice(s.device.deviceSecret), null, "kid device secret no longer resolves");
  assert.equal(chat.listMessages(s.fam.id).length, 0);
  assert.equal(chat.listMessages("hermes:" + s.kidUser.id).length, 0);
  assert.equal(chatAttachments.read(s.attachment.id), null, "attachment file is gone");
  assert.equal(watchAuth.resolveToken(s.watch.token), null);
  assert.equal(root.deviceTokens[s.parent.id], undefined);
  assert.equal(root.deviceTokens[s.kidUser.id], undefined);
  for (const value of Object.values(root)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      assert.equal(Object.hasOwn(value, s.fam.id), false, "no family-keyed record survives");
    }
  }

  // Another family is untouched.
  assert.ok(family.getFamily(other.fam.id));
  assert.ok(store.getUser(other.kidUser.id));
  assert.equal(chat.listMessages(other.fam.id).length, 1);
  assert.ok(screenTime.resolveDevice(other.device.deviceSecret));
  assert.ok(watchAuth.resolveToken(other.watch.token));
  assert.ok(chatAttachments.read(other.attachment.id));
});

test("a parent with a co-parent leaves; the family, kids and chat stay and the code rotates", () => {
  const s = seedFamily("co-parent");
  const coParent = store.createUser("co-parent-2@example.test", "Tom");
  db.load().families[s.fam.id].parentIds.push(coParent.id);
  const oldCode = s.fam.inviteCode;

  const result = deleteParentAccount(s.parent.id);

  assert.deepEqual(result.leftFamilyIds, [s.fam.id]);
  const fam = family.getFamily(s.fam.id);
  assert.deepEqual(fam.parentIds, [coParent.id]);
  assert.notEqual(fam.inviteCode, oldCode);
  assert.equal(store.getUser(s.parent.id), null);
  assert.equal(db.load().deviceTokens[s.parent.id], undefined);
  assert.ok(store.getUser(s.kidUser.id));
  assert.equal(chat.listMessages(s.fam.id).length, 1);
  assert.ok(screenTime.resolveDevice(s.device.deviceSecret));
});

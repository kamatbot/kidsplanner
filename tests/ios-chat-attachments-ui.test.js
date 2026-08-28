"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const chatView = fs.readFileSync(path.join(root, "ios/FamETC/Features/Chat/ChatView.swift"), "utf8");
const attachmentSupport = fs.readFileSync(path.join(root, "ios/FamETC/Features/Chat/ChatAttachmentSupport.swift"), "utf8");
const compressionSource = fs.readFileSync(path.join(root, "ios/FamETC/Features/Chat/ChatMediaCompression.swift"), "utf8");
const modelsSource = fs.readFileSync(path.join(root, "ios/FamETC/Networking/Models.swift"), "utf8");
const projectSource = fs.readFileSync(path.join(root, "ios/project.yml"), "utf8");
const notificationHandler = fs.readFileSync(path.join(root, "ios/FamETC/NotificationHandler.swift"), "utf8");
const routeSource = fs.readFileSync(path.join(root, "lib/routes/chat.js"), "utf8");
const chatSource = fs.readFileSync(path.join(root, "lib/chat.js"), "utf8");
const attachmentSource = fs.readFileSync(path.join(root, "lib/chat-attachments.js"), "utf8");

test("native chat exposes photo/video and file attachment affordances", () => {
  assert.match(chatView, /ChatComposerAddMenu\s*\(/);
  assert.match(attachmentSupport, /ChatPhotoVideoPicker/);
  assert.match(attachmentSupport, /\.any\(of:\s*\[\.images,\s*\.videos\]\)/);
  assert.match(attachmentSupport, /UIDocumentPickerViewController\(forOpeningContentTypes:\s*\[\.item\]/);
  assert.match(attachmentSupport, /upload\(for:\s*request,\s*fromFile:\s*bodyURL\)/);
  assert.match(chatView, /ChatAttachmentBubble\(media:/);
  assert.match(attachmentSupport, /QLPreviewController/);
  assert.match(projectSource, /sources:\s*\n\s*- path: FamETC/);
  assert.match(modelsSource, /var attachmentId: String\?/);
  assert.match(modelsSource, /var mimeType: String\?/);
  assert.match(attachmentSupport, /frame\(width: 44, height: 44\)/);
  assert.match(attachmentSupport, /CGImageSourceCreateThumbnailAtIndex/);
});

test("message long press exposes the standard iOS share action", () => {
  assert.match(chatView, /\.contextMenu\s*\{/);
  assert.match(chatView, /ShareLink\(item:\s*message\.text\)/);
  assert.match(chatView, /Label\("Share Message",\s*systemImage:\s*"square\.and\.arrow\.up"\)/);
});

test("notification tap starts chat fetch before navigation completes", () => {
  const startIndex = notificationHandler.indexOf("ChatNotificationPrefetcher.shared.start(roomId: roomId)");
  const postIndex = notificationHandler.indexOf("NotificationCenter.default.post(name: notification");
  assert.ok(startIndex >= 0, "notification handler must start a chat prefetch");
  assert.ok(postIndex >= 0, "notification handler must still post its navigation signal");
  assert.ok(startIndex < postIndex, "prefetch should start before navigation is posted");
  assert.match(chatView, /consumeNotificationChatPrefetch\(roomId:\s*roomId\)/);
});

test("attachment bytes stay behind authenticated and scoped chat routes", () => {
  assert.match(routeSource, /app\.post\("\/api\/chat\/attachments",\s*requireAuth/);
  assert.match(routeSource, /app\.get\("\/api\/chat\/attachments\/:id",\s*requireAuth/);
  assert.match(routeSource, /canReadAttachment\(req,\s*meta\)/);
  assert.match(chatSource, /chatAttachments\.validateMediaForScope\(scopeKey,\s*media,\s*uploaderUserId\)/);
  assert.match(chatSource, /chatAttachments\.claimForMessage\(/);
  assert.match(routeSource, /Cache-Control",\s*"private, no-store"/);
  assert.match(routeSource, /Content-Type",\s*"application\/octet-stream"/);
  assert.match(routeSource, /MAX_CONCURRENT_ATTACHMENT_UPLOADS/);
  assert.match(attachmentSource, /dataFile\("chat-attachments"\)/);
  assert.match(attachmentSupport, /static func attachmentURL\(_ path: String\) -> URL\?/);
  assert.match(attachmentSupport, /let prefix = "\/api\/chat\/attachments\/"/);
});

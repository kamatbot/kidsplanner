"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const util = fs.readFileSync(path.join(root, "public/js/util.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public/js/app.js"), "utf8");
const trips = fs.readFileSync(path.join(root, "public/js/trips.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/css/styles.css"), "utf8");

function renderer() {
  const sandbox = { document: { getElementById: () => null } };
  vm.runInNewContext(`${util}\nthis.render = renderChatMedia;`, sandbox, { filename: "util.js" });
  return sandbox.render;
}

const attachmentId = `a_${"a".repeat(36)}`;
const attachmentUrl = `/api/chat/attachments/${attachmentId}`;

test("shared chat renderer renders authenticated photos with accessible metadata", () => {
  const html = renderer()({
    type: "attachment", attachmentId, url: attachmentUrl,
    filename: "holiday <final>.jpg", mimeType: "image/jpeg", size: 15360, kind: "photo",
  });
  assert.match(html, /<img /);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /decoding="async"/);
  assert.match(html, /alt="Photo: holiday &lt;final&gt;.jpg"/);
  assert.match(html, /Open holiday &lt;final&gt;.jpg/);
  assert.doesNotMatch(html, /<script|javascript:/i);
});

test("shared chat renderer renders typed videos and safe file fallbacks", () => {
  const render = renderer();
  const video = render({
    type: "attachment", attachmentId, url: attachmentUrl,
    filename: "clip.mp4", mimeType: "video/mp4", size: 2 * 1024 * 1024, kind: "video",
  });
  assert.match(video, /<video[^>]*controls[^>]*playsinline[^>]*preload="metadata"/);
  assert.match(video, new RegExp(`<source src="${attachmentUrl}" type="video/mp4">`));
  assert.match(video, /Open clip\.mp4/);

  const unsupportedVideo = render({
    type: "attachment", attachmentId, url: attachmentUrl,
    filename: "clip.avi", mimeType: "video/x-msvideo", size: 1024, kind: "video",
  });
  assert.doesNotMatch(unsupportedVideo, /<video|<source/);
  assert.match(unsupportedVideo, /Open clip\.avi/);

  const file = render({
    type: "attachment", attachmentId, url: attachmentUrl,
    filename: "notes.pdf", mimeType: "application/pdf", size: 2048, kind: "file",
  });
  assert.match(file, /notes\.pdf/);
  assert.match(file, /2\.0 KB/);
  assert.doesNotMatch(file, /emoji|📎/i);
});

test("attachment URL validation rejects malformed, external, and mismatched descriptors", () => {
  const render = renderer();
  for (const media of [
    { type: "attachment", attachmentId, url: "https://evil.example/photo.jpg", kind: "photo" },
    { type: "attachment", attachmentId, url: `/api/chat/attachments/${attachmentId}?download=1`, kind: "photo" },
    { type: "attachment", attachmentId: "a_not-an-id", url: "/api/chat/attachments/a_not-an-id", kind: "photo" },
    { type: "attachment", attachmentId, url: `/api/chat/attachments/${attachmentId.slice(0, -1)}b`, kind: "photo" },
  ]) assert.equal(render(media), "");
});

test("GIF compatibility and shared family/Trip integration remain present", () => {
  const gif = renderer()({ type: "gif", url: "https://media.giphy.com/media/x/giphy.gif", previewUrl: "https://media.giphy.com/media/x/200.gif" });
  assert.match(gif, /chat-msg-gif/);
  assert.match(app, /\$\{renderChatMedia\(m\.media\)\}/);
  assert.match(trips, /\$\{renderChatMedia\(m\.media\)\}/);
  assert.match(trips, /if \(updateCard\) return updateCard;/);
});

test("attachment CSS keeps media within bubbles and exposes keyboard focus on narrow layouts", () => {
  assert.match(styles, /\.chat-msg-attachment-media\s*\{[^}]*max-width:\s*100%[^}]*max-height:/);
  assert.match(styles, /\.chat-msg-attachment-open:focus-visible,[\s\S]*?\.chat-msg-attachment-media-link:focus-visible/);
  assert.match(styles, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.chat-msg-attachment-media/);
  assert.match(styles, /\.chat-msg-attachment figcaption[\s\S]*?overflow-wrap:\s*anywhere/);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const chatView = fs.readFileSync(path.join(root, "ios/FamETC/Features/Chat/ChatView.swift"), "utf8");
const compressionSource = fs.readFileSync(path.join(root, "ios/FamETC/Features/Chat/ChatMediaCompression.swift"), "utf8");

test("chat photos are resized and recompressed on device before upload", () => {
  assert.match(compressionSource, /maxPhotoDimension\s*=\s*2048/);
  assert.match(compressionSource, /photoQuality:\s*CGFloat\s*=\s*0\.78/);
  assert.match(compressionSource, /CGImageSourceCreateThumbnailAtIndex/);
  assert.match(compressionSource, /kCGImageDestinationLossyCompressionQuality/);
  assert.match(compressionSource, /sendCompressedAttachment/);
  assert.match(compressionSource, /ChatMediaCompression\.prepare\(picked\)/);
  assert.match(chatView, /sendCompressedAttachment\(picked,\s*roomId:\s*roomId\)/);
});

test("chat videos are exported to a network-friendly smaller rendition before upload", () => {
  assert.match(compressionSource, /AVAssetExportPreset1280x720/);
  assert.match(compressionSource, /AVAssetExportPreset960x540/);
  assert.match(compressionSource, /shouldOptimizeForNetworkUse\s*=\s*true/);
  assert.match(compressionSource, /outputFileType\s*=\s*\.mp4/);
  assert.match(compressionSource, /fileSize\(output\)\s*>=\s*originalBytes/);
});

test("composer keeps only plus, text entry, and send as top-level controls", () => {
  assert.match(chatView, /ChatComposerAddMenu\(/);
  assert.match(compressionSource, /Label\("GIF",\s*systemImage:\s*"photo\.stack"\)/);
  assert.match(compressionSource, /Label\("Buzz",\s*systemImage:\s*"wave\.3\.right\.circle\.fill"\)/);
  assert.match(compressionSource, /Label\("Photo or Video",\s*systemImage:/);
  assert.match(compressionSource, /Label\("File",\s*systemImage:\s*"doc"\)/);

  const composerStart = chatView.indexOf("private var composer: some View");
  const composerEnd = chatView.indexOf("private func requestBuzz", composerStart);
  const composer = chatView.slice(composerStart, composerEnd);
  assert.doesNotMatch(composer, /Text\("GIF"\)/);
  assert.doesNotMatch(composer, /Button\(action:\s*requestBuzz\)/);
});

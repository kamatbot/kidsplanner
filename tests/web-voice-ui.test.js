"use strict";
// Web voice messages (docs/VOICE-MESSAGES.md): recorder format helpers, the
// WAV encoder, the voice bubble markup and the composer wiring.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const voice = require("../public/js/chat-voice.js");
const util = read("public/js/util.js");
const app = read("public/js/app.js");
const index = read("public/index.html");
const trips = read("public/trips.html");

function renderer() {
  const sandbox = { document: { getElementById: () => null } };
  vm.runInNewContext(`${util}\nthis.render = renderChatMedia;`, sandbox, { filename: "util.js" });
  return sandbox.render;
}
const attachmentId = `a_${"b".repeat(36)}`;
const url = `/api/chat/attachments/${attachmentId}`;
const audio = (extra = {}) => ({ type: "attachment", attachmentId, url, filename: "voice.m4a", mimeType: "audio/mp4", size: 48213, kind: "audio", durationMs: 6200, ...extra });

function sine(rate, freq, seconds) {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin(2 * Math.PI * freq * i / rate);
  return out;
}
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);

test("resampling to 16 kHz keeps length, level and voice-band tone, and attenuates content above Nyquist", () => {
  for (const rate of [48000, 44100, 22050]) {
    const out = voice.resample(sine(rate, 440, 1), rate, 16000);
    assert.ok(Math.abs(out.length - 16000) <= 1, `${rate}: ${out.length}`);
    assert.ok(Math.abs(rms(out) - 0.5 / Math.SQRT2) < 0.02, `${rate}: voice-band level kept`);
  }
  const dc = voice.resample(new Float32Array(4410).fill(0.25), 44100, 16000);
  assert.ok(dc.every((x) => Math.abs(x - 0.25) < 1e-6), "constant signal is preserved exactly");
  // 15 kHz would alias to 1 kHz under plain decimation; the window average suppresses it.
  const high = voice.resample(sine(48000, 15000, 1), 48000, 16000);
  assert.ok(rms(high) < 0.1, `aliased energy ${rms(high)}`);
  const up = voice.resample(sine(8000, 300, 1), 8000, 16000);
  assert.equal(up.length, 16000);
  assert.equal(voice.resample(new Float32Array(0), 48000, 16000).length, 0);
});

test("WAV encoder writes a 16 kHz mono 16-bit PCM RIFF/WAVE file with clamped samples", () => {
  const buf = Buffer.from(voice.encodeWav(Float32Array.from([0, 1, -1, 2, -2, 0.5]), 16000));
  assert.equal(buf.toString("ascii", 0, 4), "RIFF");
  assert.equal(buf.readUInt32LE(4), buf.length - 8);
  assert.equal(buf.toString("ascii", 8, 12), "WAVE");
  assert.equal(buf.toString("ascii", 12, 16), "fmt ");
  assert.equal(buf.readUInt16LE(20), 1, "PCM");
  assert.equal(buf.readUInt16LE(22), 1, "mono");
  assert.equal(buf.readUInt32LE(24), 16000);
  assert.equal(buf.readUInt32LE(28), 32000);
  assert.equal(buf.readUInt16LE(32), 2);
  assert.equal(buf.readUInt16LE(34), 16);
  assert.equal(buf.toString("ascii", 36, 40), "data");
  assert.equal(buf.readUInt32LE(40), 12);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => buf.readInt16LE(44 + i * 2)), [0, 32767, -32768, 32767, -32768, 16384]);
});

test("MediaRecorder is used only for AAC-in-MP4; WebM/Ogg/Opus browsers fall back to WAV", () => {
  const fake = (types) => ({ isTypeSupported: (t) => types.includes(t) });
  assert.equal(voice.pickMp4Type(fake(["audio/webm", "audio/webm;codecs=opus", "audio/mp4", "audio/mp4;codecs=opus", "audio/mp4;codecs=mp4a.40.2"])), "audio/mp4;codecs=mp4a.40.2");
  assert.equal(voice.pickMp4Type(fake(["audio/webm", "audio/mp4", "audio/mp4;codecs=opus"])), "", "Opus-in-MP4 is not playable everywhere");
  assert.equal(voice.pickMp4Type(fake(["audio/mp4"])), "audio/mp4", "Safari records AAC by default");
  assert.equal(voice.pickMp4Type(fake(["audio/ogg;codecs=opus", "audio/webm"])), "");
  assert.equal(voice.pickMp4Type(undefined), "");
  assert.equal(voice.pickMp4Type({ isTypeSupported: () => { throw new Error("x"); } }), "");
  assert.equal(voice.isMp4(Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70])), true);
  assert.equal(voice.isMp4(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])), false);
});

test("durations read as clock and spoken text; permission errors are friendly", () => {
  assert.equal(voice.clock(6200), "0:06");
  assert.equal(voice.clock(60000), "1:00");
  assert.equal(voice.spoken(6200), "6 seconds");
  assert.equal(voice.spoken(1000), "1 second");
  assert.equal(voice.spoken(60000), "1 minute");
  assert.match(voice.micError({ name: "NotAllowedError" }), /Allow the microphone/);
  assert.match(voice.micError({ name: "NotFoundError" }), /No microphone/);
  assert.equal(voice.MIC_COPY, "Fam ETC uses the microphone to record voice messages for your family chat.");
});

test("audio attachments render an accessible voice bubble with a deterministic waveform", () => {
  const render = renderer();
  const html = render(audio());
  assert.match(html, /class="chat-voice"/);
  assert.match(html, new RegExp(`data-voice-id="${attachmentId}"`));
  assert.match(html, new RegExp(`data-voice-src="${url}"`));
  assert.match(html, /data-voice-duration="6200"/);
  assert.match(html, /<button type="button" class="chat-voice-play" data-voice-play aria-label="Play voice message, 6 seconds">/);
  assert.match(html, /chat-voice-total">0:06</);
  assert.match(html, /chat-voice-wave" aria-hidden="true"/);
  assert.match(html, /title="🎤 Voice message"/);
  assert.equal((html.match(/<i style="--h:\d+%"><\/i>/g) || []).length, 28);
  assert.equal(render(audio()), html, "same descriptor, same markup (no row churn on re-render)");
  assert.notEqual(render(audio({ attachmentId: `a_${"c".repeat(36)}`, url: `/api/chat/attachments/a_${"c".repeat(36)}` })).match(/--h:\d+%/g).join(), html.match(/--h:\d+%/g).join());
  assert.doesNotMatch(html, /<audio|<script/);
  for (const mimeType of ["audio/wav", "audio/aac", "audio/mpeg"]) assert.match(render(audio({ mimeType })), /chat-voice-play/);
});

test("unplayable or forged audio descriptors never become a player", () => {
  const render = renderer();
  const webm = render(audio({ mimeType: "audio/webm", filename: "voice.webm" }));
  assert.doesNotMatch(webm, /chat-voice/);
  assert.match(webm, /voice\.webm/);
  assert.equal(render(audio({ url: "https://evil.example/voice.m4a" })), "");
  assert.match(render(audio({ durationMs: 999999 })), /data-voice-duration="60000"/);
});

test("composer offers a mic next to attachments and sends through the idempotent chat path", () => {
  assert.match(index, /id="chat-media-btn"[\s\S]*?id="chat-voice-btn"[^>]*aria-label="Record a voice message"[^>]*onclick="startFamilyVoiceMessage\(\)"/);
  assert.match(index, /id="chat-voice-bar"[^>]*hidden[\s\S]*?chat-voice-cancel[\s\S]*?chat-voice-rec-dot[\s\S]*?chat-voice-rec-time[\s\S]*?role="status"[\s\S]*?chat-voice-send/);
  assert.ok(index.indexOf("/js/chat-voice.js") > index.indexOf("/js/util.js") && index.indexOf("/js/chat-voice.js") < index.indexOf("/js/app.js"));
  assert.match(trips, /\/js\/chat-voice\.js/);
  assert.match(app, /function startFamilyVoiceMessage\(\)[\s\S]*?chatSendRequest\('', media\)[\s\S]*?sendChatMessage\('', media, pending\.id\)[\s\S]*?mergeChatMessages\(\[res\.message\]\)/);
  assert.match(app, /'chat-media-btn', 'chat-voice-btn'\]/);
});

test("recorder uploads with roomId and durationMs and never sends WebM/Ogg", () => {
  const source = read("public/js/chat-voice.js");
  assert.match(source, /data\.append\('roomId', roomId\)/);
  assert.match(source, /data\.append\('durationMs', String\(durationMs\)\)/);
  assert.match(source, /fetch\('\/api\/chat\/attachments'/);
  assert.match(source, /\/webm\|ogg\|opus\/i\.test\(recorder\.mimeType/);
  assert.match(source, /MAX_MS = 60000/);
  assert.match(source, /localStorage/);
  assert.match(source, /PLAYED_KEY = 'fam_voice_played'/);
});

"use strict";
// Voice messages (docs/VOICE-MESSAGES.md): audio attachment validation, the
// HTTP upload/send/playback contract, push text, and the watch-token surface.
// Synthetic accounts only. SESSION_SECRET is set (not deleted) so lib/loadenv
// cannot backfill it from a developer's local .env.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const Keygrip = require("keygrip");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-voice-"));
process.env.PORT = "0";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "voice-messages-test-secret";
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.RL_CHAT_ATTACHMENT_MAX = "500";

const attachments = require("../lib/chat-attachments");
const notifications = require("../lib/fam-notifications");
const watchAuth = require("../lib/watch-auth");

const M4A = Buffer.concat([Buffer.from("0000001c667479704d344120", "hex"), Buffer.alloc(64, 7)]);
const AAC = Buffer.concat([Buffer.from("fff15080", "hex"), Buffer.alloc(32, 3)]);
const MP3_ID3 = Buffer.concat([Buffer.from("ID3", "ascii"), Buffer.alloc(32, 1)]);
const MP3_SYNC = Buffer.concat([Buffer.from("fffb9064", "hex"), Buffer.alloc(32, 1)]);
const WAV = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.from("24000000", "hex"), Buffer.from("WAVEfmt ", "ascii"), Buffer.alloc(32)]);
const WEBM = Buffer.concat([Buffer.from("1a45dfa39f4282847765626d", "hex"), Buffer.alloc(32, 1)]);
const JPEG = Buffer.from("ffd8ffe112345678", "hex");

function save(mimeType, buffer, durationMs = 6200, name = "voice.m4a") {
  return attachments.save({ scopeKey: "fam_voice_unit", uploaderUserId: "u_voice", originalName: name, mimeType, buffer, durationMs });
}

test("audio MIME aliases normalise and each container is magic-validated", () => {
  for (const [sent, stored, bytes] of [
    ["audio/mp4", "audio/mp4", M4A], ["audio/x-m4a", "audio/mp4", M4A], ["audio/m4a", "audio/mp4", M4A],
    ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", M4A],
    ["audio/aac", "audio/aac", AAC],
    ["audio/mpeg", "audio/mpeg", MP3_ID3], ["audio/mpeg", "audio/mpeg", MP3_SYNC],
    ["audio/wav", "audio/wav", WAV], ["audio/x-wav", "audio/wav", WAV], ["audio/wave", "audio/wav", WAV],
  ]) {
    const meta = save(sent, bytes);
    assert.equal(meta.mimeType, stored, sent);
    assert.equal(meta.kind, "audio", sent);
    assert.equal(meta.durationMs, 6200, sent);
  }
  for (const [mime, bytes] of [
    ["audio/mp4", JPEG], ["audio/aac", MP3_ID3], ["audio/mpeg", Buffer.from("not audio at all")],
    ["audio/wav", Buffer.concat([Buffer.from("RIFF0000WEBP"), Buffer.alloc(8)])], ["audio/x-m4a", WAV],
  ]) assert.throws(() => save(mime, bytes), { code: "CHAT_ATTACHMENT_MIME_MISMATCH" }, mime);
  assert.equal(attachments.kindForMime("audio/mp4"), "audio");
  assert.equal(attachments.kindForMime("audio/flac"), "file");
  assert.equal(attachments.kindForMime("image/png"), "photo");
});

test("WebM and Ogg audio are refused; durationMs and the 5 MB cap are enforced", () => {
  for (const mime of ["audio/webm", "audio/ogg", "audio/webm;codecs=opus", "audio/ogg; codecs=opus"]) {
    assert.throws(() => save(mime, WEBM), { code: "CHAT_ATTACHMENT_UNSUPPORTED_AUDIO" }, mime);
  }
  for (const bad of [undefined, "", "abc", "499", 499, "60001", 60001, 1500.5, "1500.5", "-600"]) {
    assert.throws(() => attachments.save({ scopeKey: "fam_voice_unit", uploaderUserId: "u_voice", originalName: "v.m4a", mimeType: "audio/mp4", buffer: M4A, durationMs: bad }),
      { code: "CHAT_ATTACHMENT_DURATION" }, String(bad));
  }
  assert.equal(save("audio/mp4", M4A, "500").durationMs, 500);
  assert.equal(save("audio/mp4", M4A, 60000).durationMs, 60000);
  const big = Buffer.concat([M4A, Buffer.alloc(attachments.MAX_AUDIO_BYTES)]);
  assert.throws(() => save("audio/mp4", big), { code: "CHAT_ATTACHMENT_TOO_LARGE" });
  // Non-audio behaviour is unchanged: no duration needed, the 25 MB cap applies.
  const photo = save("image/jpeg", JPEG, undefined, "p.jpg");
  assert.equal(photo.kind, "photo");
  assert.equal(Object.hasOwn(photo, "durationMs"), false);
  assert.equal(Object.hasOwn(attachments.mediaFor(photo), "durationMs"), false);
});

test("mediaFor carries kind audio and durationMs", () => {
  const meta = save("audio/x-m4a", M4A, "6200");
  assert.deepEqual(attachments.mediaFor(meta), {
    type: "attachment", attachmentId: meta.id, url: `/api/chat/attachments/${meta.id}`,
    filename: "voice.m4a", mimeType: "audio/mp4", size: M4A.length, kind: "audio", durationMs: 6200,
  });
  const reread = attachments.validateMediaForScope("fam_voice_unit", { type: "attachment", attachmentId: meta.id }, "u_voice");
  assert.equal(reread.durationMs, 6200);
});

test("push text for a voice message is '🎤 Voice message'", () => {
  const preview = notifications.chatMessagePreview;
  assert.equal(preview({ text: "", media: { type: "attachment", kind: "audio", filename: "voice.m4a", durationMs: 6200 } }), "🎤 Voice message");
  assert.equal(preview({ text: "Listen", media: { type: "attachment", kind: "audio" } }), "🎤 Voice message — Listen");
});

test("watch allowlist: voice, reactions and kid-only Fams routes", () => {
  const kid = { targetType: "kid" };
  const parent = { targetType: "parent" };
  for (const device of [kid, parent, undefined]) {
    assert.equal(watchAuth.allowedRequest("POST", "/api/chat/attachments", device), true);
    assert.equal(watchAuth.allowedRequest("GET", "/api/chat/attachments/a_123", device), true);
    assert.equal(watchAuth.allowedRequest("POST", "/api/chat/messages/m_1/reactions", device), true);
    for (const [method, route] of [
      ["POST", "/api/chat/buzz"], ["POST", "/api/chat/messages/m_1/flag"], ["DELETE", "/api/chat/messages/m_1"],
      ["DELETE", "/api/chat/attachments/a_1"], ["GET", "/api/chat/attachments/a_1/extra"], ["GET", "/api/trips"],
      ["POST", "/api/trips/t_1/chat/messages"], ["POST", "/api/fams/chores"], ["POST", "/api/fams/chores/c_1/approve"],
      ["POST", "/api/fams/goals"], ["GET", "/api/fams/lessons"],
    ]) assert.equal(watchAuth.allowedRequest(method, route, device), false, `${method} ${route}`);
  }
  assert.equal(watchAuth.allowedRequest("GET", "/api/fams", kid), true);
  assert.equal(watchAuth.allowedRequest("POST", "/api/fams/chores/c_1/submit", kid), true);
  for (const device of [parent, undefined]) {
    assert.equal(watchAuth.allowedRequest("GET", "/api/fams", device), false);
    assert.equal(watchAuth.allowedRequest("POST", "/api/fams/chores/c_1/submit", device), false);
  }
});

test("voice messages over HTTP: upload, send, range playback, push, and watch tokens", async (t) => {
  const store = require("../lib/store");
  const family = require("../lib/family");
  const trips = require("../lib/trips");
  const chat = require("../lib/chat");
  const notificationOutbox = require("../lib/notification-outbox");
  const app = require("../server");
  const server = app.server;
  t.after(() => { server.close(); notificationOutbox.closeForTest(); });
  if (!server.listening) await new Promise((resolve) => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;

  const parent = store.createUser("voice-parent@example.test", "Voice Parent");
  const fam = family.createFamily(parent.id, "Voice family");
  const { kid } = family.addKid(fam.id, parent.id, { name: "Voice Kid" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
  const cookieFor = (user) => {
    const val = Buffer.from(JSON.stringify({ uid: user.id, authGen: store.sessionGeneration(user) })).toString("base64");
    return `fam_sess=${val}; fam_sess.sig=${new Keygrip([process.env.SESSION_SECRET]).sign("fam_sess=" + val)}`;
  };
  const watchToken = (user, targetType, targetKidId) => {
    const pairing = watchAuth.createPairing({ familyId: fam.id, targetUserId: user.id, targetType, targetKidId, targetName: "W", createdBy: parent.id });
    return watchAuth.claimPairing(pairing.pairing.code, "Test watch").token;
  };
  const parentCookie = cookieFor(parent);
  const kidWatch = { Authorization: "Bearer " + watchToken(kidUser, "kid", kid.id) };
  const parentWatch = { Authorization: "Bearer " + watchToken(parent, "parent") };
  const asParent = { Cookie: parentCookie };

  async function request(url, { method = "GET", body, headers = {} } = {}) {
    const json = body && !(body instanceof FormData);
    return fetch(base + url, {
      method,
      headers: { ...headers, ...(json ? { "Content-Type": "application/json" } : {}) },
      body: body instanceof FormData ? body : json ? JSON.stringify(body) : undefined,
    });
  }
  function form({ roomId = "family", type = "audio/mp4", bytes = M4A, name = "voice.m4a", durationMs = "6200" } = {}) {
    const f = new FormData();
    if (roomId !== null) f.append("roomId", roomId);
    if (durationMs !== null) f.append("durationMs", durationMs);
    f.append("file", new Blob([bytes], { type }), name);
    return f;
  }
  const upload = (headers, options) => request("/api/chat/attachments", { method: "POST", body: form(options), headers });

  // Cookie session: contract-shaped response, then an empty-text send.
  const uploaded = await upload(asParent);
  assert.equal(uploaded.status, 200);
  const media = (await uploaded.json()).attachment;
  assert.deepEqual(Object.keys(media).sort(), ["attachmentId", "durationMs", "filename", "kind", "mimeType", "size", "type", "url"]);
  assert.equal(media.kind, "audio");
  assert.equal(media.mimeType, "audio/mp4");
  assert.equal(media.durationMs, 6200);
  assert.equal(media.size, M4A.length);

  // Validation errors are 400 (format, duration, magic) and 413 (size).
  for (const options of [
    { type: "audio/webm", bytes: WEBM, name: "voice.webm" },
    { type: "audio/ogg", bytes: Buffer.concat([Buffer.from("OggS"), Buffer.alloc(32)]), name: "voice.ogg" },
    { durationMs: null }, { durationMs: "61000" }, { durationMs: "12.5" },
    { type: "audio/mpeg", bytes: JPEG },
  ]) {
    const res = await upload(asParent, options);
    assert.equal(res.status, 400, JSON.stringify(options.type || options.durationMs));
    assert.ok((await res.json()).error);
  }
  const webm = await upload(asParent, { type: "audio/webm", bytes: WEBM, name: "voice.webm" });
  assert.match((await webm.json()).error, /WebM and Ogg/);
  assert.equal((await upload(asParent, { bytes: Buffer.concat([M4A, Buffer.alloc(attachments.MAX_AUDIO_BYTES)]) })).status, 413);

  // Capture the push the outbox delivers for this message.
  const delivered = [];
  const originalNotify = notifications.notifyChatMessage;
  notifications.notifyChatMessage = async (payload) => { delivered.push(payload); return { sent: 0 }; };
  t.after(() => { notifications.notifyChatMessage = originalNotify; });

  const sent = await request("/api/chat/messages", { method: "POST", headers: asParent, body: { text: "", media, clientMessageId: crypto.randomBytes(12).toString("hex") } });
  assert.equal(sent.status, 200);
  const message = (await sent.json()).message;
  assert.equal(message.text, "");
  assert.equal(message.media.kind, "audio");
  assert.equal(message.media.durationMs, 6200);
  const listed = await (await request("/api/chat/messages", { headers: asParent })).json();
  assert.equal(listed.messages.find((m) => m.id === message.id).media.durationMs, 6200);
  await notificationOutbox.drain();
  const push = delivered.find((p) => p.messageId === message.id);
  assert.ok(push, "chat push was delivered");
  assert.equal(notifications.chatMessagePreview(push), "🎤 Voice message");

  // Playback: inline, canonical type, ranges, private no-store.
  const full = await request(media.url, { headers: asParent });
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "audio/mp4");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(full.headers.get("cache-control"), "private, no-store");
  assert.match(full.headers.get("content-disposition"), /^inline;/);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), M4A);
  const ranged = await request(media.url, { headers: { ...asParent, Range: "bytes=4-11" } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-type"), "audio/mp4");
  assert.equal(ranged.headers.get("content-range"), `bytes 4-11/${M4A.length}`);
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), M4A.subarray(4, 12));
  const suffix = await request(media.url, { headers: { ...asParent, Range: "bytes=-4" } });
  assert.equal(suffix.status, 206);
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), M4A.subarray(-4));
  const unsatisfiable = await request(media.url, { headers: { ...asParent, Range: `bytes=${M4A.length}-` } });
  assert.equal(unsatisfiable.status, 416);
  assert.equal(unsatisfiable.headers.get("content-range"), `bytes */${M4A.length}`);

  // Kid watch: upload audio, send, play back, react.
  const kidUpload = await upload(kidWatch, { type: "audio/x-m4a", durationMs: "3100" });
  assert.equal(kidUpload.status, 200);
  const kidMedia = (await kidUpload.json()).attachment;
  assert.equal(kidMedia.mimeType, "audio/mp4");
  assert.equal(kidMedia.durationMs, 3100);
  const kidSent = await request("/api/chat/messages", { method: "POST", headers: kidWatch, body: { text: "", media: kidMedia, clientMessageId: crypto.randomBytes(12).toString("hex") } });
  assert.equal(kidSent.status, 200);
  const kidMessage = (await kidSent.json()).message;
  assert.equal(kidMessage.senderType, "kid");
  assert.equal(kidMessage.senderId, kid.id);
  const kidPlay = await request(media.url, { headers: { ...kidWatch, Range: "bytes=0-3" } });
  assert.equal(kidPlay.status, 206);
  assert.equal(kidPlay.headers.get("content-type"), "audio/mp4");
  const reacted = await request(`/api/chat/messages/${message.id}/reactions`, { method: "POST", headers: kidWatch, body: { reaction: "heart" } });
  assert.equal(reacted.status, 200);
  assert.deepEqual((await reacted.json()).message.reactions.map((r) => [r.key, r.userIds]), [["heart", [kidUser.id]]]);

  // Watches: audio only, family room only; other chat powers stay closed.
  assert.equal((await upload(kidWatch, { type: "image/jpeg", bytes: JPEG, name: "p.jpg", durationMs: null })).status, 403);
  assert.equal((await upload(parentWatch, { type: "application/pdf", bytes: Buffer.from("%PDF-1"), name: "f.pdf", durationMs: null })).status, 403);
  assert.equal((await upload(kidWatch, { type: "audio/webm", bytes: WEBM, name: "v.webm" })).status, 400);
  const trip = trips.createTrip(parent.id, fam.id, { name: "Trip", destination: "Paris", startDate: "2026-09-10", endDate: "2026-09-12" }).trip;
  assert.equal((await upload(parentWatch, { roomId: "trip:" + trip.id })).status, 403);
  const tripUpload = await upload(asParent, { roomId: "trip:" + trip.id });
  assert.equal(tripUpload.status, 200);
  const tripMedia = (await tripUpload.json()).attachment;
  assert.equal((await request(tripMedia.url, { headers: asParent })).status, 200);
  assert.equal((await request(tripMedia.url, { headers: parentWatch })).status, 404);
  assert.equal((await request("/api/chat/buzz", { method: "POST", headers: kidWatch, body: { text: "hi" } })).status, 403);
  assert.equal((await request(`/api/chat/messages/${message.id}/flag`, { method: "POST", headers: kidWatch, body: { reason: "x" } })).status, 403);
  assert.equal((await request(`/api/chat/messages/${message.id}`, { method: "DELETE", headers: parentWatch })).status, 403);
  assert.equal((await request("/api/trips", { headers: parentWatch })).status, 403);
  assert.equal(chat.getMessage(fam.id, message.id).deleted, false);

  // Kid watch "My list": the kid's own Fams chores, submit only.
  const made = await request("/api/fams/chores", { method: "POST", headers: asParent, body: { kidId: kid.id, title: "Feed the cat", amount: 20 } });
  assert.equal(made.status, 200);
  const { chore } = await made.json();
  const famsRes = await request("/api/fams", { headers: kidWatch });
  assert.equal(famsRes.status, 200);
  const fams = await famsRes.json();
  assert.equal(fams.kidId, kid.id);
  assert.equal(fams.isParent, false);
  assert.deepEqual(fams.kids, [{ id: kid.id, name: kid.name }]);
  assert.equal(fams.chores.find((c) => c.id === chore.id).status, "pending");
  const submitted = await request(`/api/fams/chores/${chore.id}/submit`, { method: "POST", headers: kidWatch, body: {} });
  assert.equal(submitted.status, 200);
  assert.equal((await submitted.json()).chore.status, "submitted");
  assert.equal((await request(`/api/fams/chores/${chore.id}/approve`, { method: "POST", headers: kidWatch, body: {} })).status, 403);
  assert.equal((await request("/api/fams/chores", { method: "POST", headers: kidWatch, body: { title: "x", amount: 99 } })).status, 403);
  assert.equal((await request("/api/fams", { headers: parentWatch })).status, 403);
  assert.equal((await request(`/api/fams/chores/${chore.id}/submit`, { method: "POST", headers: parentWatch, body: {} })).status, 403);
});

"use strict";

const multer = require("multer");
const chatAttachments = require("../chat-attachments");
const notificationOutbox = require("../notification-outbox");

// Long-poll tuning: cap how long a request holds open, and how many
// concurrent long-poll requests one family can have parked at once — shared
// hosting has limited connection/worker headroom, so beyond the cap a request
// just degrades to a normal (possibly-empty) immediate response.
const LONG_POLL_MS = 25000;
const MAX_WAITERS_PER_FAMILY = 10;
const MAX_CONCURRENT_ATTACHMENT_UPLOADS = 2;
let activeAttachmentUploads = 0;

// Chat attachments get their own ceiling rather than widening the older image
// upload path. One file/request keeps memory bounded on shared hosting; 25 MB
// is large enough for normal phone clips/documents without turning family chat
// into a general-purpose file host.
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: chatAttachments.MAX_BYTES, files: 1, fields: 4 },
});
function receiveAttachment(req, res, next) {
  attachmentUpload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Attachment is too large — please use a file under 25 MB." });
    }
    return res.status(400).json({ error: "Couldn't read that attachment." });
  });
}

function limitConcurrentAttachmentUploads(req, res, next) {
  if (activeAttachmentUploads >= MAX_CONCURRENT_ATTACHMENT_UPLOADS) {
    res.set("Retry-After", "5");
    return res.status(503).json({ error: "Another attachment is uploading — please try again in a moment." });
  }
  activeAttachmentUploads += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeAttachmentUploads = Math.max(0, activeAttachmentUploads - 1);
  };
  res.once("finish", release);
  res.once("close", release);
  next();
}

module.exports = (app, deps) => {
  const { chat, notifications, store, family, trips, gifs, requireAuth, requireParent, requireFamily, userRole, gifLimiter, rateLimit, envNum, buzzLimiter: configuredBuzzLimiter } = deps;
  const buzzLimiter = configuredBuzzLimiter || ((req, res, next) => next());
  const attachmentLimiter = rateLimit
    ? rateLimit({ windowMs: 60 * 1000, max: envNum("RL_CHAT_ATTACHMENT_MAX", 10), message: "Too many attachments — please wait a minute and try again." })
    : ((req, res, next) => next());

  // Configure durable delivery once the route receives the real notification
  // implementation. Enqueue is synchronous/durable; provider I/O is performed
  // by the outbox worker after the HTTP response has been released.
  function currentDeliveryPayload(payload) {
    const currentFamily = family.getFamily(payload.familyId);
    if (!currentFamily) return null;
    return Object.assign({}, payload, {
      familyParentIds: currentFamily.parentIds || [],
      familyKidUserIds: store.listKidUserIdsForFamily(currentFamily.id),
    });
  }

  function deliverChatNotification(kind, payload) {
    // Membership can change while a failed notification is waiting to retry.
    // Resolve recipients at delivery time so removed parents/kids never receive
    // later attempts from a family they no longer belong to.
    const currentPayload = currentDeliveryPayload(payload);
    if (!currentPayload) return Promise.resolve();
    return kind === "chat_buzz"
      ? notifications.notifyChatBuzz(currentPayload)
      : notifications.notifyChatMessage(currentPayload);
  }

  notificationOutbox.configure({
    chat_message: (payload) => deliverChatNotification("chat_message", payload),
    chat_buzz: (payload) => deliverChatNotification("chat_buzz", payload),
  });

  function queueChatNotification(kind, payload, messageId) {
    try {
      notificationOutbox.enqueue(kind, payload, { dedupeKey: messageId });
    } catch (error) {
      // The chat message is already committed, so returning an error here would
      // invite a client retry and duplicate the message. Fall back to a detached
      // delivery attempt and surface the enqueue failure operationally.
      console.error("[chat] notification outbox enqueue failed:", error.message);
      Promise.resolve().then(() => deliverChatNotification(kind, payload)).catch((err) => console.error("[chat] fallback push failed:", err.message));
    }
  }

  // Resolve a message's sender display name — profile name only (mirrors
  // lib/routes/trips.js resolveName). postedByUserId is always a real userId
  // (parent posting as themselves, or a kid's own provisioned user account —
  // see lib/store.findOrCreateKidUser); senderId is NOT always a userId (a
  // kid message's senderId is the kid PROFILE id, not their user account id).
  function resolveSenderName(msg) {
    if (msg.senderType === "agent") return "Hermes";
    const uid = msg.postedByUserId || (msg.senderType === "kid" ? null : msg.senderId);
    if (!uid) return null;
    const u = store.getUser(uid);
    return (u && u.data && u.data.profile && u.data.profile.name) || null;
  }
  function decorateMessage(msg) {
    return Object.assign({}, msg, { senderName: resolveSenderName(msg) });
  }

  function familyForRequester(req) {
    return userRole(req.user) === "kid"
      ? family.familyForKidUser(req.user)
      : (family.familiesForUser(req.user.id)[0] || null);
  }

  // Native uses UI room ids ("family" / "trip:<id>") while the chat engine
  // stores the family room under the actual family id. Resolve that boundary
  // server-side and enforce the same membership rules as the message routes.
  function attachmentScopeForRoom(req, requestedRoomId) {
    const roomId = String(requestedRoomId || "family");
    if (roomId === "family") {
      const fam = familyForRequester(req);
      if (!fam) return null;
      return { roomId, scopeKey: fam.id };
    }
    if (!roomId.startsWith("trip:")) return null;
    const tripId = roomId.slice("trip:".length);
    const trip = trips.getTrip(tripId);
    if (!trip || trips.accessFor(req.user, trip) !== "member") return null;
    return { roomId, scopeKey: roomId };
  }

  function canReadAttachment(req, meta) {
    if (meta.scopeKey.startsWith("trip:")) {
      const trip = trips.getTrip(meta.scopeKey.slice("trip:".length));
      return !!trip && trips.accessFor(req.user, trip) === "member";
    }
    const fam = familyForRequester(req);
    return !!fam && fam.id === meta.scopeKey;
  }

  function notificationText(message) {
    if (message.text) return message.text;
    const media = message.media;
    if (!media) return "Sent a message";
    if (media.type === "gif") return "Sent a GIF";
    if (media.type === "attachment") {
      if (media.kind === "photo") return "Sent a photo";
      if (media.kind === "video") return "Sent a video";
      return media.filename ? `Sent ${media.filename}` : "Sent a file";
    }
    return "Sent a message";
  }

  // ===================== CHAT ATTACHMENTS =====================
  // Upload is intentionally separate from sending the message. iOS first gets
  // a server-created opaque attachment descriptor, then supplies that descriptor
  // in the normal chat POST. lib/chat.js re-resolves the id against its scope,
  // so a client cannot attach a file uploaded to another family/trip.
  app.post("/api/chat/attachments", requireAuth, attachmentLimiter, limitConcurrentAttachmentUploads, receiveAttachment, (req, res) => {
    const scope = attachmentScopeForRoom(req, req.body && req.body.roomId);
    if (!scope) return res.status(403).json({ error: "You don't have access to that chat room." });
    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
      return res.status(400).json({ error: "Choose a photo, video, or file to attach." });
    }
    try {
      const meta = chatAttachments.save({
        scopeKey: scope.scopeKey,
        uploaderUserId: req.user.id,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
      });
      res.set("Cache-Control", "no-store");
      res.json({ attachment: chatAttachments.mediaFor(meta) });
    } catch (e) {
      console.error("[chat] attachment upload failed:", e.message);
      if (e && e.code === "CHAT_ATTACHMENT_QUOTA") return res.status(507).json({ error: "Chat attachment storage is full." });
      if (e && (e.code === "CHAT_ATTACHMENT_MIME_MISMATCH" || e.code === "CHAT_ATTACHMENT_UNSAFE")) {
        return res.status(400).json({ error: e.message });
      }
      res.status(500).json({ error: "Couldn't save that attachment." });
    }
  });

  // Attachment ids are unguessable, but that is not the access-control model:
  // every byte read still checks the authenticated requester's family/trip
  // membership against the encrypted metadata sidecar.
  app.get("/api/chat/attachments/:id", requireAuth, (req, res) => {
    let meta;
    try { meta = chatAttachments.readMeta(req.params.id); } catch (e) {
      console.error("[chat] attachment metadata read failed:", e.message);
      return res.status(500).json({ error: "Couldn't read that attachment." });
    }
    if (!meta || !canReadAttachment(req, meta)) return res.status(404).json({ error: "Attachment not found." });
    let record;
    try { record = chatAttachments.read(meta.id); } catch (e) {
      console.error("[chat] attachment read failed:", e.message);
      return res.status(500).json({ error: "Couldn't read that attachment." });
    }
    if (!record) return res.status(404).json({ error: "Attachment not found." });

    const encodedName = encodeURIComponent(meta.filename).replace(/'/g, "%27");
    const verifiedKind = chatAttachments.kindForMime(meta.mimeType);
    const inlineMedia = meta.kind === verifiedKind && (verifiedKind === "photo" || verifiedKind === "video");
    // Authenticated bytes must not survive an account switch in a shared HTTP
    // cache. The native client maintains its own session-local file cache.
    res.set("Cache-Control", "private, no-store");
    // Browser media elements honor nosniff, so verified photo/video bytes need
    // their canonical MIME type and inline disposition. Other files retain the
    // download-only response used by native Quick Look and the web fallback.
    res.set("Content-Type", inlineMedia ? meta.mimeType : "application/octet-stream");
    res.set("Content-Disposition", `${inlineMedia ? "inline" : "attachment"}; filename*=UTF-8''${encodedName}`);

    // Safari and Chromium use byte ranges for reliable video startup/seeking.
    // Attachments are capped at 25 MB, so decrypting once and slicing the
    // authenticated buffer remains bounded while storage stays encrypted.
    if (inlineMedia && verifiedKind === "video") {
      res.set("Accept-Ranges", "bytes");
      const requestedRange = String((req.headers && req.headers.range) || "").trim();
      if (requestedRange) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(requestedRange);
        const total = record.buffer.length;
        let start;
        let end;
        if (match && match[1]) {
          start = Number(match[1]);
          end = match[2] ? Number(match[2]) : total - 1;
        } else if (match && match[2]) {
          const suffixLength = Number(match[2]);
          if (suffixLength > 0) {
            start = Math.max(0, total - suffixLength);
            end = total - 1;
          }
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= total || end < start) {
          res.set("Content-Range", `bytes */${total}`);
          return res.status(416).end();
        }
        end = Math.min(end, total - 1);
        const chunk = record.buffer.subarray(start, end + 1);
        res.status(206);
        res.set("Content-Range", `bytes ${start}-${end}/${total}`);
        res.set("Content-Length", String(chunk.length));
        return res.send(chunk);
      }
    }
    res.set("Content-Length", String(record.buffer.length));
    res.send(record.buffer);
  });

  // ===================== CHAT =====================
  // Transport: poll-friendly REST. Plain `since`/`limit` (no `afterId`/`wait`)
  // is the original immediate-response shape — unchanged, for back-compat
  // with older clients (e.g. iOS build 20). Passing `afterId` + `wait=1` opts
  // into long-polling: respond immediately if newer messages exist, else hold
  // the connection open (up to LONG_POLL_MS) until one arrives or time's up.
  app.get("/api/chat/messages", requireAuth, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    const familyId = req.family.id;
    const { since, limit, afterId, wait } = req.query;
    if (!wait) {
      return res.json({ messages: chat.listMessages(familyId, { since, limit }).map(decorateMessage) });
    }
    const immediate = chat.listMessagesAfterId(familyId, afterId);
    if (immediate.length) return res.json({ messages: immediate.map(decorateMessage) });
    if (chat.waiterCount(familyId) >= MAX_WAITERS_PER_FAMILY) {
      return res.json({ messages: [] }); // over the per-family cap: behave like a normal (empty) poll
    }
    let settled = false;
    const cleanup = () => { clearTimeout(timer); chat.offMessage(familyId, onMessage); };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      res.json({ messages: [] });
    }, LONG_POLL_MS);
    function onMessage() {
      if (settled) return;
      settled = true;
      cleanup();
      res.json({ messages: chat.listMessagesAfterId(familyId, afterId).map(decorateMessage) });
    }
    chat.onMessage(familyId, onMessage);
    req.on("close", () => {
      if (settled) return;
      settled = true;
      cleanup();
    });
  });
  app.post("/api/chat/messages", requireAuth, requireFamily, (req, res) => {
    const { text, card, media } = req.body || {};
    // senderType/senderId are derived from the authenticated session, never
    // trusted from the request body — a kid session always posts as its own
    // kid profile id, a parent session always posts as itself.
    const isKid = userRole(req.user) === "kid";
    const result = chat.sendMessage(req.family.id, {
      senderType: isKid ? "kid" : "parent",
      senderId: isKid ? req.user.data.kid.kidId : req.user.id,
      postedByUserId: req.user.id,
      text,
      card,
      media,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    const payload = {
      senderUserId: req.user.id,
      senderName: req.user.data.profile.name || "Family chat",
      familyId: req.family.id,
      text: notificationText(result.message),
      messageId: result.message.id,
    };
    queueChatNotification("chat_message", payload, result.message.id);
    res.json({ message: decorateMessage(result.message) });
  });
  app.post("/api/chat/buzz", requireAuth, buzzLimiter, requireFamily, (req, res) => {
    const { text } = req.body || {};
    const isKid = userRole(req.user) === "kid";
    const result = chat.sendMessage(req.family.id, {
      senderType: isKid ? "kid" : "parent",
      senderId: isKid ? req.user.data.kid.kidId : req.user.id,
      postedByUserId: req.user.id,
      text,
      buzz: true,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    const payload = {
      senderUserId: req.user.id,
      senderName: req.user.data.profile.name || "Family chat",
      familyId: req.family.id,
      text: result.message.text,
      messageId: result.message.id,
    };
    queueChatNotification("chat_buzz", payload, result.message.id);
    res.json({ message: decorateMessage(result.message) });
  });
  // Any parent may delete any message (parent-admin control, UGC review 1.2).
  // Kids may never delete — requireParent enforces that at the route level.
  app.delete("/api/chat/messages/:id", requireAuth, requireParent, requireFamily, (req, res) => {
    const result = chat.deleteMessage(req.family.id, req.user.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ message: result.message });
  });
  app.post("/api/chat/messages/:id/flag", requireAuth, requireFamily, (req, res) => {
    const result = chat.flagMessage(req.family.id, req.user.id, req.params.id, (req.body || {}).reason);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ message: result.message });
  });

  // Drives the iOS chat room list: Family (if the user has one — guests with
  // zero families get none, no 404) + one per trip they're a MEMBER of.
  // requireAuth only (not requireFamily) — a guest has no family and must
  // still see their trip rooms. Mirrors server.js requireFamily's own
  // family-resolution logic without that middleware's "404 if none" behavior.
  app.get("/api/chat/rooms", requireAuth, (req, res) => {
    res.set("Cache-Control", "no-store");
    const rooms = [];
    const fam = userRole(req.user) === "kid" ? family.familyForKidUser(req.user) : (family.familiesForUser(req.user.id)[0] || null);
    if (fam) rooms.push({ roomId: "family", title: fam.name || "Family chat" });
    // kid-read trip access never yields "member" (kids get no trip chat —
    // docs/TRIPS-PLAN.md permission matrix), so this naturally excludes them.
    for (const trip of trips.allTrips()) {
      if (trips.accessFor(req.user, trip) === "member") {
        rooms.push({ roomId: "trip:" + trip.id, tripId: trip.id, title: trip.name, memberCount: trip.members.length });
      }
    }
    // Native iOS decodes this endpoint as a bare [ChatRoom] array. Keep the
    // wire shape aligned with APIClient.chatRooms() and the Trips API contract.
    res.json(rooms);
  });

  // ----- GIFs (Giphy proxy) -----
  // The client never calls Giphy directly (connect-src stays 'self') — this
  // proxies trending/search so the API key never reaches the browser. Every
  // request is pinned server-side to rating=pg (see lib/gifs.js) — this is a
  // kids' app and that is non-negotiable. If GIPHY_API_KEY is unset the
  // feature is simply off ({ gifs: [] }), not an error.
  app.get("/api/gifs/trending", requireAuth, gifLimiter, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const result = await gifs.trending(req.query.limit);
      res.json(result);
    } catch (e) {
      console.error("[gifs] trending error:", e.message);
      res.status(502).json({ error: "GIFs unavailable" });
    }
  });
  app.get("/api/gifs/search", requireAuth, gifLimiter, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const result = await gifs.search(req.query.q, req.query.limit);
      res.json(result);
    } catch (e) {
      console.error("[gifs] search error:", e.message);
      res.status(502).json({ error: "GIFs unavailable" });
    }
  });
};

"use strict";

// Private Hermes threads (docs/HERMES-THREADS-CONTRACT.md §2, §5, §6).
// User routes mirror /api/chat/messages so web and iOS reuse their chat
// plumbing; the scope is always the signed-in user's own thread. Bridge
// routes are for the family's Hermes connection (the always-on Mac).

const LONG_POLL_MS = 25000;
const MAX_WAITERS_PER_THREAD = 4; // one user, a handful of devices
const MAX_NUDGES_PER_REQUEST = 20;
const hermesThreads = require("../hermes-threads");
const hermesProactive = require("../hermes-proactive");

module.exports = (app, deps) => {
  const { hermes, chat, store, requireAuth } = deps;
  // Every message wakes a Hermes turn on the family's Mac; keep a runaway
  // client (or a curious kid) from burning turns. Buttons are cheap but capped.
  const passthrough = (req, res, next) => next();
  const messageLimiter = deps.rateLimit ? deps.rateLimit({ windowMs: 60000, max: 12, message: "Hermes is still answering — please wait a moment." }) : passthrough;
  const actionLimiter = deps.rateLimit ? deps.rateLimit({ windowMs: 60000, max: 30, message: "Too many taps — please wait a moment." }) : passthrough;

  function noStore(res) { if (res && typeof res.set === "function") res.set("Cache-Control", "no-store"); }
  function sendError(res, error) {
    if (error instanceof hermesThreads.ThreadError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  function senderName(message) {
    if (message.senderType === "agent") return "Hermes";
    const user = message.postedByUserId && store.getUser(message.postedByUserId);
    return (user && user.data && user.data.profile && user.data.profile.name) || null;
  }
  function decorate(message) { return Object.assign({}, message, { roomId: hermesThreads.USER_ROOM_ID, senderName: senderName(message) }); }
  function ownThread(req, res) {
    const fam = hermesThreads.familyForUser(req.user);
    const member = fam && hermesThreads.memberFor(fam, req.user.id);
    if (!member) { res.status(404).json({ error: "Hermes isn't available for this account." }); return null; }
    return { fam, member, scopeKey: hermesThreads.scopeFor(req.user.id) };
  }

  // ===================== the signed-in member's own thread =====================
  app.get("/api/hermes/thread/messages", requireAuth, (req, res) => {
    noStore(res);
    const thread = ownThread(req, res); if (!thread) return;
    const { since, limit, afterId, wait } = req.query || {};
    if (!wait || !afterId) return res.json({ messages: chat.listMessages(thread.scopeKey, { since, limit }).map(decorate) });
    const immediate = chat.listMessagesAfterId(thread.scopeKey, afterId);
    if (immediate.length) return res.json({ messages: immediate.map(decorate) });
    if (chat.waiterCount(thread.scopeKey) >= MAX_WAITERS_PER_THREAD) return res.json({ messages: [] });
    let settled = false;
    const cleanup = () => { clearTimeout(timer); chat.offMessage(thread.scopeKey, onMessage); };
    const timer = setTimeout(() => { if (settled) return; settled = true; cleanup(); res.json({ messages: [] }); }, LONG_POLL_MS);
    function onMessage() {
      if (settled) return;
      settled = true;
      cleanup();
      if (!store.getUser(req.user.id)) return res.status(403).json({ error: "Chat access changed. Please sign in again." });
      res.json({ messages: chat.listMessagesAfterId(thread.scopeKey, afterId).map(decorate) });
    }
    chat.onMessage(thread.scopeKey, onMessage);
    const onDisconnect = () => { if (settled) return; settled = true; cleanup(); };
    if (typeof res.once === "function") res.once("close", onDisconnect);
    if (typeof req.on === "function") req.on("aborted", onDisconnect);
  });

  app.post("/api/hermes/thread/messages", requireAuth, messageLimiter, (req, res) => {
    noStore(res);
    const thread = ownThread(req, res); if (!thread) return;
    const { text, card, media, buzz, clientMessageId } = req.body || {};
    if (card != null || media != null || buzz != null) return res.status(400).json({ error: "Messages to Hermes are text only." });
    const isKid = thread.member.role === "kid";
    const result = chat.sendMessage(thread.scopeKey, {
      senderType: isKid ? "kid" : "parent",
      senderId: isKid ? thread.member.kidId : req.user.id,
      postedByUserId: req.user.id,
      text,
      clientMessageId,
    });
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    // No push: Hermes answers from the family's Mac.
    res.json({ message: decorate(result.message) });
  });

  app.post("/api/hermes/thread/messages/:messageId/actions", requireAuth, actionLimiter, (req, res) => {
    noStore(res);
    const thread = ownThread(req, res); if (!thread) return;
    const action = req.body && typeof req.body.action === "string" ? req.body.action.trim() : "";
    if (!action) return res.status(400).json({ error: "An action is required." });
    try {
      const out = hermesThreads.applyAction({ fam: thread.fam, member: thread.member, messageId: String(req.params.messageId || ""), actionId: action });
      const body = { message: decorate(out.message), messages: out.messages.map(decorate) };
      if (out.alreadyDone) body.alreadyDone = true;
      res.json(body);
    } catch (error) { sendError(res, error); }
  });

  // ===================== Hermes bridge (family bearer) =====================
  function bearerToken(req) {
    const header = typeof req.get === "function" ? req.get("authorization") : (req.headers && req.headers.authorization);
    const match = /^Bearer\s+(\S+)$/i.exec(String(header || "").trim());
    return match ? match[1] : null;
  }
  function requireHermes(req, res, next) {
    const auth = hermes.familyForToken(bearerToken(req));
    if (!auth) return res.status(401).json({ error: "Invalid or expired Hermes token." });
    req.hermesAuth = auth;
    next();
  }

  app.get("/api/hermes/proactive/state", requireHermes, (req, res) => {
    noStore(res);
    res.json(hermesProactive.buildState(req.hermesAuth.family));
  });

  app.post("/api/hermes/proactive/nudges", requireHermes, (req, res) => {
    noStore(res);
    const nudges = req.body && req.body.nudges;
    if (!Array.isArray(nudges) || !nudges.length || nudges.length > MAX_NUDGES_PER_REQUEST) {
      return res.status(400).json({ error: `Send between 1 and ${MAX_NUDGES_PER_REQUEST} nudges.` });
    }
    const fam = req.hermesAuth.family;
    const results = nudges.map((nudge) => {
      const userId = nudge && typeof nudge.userId === "string" ? nudge.userId : null;
      const nudgeKey = nudge && typeof nudge.nudgeKey === "string" ? nudge.nudgeKey : null;
      try {
        const out = hermesThreads.postNudge(fam, { userId, nudgeKey, text: nudge.text, card: nudge.card });
        return { userId, nudgeKey, messageId: out.message.id, created: out.created };
      } catch (error) {
        if (!(error instanceof hermesThreads.ThreadError)) throw error;
        return { userId, nudgeKey, error: error.message, status: error.status };
      }
    });
    res.json({ results });
  });
};

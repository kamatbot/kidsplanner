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
const companion = require("../kid-companion");
const companionAI = require("../kid-companion-ai");
const db = require("../db");
const activeKidTurns = new Set();

module.exports = (app, deps) => {
  const { hermes, chat, store, requireAuth } = deps;
  // Every message wakes a Hermes turn on the family's Mac; keep a runaway
  // client (or a curious kid) from burning turns. Buttons are cheap but capped.
  const passthrough = (req, res, next) => next();
  const messageLimiter = deps.rateLimit ? deps.rateLimit({ windowMs: 60000, max: 12, message: "Hermes is still answering — please wait a moment." }) : passthrough;
  const actionLimiter = deps.rateLimit ? deps.rateLimit({ windowMs: 60000, max: 30, message: "Too many taps — please wait a moment." }) : passthrough;

  function noStore(res) { if (res && typeof res.set === "function") res.set("Cache-Control", "no-store"); }
  function sessionStillActive(req) {
    if (req.watchAuth) return !!db.load().watchAuth?.devices?.[req.watchAuth.id]
      && !db.load().watchAuth.devices[req.watchAuth.id].revokedAt;
    return typeof deps.currentUser !== "function" || deps.currentUser(req)?.id === req.user.id;
  }
  function sendError(res, error) {
    if (error instanceof hermesThreads.ThreadError || error instanceof companion.CompanionError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  function senderName(message) {
    if (message.senderType === "agent") return "Hermes";
    const user = message.postedByUserId && store.getUser(message.postedByUserId);
    return (user && user.data && user.data.profile && user.data.profile.name) || null;
  }
  function decorate(message) {
    const owner = hermesThreads.ownerOfScope(message.familyId);
    const name = message.senderType === "agent" && owner?.member.role === "kid"
      ? companion.getProfile(owner.fam, owner.member.kidId).name : senderName(message);
    return Object.assign({}, message, { roomId: hermesThreads.USER_ROOM_ID, senderName: name });
  }
  function ownThread(req, res) {
    const fam = hermesThreads.familyForUser(req.user);
    const member = fam && hermesThreads.memberFor(fam, req.user.id);
    if (!member) { res.status(404).json({ error: "Hermes isn't available for this account." }); return null; }
    if (req.watchAuth && (req.watchAuth.targetType !== "kid" || member.role !== "kid"
        || req.watchAuth.familyId !== fam.id || req.watchAuth.targetKidId !== member.kidId)) {
      res.status(403).json({ error: "This companion belongs to a child's paired Watch." }); return null;
    }
    return { fam, member, scopeKey: hermesThreads.scopeFor(req.user.id) };
  }

  // Cosmetic choices belong to the child. Enablement and age are parent-only;
  // neither endpoint ever accepts a caller-supplied family or user identity.
  app.get("/api/hermes/companion", requireAuth, (req, res) => {
    noStore(res);
    const thread = ownThread(req, res); if (!thread) return;
    if (thread.member.role !== "kid") return res.status(403).json({ error: "This is your child's companion setting." });
    res.json({ profile: companion.getProfile(thread.fam, thread.member.kidId) });
  });
  app.put("/api/hermes/companion", requireAuth, actionLimiter, (req, res) => {
    noStore(res);
    const thread = ownThread(req, res); if (!thread) return;
    if (thread.member.role !== "kid") return res.status(403).json({ error: "This is your child's companion setting." });
    try { res.json({ profile: companion.updateProfile(thread.fam, thread.member.kidId, req.body, { isParent: false }) }); }
    catch (error) { sendError(res, error); }
  });
  app.get("/api/hermes/companions", requireAuth, (req, res) => {
    noStore(res);
    const thread = ownThread(req, res); if (!thread) return;
    if (thread.member.role !== "parent") return res.status(403).json({ error: "Only parents can manage companions." });
    res.json({ companions: (thread.fam.kids || []).map((kid) => ({ kidId: kid.id, kidName: kid.name, profile: companion.getProfile(thread.fam, kid.id) })) });
  });
  app.put("/api/hermes/companions/:kidId", requireAuth, actionLimiter, (req, res) => {
    noStore(res);
    const thread = ownThread(req, res); if (!thread) return;
    if (thread.member.role !== "parent") return res.status(403).json({ error: "Only parents can manage companions." });
    try { res.json({ profile: companion.updateProfile(thread.fam, String(req.params.kidId || ""), req.body, { isParent: true }) }); }
    catch (error) { sendError(res, error); }
  });

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
      const current = store.getUser(req.user.id);
      const currentFamily = hermesThreads.familyForUser(current);
      if (currentFamily?.id !== thread.fam.id || !hermesThreads.memberFor(currentFamily, req.user.id)
          || !sessionStillActive(req)) {
        return res.status(403).json({ error: "Chat access changed. Please sign in again." });
      }
      res.json({ messages: chat.listMessagesAfterId(thread.scopeKey, afterId).map(decorate) });
    }
    chat.onMessage(thread.scopeKey, onMessage);
    const onDisconnect = () => { if (settled) return; settled = true; cleanup(); };
    if (typeof res.once === "function") res.once("close", onDisconnect);
    if (typeof req.on === "function") req.on("aborted", onDisconnect);
  });

  app.post("/api/hermes/thread/messages", requireAuth, messageLimiter, async (req, res) => {
    let ownedTurnKey = null;
    try {
      noStore(res);
      const thread = ownThread(req, res); if (!thread) return;
      const { text, card, media, buzz, clientMessageId } = req.body || {};
      if (card != null || media != null || buzz != null) return res.status(400).json({ error: "Messages to Hermes are text only." });
      const isKid = thread.member.role === "kid";
      const turnKey = `${thread.fam.id}:${thread.member.kidId}`;
      if (isKid && (typeof text !== "string" || !text.trim() || text.length > 4000)) return res.status(400).json({ error: "Send a message between 1 and 4,000 characters." });
      const identity = { senderType: isKid ? "kid" : "parent", senderId: isKid ? thread.member.kidId : req.user.id, postedByUserId: req.user.id, clientMessageId };
      if (isKid && chat.findRetryMessage(thread.scopeKey, identity)) {
        const retry = chat.sendMessage(thread.scopeKey, { ...identity, text });
        if (retry.error) return res.status(retry.status || 400).json({ error: retry.error });
        return res.json({ message: decorate(retry.message) });
      }
      let policy;
      if (isKid) {
        policy = companion.getProfile(thread.fam, thread.member.kidId);
        if (!policy.enabled) return res.status(403).json({ error: "Ask a parent to turn on your AI companion and choose your age group first." });
        if (activeKidTurns.has(turnKey)) return res.status(429).json({ error: "Your companion is still answering. Please wait a moment." });
        // Bound across all of this child's sessions; survives process restarts.
        const day = hermesProactive.dateKey(new Date(), hermesProactive.familyTimezone(thread.fam));
        const root = db.load();
        root.kidCompanionUsage ||= {};
        root.kidCompanionUsage[thread.fam.id] ||= {};
        const previous = root.kidCompanionUsage[thread.fam.id][thread.member.kidId];
        if (previous?.day === day && previous.count >= 40) return res.status(429).json({ error: "That's all our chats for today. You can still use your planner and reminders." });
        activeKidTurns.add(turnKey);
        ownedTurnKey = turnKey;
      }
      const result = chat.sendMessage(thread.scopeKey, {
        ...identity, text,
      });
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      if (isKid && !result.existing) {
        const day = hermesProactive.dateKey(new Date(), hermesProactive.familyTimezone(thread.fam));
        const usage = db.load().kidCompanionUsage[thread.fam.id];
        usage[thread.member.kidId] = { day, count: usage[thread.member.kidId]?.day === day ? usage[thread.member.kidId].count + 1 : 1 };
        db.persist();
        const history = chat.listMessages(thread.scopeKey, { limit: 16 }).filter((m) => !m.deleted && m.id !== result.message.id);
        let answer;
        try { answer = await companionAI.replyForKid({ fam: thread.fam, userId: req.user.id, kidId: thread.member.kidId, text: result.message.text, history }); }
        catch (_) { answer = { text: "I couldn't check my reply safely just now. Please try again in a little while.", mode: "unavailable" }; }
        // A parent's switch or account removal wins over an in-flight model call.
        const currentUser = store.getUser(req.user.id);
        const currentFamily = hermesThreads.familyForUser(currentUser);
        const member = currentFamily && hermesThreads.memberFor(currentFamily, req.user.id);
        if (currentFamily?.id !== thread.fam.id || member?.kidId !== thread.member.kidId || member?.role !== "kid") {
          return res.status(403).json({ error: "Chat access changed. Please sign in again." });
        }
        if (!sessionStillActive(req)) {
          return res.status(401).json({ error: "Your session ended. Please sign in again." });
        }
        const current = companion.getProfile(currentFamily, member.kidId);
        if (!current.enabled || current.ageBand !== policy.ageBand) return res.json({ message: decorate(result.message) });
        const reply = chat.sendMessage(thread.scopeKey, { senderType: "agent", text: answer.text });
        if (reply.error) return res.json({ message: decorate(result.message) });
        return res.json({ message: decorate(result.message), messages: [decorate(reply.message)] });
      }
      // No push: Hermes answers from the family's Mac.
      res.json({ message: decorate(result.message) });
    } catch (error) {
      if (error instanceof companion.CompanionError || error instanceof hermesThreads.ThreadError) return sendError(res, error);
      return res.status(503).json({ error: "Your companion is unavailable. Please try again in a little while." });
    } finally {
      if (ownedTurnKey) activeKidTurns.delete(ownedTurnKey);
    }
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

  // ===================== what Hermes helps with (parents) =====================
  app.get("/api/hermes/settings", requireAuth, deps.requireParent, deps.requireFamily, (req, res) => {
    noStore(res);
    res.json({ helpsWith: hermesThreads.helpsWith(req.family || hermesThreads.familyForUser(req.user)) });
  });
  app.put("/api/hermes/settings", requireAuth, deps.requireParent, deps.requireFamily, (req, res) => {
    noStore(res);
    try {
      const fam = req.family || hermesThreads.familyForUser(req.user);
      res.json({ helpsWith: hermesThreads.setHelpsWith(fam, req.body && req.body.helpsWith) });
    } catch (error) { sendError(res, error); }
  });

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
        if (out.skipped) return { userId, nudgeKey, created: false, skipped: out.skipped };
        return { userId, nudgeKey, messageId: out.message.id, created: out.created };
      } catch (error) {
        if (!(error instanceof hermesThreads.ThreadError)) throw error;
        return { userId, nudgeKey, error: error.message, status: error.status };
      }
    });
    res.json({ results });
  });
};

"use strict";

const LONG_POLL_MS = 25000;
const MAX_WAITERS_PER_ROOM = 10;
const INVALID_TOKEN_ERROR = "Invalid or expired Hermes token.";
const INVALID_ROOM_ERROR = "Room is not available.";
const operator = require("../operator");
const operatorExecution = require("../operator-execution");
const operatorCards = require("../operator-cards");
const operatorMemory = require("../operator-memory");
const familyContext = require("../family-context");
const actorCapabilities = require("../operator-capabilities");
const hermesMcp = require("../hermes-mcp");
const FAMILY_CONTEXT_ROOM_ERROR = "Family context is only available in the family room.";

module.exports = (app, deps) => {
  const { hermes, family, chat, store, notifications, requireAuth, requireParent, requireFamily } = deps;

  function setNoStore(res) { if (res && typeof res.set === "function") res.set("Cache-Control", "no-store"); }
  function apiBaseUrl(req) {
    const host = typeof req.get === "function" ? req.get("host") : (req.headers && req.headers.host);
    if (host) return `${req.protocol || "https"}://${host}/api/hermes`;
    const origin = (process.env.CANONICAL_HOST || "https://www.fametc.com").replace(/\/+$/, "");
    return `${origin}/api/hermes`;
  }
  function bearerToken(req) {
    const header = typeof req.get === "function" ? req.get("authorization") : (req.headers && req.headers.authorization);
    const match = /^Bearer\s+(\S+)$/i.exec(String(header || "").trim());
    return match ? match[1] : null;
  }
  function requireHermes(req, res, next) {
    const auth = hermes.familyForToken(bearerToken(req));
    if (!auth) return res.status(401).json({ error: INVALID_TOKEN_ERROR });
    req.hermesAuth = auth;
    next();
  }
  function resolveSenderName(message) {
    if (message.senderType === "agent") return "Hermes";
    const uid = message.postedByUserId || (message.senderType === "kid" ? null : message.senderId);
    if (!uid || !store || typeof store.getUser !== "function") return null;
    const user = store.getUser(uid);
    return (user && user.data && user.data.profile && user.data.profile.name) || null;
  }
  function decorateMessage(room, message, auth) {
    const senderName = resolveSenderName(message);
    const decorated = Object.assign({}, message, { roomId: room.roomId, senderName });
    const actor = operator.actorFromMessage(message, senderName);
    if (actor) {
      decorated.actor = actor;
      if (auth && room.kind === "family") {
        try {
          decorated.actorToken = actorCapabilities.issue({ family: auth.family, connection: auth.connection, actor, messageId: message.id, roomId: room.roomId });
        } catch (error) { /* conversational replies may continue without authority */ }
      }
    }
    return decorated;
  }
  function resolveRoom(req, res) {
    const room = hermes.roomForFamily(req.hermesAuth.family, req.params.roomId);
    if (!room) { res.status(403).json({ error: INVALID_ROOM_ERROR }); return null; }
    return room;
  }
  function primaryFamily(req) {
    if (req.family) return req.family;
    const fams = family.familiesForUser(req.user.id);
    return fams.length ? fams[0] : null;
  }
  function parentOperatorActor(req) {
    return {
      type: "parent", principalId: req.user.id, userId: req.user.id,
      name: req.user && req.user.data && req.user.data.profile && req.user.data.profile.name || null,
    };
  }
  function operatorErrorStatus(error) {
    const code = error && error.code;
    if (["OPERATOR_EXECUTION_UNAVAILABLE", "OPERATOR_STORAGE_UNAVAILABLE", "OPERATOR_MEMORY_UNAVAILABLE"].includes(code)) return 503;
    if ([
      "APPROVAL_WRONG_APPROVER", "APPROVAL_PARENT_REQUIRED", "OPERATOR_POLICY_DENIED",
      "OPERATOR_CARD_DENIED", "OPERATOR_ACTOR_ACTION_DENIED", "OPERATOR_ACTION_PROHIBITED",
      "OPERATOR_MEMORY_PARENT_REQUIRED", "OPERATOR_MEMORY_SCOPE_DENIED",
    ].includes(code)) return 403;
    if (["APPROVAL_HASH_MISMATCH", "APPROVAL_NOT_PENDING", "APPROVAL_EXPIRED", "OPERATOR_MEMORY_NOT_PENDING"].includes(code)) return 409;
    if (["OPERATOR_CASE_NOT_FOUND", "APPROVAL_NOT_FOUND", "OPERATOR_FAMILY_NOT_FOUND", "OPERATOR_MEMORY_NOT_FOUND"].includes(code)) return 404;
    return 400;
  }
  function sendOperatorError(res, error) {
    const code = error && error.code || "OPERATOR_ERROR";
    const message = error && error.message || "Operator request failed.";
    return res.status(operatorErrorStatus(error)).json({ error: message, code });
  }

  function withLegacyContextAliases(snapshot) {
    const canonicalSections = snapshot.sections || {};
    const sections = Object.assign({}, canonicalSections);
    if (canonicalSections.preferences) {
      sections.preferences = Object.assign({}, canonicalSections.preferences);
      delete sections.preferences.exclusions;
    }
    const members = sections.identities && Array.isArray(sections.identities.members) ? sections.identities.members : [];
    const kids = members.filter((member) => member.role === "kid").map((member) => ({ id: member.kidId, name: member.displayName, grade: member.grade || null }));
    return Object.assign({}, snapshot, {
      sections,
      access: { scope: "connected-family", mode: "read-only", preauthorized: true, writesAllowed: false },
      family: { id: snapshot.household.localFamilyId, name: snapshot.household.displayName, kids },
      calendar: sections.calendar && sections.calendar.items || [],
      homework: sections.homework && sections.homework.items || [],
      actions: sections.actions && sections.actions.items || [],
      meals: { menu: sections.meals && sections.meals.items || [] },
    });
  }

  app.get("/api/hermes", (req, res) => {
    setNoStore(res);
    res.json({ ok: true, service: "FamETC Hermes bridge", message: "Use this URL as FAMETC_HERMES_API_URL. The adapter adds /rooms automatically." });
  });

  app.post("/api/hermes/connect", requireAuth, requireParent, requireFamily, (req, res) => {
    const fam = primaryFamily(req); const result = hermes.connectFamily(fam && fam.id);
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ connection: result.connection, token: result.token, apiBaseUrl: apiBaseUrl(req) });
  });
  app.get("/api/hermes/connect", requireAuth, requireParent, requireFamily, (req, res) => {
    const fam = primaryFamily(req); res.json({ connection: hermes.connectionStatus(fam) });
  });
  app.delete("/api/hermes/connect", requireAuth, requireParent, requireFamily, (req, res) => {
    const fam = primaryFamily(req); const result = hermes.revokeFamily(fam && fam.id);
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ ok: true });
  });

  // ===================== parent Operator product surface =====================
  app.get("/api/operator/cases", requireAuth, requireParent, requireFamily, (req, res) => {
    setNoStore(res); const fam = primaryFamily(req);
    try { return res.json({ cases: operatorCards.listCaseCards(fam.id, req.user.id, { state: req.query && req.query.state, limit: req.query && req.query.limit }) }); }
    catch (error) { return sendOperatorError(res, error); }
  });
  app.get("/api/operator/cases/:caseId", requireAuth, requireParent, requireFamily, (req, res) => {
    setNoStore(res); const fam = primaryFamily(req);
    try { const card = operatorCards.caseCard(fam.id, req.params.caseId, req.user.id); if (!card) return res.status(404).json({ error: "Operator case not found.", code: "OPERATOR_CASE_NOT_FOUND" }); return res.json({ case: card }); }
    catch (error) { return sendOperatorError(res, error); }
  });
  app.get("/api/operator/activity", requireAuth, requireParent, requireFamily, (req, res) => {
    setNoStore(res); const fam = primaryFamily(req);
    try { return res.json({ activity: operatorCards.familyActivity(fam.id, req.user.id, { limit: req.query && req.query.limit }) }); }
    catch (error) { return sendOperatorError(res, error); }
  });

  // Family Memory: Hermes can only propose through MCP. These session-authenticated
  // routes are the parent governance surface for activate/edit/delete.
  app.get("/api/operator/memory", requireAuth, requireParent, requireFamily, (req, res) => {
    setNoStore(res); const fam = primaryFamily(req);
    try { return res.json({ memories: operatorMemory.list(fam.id, parentOperatorActor(req), { state: req.query && req.query.state || "active", limit: req.query && req.query.limit }) }); }
    catch (error) { return sendOperatorError(res, error); }
  });
  app.post("/api/operator/memory", requireAuth, requireParent, requireFamily, (req, res) => {
    setNoStore(res); const fam = primaryFamily(req);
    try { return res.json({ memory: operatorMemory.createByParent(fam.id, parentOperatorActor(req), req.body || {}) }); }
    catch (error) { return sendOperatorError(res, error); }
  });
  app.post("/api/operator/memory/:memoryId/decision", requireAuth, requireParent, requireFamily, (req, res) => {
    setNoStore(res); const fam = primaryFamily(req);
    try {
      const memory = operatorMemory.decide(fam.id, req.params.memoryId, parentOperatorActor(req), req.body && req.body.decision);
      if (!memory) return res.status(404).json({ error: "Family Memory item not found.", code: "OPERATOR_MEMORY_NOT_FOUND" });
      return res.json({ memory });
    } catch (error) { return sendOperatorError(res, error); }
  });
  app.post("/api/operator/memory/:memoryId/update", requireAuth, requireParent, requireFamily, (req, res) => {
    setNoStore(res); const fam = primaryFamily(req);
    try {
      const memory = operatorMemory.updateByParent(fam.id, req.params.memoryId, parentOperatorActor(req), req.body || {});
      if (!memory) return res.status(404).json({ error: "Active Family Memory item not found.", code: "OPERATOR_MEMORY_NOT_FOUND" });
      return res.json({ memory });
    } catch (error) { return sendOperatorError(res, error); }
  });
  app.delete("/api/operator/memory/:memoryId", requireAuth, requireParent, requireFamily, (req, res) => {
    setNoStore(res); const fam = primaryFamily(req);
    try {
      if (!operatorMemory.removeByParent(fam.id, req.params.memoryId, parentOperatorActor(req))) return res.status(404).json({ error: "Family Memory item not found.", code: "OPERATOR_MEMORY_NOT_FOUND" });
      return res.json({ ok: true });
    } catch (error) { return sendOperatorError(res, error); }
  });

  app.get("/api/operator/approvals", requireAuth, requireParent, requireFamily, (req, res) => {
    setNoStore(res); const fam = primaryFamily(req);
    try { const approvals = operatorExecution.listApprovalsForParent(fam.id, req.user.id, { state: req.query && req.query.state, limit: req.query && req.query.limit }); return res.json({ approvals, supportedActionTypes: operatorExecution.supportedActionTypes() }); }
    catch (error) { return sendOperatorError(res, error); }
  });
  app.get("/api/operator/approvals/:approvalId", requireAuth, requireParent, requireFamily, (req, res) => {
    setNoStore(res); const fam = primaryFamily(req);
    try { const approval = operatorExecution.getApprovalForParent(fam.id, req.user.id, req.params.approvalId); if (!approval) return res.status(404).json({ error: "Approval not found.", code: "APPROVAL_NOT_FOUND" }); return res.json({ approval }); }
    catch (error) { return sendOperatorError(res, error); }
  });
  app.post("/api/operator/approvals/:approvalId/decision", requireAuth, requireParent, requireFamily, (req, res) => {
    setNoStore(res); const fam = primaryFamily(req);
    try {
      const result = operatorExecution.decideApproval(fam.id, req.params.approvalId, { actor: parentOperatorActor(req), decision: req.body && req.body.decision, actionHash: req.body && req.body.actionHash });
      if (!result) return res.status(404).json({ error: "Approval not found.", code: "APPROVAL_NOT_FOUND" });
      return res.json(result);
    } catch (error) { return sendOperatorError(res, error); }
  });

  // ===================== bearer-authenticated Hermes bridge =====================
  app.post("/api/hermes/mcp", requireHermes, (req, res) => { setNoStore(res); return hermesMcp.handle(req, res, req.hermesAuth); });
  app.get("/api/hermes/rooms", requireHermes, (req, res) => { setNoStore(res); res.json({ rooms: hermes.roomsForFamily(req.hermesAuth.family) }); });
  app.get("/api/hermes/rooms/:roomId/context", requireHermes, (req, res) => {
    setNoStore(res); const room = resolveRoom(req, res); if (!room) return;
    if (room.kind !== "family") return res.status(403).json({ error: FAMILY_CONTEXT_ROOM_ERROR });
    try {
      const query = req.query || {};
      const snapshot = familyContext.buildFamilyContext(req.hermesAuth.family.id, { actor: null, purpose: "family-assistance", roomId: room.roomId, from: query.from, to: query.to });
      return res.json(withLegacyContextAliases(snapshot));
    } catch (error) {
      if (error && error.code && String(error.code).startsWith("FAMILY_CONTEXT_")) return res.status(400).json({ error: error.message, code: error.code });
      throw error;
    }
  });
  app.get("/api/hermes/rooms/:roomId/messages", requireHermes, (req, res) => {
    setNoStore(res); const room = resolveRoom(req, res); if (!room) return;
    const afterId = typeof req.query.afterId === "string" ? req.query.afterId : "";
    const read = () => { const result = hermes.listInboundMessages(room.scopeKey, afterId); return { messages: result.messages.map((message) => decorateMessage(room, message, req.hermesAuth)), cursor: result.cursor }; };
    const immediate = read();
    if (!afterId || immediate.messages.length || immediate.cursor !== afterId || req.query.wait !== "1") return res.json(immediate);
    const scope = room.scopeKey; if (chat.waiterCount(scope) >= MAX_WAITERS_PER_ROOM) return res.json(immediate);
    let settled = false;
    const cleanup = () => { clearTimeout(timer); chat.offMessage(scope, onMessage); };
    const timer = setTimeout(() => { if (settled) return; settled = true; cleanup(); res.json({ messages: [], cursor: afterId }); }, LONG_POLL_MS);
    function onMessage() { if (settled) return; const next = read(); if (next.messages.length || next.cursor !== afterId) { settled = true; cleanup(); res.json(next); } }
    chat.onMessage(scope, onMessage);
    req.on("close", () => { if (settled) return; settled = true; cleanup(); });
  });
  app.post("/api/hermes/rooms/:roomId/messages", requireHermes, async (req, res) => {
    const room = resolveRoom(req, res); if (!room) return;
    const body = req.body || {}; const result = hermes.sendAgentMessage(room.scopeKey, body.text);
    if (result.error) return res.status(400).json({ error: result.error });
    try {
      if (room.kind === "family") {
        await notifications.notifyChatMessage({ familyParentIds: req.hermesAuth.family.parentIds, familyKidUserIds: store.listKidUserIdsForFamily(req.hermesAuth.family.id), senderUserId: null, senderName: "Hermes", familyId: req.hermesAuth.family.id, text: result.message.text });
      } else { await notifications.notifyTripChatMessage(room.trip, null, "Hermes", result.message.text); }
    } catch (e) { /* push fan-out must never block a bridge reply */ }
    res.json({ message: decorateMessage(room, result.message) });
  });
};

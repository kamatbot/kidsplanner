"use strict";

const LONG_POLL_MS = 25000;
const MAX_WAITERS_PER_ROOM = 10;
const INVALID_TOKEN_ERROR = "Invalid or expired Hermes token.";
const INVALID_ROOM_ERROR = "Room is not available.";
const operator = require("../operator");
const operatorExecution = require("../operator-execution");
const actorCapabilities = require("../operator-capabilities");
const hermesMcp = require("../hermes-mcp");
const FAMILY_CONTEXT_ROOM_ERROR = "Family context is only available in the family room.";
const CONTEXT_PAST_DAYS = 14;
const CONTEXT_FUTURE_DAYS = 92;
const MAX_CONTEXT_WINDOW_DAYS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;
const CONTEXT_LIMITS = Object.freeze({ calendar: 250, homework: 200, actions: 200, meals: 100 });

module.exports = (app, deps) => {
  const {
    hermes,
    family,
    chat,
    store,
    events,
    schoolFeeds,
    homework,
    actions,
    meals,
    notifications,
    requireAuth,
    requireParent,
    requireFamily,
  } = deps;

  function setNoStore(res) {
    if (res && typeof res.set === "function") res.set("Cache-Control", "no-store");
  }

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
    const decorated = Object.assign({}, message, {
      roomId: room.roomId,
      senderName,
    });
    const actor = operator.actorFromMessage(message, senderName);
    if (actor) {
      decorated.actor = actor;
      // Family Operator authority is never placed into a shared Trip room,
      // even when the sender is a family parent: Hermes' reply is visible to
      // every Trip member. Trip conversations remain conversational only.
      if (auth && room.kind === "family") {
        try {
          decorated.actorToken = actorCapabilities.issue({
            family: auth.family,
            connection: auth.connection,
            actor,
            messageId: message.id,
            roomId: room.roomId,
          });
        } catch (error) {
          // No actorToken is safer than widening authority. Hermes can still
          // answer the message conversationally without Operator tools.
        }
      }
    }
    return decorated;
  }

  function resolveRoom(req, res) {
    const room = hermes.roomForFamily(req.hermesAuth.family, req.params.roomId);
    if (!room) {
      res.status(403).json({ error: INVALID_ROOM_ERROR });
      return null;
    }
    return room;
  }

  function primaryFamily(req) {
    if (req.family) return req.family;
    const fams = family.familiesForUser(req.user.id);
    return fams.length ? fams[0] : null;
  }

  function parentOperatorActor(req) {
    return {
      type: "parent",
      principalId: req.user.id,
      userId: req.user.id,
      name: req.user && req.user.data && req.user.data.profile && req.user.data.profile.name || null,
    };
  }

  function operatorErrorStatus(error) {
    const code = error && error.code;
    if (code === "OPERATOR_EXECUTION_UNAVAILABLE" || code === "OPERATOR_STORAGE_UNAVAILABLE") return 503;
    if (code === "APPROVAL_WRONG_APPROVER" || code === "APPROVAL_PARENT_REQUIRED" || code === "OPERATOR_POLICY_DENIED") return 403;
    if (code === "APPROVAL_HASH_MISMATCH" || code === "APPROVAL_NOT_PENDING" || code === "APPROVAL_EXPIRED") return 409;
    if (code === "OPERATOR_CASE_NOT_FOUND" || code === "APPROVAL_NOT_FOUND") return 404;
    return 400;
  }

  function sendOperatorError(res, error) {
    const code = error && error.code || "OPERATOR_ERROR";
    const message = error && error.message || "Operator request failed.";
    return res.status(operatorErrorStatus(error)).json({ error: message, code });
  }

  function parseDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
    if (!match) return null;
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getUTCFullYear() === Number(match[1])
      && date.getUTCMonth() === Number(match[2]) - 1
      && date.getUTCDate() === Number(match[3]) ? date : null;
  }

  function dateString(date) {
    return date.toISOString().slice(0, 10);
  }

  function shiftDate(date, days) {
    return new Date(date.getTime() + days * DAY_MS);
  }

  function contextRange(query) {
    const today = parseDate(dateString(new Date()));
    const from = query && query.from ? parseDate(query.from) : shiftDate(today, -CONTEXT_PAST_DAYS);
    const to = query && query.to ? parseDate(query.to) : shiftDate(today, CONTEXT_FUTURE_DAYS);
    if (!from || !to || from > to || (to.getTime() - from.getTime()) / DAY_MS > MAX_CONTEXT_WINDOW_DAYS) {
      return null;
    }
    return { from: dateString(from), to: dateString(to) };
  }

  function text(value, max = 300) {
    return String(value == null ? "" : value).trim().slice(0, max);
  }

  function intersects(date, endDate, range) {
    return !!date && date <= range.to && (endDate || date) >= range.from;
  }

  function familyContext(fam, range) {
    const manualEvents = events.listEvents(fam.id, range).map((event) => ({
      id: event.id,
      title: text(event.title),
      date: event.date,
      endDate: event.endDate || null,
      time: event.time || null,
      endTime: event.endTime || null,
      category: event.category || "other",
      kidId: event.kidId || null,
      source: "family",
    }));
    const feedStore = schoolFeeds.famStore(fam.id);
    const schoolEvents = schoolFeeds.collectFromCache(feedStore, Date.now())
      .filter((event) => intersects(text(event.start, 30).slice(0, 10), text(event.end, 30).slice(0, 10), range))
      .map((event) => ({
        id: `${event.subscriptionId || "school"}:${event.uid || "event"}`,
        title: text(event.title),
        date: text(event.start, 30).slice(0, 10),
        endDate: text(event.end, 30).slice(0, 10) || null,
        time: event.allDay ? null : (text(event.start, 30).slice(11, 16) || null),
        endTime: event.allDay ? null : (text(event.end, 30).slice(11, 16) || null),
        category: event.type === "deadline" ? "school-deadline" : "school",
        kidId: event.kidId || null,
        location: text(event.location, 200) || null,
        source: "school",
      }));
    const menu = meals.getState(fam.id).menu
      .filter((entry) => intersects(entry.date, entry.date, range))
      .map((entry) => ({
        id: entry.id,
        date: entry.date,
        slot: entry.slot,
        title: text(entry.title, 120),
      }))
      .slice(0, CONTEXT_LIMITS.meals);
    const calendar = manualEvents.concat(schoolEvents).sort((a, b) =>
      `${a.date || ""} ${a.time || ""}`.localeCompare(`${b.date || ""} ${b.time || ""}`)
    ).slice(0, CONTEXT_LIMITS.calendar);
    const homeworkItems = homework.listForFamily(fam.id)
      .filter((item) => item.status !== "done" ? (!item.dueDate || item.dueDate <= range.to) : intersects(item.dueDate, item.dueDate, range))
      .map((item) => ({
        id: item.id,
        kidId: item.kidId,
        title: text(item.title),
        subject: text(item.subject, 100) || null,
        dueDate: item.dueDate || null,
        dueTime: item.dueTime || null,
        status: item.status,
        effortMin: item.effortMin || null,
        source: item.source,
      }))
      .slice(0, CONTEXT_LIMITS.homework);
    const actionItems = actions.listForFamily(fam.id, { statuses: ["open", "snoozed"] })
      .filter((item) => !item.dueDate || item.dueDate <= range.to)
      .map((item) => ({
        id: item.id,
        title: text(item.title),
        status: item.status,
        dueDate: item.dueDate || null,
        dueTime: item.dueTime || null,
        assigneeType: item.assigneeType,
        kidId: item.kidId || null,
        sourceType: item.sourceType,
      }))
      .slice(0, CONTEXT_LIMITS.actions);
    return {
      generatedAt: new Date().toISOString(),
      range,
      access: {
        scope: "connected-family",
        mode: "read-only",
        preauthorized: true,
        writesAllowed: false,
      },
      family: {
        id: fam.id,
        name: text(fam.name, 60),
        kids: (fam.kids || []).map((kid) => ({ id: kid.id, name: text(kid.name, 60), grade: text(kid.grade, 20) || null })),
      },
      calendar,
      homework: homeworkItems,
      actions: actionItems,
      meals: { menu },
    };
  }

  // Public discovery endpoint for the base URL shown during setup. It returns
  // only static metadata; family status and credentials remain parent-only.
  app.get("/api/hermes", (req, res) => {
    setNoStore(res);
    res.json({
      ok: true,
      service: "FamETC Hermes bridge",
      message: "Use this URL as FAMETC_HERMES_API_URL. The adapter adds /rooms automatically.",
    });
  });

  // ===================== interactive parent connection =====================
  app.post("/api/hermes/connect", requireAuth, requireParent, requireFamily, (req, res) => {
    const fam = primaryFamily(req);
    const result = hermes.connectFamily(fam && fam.id);
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ connection: result.connection, token: result.token, apiBaseUrl: apiBaseUrl(req) });
  });

  app.get("/api/hermes/connect", requireAuth, requireParent, requireFamily, (req, res) => {
    const fam = primaryFamily(req);
    res.json({ connection: hermes.connectionStatus(fam) });
  });

  app.delete("/api/hermes/connect", requireAuth, requireParent, requireFamily, (req, res) => {
    const fam = primaryFamily(req);
    const result = hermes.revokeFamily(fam && fam.id);
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ ok: true });
  });

  // ===================== parent approval surface =====================
  // Browser/iOS contract for approval cards. Hermes cannot call these
  // session-authenticated routes; the agent uses MCP plus signed actorToken.
  app.get("/api/operator/approvals", requireAuth, requireParent, requireFamily, (req, res) => {
    setNoStore(res);
    const fam = primaryFamily(req);
    try {
      const approvals = operatorExecution.listApprovalsForParent(fam.id, req.user.id, {
        state: req.query && req.query.state,
        limit: req.query && req.query.limit,
      });
      return res.json({
        approvals,
        supportedActionTypes: operatorExecution.supportedActionTypes(),
      });
    } catch (error) {
      return sendOperatorError(res, error);
    }
  });

  app.get("/api/operator/approvals/:approvalId", requireAuth, requireParent, requireFamily, (req, res) => {
    setNoStore(res);
    const fam = primaryFamily(req);
    try {
      const approval = operatorExecution.getApprovalForParent(fam.id, req.user.id, req.params.approvalId);
      if (!approval) return res.status(404).json({ error: "Approval not found.", code: "APPROVAL_NOT_FOUND" });
      return res.json({ approval });
    } catch (error) {
      return sendOperatorError(res, error);
    }
  });

  app.post("/api/operator/approvals/:approvalId/decision", requireAuth, requireParent, requireFamily, (req, res) => {
    setNoStore(res);
    const fam = primaryFamily(req);
    try {
      const result = operatorExecution.decideApproval(fam.id, req.params.approvalId, {
        actor: parentOperatorActor(req),
        decision: req.body && req.body.decision,
        actionHash: req.body && req.body.actionHash,
      });
      if (!result) return res.status(404).json({ error: "Approval not found.", code: "APPROVAL_NOT_FOUND" });
      return res.json(result);
    } catch (error) {
      return sendOperatorError(res, error);
    }
  });

  // ===================== bearer-authenticated bridge =====================
  // Stateless MCP endpoint. It deliberately shares the same family-scoped
  // bearer as the chat bridge; tools never accept a familyId argument.
  app.post("/api/hermes/mcp", requireHermes, (req, res) => {
    setNoStore(res);
    return hermesMcp.handle(req, res, req.hermesAuth);
  });

  app.get("/api/hermes/rooms", requireHermes, (req, res) => {
    setNoStore(res);
    res.json({ rooms: hermes.roomsForFamily(req.hermesAuth.family) });
  });

  app.get("/api/hermes/rooms/:roomId/context", requireHermes, (req, res) => {
    setNoStore(res);
    const room = resolveRoom(req, res);
    if (!room) return;
    if (room.kind !== "family") return res.status(403).json({ error: FAMILY_CONTEXT_ROOM_ERROR });
    const range = contextRange(req.query);
    if (!range) return res.status(400).json({ error: `Use valid from/to dates spanning no more than ${MAX_CONTEXT_WINDOW_DAYS} days.` });
    res.json(familyContext(req.hermesAuth.family, range));
  });

  app.get("/api/hermes/rooms/:roomId/messages", requireHermes, (req, res) => {
    setNoStore(res);
    const room = resolveRoom(req, res);
    if (!room) return;
    const afterId = typeof req.query.afterId === "string" ? req.query.afterId : "";
    const read = () => {
      const result = hermes.listInboundMessages(room.scopeKey, afterId);
      return {
        messages: result.messages.map((message) => decorateMessage(room, message, req.hermesAuth)),
        cursor: result.cursor,
      };
    };
    const immediate = read();
    // A missing cursor is discovery/seed mode. A known cursor with filtered
    // messages still advances, which prevents loops on agent/non-mention text.
    if (!afterId || immediate.messages.length || immediate.cursor !== afterId || req.query.wait !== "1") {
      return res.json(immediate);
    }
    const scope = room.scopeKey;
    if (chat.waiterCount(scope) >= MAX_WAITERS_PER_ROOM) return res.json(immediate);

    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      chat.offMessage(scope, onMessage);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      res.json({ messages: [], cursor: afterId });
    }, LONG_POLL_MS);
    function onMessage() {
      if (settled) return;
      const next = read();
      if (next.messages.length || next.cursor !== afterId) {
        settled = true;
        cleanup();
        res.json(next);
      }
    }
    chat.onMessage(scope, onMessage);
    req.on("close", () => {
      if (settled) return;
      settled = true;
      cleanup();
    });
  });

  app.post("/api/hermes/rooms/:roomId/messages", requireHermes, async (req, res) => {
    const room = resolveRoom(req, res);
    if (!room) return;
    const body = req.body || {};
    const result = hermes.sendAgentMessage(room.scopeKey, body.text);
    if (result.error) return res.status(400).json({ error: result.error });

    try {
      if (room.kind === "family") {
        await notifications.notifyChatMessage({
          familyParentIds: req.hermesAuth.family.parentIds,
          familyKidUserIds: store.listKidUserIdsForFamily(req.hermesAuth.family.id),
          senderUserId: null,
          senderName: "Hermes",
          familyId: req.hermesAuth.family.id,
          text: result.message.text,
        });
      } else {
        await notifications.notifyTripChatMessage(room.trip, null, "Hermes", result.message.text);
      }
    } catch (e) { /* push fan-out must never block a bridge reply */ }
    res.json({ message: decorateMessage(room, result.message) });
  });
};

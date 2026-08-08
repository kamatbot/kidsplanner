"use strict";

// Family decisions are intentionally available to every authenticated family
// member, including kids. The route derives family and actor identity from
// requireFamily/requireAuth and never trusts those values from JSON.
module.exports = (app, deps) => {
  const { decisions, chat, requireAuth, requireFamily } = deps;

  function noStore(res) {
    if (typeof res.set === "function") res.set("Cache-Control", "no-store");
    else if (typeof res.setHeader === "function") res.setHeader("Cache-Control", "no-store");
  }

  function error(res, result) {
    return res.status(400).json({ error: result.error });
  }

  function own(body, key) {
    return Object.prototype.hasOwnProperty.call(body || {}, key);
  }

  function editablePatch(body) {
    const patch = {};
    for (const field of ["question", "options", "deadline"]) {
      if (own(body, field)) patch[field] = body[field];
    }
    return patch;
  }

  function sourceReferenceFromBody(body) {
    if (body && body.sourceType != null && body.sourceType !== "chat") {
      return { error: "Only family chat messages can create decisions." };
    }
    if (body && body.roomId != null && body.roomId !== "family") {
      return { error: "Only the family chat room can create decisions." };
    }
    if (!body || typeof body.sourceId !== "string" || !body.sourceId.trim()) return null;
    const sourceId = body.sourceId.trim();
    if (sourceId.length > 200) return { error: "A family chat message sourceId is invalid." };
    return { sourceId };
  }

  function familyChatSourceMessage(req, body, sourceId) {
    // The endpoint itself is the chat conversion contract, but accepting a
    // different sourceType would make it possible for a client to bypass the
    // family-text-only safety checks.
    if (body && body.sourceType != null && body.sourceType !== "chat") {
      return { error: "Only family chat messages can create decisions." };
    }
    if (body && body.roomId != null && body.roomId !== "family") {
      return { error: "Only the family chat room can create decisions." };
    }
    if (!chat || typeof chat.getMessage !== "function") return { error: "Family chat is unavailable." };

    const message = chat.getMessage(req.family.id, sourceId);
    if (!message || message.familyId && message.familyId !== req.family.id) {
      return { error: "The family chat message is unavailable." };
    }
    const room = message.roomId || message.scopeId;
    if (typeof room === "string" && room !== "family") {
      return { error: "Only the family chat room can create decisions." };
    }
    if (typeof message.familyId === "string" && message.familyId.startsWith("trip:")) {
      return { error: "Trip chat messages cannot create family decisions." };
    }
    if (message.deleted) return { error: "The family chat message is unavailable." };
    if (message.card && message.card.type === "event") {
      return { error: "Event cards cannot create decisions." };
    }
    // A decision conversion needs the family text as its question source. A
    // GIF/media-only message has no text to convert and must be rejected.
    if (typeof message.text !== "string" || !message.text.trim()) {
      return { error: "Media-only chat messages cannot create decisions." };
    }
    return { sourceId, message };
  }

  app.get("/api/family/decisions", requireAuth, requireFamily, (req, res) => {
    noStore(res);
    const list = decisions.listDecisions(req.family.id).map(decisions.publicDecision);
    res.json({ decisions: list });
  });

  app.post("/api/family/decisions", requireAuth, requireFamily, (req, res) => {
    const body = req.body || {};
    if (body.sourceType != null || body.sourceId != null) {
      return error(res, { error: "Chat sources must use the from-chat decision endpoint." });
    }
    const result = decisions.createDecision(req.family.id, {
      question: body.question,
      options: body.options,
      deadline: body.deadline,
      createdBy: req.user.id,
    });
    if (result.error) return error(res, result);
    res.json({ decision: decisions.publicDecision(result.decision), existing: !!result.existing });
  });

  app.patch("/api/family/decisions/:id", requireAuth, requireFamily, (req, res) => {
    const existing = decisions.getDecision(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Decision not found." });
    const result = decisions.updateDecision(req.family.id, req.params.id, editablePatch(req.body || {}));
    if (result.error) return error(res, result);
    res.json({ decision: decisions.publicDecision(result.decision) });
  });

  app.delete("/api/family/decisions/:id", requireAuth, requireFamily, (req, res) => {
    const existing = decisions.getDecision(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Decision not found." });
    const result = decisions.deleteDecision(req.family.id, req.params.id);
    if (result.error) return error(res, result);
    res.json({ ok: true });
  });

  app.post("/api/family/decisions/:id/respond", requireAuth, requireFamily, (req, res) => {
    const existing = decisions.getDecision(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Decision not found." });
    const result = decisions.respondToDecision(req.family.id, req.params.id, (req.body || {}).optionId, req.user.id);
    if (result.error) return error(res, result);
    res.json({ decision: decisions.publicDecision(result.decision) });
  });

  app.post("/api/family/decisions/:id/resolve", requireAuth, requireFamily, (req, res) => {
    const existing = decisions.getDecision(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Decision not found." });
    const body = req.body || {};
    const optionId = own(body, "resolvedOptionId") ? body.resolvedOptionId : body.optionId;
    const result = decisions.resolveDecision(req.family.id, req.params.id, optionId, req.user.id);
    if (result.error) return error(res, result);
    res.json({ decision: decisions.publicDecision(result.decision) });
  });

  app.post("/api/family/decisions/:id/reopen", requireAuth, requireFamily, (req, res) => {
    const existing = decisions.getDecision(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Decision not found." });
    const result = decisions.reopenDecision(req.family.id, req.params.id, req.user.id);
    if (result.error) return error(res, result);
    res.json({ decision: decisions.publicDecision(result.decision) });
  });

  app.post("/api/family/decisions/from-chat", requireAuth, requireFamily, (req, res) => {
    const body = req.body || {};
    const reference = sourceReferenceFromBody(body);
    if (reference && reference.error) return error(res, reference);
    if (!reference || !reference.sourceId) return error(res, { error: "A family chat message sourceId is required." });

    // Idempotency is keyed by the family-scoped source reference. Return the
    // stored object before reading client fields again, so deleting/editing a
    // source message never mutates or invalidates an existing decision.
    const existing = decisions.getBySource(req.family.id, "chat", reference.sourceId);
    if (existing) return res.json({ decision: decisions.publicDecision(existing), existing: true });

    const source = familyChatSourceMessage(req, body, reference.sourceId);
    if (source.error) return error(res, source);

    const question = own(body, "question") ? body.question : source.message.text;
    const result = decisions.createDecision(req.family.id, {
      question,
      options: body.options,
      deadline: body.deadline,
      sourceType: "chat",
      sourceId: source.sourceId,
      createdBy: req.user.id,
    });
    if (result.error) return error(res, result);
    res.json({ decision: decisions.publicDecision(result.decision), existing: false });
  });
};

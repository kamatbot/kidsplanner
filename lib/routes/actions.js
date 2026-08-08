"use strict";

// Family action-item API. The model validates shape/references; this module
// applies the authenticated family and parent/kid field permissions.
module.exports = (app, deps) => {
  const {
    actions,
    analytics,
    requireAuth,
    requireParent,
    requireFamily,
    userRole,
    kidIdForUser,
  } = deps;

  function track(name) {
    try {
      if (analytics && typeof analytics.recordEvent === "function") analytics.recordEvent(name);
    } catch (e) {
      // Analytics is aggregate-only and must never block a family action.
    }
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj || {}, key);
  }

  function setNoStore(res) {
    res.set("Cache-Control", "no-store");
  }

  const PARENT_PATCH_FIELDS = [
    "status", "title", "notes", "dueDate", "dueTime",
    "assigneeType", "assigneeId", "kidId", "snoozedUntil",
  ];
  const KID_PATCH_FIELDS = ["status", "snoozedUntil"];
  const KID_FORBIDDEN_FIELDS = [
    "title", "notes", "dueDate", "dueTime", "assigneeType", "assigneeId", "kidId",
    "sourceType", "sourceId", "createdBy", "familyId", "id",
  ];

  app.get("/api/family/actions", requireAuth, requireFamily, (req, res) => {
    setNoStore(res);
    const role = userRole(req.user);
    const rawQuery = Object.assign({}, req.query || {});
    let viewerKidId = null;
    if (role === "kid") {
      // Never trust ?kid= / ?kidId= from a kid session. The session's linked
      // profile controls the visible scope; the model then includes that kid's
      // assigned actions plus shared family actions.
      viewerKidId = kidIdForUser(req);
      if (!viewerKidId) return res.status(403).json({ error: "No kid profile linked to this session." });
      delete rawQuery.kid;
      delete rawQuery.kidId;
    }
    const parsed = actions.normalizeListFilters(rawQuery, req.family.id);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const list = actions.listActions(req.family.id, Object.assign({}, parsed.filters, { viewerKidId }));
    res.json({ actions: list });
  });

  app.post("/api/family/actions", requireAuth, requireParent, requireFamily, (req, res) => {
    const body = req.body || {};
    const result = actions.createAction(req.family.id, {
      title: body.title,
      notes: body.notes,
      dueDate: body.dueDate,
      dueTime: body.dueTime,
      assigneeType: body.assigneeType,
      assigneeId: body.assigneeId,
      kidId: body.kidId,
      // The source link is opaque and is preserved for later projections, but
      // family/source ownership is never inferred from a client-supplied ID.
      sourceType: body.sourceType,
      sourceId: body.sourceId,
      createdBy: req.user.id,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    track("action_created");
    res.json({ action: result.action });
  });

  app.patch("/api/family/actions/:id", requireAuth, requireFamily, (req, res) => {
    const existing = actions.getAction(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Action not found." });

    const body = req.body || {};
    const role = userRole(req.user);
    let patch;
    if (role === "kid") {
      const ownKidId = kidIdForUser(req);
      if (!actions.canKidManage(existing, ownKidId)) {
        return res.status(403).json({ error: "Kids can only update actions assigned to them." });
      }
      if (KID_FORBIDDEN_FIELDS.some((field) => hasOwn(body, field))) {
        return res.status(403).json({ error: "Kids cannot edit action details or assignees." });
      }
      if (hasOwn(body, "status") && body.status !== "done" && body.status !== "snoozed") {
        return res.status(403).json({ error: "Kids can only complete or snooze their actions." });
      }
      patch = {};
      for (const field of KID_PATCH_FIELDS) {
        if (hasOwn(body, field)) patch[field] = body[field];
      }
    } else {
      patch = {};
      for (const field of PARENT_PATCH_FIELDS) {
        if (hasOwn(body, field)) patch[field] = body[field];
      }
    }

    if (!Object.keys(patch).length) return res.status(400).json({ error: "No editable action fields were provided." });
    const previousStatus = existing.status;
    const result = actions.updateAction(req.family.id, req.params.id, patch);
    if (result.error) return res.status(400).json({ error: result.error });
    if (previousStatus !== "done" && result.action.status === "done") track("action_completed");
    if (previousStatus !== "snoozed" && result.action.status === "snoozed") track("action_snoozed");
    res.json({ action: result.action });
  });

  app.delete("/api/family/actions/:id", requireAuth, requireParent, requireFamily, (req, res) => {
    const existing = actions.getAction(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Action not found." });
    const result = actions.deleteAction(req.family.id, req.params.id);
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ ok: true });
  });
};

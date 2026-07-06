"use strict";

module.exports = (app, deps) => {
  const { homework, chat, requireAuth, requireFamily, userRole, kidIdForUser, friendlyDate } = deps;

  // Keep the calendar / homework hub / chat in sync: post a family-chat note when
  // homework is added or finished. Done SERVER-SIDE so it works identically on web
  // and iOS (both hit this API). Attributed to the acting user; a chat hiccup must
  // never fail the homework action.
  function postHomeworkChat(req, kind, item) {
    try {
      const isKid = userRole(req.user) === "kid";
      const kid = (req.family.kids || []).find((k) => k.id === item.kidId);
      const forWho = kid && kid.name ? ` for ${kid.name}` : "";
      const text =
        kind === "added"
          ? `📚 New homework${forWho}: ${item.title} — due ${friendlyDate(item.dueDate)}`
          : `✅ Finished: ${item.title}`;
      chat.sendMessage(req.family.id, {
        senderType: isKid ? "kid" : "parent",
        senderId: isKid ? req.user.data.kid.kidId : req.user.id,
        postedByUserId: req.user.id,
        text,
        // A tappable reference so clients can render this as a distinct card that
        // deep-links to the assignment (see the iOS chat card UI).
        card: { type: "homework", id: item.id, title: item.title },
      });
    } catch (e) {
      /* never block the homework op on a chat error */
    }
  }

  app.get("/api/homework", requireAuth, requireFamily, (req, res) => {
    const role = userRole(req.user);
    let kidId = req.query.kidId ? String(req.query.kidId) : null;
    if (role === "kid") {
      // Kids can never list a sibling's homework, regardless of what ?kidId=
      // was passed — force it to their own.
      kidId = kidIdForUser(req);
    }
    const items = homework.listForFamily(req.family.id, { kidId, subject: req.query.subject });
    res.json({ homework: items });
  });

  app.post("/api/homework", requireAuth, requireFamily, (req, res) => {
    const role = userRole(req.user);
    const body = req.body || {};
    // A kid session may only add homework for THEMSELVES — kidId is derived
    // server-side, never trusted from the body, for a kid. Parents may add for
    // any kid in the family (the kidId they send is validated against the
    // family's kid list inside addHomework()).
    const kidId = role === "kid" ? kidIdForUser(req) : body.kidId;
    if (role === "kid" && !kidId) return res.status(403).json({ error: "No kid profile linked to this session." });
    const result = homework.addHomework(req.family.id, {
      kidId,
      title: body.title,
      subject: body.subject,
      dueDate: body.dueDate,
      dueTime: body.dueTime,
      effortMin: body.effortMin,
      source: role === "kid" ? "manual" : (body.source || "manual"),
      notes: body.notes,
      checklist: body.checklist,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    postHomeworkChat(req, "added", result.homework);
    res.json({ homework: result.homework });
  });

  app.patch("/api/homework/:id", requireAuth, requireFamily, (req, res) => {
    const role = userRole(req.user);
    const existing = homework.getById(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Homework item not found." });
    if (!homework.canAccess(req.user, role, req.family.id, existing)) {
      return res.status(403).json({ error: "You don't have access to this homework item." });
    }
    // Capture BEFORE updating — updateHomework mutates `existing` in place (same
    // object), so reading existing.status after would already show the new value.
    const prevStatus = existing.status;
    const body = req.body || {};
    const patch = {
      status: body.status,
      notes: body.notes,
      checklist: body.checklist,
    };
    // Only a parent may edit the descriptive fields (title/subject/due date/
    // effort) — a kid can update their own status/notes/checklist (the
    // "complete it" workflow) but not rewrite what the assignment IS.
    if (role !== "kid") {
      if (body.title !== undefined) patch.title = body.title;
      if (body.subject !== undefined) patch.subject = body.subject;
      if (body.dueDate !== undefined) patch.dueDate = body.dueDate;
      if (body.dueTime !== undefined) patch.dueTime = body.dueTime;
      if (body.effortMin !== undefined) patch.effortMin = body.effortMin;
    }
    const result = homework.updateHomework(req.family.id, req.params.id, patch);
    if (result.error) return res.status(400).json({ error: result.error });
    // Only when it transitions INTO done (not on every edit, not on un-checking).
    if (prevStatus !== "done" && result.homework.status === "done") {
      postHomeworkChat(req, "done", result.homework);
    }
    res.json({ homework: result.homework });
  });

  app.delete("/api/homework/:id", requireAuth, requireFamily, (req, res) => {
    const role = userRole(req.user);
    const existing = homework.getById(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Homework item not found." });
    if (!homework.canAccess(req.user, role, req.family.id, existing)) {
      return res.status(403).json({ error: "You don't have access to this homework item." });
    }
    const result = homework.removeHomework(req.family.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });
};

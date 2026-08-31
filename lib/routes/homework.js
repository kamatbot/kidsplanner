"use strict";

module.exports = (app, deps) => {
  const { homework, actions, chat, store, notifications, requireAuth, requireFamily, userRole, kidIdForUser, friendlyDate } = deps;

  function homeworkWatchRecipients(req, item) {
    const recipients = [...(req.family.parentIds || [])];
    if (store && typeof store.listKidUserIdsForFamily === "function") {
      for (const userId of store.listKidUserIdsForFamily(req.family.id)) {
        const user = store.getUser(userId);
        if (user && user.data && user.data.kid && user.data.kid.kidId === item.kidId) recipients.push(userId);
      }
    }
    return [...new Set(recipients)];
  }

  function notifyWatchHomework(req, item) {
    if (!notifications || typeof notifications.notifyWatchHomework !== "function") return;
    Promise.resolve(notifications.notifyWatchHomework({
      recipientUserIds: homeworkWatchRecipients(req, item),
      actorUserId: req.user.id,
      familyId: req.family.id,
      homework: item,
    })).catch(() => {});
  }

  function syncLinkedAction(req, item) {
    if (!actions || typeof actions.getBySource !== "function" || typeof actions.updateAction !== "function") return;
    if (!item || item.status !== "done") return;
    const action = actions.getBySource(req.family.id, "homework", item.id);
    if (!action || action.status === "done") return;
    actions.updateAction(req.family.id, action.id, { status: "done" });
  }

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

  // Read-only kid-facing integration point: the Homework detail UI can call
  // this endpoint to render a timer/date suggestion. It deliberately does not
  // call events/actions/chat or write homework, so a kid does not need parent
  // confirmation and a retry is idempotent. The next UI step is to present
  // `suggestion.date` + `suggestion.durationMin` as an optional local plan;
  // creating a calendar event, if ever desired, must remain an explicit user
  // action through the calendar API.
  app.get("/api/homework/:id/work-session-suggestion", requireAuth, requireFamily, (req, res) => {
    if (res.set) res.set("Cache-Control", "no-store");
    const role = userRole(req.user);
    const existing = homework.getById(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Homework item not found." });
    if (!homework.canAccess(req.user, role, req.family.id, existing)) {
      return res.status(403).json({ error: "You don't have access to this homework item." });
    }

    const result = homework.suggestWorkSession(req.family.id, req.params.id, {
      todayIso: req.query && req.query.today,
    });
    if (result.error) return res.status(404).json({ error: result.error });
    const body = { suggestion: result.suggestion };
    if (result.reason) body.reason = result.reason;
    res.json(body);
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
      moodleIdentity: role === "kid" ? undefined : body.moodleIdentity,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    postHomeworkChat(req, "added", result.homework);
    notifyWatchHomework(req, result.homework);
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
    if (req.watchAuth && Object.keys(body).some((field) => field !== "status")) {
      return res.status(403).json({ error: "Watch credentials can only update homework status." });
    }
    if (body.moodleIdentity !== undefined) {
      if (role === "kid") {
        return res.status(403).json({ error: "Only a parent can link Moodle homework identity." });
      }
      if (Object.keys(body).some((field) => field !== "moodleIdentity")) {
        return res.status(400).json({ error: "Moodle identity must be linked in a separate update." });
      }
      const linked = homework.setMoodleIdentity(req.family.id, req.params.id, body.moodleIdentity);
      if (linked.error) return res.status(400).json({ error: linked.error });
      return res.json({ homework: linked.homework, completionSync: linked.completionSync });
    }
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
    syncLinkedAction(req, result.homework);
    notifyWatchHomework(req, result.homework);
    const response = { homework: result.homework };
    if (result.completionSync) response.completionSync = result.completionSync;
    res.json(response);
  });

  // A checklist step is a safe, replayable Watch action when the desired
  // state is explicit. Keep it separate from the generic homework PATCH so a
  // paired Watch never gains authority to replace checklist text or rewrite
  // assignment details. Replaying `{ done: true }` after a timeout remains
  // idempotent, unlike a blind toggle.
  app.patch("/api/homework/:id/checklist/:index", requireAuth, requireFamily, (req, res) => {
    const role = userRole(req.user);
    const existing = homework.getById(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Homework item not found." });
    if (!homework.canAccess(req.user, role, req.family.id, existing)) {
      return res.status(403).json({ error: "You don't have access to this homework item." });
    }

    const body = req.body || {};
    if (Object.keys(body).some((field) => field !== "done") || typeof body.done !== "boolean") {
      return res.status(400).json({ error: "A checklist step requires a boolean done value." });
    }

    const result = homework.toggleChecklistItem(
      req.family.id,
      req.params.id,
      req.params.index,
      body.done
    );
    if (result.error) return res.status(400).json({ error: result.error });
    notifyWatchHomework(req, result.homework);
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

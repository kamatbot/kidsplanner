"use strict";

module.exports = (app, deps) => {
  const { schoolAccount, moodleClient, family, homework, actions, requireAuth, requireParent, requireFamily, authLimiter } = deps;

  // A parent stores their school Moodle credentials (encrypted at rest — see
  // lib/school-account.js) so the app can log in server-side and import
  // HOMEWORK + TIMETABLE for a mapped child. All routes are parent-only
  // (requireParent) — kids never see or trigger a school-portal login using a
  // parent's credentials. Credentials are decrypted ONLY inside the connect/
  // import handlers below, held in memory for the duration of a single Moodle
  // request, and never logged or returned to the client.
  const SCHOOL_MOODLE_BASE_URL = process.env.SCHOOL_MOODLE_BASE_URL || "https://bangkok.learn.nae.school";
  const MOODLE_COMPLETION_ORIGIN = "https://bangkok.learn.nae.school";
  let configuredMoodleOrigin = null;
  try {
    configuredMoodleOrigin = new URL(SCHOOL_MOODLE_BASE_URL).origin;
  } catch (e) {
    // Invalid configuration is handled by the existing login path. It also
    // makes imported rows ineligible for reverse sync rather than assigning
    // an identity for an origin we cannot prove.
  }

  function moodleIdentityFor(userId, taskId) {
    if (configuredMoodleOrigin !== MOODLE_COMPLETION_ORIGIN) return null;
    if (typeof userId !== "string" || !/^\d{1,20}$/.test(userId)) return null;
    if (typeof taskId !== "string" || !/^\d{1,200}$/.test(taskId)) return null;
    return {
      origin: configuredMoodleOrigin,
      homeworkViewId: "2",
      userId,
      taskId,
    };
  }

  function hasMoodleIdentity(item, identity) {
    const stored = item && item.moodleIdentity;
    return !!stored
      && stored.origin === identity.origin
      && stored.homeworkViewId === identity.homeworkViewId
      && stored.userId === identity.userId
      && stored.taskId === identity.taskId;
  }

  function validCompletionRequestId(value) {
    return typeof value === "string" && value.length <= 128 && /^mcr_[A-Za-z0-9_-]+$/.test(value);
  }

  app.get("/api/school/status", requireAuth, requireParent, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({
      connected: schoolAccount.hasAccount(req.family.id),
      encryptionAvailable: schoolAccount.encryptionAvailable(),
      kidMappings: schoolAccount.listKidMappings(req.family.id),
    });
  });

  app.get("/api/school/completions/pending", requireAuth, requireParent, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(homework.listPendingMoodleCompletions(req.family.id, { limit: 50 }));
  });

  app.post("/api/school/completions/claim", requireAuth, requireParent, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    const body = req.body;
    const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
    const requestId = keys.length === 1 && keys[0] === "requestId" ? body.requestId : null;
    if (!validCompletionRequestId(requestId)) {
      return res.status(400).json({ error: "Invalid completion claim." });
    }
    res.json(homework.claimMoodleCompletion(req.family.id, requestId));
  });

  app.post("/api/school/completions/ack", requireAuth, requireParent, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    const body = req.body;
    const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
    const requestIds = keys.length === 1 && keys[0] === "requestIds" ? body.requestIds : null;
    const valid = Array.isArray(requestIds)
      && requestIds.length <= 100
      && requestIds.every(validCompletionRequestId)
      && new Set(requestIds).size === requestIds.length;
    if (!valid) return res.status(400).json({ error: "Invalid completion acknowledgement." });
    res.json(homework.acknowledgeMoodleCompletions(req.family.id, requestIds));
  });

  app.post("/api/school/connect", requireAuth, requireParent, requireFamily, authLimiter, async (req, res) => {
    if (!schoolAccount.encryptionAvailable()) {
      return res.status(503).json({ error: "School account connection is not available (encryption is not configured on this server)." });
    }
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username and password are required." });
    let result;
    try {
      result = await moodleClient.login(SCHOOL_MOODLE_BASE_URL, username, password);
    } catch (e) {
      // Never include e.message verbatim in case it echoes request internals —
      // log only a generic marker, never credentials (they're not in scope
      // here anyway — moodleClient.login never logs them either).
      console.error("[school] connect: unexpected login error");
      return res.status(502).json({ error: "Could not reach the school portal. Please try again later.", reason: "unreachable" });
    }
    if (!result.ok) {
      const status = result.reason === "unreachable" ? 502 : 400;
      return res.status(status).json({ error: result.error, reason: result.reason });
    }
    const saved = schoolAccount.saveCredentials(req.family.id, req.user.id, { username, password });
    if (!saved.ok) return res.status(503).json({ error: saved.error });
    res.json({ ok: true });
  });

  app.post("/api/school/map", requireAuth, requireParent, requireFamily, (req, res) => {
    const { kidId, moodleUserId } = req.body || {};
    if (!kidId || !family.kidBelongsToFamily(req.family.id, kidId)) {
      return res.status(400).json({ error: "Kid not found in this family." });
    }
    const result = schoolAccount.setMoodleUserId(req.family.id, kidId, moodleUserId);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, kidId: result.kidId, moodleUserId: result.moodleUserId });
  });

  app.post("/api/school/import", requireAuth, requireParent, requireFamily, async (req, res) => {
    if (!schoolAccount.encryptionAvailable()) {
      return res.status(503).json({ error: "School account connection is not available (encryption is not configured on this server)." });
    }
    const kidId = req.body && req.body.kidId;
    if (!kidId || !family.kidBelongsToFamily(req.family.id, kidId)) {
      return res.status(400).json({ error: "Kid not found in this family." });
    }
    const moodleUserId = schoolAccount.getMoodleUserId(req.family.id, kidId);
    if (!moodleUserId) return res.status(400).json({ error: "Set this child's Moodle user id first." });

    // Decrypt credentials ONLY here, transiently, for this one request. Never
    // logged, never persisted again, never included in the response.
    const creds = schoolAccount.getCredentials(req.family.id);
    if (!creds) return res.status(400).json({ error: "No school account connected yet." });

    let session;
    try {
      const loginResult = await moodleClient.login(SCHOOL_MOODLE_BASE_URL, creds.username, creds.password);
      if (!loginResult.ok) {
        const status = loginResult.reason === "unreachable" ? 502 : 400;
        return res.status(status).json({ error: loginResult.error, reason: loginResult.reason });
      }
      session = loginResult.session;
    } catch (e) {
      console.error("[school] import: unexpected login error");
      return res.status(502).json({ error: "Could not reach the school portal. Please try again later." });
    } finally {
      // Drop any reference to the plaintext credentials as soon as we're done
      // with the login call — nothing below this point should need them again.
      creds.password = null;
    }

    try {
      const [hw, tt] = await Promise.all([
        moodleClient.fetchHomework(session, moodleUserId),
        moodleClient.fetchTimetable(session, moodleUserId),
      ]);
      res.json({ homework: hw, timetable: tt });
    } catch (e) {
      console.error("[school] import: fetch error:", e.reason || e.message);
      res.status(502).json({ error: "Could not fetch homework/timetable from the school portal right now. Please try again." });
    }
  });

  app.post("/api/school/import/confirm", requireAuth, requireParent, requireFamily, (req, res) => {
    const { kidId, homework: hwList, timetable: ttList } = req.body || {};
    if (!kidId || !family.kidBelongsToFamily(req.family.id, kidId)) {
      return res.status(400).json({ error: "Kid not found in this family." });
    }
    const items = Array.isArray(hwList) ? hwList : [];
    const mappedMoodleUserId = schoolAccount.getMoodleUserId(req.family.id, kidId);
    let created = 0;
    let skipped = 0;
    for (const raw of items) {
      if (!raw || raw.completed) { skipped++; continue; } // import only non-completed homework by default
      const title = String(raw.title || "").trim();
      const dueDate = raw.dueDate;
      if (!title || !dueDate) { skipped++; continue; }
      const identity = moodleIdentityFor(mappedMoodleUserId, raw.moodleTaskId);
      const existingItems = homework.listForFamily(req.family.id, { kidId });
      if (identity) {
        // Exact task identity is the primary key. Same-title Moodle tasks are
        // distinct, while a repeated import of one task remains idempotent.
        const exact = existingItems.find(
          (h) => h.source === "school-portal" && hasMoodleIdentity(h, identity)
        );
        if (exact) { skipped++; continue; }

        // Adopt a legacy title/date row only when the match is unambiguous.
        // setMoodleIdentity owns sanitization, sourceUid derivation, and the
        // already-done enqueue transition.
        const legacyMatches = existingItems.filter(
          (h) => h.source === "school-portal"
            && !h.moodleIdentity
            && h.title === title
            && h.dueDate === dueDate
        );
        if (legacyMatches.length === 1) {
          const adopted = homework.setMoodleIdentity(req.family.id, legacyMatches[0].id, identity);
          if (!adopted.error) { skipped++; continue; }
        }
      } else {
        // Identity-less rows retain the original title/date compatibility
        // behavior and deliberately remain ineligible for reverse sync.
        const legacyDuplicate = existingItems.find(
          (h) => h.source === "school-portal" && h.title === title && h.dueDate === dueDate
        );
        if (legacyDuplicate) { skipped++; continue; }
      }
      const result = homework.addHomework(req.family.id, {
        kidId,
        title,
        subject: raw.subject || "",
        dueDate,
        source: "school-portal",
        moodleIdentity: identity,
        notes: raw.setDate ? `Set ${raw.setDate}` : "",
      });
      if (!result.error) created++;
      else skipped++;
    }
    // The canonical Moodle homework rows are the source of truth for Today
    // actions. Project the complete family set after confirm so repeated
    // confirms are idempotent and existing action lifecycle/notes/edits are
    // preserved by the model-level upsert.
    if (actions && typeof actions.projectMoodleAssignments === "function") {
      actions.projectMoodleAssignments(
        req.family.id,
        homework.listForFamily(req.family.id).filter((item) => item.source === "school-portal")
      );
    }
    // Timetable entries are calendar events the client stores locally
    // (localStorage `fam_events`, see public/js/app.js getEvents/saveEvents) —
    // return the parsed timetable back to the client verbatim so it can build
    // {id,userId,kidId,title,date,time,endTime,category:'school',notes} rows
    // and persist them client-side, same as every other calendar entry.
    const timetable = Array.isArray(ttList) ? ttList : [];
    res.json({ ok: true, homeworkCreated: created, homeworkSkipped: skipped, timetable });
  });

  app.post("/api/school/disconnect", requireAuth, requireParent, requireFamily, (req, res) => {
    const result = schoolAccount.deleteAccount(req.family.id);
    res.json({ ok: true, deleted: result.deleted });
  });
};

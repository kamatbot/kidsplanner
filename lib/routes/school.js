"use strict";

module.exports = (app, deps) => {
  const { schoolAccount, moodleClient, family, homework, requireAuth, requireParent, requireFamily, authLimiter } = deps;

  // A parent stores their school Moodle credentials (encrypted at rest — see
  // lib/school-account.js) so the app can log in server-side and import
  // HOMEWORK + TIMETABLE for a mapped child. All routes are parent-only
  // (requireParent) — kids never see or trigger a school-portal login using a
  // parent's credentials. Credentials are decrypted ONLY inside the connect/
  // import handlers below, held in memory for the duration of a single Moodle
  // request, and never logged or returned to the client.
  const SCHOOL_MOODLE_BASE_URL = process.env.SCHOOL_MOODLE_BASE_URL || "https://bangkok.learn.nae.school";

  app.get("/api/school/status", requireAuth, requireParent, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({
      connected: schoolAccount.hasAccount(req.family.id),
      encryptionAvailable: schoolAccount.encryptionAvailable(),
      kidMappings: schoolAccount.listKidMappings(req.family.id),
    });
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
    let created = 0;
    let skipped = 0;
    for (const raw of items) {
      if (!raw || raw.completed) { skipped++; continue; } // import only non-completed homework by default
      const title = String(raw.title || "").trim();
      const dueDate = raw.dueDate;
      if (!title || !dueDate) { skipped++; continue; }
      // Dedup by a stable key: same kid + same title + same due date + source
      // "school-portal" is treated as "already imported" — addHomework has no
      // native dedup, so check existing items first.
      const existing = homework.listForFamily(req.family.id, { kidId }).find(
        (h) => h.source === "school-portal" && h.title === title && h.dueDate === dueDate
      );
      if (existing) { skipped++; continue; }
      const result = homework.addHomework(req.family.id, {
        kidId,
        title,
        subject: raw.subject || "",
        dueDate,
        source: "school-portal",
        notes: raw.setDate ? `Set ${raw.setDate}` : "",
      });
      if (!result.error) created++;
      else skipped++;
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

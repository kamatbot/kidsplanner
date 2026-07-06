"use strict";

module.exports = (app, deps) => {
  const { notes, wordbank, brainteaser, family, requireAuth, requireFamily, userRole, kidIdForUser } = deps;

  // ===================== NOTES (enrichment) =====================
  // A running family/kid journal. A kid session only ever sees/edits their OWN
  // notes (authorId derived server-side from req.user, never trusted from the
  // body); a parent sees the whole family's notes and may filter by
  // ?authorId=. Only the author may PATCH/DELETE their own note — see
  // lib/notes.js canAccess().
  app.get("/api/notes", requireAuth, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    const role = userRole(req.user);
    let authorId = req.query.authorId ? String(req.query.authorId) : null;
    if (role === "kid") {
      // A kid can never read a sibling's notes, regardless of ?authorId=.
      authorId = kidIdForUser(req);
    }
    const items = notes.listNotes(req.family.id, { authorId, from: req.query.from, to: req.query.to });
    res.json({ notes: items });
  });

  app.post("/api/notes", requireAuth, requireFamily, (req, res) => {
    const role = userRole(req.user);
    const body = req.body || {};
    const authorType = role === "kid" ? "kid" : "parent";
    const authorId = role === "kid" ? kidIdForUser(req) : req.user.id;
    if (role === "kid" && !authorId) return res.status(403).json({ error: "No kid profile linked to this session." });
    const result = notes.addNote(req.family.id, {
      authorType,
      authorId,
      date: body.date,
      body: body.body,
      source: body.source,
      ref: body.ref,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ note: result.note });
  });

  app.patch("/api/notes/:id", requireAuth, requireFamily, (req, res) => {
    const existing = notes.getById(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Note not found." });
    if (!notes.canAccess(existing, req.user)) {
      return res.status(403).json({ error: "You don't have access to this note." });
    }
    const result = notes.updateNote(req.family.id, req.params.id, { body: (req.body || {}).body });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ note: result.note });
  });

  app.delete("/api/notes/:id", requireAuth, requireFamily, (req, res) => {
    const existing = notes.getById(req.family.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Note not found." });
    if (!notes.canAccess(existing, req.user)) {
      return res.status(403).json({ error: "You don't have access to this note." });
    }
    const result = notes.removeNote(req.family.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  // ===================== WORD BANK (enrichment) =====================
  // Enrichment progress (word bank + brain teaser) is tracked per PLAYER. A kid
  // session always resolves to their own kidId. A parent can play too — they
  // track against their OWN user id — or pass ?kidId= to view/help a specific
  // child. Returns null only when a parent names a kid that isn't in the family.
  function enrichmentPlayerId(req, explicitKidId) {
    const role = userRole(req.user);
    if (role === "kid") return kidIdForUser(req);
    if (explicitKidId) {
      return family.kidBelongsToFamily(req.family.id, String(explicitKidId)) ? String(explicitKidId) : null;
    }
    return req.user.id; // parent plays as themselves
  }
  const NOT_IN_FAMILY = "That kid isn't in your family.";

  app.get("/api/wordbank", requireAuth, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    const playerId = enrichmentPlayerId(req, req.query.kidId);
    if (!playerId) return res.status(400).json({ error: NOT_IN_FAMILY });
    const result = wordbank.listWords(playerId);
    res.json({ words: result.words, stats: result.stats });
  });

  app.post("/api/wordbank/interact", requireAuth, requireFamily, (req, res) => {
    const body = req.body || {};
    const playerId = enrichmentPlayerId(req, body.kidId);
    if (!playerId) return res.status(400).json({ error: NOT_IN_FAMILY });
    const result = wordbank.interact(playerId, { word: body.word, correct: !!body.correct });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ entry: result.entry });
  });

  app.post("/api/wordbank/placement", requireAuth, requireFamily, (req, res) => {
    const body = req.body || {};
    const playerId = enrichmentPlayerId(req, body.kidId);
    if (!playerId) return res.status(400).json({ error: NOT_IN_FAMILY });
    const result = wordbank.placement(playerId, { known: body.known });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true, stats: result.stats });
  });

  app.get("/api/wordbank/quiz", requireAuth, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    const playerId = enrichmentPlayerId(req, req.query.kidId);
    if (!playerId) return res.status(400).json({ error: NOT_IN_FAMILY });
    const result = wordbank.quiz(playerId, { n: req.query.n });
    res.json(result);
  });

  // ===================== BRAIN TEASER (enrichment) =====================
  // Daily quiz set per player. Parents can play too (tracked against their own
  // user id); a parent may pass kidId to play/track on a child's behalf.
  app.get("/api/brainteaser/today", requireAuth, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    const playerId = enrichmentPlayerId(req, req.query.kidId);
    if (!playerId) return res.status(400).json({ error: NOT_IN_FAMILY });
    const result = brainteaser.getToday(playerId);
    res.json(result);
  });

  app.post("/api/brainteaser/answer", requireAuth, requireFamily, (req, res) => {
    const body = req.body || {};
    const playerId = enrichmentPlayerId(req, body.kidId);
    if (!playerId) return res.status(400).json({ error: NOT_IN_FAMILY });
    const result = brainteaser.answer(playerId, { qid: body.qid, correct: !!body.correct });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });
};

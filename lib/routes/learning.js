"use strict";

const oidcProvider = require("../oidc-provider");
const pathOddsRoutes = require("./pathodds");

module.exports = (app, deps) => {
  const { notes, news, dailyPuzzles, wordbank, brainteaser, family, requireAuth, requireFamily, userRole, kidIdForUser } = deps;

  // PathOdds is deliberately mounted from this already-loaded route module so
  // the family app remains one process: FamETC owns identity/daily behavior,
  // while PathOdds owns the learner model and deep SAT work.
  oidcProvider.mount(app, deps);
  pathOddsRoutes.mount(app, deps);

  app.get("/api/news/recent", requireAuth, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json(await news.getRecentNews());
    } catch (error) {
      res.json({ items: [], maxAgeDays: 14 });
    }
  });

  app.get("/api/enrichment/puzzle/today", requireAuth, requireFamily, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const date = req.query && req.query.date;
    const parsedDate = dailyPuzzles.parseDate(date);
    let options;
    if (parsedDate && (parsedDate.getUTCDay() === 0 || parsedDate.getUTCDay() === 6)) {
      let newsItems = [];
      try {
        const recent = await news.getRecentNews();
        newsItems = recent && Array.isArray(recent.items) ? recent.items : [];
      } catch (error) {
        // News is enrichment only; the deterministic static crossword remains available.
      }
      options = { newsItems };
    }
    const result = dailyPuzzles.getDailyPuzzle(date, options);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

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
  function enrichmentPlayerId(req, explicitKidId) {
    const role = userRole(req.user);
    if (role === "kid") return kidIdForUser(req);
    if (explicitKidId) {
      return family.kidBelongsToFamily(req.family.id, String(explicitKidId)) ? String(explicitKidId) : null;
    }
    return req.user.id;
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

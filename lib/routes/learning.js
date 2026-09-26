"use strict";

const oidcProvider = require("../oidc-provider");
const pathOddsRoutes = require("./pathodds");
const vocabulary = require("../vocabulary-challenges");
const notificationOutbox = require("../notification-outbox");

function newsCard(note) {
  if (note.source !== "news" || note.ref?.kind !== "news") return null;
  // Both shipped clients persist headline, summary and URL in this format.
  const lines = String(note.ref.context || "").trim().split(/\r?\n/);
  const title = lines[0]?.trim();
  const link = lines.at(-1)?.trim();
  try {
    const url = new URL(link);
    if (!title || !link || link.length > 2048 || /[\u0000-\u0020\u007f]/.test(link)
        || url.protocol !== "https:" || url.username || url.password) return null;
    return { type: "news", id: note.id, title: title.slice(0, 300), url: url.href, source: url.hostname };
  } catch (_) { return null; }
}

module.exports = (app, deps) => {
  const { notes, news, chat, store, dailyPuzzles, wordbank, brainteaser, family, requireAuth, requireFamily, userRole, kidIdForUser } = deps;

  function shareNewsReflection(payload, recovering = false) {
    const fam = family.getFamily(payload.familyId);
    const note = notes.getById(payload.familyId, payload.noteId);
    const actor = store.getUser(payload.senderUserId);
    // A removed author or deleted note must not create a later family post.
    const stillMember = actor && (payload.senderType === "kid"
      ? family.familyForKidUser(actor)?.id === fam?.id
      : fam?.parentIds.includes(actor.id));
    if (!fam || !note || note.source !== "news" || !stillMember) return false;
    const result = chat.sendMessage(fam.id, {
      senderType: payload.senderType, senderId: payload.senderId, postedByUserId: actor.id,
      text: payload.text, card: payload.card, clientMessageId: `news_${note.id}`,
    });
    if (result.error) throw new Error("News chat share failed");
    if (result.message.deleted) return false;
    if (!result.existing || recovering || notificationOutbox.hasPending("news_reflection_share", note.id)) {
      notificationOutbox.enqueue("chat_message", {
        familyId: fam.id, familyParentIds: payload.familyParentIds, familyKidUserIds: payload.familyKidUserIds,
        senderUserId: actor.id, senderName: actor.data?.profile?.name || "Family chat",
        text: result.message.text, messageId: result.message.id,
      }, { dedupeKey: result.message.id });
    }
    // A client retry can succeed before the deferred share's backoff expires.
    // Retire that recovery only after the replacement push intent is durable;
    // otherwise its later attempt could recreate an already-delivered push.
    notificationOutbox.retire("news_reflection_share", note.id);
    return true;
  }
  notificationOutbox.configure({ news_reflection_share: (payload) => shareNewsReflection(payload, true) });

  // PathOdds is deliberately mounted from this already-loaded route module so
  // the family app remains one process: FamETC owns identity/daily behavior,
  // while PathOdds owns the learner model and deep SAT work.
  oidcProvider.mount(app, deps);
  pathOddsRoutes.mount(app, deps);

  app.get("/api/news/recent", requireAuth, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const result = await news.getDailyNews(req.query && req.query.date);
      if (result.error) return res.status(400).json({ error: result.error });
      res.json(result);
    } catch (error) {
      res.json({ items: [], maxAgeDays: 14 });
    }
  });

  app.get("/api/enrichment/vocabulary/today", requireAuth, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    const result = vocabulary.getDailyVocabulary(req.query && req.query.date);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  app.get("/api/enrichment/puzzle/today", requireAuth, requireFamily, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const date = req.query && req.query.date;
    const parsedDate = dailyPuzzles.parseDate(date);
    // Older native releases only understand Sudoku/crossword payloads.
    const weekly = req.query && req.query.schedule === "weekly";
    const options = { schedule: weekly ? "weekly" : "legacy" };
    const newsDays = weekly && date >= "2026-09-21" ? [0, 6] : [2, 4];
    if (parsedDate && newsDays.includes(parsedDate.getUTCDay())) {
      let newsItems = [];
      try {
        const recent = await news.getRecentNews();
        newsItems = recent && Array.isArray(recent.items) ? recent.items : [];
      } catch (error) {
        // News is enrichment only; the deterministic static crossword remains available.
      }
      options.newsItems = newsItems;
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
    let chatShared;
    if (result.note.source === "news") {
      chatShared = false;
      const card = newsCard(result.note);
      if (card) {
        const payload = {
          familyId: req.family.id, noteId: result.note.id,
          familyParentIds: [...req.family.parentIds], familyKidUserIds: store.listKidUserIdsForFamily(req.family.id),
          senderUserId: req.user.id, senderType: authorType, senderId: authorId,
          text: result.note.body, card,
        };
        try { chatShared = shareNewsReflection(payload); }
        catch (_) {
          // Saving a reflection remains successful when chat is unavailable.
          // The encrypted outbox retries the share with the same message key.
          try { notificationOutbox.enqueue("news_reflection_share", payload, { dedupeKey: result.note.id }); }
          catch (_) { console.error("[notes] news share retry could not be queued"); }
        }
      }
    }
    res.json({ note: result.note, ...(chatShared !== undefined ? { chatShared } : {}) });
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

"use strict";
const corner = require('../my-corner');
module.exports = (app, { requireAuth, requireFamily, userRole, kidIdForUser, family }) => {
  function child(req, res, next) {
    res.set('Cache-Control', 'no-store');
    const kidId = kidIdForUser(req);
    const expectedAccount = req.get('X-Fam-Corner-Account');
    if (expectedAccount && expectedAccount !== req.user.id) return res.status(403).json({ error: 'The signed-in account changed. Reopen My Corner.' });
    if (req.watchAuth || userRole(req.user) !== 'kid' || !kidId
        || req.user.data.kid.familyId !== req.family.id || !family.kidBelongsToFamily(req.family.id, kidId)) {
      return res.status(403).json({ error: 'My Corner is only available to the signed-in child.' });
    }
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'My Corner does not accept an owner or query parameters.' });
    req.cornerKidId = kidId;
    next();
  }
  function handle(write) { return (req, res) => {
    try {
      res.json(write ? corner.save(req.family.id, req.cornerKidId, req.body) : corner.read(req.family.id, req.cornerKidId));
    } catch (error) {
      res.status(error.status || 503).json({ error: error.status ? error.message : 'My Corner could not load or save. Please retry.' });
    }
  }; }
  app.get('/api/my-corner', requireAuth, requireFamily, child, handle(false));
  app.put('/api/my-corner', requireAuth, requireFamily, child, handle(true));
};

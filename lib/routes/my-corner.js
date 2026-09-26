"use strict";
const corner = require('../my-corner');
module.exports = (app, { requireAuth, requireFamily, userRole, kidIdForUser, family }) => {
  function owner(req, res, next) {
    res.set('Cache-Control', 'no-store');
    const kidId = kidIdForUser(req);
    const expectedAccount = req.get('X-Fam-Corner-Account');
    if (expectedAccount && expectedAccount !== req.user.id) return res.status(403).json({ error: 'The signed-in account changed. Reopen My Corner.' });
    const expectedFamily = req.get('X-Fam-Corner-Family');
    if (expectedFamily && expectedFamily !== req.family.id) return res.status(403).json({ error: 'Your family changed. Reopen My Corner.' });
    if (req.watchAuth) return res.status(403).json({ error: 'Open My Corner in the app or website.' });
    const role = userRole(req.user);
    const expectedRole = req.get('X-Fam-Corner-Role');
    if (expectedRole && expectedRole !== role) return res.status(403).json({ error: 'Your account role changed. Reopen My Corner.' });
    if (role === 'kid' && kidId && req.user.data.kid.familyId === req.family.id
        && family.kidBelongsToFamily(req.family.id, kidId)) req.cornerOwnerId = kidId;
    else if (role === 'parent' && req.family.parentIds.includes(req.user.id)) req.cornerOwnerId = `parent:${req.user.id}`;
    else return res.status(403).json({ error: 'My Corner requires a current family member.' });
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'My Corner does not accept an owner or query parameters.' });
    next();
  }
  function handle(write) { return (req, res) => {
    try {
      res.json(write ? corner.save(req.family.id, req.cornerOwnerId, req.body) : corner.read(req.family.id, req.cornerOwnerId));
    } catch (error) {
      res.status(error.status || 503).json({ error: error.status ? error.message : 'My Corner could not load or save. Please retry.' });
    }
  }; }
  app.get('/api/my-corner', requireAuth, requireFamily, owner, handle(false));
  app.put('/api/my-corner', requireAuth, requireFamily, owner, handle(true));
};

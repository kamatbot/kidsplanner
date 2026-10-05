"use strict";

module.exports = (app, deps) => {
  const {
    requireAuth,
    requireFamily,
    requireHub,
    userRole,
    kidIdForUser
  } = deps;
  const support = deps.studentSupport || require('../student-support');
  function handle(write) {
    return (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const role = userRole(req.user);
        if (!['kid', 'parent'].includes(role) || (req.watchAuth && role !== 'kid')) return res.status(403).json({
          error: 'Student support is unavailable for this account.'
        });
        const kidId = role === 'kid' ? kidIdForUser(req) : (write ? req.body?.kidId : req.query.kidId);
        if (!kidId || !(req.family.kids || []).some(k => k.id === kidId)) return res.status(404).json({
          error: 'Child not found.'
        });
        // Child writes must name their own scope so queued work cannot silently cross accounts.
        if (write && req.body?.kidId !== kidId) return res.status(403).json({
          error: 'Child scope changed.'
        });
        const result = write ? support.command(req.family.id, kidId, {
          userId: req.user.id,
          parent: role === 'parent',
          watch: !!req.watchAuth
        }, req.body) : support.getSnapshot(req.family.id, kidId);
        res.json({
          support: result
        });
      } catch (e) {
        if (e.status) return res.status(e.status).json({
          error: e.message
        });
        throw e;
      }
    };
  }
  // Resolve bearer identity before applying the hub gate as well as its global prefix gate.
  app.get('/api/student-support', requireAuth, requireFamily, requireHub, handle(false));
  app.post('/api/student-support/commands', requireAuth, requireFamily, requireHub, handle(true));
};

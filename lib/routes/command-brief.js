"use strict";
const commandBrief = require("../command-brief");

module.exports = (app, deps) => {
  const { requireAuth, requireFamily, userRole, kidIdForUser } = deps;

  app.get("/api/command/brief", requireAuth, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    const isParent = userRole(req.user) !== "kid";
    const kidId = isParent ? null : kidIdForUser(req);
    const brief = commandBrief.buildCommandBrief({
      family: req.family,
      user: req.user,
      isParent,
      kidId,
      now: new Date(),
    });
    res.json(brief);
  });
};

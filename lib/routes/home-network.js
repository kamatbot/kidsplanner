"use strict";
/**
 * Home Wi-Fi agent endpoints (lib/home-network.js). Parents pair and unpair
 * from Settings with their session; the agent (Canopy on the home network)
 * claims a one-time code, then authenticates with `Authorization: FamHome
 * <token>` — never a cookie, never a parent or kid session.
 */
module.exports = (app, deps) => {
  const { requireAuth, requireParent, requireFamily, authLimiter, rateLimit } = deps;
  const homeNetwork = deps.homeNetwork || require("../home-network");
  const claimLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: "Too many pairing attempts. Please wait a few minutes." });

  function send(res, result) {
    res.set("Cache-Control", "no-store");
    if (result && result.error) {
      return res.status(result.status || 400).json({ error: result.error, ...(result.code ? { code: result.code } : {}) });
    }
    return res.json(result);
  }

  function agent(req, res) {
    const m = /^FamHome\s+(\S{1,100})$/.exec((req.get && req.get("authorization")) || "");
    const ctx = m && homeNetwork.resolveToken(m[1]);
    if (ctx) return ctx;
    res.set("Cache-Control", "no-store");
    res.status(401).json({ error: "This home network isn't paired with Fam ETC. Pair it again.", code: "home_unpaired" });
    return null;
  }

  // ---------- parent ----------
  const parent = [requireAuth, requireParent, requireFamily];

  app.get("/api/home-network", ...parent, (req, res) => send(res, homeNetwork.status(req.family)));
  app.post("/api/home-network/pairing", ...parent, (req, res) => send(res, homeNetwork.createPairing(req.family, req.user.id)));
  app.delete("/api/home-network", ...parent, (req, res) => send(res, homeNetwork.unpair(req.family)));
  app.put("/api/home-network/settings", ...parent, (req, res) => send(res, homeNetwork.updateSettings(req.family, req.body)));
  app.get("/api/home-network/digest", ...parent, (req, res) => send(res, homeNetwork.getDigest(req.family)));
  app.post("/api/home-network/no-school", ...parent, (req, res) => send(res, homeNetwork.addNoSchoolDate(req.family, (req.body || {}).date)));
  app.delete("/api/home-network/no-school/:date", ...parent, (req, res) => send(res, homeNetwork.removeNoSchoolDate(req.family, req.params.date)));
  app.get("/api/home-network/alerts", ...parent, (req, res) => send(res, homeNetwork.getAlerts(req.family)));
  app.post("/api/home-network/alerts/dismiss", ...parent, (req, res) => send(res, homeNetwork.dismissAllAlerts(req.family)));
  app.post("/api/home-network/alerts/:alertId/dismiss", ...parent, (req, res) => send(res, homeNetwork.dismissAlert(req.family, req.params.alertId)));

  // ---------- agent ----------
  app.post("/api/home-network/claim", authLimiter, claimLimiter, (req, res) => {
    const b = req.body || {};
    send(res, homeNetwork.claim(b.code, b));
  });

  app.get("/api/home-network/policy", (req, res) => {
    const ctx = agent(req, res);
    if (!ctx) return;
    const body = homeNetwork.policy(ctx);
    res.set("Cache-Control", "no-store");
    res.set("ETag", body.etag);
    if (req.get("if-none-match") === body.etag) return res.status(304).end();
    return res.json(body);
  });

  app.post("/api/home-network/report", (req, res) => {
    const ctx = agent(req, res);
    if (ctx) send(res, homeNetwork.report(ctx, req.body));
  });
};

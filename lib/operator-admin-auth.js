"use strict";

const crypto = require("crypto");

function equalToken(provided, expected) {
  const left = Buffer.from(String(provided || ""), "utf8");
  const right = Buffer.from(String(expected || ""), "utf8");
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function createOperatorAdminGuard(options = {}) {
  const isProduction = options.isProduction === true;
  const configuredToken = options.token == null
    ? String(process.env.OPERATOR_ADMIN_TOKEN || "").trim()
    : String(options.token || "").trim();

  return function requireOperatorAdmin(req, res, next) {
    const provided = String(req.get("x-operator-admin-token") || "").trim();
    if (configuredToken && equalToken(provided, configuredToken)) return next();

    const ip = req.ip || "";
    const local = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
    if (!configuredToken && !isProduction && local) return next();

    res.set("Cache-Control", "no-store");
    return res.status(401).json({ error: "Operator administration is locked." });
  };
}

module.exports = { createOperatorAdminGuard };

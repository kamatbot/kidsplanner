"use strict";

const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const articles = require("../scheduled-articles");
const { preview } = require("../article-preview");
const COOKIE = "fam_article_editor";
const COOKIE_PATH = "/api/article-admin";
const TTL = 8 * 60 * 60 * 1000;
const digest = value => crypto.createHash("sha256").update(value).digest("hex");

function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  if (typeof password !== "string" || password.length < 14 || password.length > 256) throw new Error("Use a password between 14 and 256 characters.");
  return scrypt(password, salt, 32).then(key => `scrypt$${salt}$${key.toString("hex")}`);
}

function mount(app, deps, options = {}) {
  const configured = options.passwordHash ?? process.env.FAM_ARTICLE_ADMIN_PASSWORD_HASH ?? "";
  const parts = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(configured);
  const sessions = new Map();
  const now = options.now || Date.now;
  const sourcePreview = options.preview || preview;
  const secure = options.secure ?? (process.env.NODE_ENV === "production" || !!process.env.SESSION_SECRET);
  const cookieOptions = { httpOnly: true, secure, sameSite: "strict", path: COOKIE_PATH, maxAge: TTL };
  const loginLimiter = deps.rateLimit({ windowMs: 15 * 60000, max: 10, message: "Too many sign-in attempts. Try again in 15 minutes." });
  const editLimiter = deps.rateLimit({ windowMs: 60000, max: 30, message: "Please wait a moment before trying again." });
  let verifying = 0;

  function session(req) {
    for (const [key, value] of sessions) if (value.expires <= now()) sessions.delete(key);
    const token = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!parts || !token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return sessions.get(digest(token)) || null;
  }
  function origin(req, res, next) {
    const expected = secure ? new URL(deps.CANONICAL_HOST).origin : `${req.protocol}://${req.get("host")}`;
    if (req.get("origin") !== expected || !req.is("application/json")) return res.status(403).json({ error: "Open the editor on this site and try again." });
    next();
  }
  function requireEditor(req, res, next) {
    req.articleEditor = session(req);
    if (!req.articleEditor) return res.status(401).json({ error: "Sign in to the article editor." });
    next();
  }
  function csrf(req, res, next) {
    const supplied = req.get("x-csrf-token") || "";
    if (supplied !== req.articleEditor.csrfToken) return res.status(403).json({ error: "Reload the editor and try again." });
    next();
  }
  const state = req => ({ authenticated: !!session(req), configured: !!parts, today: articles.today(now()), timeZone: articles.TIME_ZONE,
    ...(session(req) ? { csrfToken: session(req).csrfToken } : {}) });
  const reply = (res, result) => res.status(result.error ? result.status || 400 : 200).json(result.error ? { error: result.error } : result);
  app.use(COOKIE_PATH, (_req, res, next) => { res.set("Cache-Control", "no-store"); res.set("X-Robots-Tag", "noindex, nofollow"); next(); });
  app.get(`${COOKIE_PATH}/session`, (req, res) => res.json(state(req)));
  app.post(`${COOKIE_PATH}/login`, origin, loginLimiter, async (req, res) => {
    if (!parts) return res.status(503).json({ error: "Article editor password has not been configured yet." });
    const password = req.body?.password;
    if (typeof password !== "string" || password.length > 256 || verifying >= 4) return res.status(401).json({ error: "Unable to sign in. Check the password and try again." });
    verifying++;
    try {
      const key = await scrypt(password, parts[1], 32);
      if (!crypto.timingSafeEqual(key, Buffer.from(parts[2], "hex"))) return res.status(401).json({ error: "Unable to sign in. Check the password and try again." });
      const previous = session(req);
      if (previous) sessions.delete(previous.key);
      if (sessions.size >= 200) sessions.delete(sessions.keys().next().value);
      const token = crypto.randomBytes(32).toString("hex");
      const keyId = digest(token);
      const entry = { key: keyId, csrfToken: crypto.randomBytes(32).toString("hex"), expires: now() + TTL };
      sessions.set(keyId, entry);
      res.cookie(COOKIE, token, cookieOptions);
      res.json({ authenticated: true, configured: true, csrfToken: entry.csrfToken, today: articles.today(now()), timeZone: articles.TIME_ZONE });
    } catch (_) { res.status(503).json({ error: "Unable to sign in right now. Try again shortly." }); }
    finally { verifying--; }
  });
  const write = [origin, requireEditor, csrf, editLimiter];
  app.post(`${COOKIE_PATH}/logout`, ...write, (req, res) => {
    sessions.delete(req.articleEditor.key);
    res.clearCookie(COOKIE, { httpOnly: true, secure, sameSite: "strict", path: COOKIE_PATH });
    res.json({ ok: true });
  });
  app.get(`${COOKIE_PATH}/articles`, requireEditor, (_req, res) => res.json({ articles: articles.list(), today: articles.today(now()), timeZone: articles.TIME_ZONE }));
  app.post(`${COOKIE_PATH}/preview`, ...write, async (req, res) => {
    try { res.json(await sourcePreview(req.body?.url)); }
    catch (_) { res.status(400).json({ error: "Could not preview this public HTTPS link. Check it, or enter a title and short description yourself." }); }
  });
  app.post(`${COOKIE_PATH}/articles`, ...write, (req, res) => reply(res, articles.save(req.body, null, now())));
  app.put(`${COOKIE_PATH}/articles/:id`, ...write, (req, res) => reply(res, articles.save(req.body, req.params.id, now())));
  app.delete(`${COOKIE_PATH}/articles/:id`, ...write, (req, res) => reply(res, articles.remove(req.params.id)));
}
module.exports = { mount, passwordHash };

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fam-editor-auth-"));
const express = require("express");
const { mount, passwordHash } = require("../lib/routes/article-admin");
const PASSWORD = "TestPhrase1"; // Eleven-character fixture; never the deployment password.
async function harness(t, configured = true) {
  const app = express(); app.use(express.json());
  let now = Date.parse("2026-10-04T12:00:00Z");
  const limits = [];
  mount(app, { CANONICAL_HOST: "https://www.fametc.com", rateLimit: options => { limits.push(options); return (_req, _res, next) => next(); } }, {
    passwordHash: configured ? await passwordHash(PASSWORD) : "", secure: false, now: () => now,
    preview: async url => ({ url, headline: "Preview", summary: "Excerpt", source: "nasa.gov" }),
  });
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "", csrf = "";
  async function call(route, method = "GET", body, overrides = {}) {
    const headers = { cookie, ...(method === "GET" ? {} : { origin: base, "content-type": "application/json", "x-csrf-token": csrf }), ...overrides };
    const response = await fetch(`${base}/api/article-admin${route}`, { method, headers, ...(method === "GET" ? {} : { body: JSON.stringify(body || {}) }) });
    const data = await response.json();
    return { status: response.status, data, headers: response.headers };
  }
  async function login() {
    const response = await call("/login", "POST", { password: PASSWORD });
    cookie = response.headers.get("set-cookie").split(";")[0]; csrf = response.data.csrfToken;
    return response;
  }
  return { call, login, advance: ms => { now += ms; }, limits };
}

test("password editor is separate from family auth, requires origin and CSRF, supports CRUD, revokes logout replay", async t => {
  const h = await harness(t);
  assert.equal((await h.call("/articles", "GET", null, { "x-operator-admin-token": "not-an-editor-session" })).status, 401);
  assert.equal((await h.call("/login", "POST", { password: "wrong" })).status, 401);
  assert.equal((await h.call("/login", "POST", { password: PASSWORD }, { origin: "https://evil.example" })).status, 403);
  const logged = await h.login(); assert.equal(logged.status, 200);
  assert.match(logged.headers.get("set-cookie"), /HttpOnly/); assert.match(logged.headers.get("set-cookie"), /SameSite=Strict/);
  assert.equal(logged.data.password, undefined);
  const body = { date: "2026-10-04", url: "https://www.nasa.gov/science", headline: "Shared science" };
  assert.equal((await h.call("/articles", "POST", body, { "x-csrf-token": "wrong" })).status, 403);
  assert.equal((await h.call("/articles", "POST", body, { origin: "https://evil.example" })).status, 403);
  const saved = await h.call("/articles", "POST", body); assert.equal(saved.status, 200);
  assert.equal((await h.call("/articles", "POST", body)).status, 409);
  const id = saved.data.article.id;
  assert.equal((await h.call(`/articles/${id}`, "PUT", { ...body, headline: "Edited title" })).data.article.headline, "Edited title");
  assert.equal((await h.call("/articles")).data.articles.length, 1);
  assert.equal((await h.call("/preview", "POST", { url: body.url })).data.headline, "Preview");
  assert.equal((await h.call(`/articles/${id}`, "DELETE")).status, 200);
  assert.equal((await h.call("/logout", "POST")).status, 200);
  // Harness intentionally keeps the copied cookie: logout must revoke it server-side.
  assert.equal((await h.call("/articles")).status, 401);
  assert.equal(h.limits[0].max, 10); assert.equal(h.limits[0].windowMs, 15 * 60000);
});

test("sessions expire and missing configuration never falls back to public/local access", async t => {
  const h = await harness(t); await h.login(); h.advance(8 * 3600000);
  assert.equal((await h.call("/articles")).status, 401);
  const disabled = await harness(t, false);
  assert.equal((await disabled.call("/session")).data.configured, false);
  assert.equal((await disabled.call("/login", "POST", { password: PASSWORD })).status, 503);
  assert.equal((await disabled.call("/articles")).status, 401);
});

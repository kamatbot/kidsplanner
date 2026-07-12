"use strict";
/*
 * POST /api/ai/parse (lib/routes/ai.js) — server-side proxy for the
 * schedule/homework AI-parse features, replacing a client-exposed
 * Anthropic key. Two layers, matching the codebase's established patterns:
 *  - auth gating is proven end-to-end by booting the real server and
 *    hitting it over HTTP with no session (notify-self.test.js / gifs.test.js
 *    boot pattern).
 *  - body validation (kind whitelist, size cap) is proven by mounting the
 *    route module directly with stub requireAuth/requireFamily and invoking
 *    the handler in isolation (calendar-routes.test.js harness pattern) —
 *    this never calls the real Anthropic API.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const http = require("http");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-"));
process.env.PORT = "0";
process.env.ANTHROPIC_API_KEY = "test-key-not-real";

const app = require("../server");
const server = app.server;

test.after(() => {
  server.close();
});

function withServer(fn) {
  if (server.listening) return fn(server.address().port);
  return new Promise((resolve, reject) => {
    server.once("listening", () => {
      Promise.resolve(fn(server.address().port)).then(resolve, reject);
    });
    server.once("error", reject);
  });
}

function request(port, opts, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, ...opts }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* no body */ }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test("POST /api/ai/parse: requires authentication (401 when not signed in)", async () => {
  await withServer(async (port) => {
    const res = await request(
      port,
      { method: "POST", path: "/api/ai/parse", headers: { "Content-Type": "application/json" } },
      { kind: "schedule", mediaType: "image/png", dataBase64: "abc" }
    );
    assert.equal(res.status, 401);
  });
});

// ---------- handler-level validation (no HTTP, no auth, no live API call) ----------
const aiRoutes = require("../lib/routes/ai");

function buildHarness() {
  const routes = {};
  const register = (method) => (p, ...handlers) => { routes[`${method} ${p}`] = handlers[handlers.length - 1]; };
  const stubApp = { get: register("GET"), post: register("POST") };
  aiRoutes(stubApp, {
    requireAuth: (req, res, next) => next(),
    requireFamily: (req, res, next) => next(),
  });
  return routes;
}

function call(handler, body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve(this); return this; },
    };
    handler({ body: body || {}, user: { id: "u1" } }, res);
  });
}

test("POST /api/ai/parse: rejects an unknown kind with 400", async () => {
  const routes = buildHarness();
  const res = await call(routes["POST /api/ai/parse"], { kind: "not-a-real-kind", mediaType: "image/png", dataBase64: "abc" });
  assert.equal(res.statusCode, 400);
});

test("POST /api/ai/parse: rejects a payload over the 8MB decoded cap", async () => {
  const routes = buildHarness();
  // ~11.2M base64 chars decodes to just over 8MB.
  const oversized = "A".repeat(11 * 1024 * 1024 + 500 * 1024);
  const res = await call(routes["POST /api/ai/parse"], { kind: "schedule", mediaType: "image/png", dataBase64: oversized });
  assert.ok(res.statusCode === 400 || res.statusCode === 413, `expected 400/413, got ${res.statusCode}`);
});

test("POST /api/ai/parse: rejects an unsupported media type with 400", async () => {
  const routes = buildHarness();
  const res = await call(routes["POST /api/ai/parse"], { kind: "schedule", mediaType: "image/bmp", dataBase64: "abc" });
  assert.equal(res.statusCode, 400);
});

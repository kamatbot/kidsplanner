"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const http = require("http");

// Isolate each test run in a throwaway data dir, and boot the real server on
// an OS-assigned ephemeral port (never touches the app's normal PORT/4000).
process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-test-"));
process.env.PORT = "0";
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.VAPID_SUBJECT;

const app = require("../server");
const server = app.server; // bound at require-time via PORT=0 (OS-assigned ephemeral port)

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

test("POST /api/notify/self: requires authentication (401 when not signed in)", async () => {
  await withServer(async (port) => {
    const res = await request(
      port,
      { method: "POST", path: "/api/notify/self", headers: { "Content-Type": "application/json" } },
      { title: "Hi", body: "there" }
    );
    assert.equal(res.status, 401);
  });
});

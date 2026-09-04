"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const Keygrip = require("keygrip");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-session-test-"));
process.env.PORT = "0";
process.env.SESSION_SECRET = "session-revocation-test-secret-please-change";
process.env.NODE_ENV = "test";

const store = require("../lib/store");
const app = require("../server");

function encodeSession(value) {
  // cookie-session@2.1.0 serializes JSON directly to standard base64.
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function signedCookie(session) {
  const value = encodeSession(session);
  const keys = new Keygrip([process.env.SESSION_SECRET]);
  const sig = keys.sign(`fam_sess=${value}`);
  return `fam_sess=${value}; fam_sess.sig=${sig}`;
}

test("logout invalidates a copied signed session cookie server-side", async (t) => {
  const server = app.server;
  t.after(() => server.close());

  const user = store.createUser("replay@example.com", "Replay Test");
  const copiedCookie = signedCookie({ uid: user.id, authGen: store.sessionGeneration(user) });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const before = await fetch(`${base}/api/me`, { headers: { Cookie: copiedCookie } });
  assert.equal(before.status, 200);

  const logout = await fetch(`${base}/api/logout`, {
    method: "POST",
    headers: { Cookie: copiedCookie, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(logout.status, 200);
  assert.equal(store.sessionGeneration(user.id), 1);

  // Replay the exact pre-logout cookie rather than accepting the clearing
  // Set-Cookie response. A purely client-side logout would still accept it.
  const replay = await fetch(`${base}/api/me`, { headers: { Cookie: copiedCookie } });
  assert.equal(replay.status, 401);
});

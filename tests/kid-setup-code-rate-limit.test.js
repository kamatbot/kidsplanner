"use strict";
/*
 * POST /api/kid/setup-code/claim is public, so it is throttled per IP with the
 * same rateLimit() pattern as the other kid-access routes (own, tighter cap:
 * RL_KID_SETUP_CLAIM_MAX). Separate file = separate server process = a limiter
 * no other test has touched.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-setup-rl-"));
process.env.PORT = "0";
process.env.NODE_ENV = "test";
process.env.RL_KID_SETUP_CLAIM_MAX = "5";

const store = require("../lib/store");
const family = require("../lib/family");
const kidAccess = require("../lib/kid-access");
const app = require("../server");
const server = app.server;

test("setup-code claims are rate limited per IP, valid codes included", async (t) => {
  t.after(() => server.close());
  if (!server.listening) await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const claim = (code) => fetch(`${base}/api/kid/setup-code/claim`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
  });

  const parent = store.createUser("rl@example.com", "Parent");
  const fam = family.createFamily(parent.id, "RL", { plan: "screen_time" });
  const kid = family.addKid(fam.id, parent.id, { name: "Mia" }).kid;
  const { code } = kidAccess.issueSetupCode(fam.id, kid.id);

  for (let i = 0; i < 5; i++) {
    const res = await claim("AAAAAA");
    assert.equal(res.status, 404, `attempt ${i + 1}`);
    assert.equal((await res.json()).code, "setup_code_invalid");
  }
  const limited = await claim("AAAAAA");
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("retry-after"));

  // Blind guessing cannot be outrun by luck: even the right code waits.
  const right = await claim(code);
  assert.equal(right.status, 429);
  assert.equal(kidAccess.setupStatus(fam.id, kid.id).codeActive, true, "the code was not consumed by a throttled request");
});

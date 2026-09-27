"use strict";
// A parent sets their own display name (early iOS sign-ups stored the family name there).
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const Keygrip = require("keygrip");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-own-name-test-"));
process.env.PORT = "0";
process.env.SESSION_SECRET = "own-name-test-secret-please-change";
process.env.NODE_ENV = "test";

const store = require("../lib/store");
const family = require("../lib/family");
const app = require("../server");

function cookieFor(user) {
  const value = Buffer.from(JSON.stringify({ uid: user.id, authGen: store.sessionGeneration(user) }), "utf8").toString("base64");
  const sig = new Keygrip([process.env.SESSION_SECRET]).sign(`fam_sess=${value}`);
  return `fam_sess=${value}; fam_sess.sig=${sig}`;
}

test("a parent can set their own name; kids and blank names cannot", async (t) => {
  const server = app.server;
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const patch = (cookie, name) => fetch(`${base}/api/me`, {
    method: "PATCH",
    headers: Object.assign({ "Content-Type": "application/json", Origin: base }, cookie ? { Cookie: cookie } : {}),
    body: JSON.stringify({ name }),
  });

  const parent = store.createUser("own-name@example.com", "Kamatsss");
  const fam = family.createFamily(parent.id, "Kamatsss");
  const { kid } = family.addKid(fam.id, parent.id, { name: "Arya" });
  const kidUser = store.findOrCreateKidUser(fam.id, kid.id, kid.name);

  assert.equal((await patch(null, "Mayur")).status, 401);
  assert.equal((await patch(cookieFor(kidUser), "Someone else")).status, 403, "kids cannot rename themselves");
  assert.equal((await patch(cookieFor(parent), "   ")).status, 400);

  const saved = await patch(cookieFor(parent), "  Mayur\u0007 Kamat  ");
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).user.name, "Mayur Kamat");
  const me = await (await fetch(`${base}/api/me`, { headers: { Cookie: cookieFor(parent) } })).json();
  assert.equal(me.user.name, "Mayur Kamat");
  assert.equal(family.getFamily(fam.id).name, "Kamatsss", "the family name is untouched");

  const long = await patch(cookieFor(parent), "x".repeat(80));
  assert.equal((await long.json()).user.name.length, 60);
});

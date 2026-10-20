"use strict";

// Exercise the real Express middleware boundary, not a mocked requireAuth.
// This file was authored offline; execute it locally before integration.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const Keygrip = require("keygrip");

process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fametc-display-boundary-"));
process.env.PORT = "0";
process.env.SESSION_SECRET = "display-boundary-test-secret-not-a-production-key";
process.env.NODE_ENV = "test";

const store = require("../lib/store");
const family = require("../lib/family");
const db = require("../lib/db");
const app = require("../server");

function cookieFor(user) {
  const session = { uid: user.id, authGen: store.sessionGeneration(user) };
  const value = Buffer.from(JSON.stringify(session), "utf8").toString("base64");
  const signature = new Keygrip([process.env.SESSION_SECRET]).sign(`fam_sess=${value}`);
  return `fam_sess=${value}; fam_sess.sig=${signature}`;
}

test("a household display cannot become a parent, switch families, or outlive revocation", async (t) => {
  const server = app.server;
  if (!server.listening) await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const parent = store.createUser("display-parent@example.test", "Display Parent");
  const fam = family.createFamily(parent.id, "Kitchen household", { plan: "full" });
  const { kid } = family.addKid(fam.id, parent.id, { name: "Jamie" });
  const stranger = store.createUser("other-display-parent@example.test", "Other Parent");
  family.createFamily(stranger.id, "Another household", { plan: "full" });
  const parentCookie = cookieFor(parent);

  async function request(route, { method = "GET", cookie, token, body } = {}) {
    return fetch(base + route, {
      method,
      redirect: "manual",
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  const started = await request("/api/displays/pairing", {
    method: "POST", cookie: parentCookie,
    body: { label: "Kitchen Portal", timeZone: "Asia/Bangkok", showHomework: true, showMeals: true },
  });
  assert.equal(started.status, 200);
  const pairing = (await started.json()).pairing;
  const claim = await request("/api/display/pair", {
    method: "POST", body: { code: pairing.code, model: "Portal test fixture" },
  });
  assert.equal(claim.status, 200);
  assert.match(claim.headers.get("cache-control") || "", /no-store/);
  const { token, device } = await claim.json();
  assert.match(token, /^fdp_/);
  assert.equal(claim.headers.get("set-cookie"), null, "pairing never creates a parent cookie");

  const contextResponse = await request("/api/display/context", { token });
  assert.equal(contextResponse.status, 200);
  const context = await contextResponse.json();
  assert.equal(context.schemaVersion, 1);
  assert.equal(context.family.name, "Kitchen household");
  assert.equal(context.members.some((member) => member.id === kid.id), true);
  assert.equal(context.days.length, 7);
  assert.equal(JSON.stringify(context).includes(fam.inviteCode), false);
  assert.equal(context.family.parentIds, undefined);

  for (const route of ["/api/me", "/api/family", "/api/chat/messages", "/api/displays"]) {
    const response = await request(route, { token });
    assert.equal(response.status, 401, `${route} must not accept a display as a user`);
  }
  const mintAnother = await request("/api/displays/pairing", {
    method: "POST", token, body: { label: "Escalation attempt" },
  });
  assert.equal(mintAnother.status, 401);
  const cookieOnly = await request("/api/display/context", { cookie: parentCookie });
  assert.equal(cookieOnly.status, 401, "parent cookies do not stand in for a paired display");

  const mixedIdentity = await request("/api/display/context", { token, cookie: cookieFor(stranger) });
  assert.equal(mixedIdentity.status, 200);
  assert.equal((await mixedIdentity.json()).family.name, "Kitchen household", "display scope comes from its credential");
  const foreignRevoke = await request(`/api/displays/${device.id}/revoke`, {
    method: "POST", cookie: cookieFor(stranger), body: {},
  });
  assert.equal(foreignRevoke.status, 404);

  // The device route must check the family plan itself: the global cookie-
  // based hub gate has no user session when a Portal makes this request.
  family.getFamily(fam.id).plan = "screen_time";
  const downgraded = await request("/api/display/context", { token });
  assert.equal(downgraded.status, 403);
  assert.equal((await downgraded.json()).code, "upgrade_required");
  const gatedParent = await request("/api/displays", { cookie: parentCookie });
  assert.equal(gatedParent.status, 403);
  assert.match(gatedParent.headers.get("cache-control") || "", /no-store/,
    "even an earlier plan gate must not leave display responses cacheable");
  family.getFamily(fam.id).plan = "full";
  db.persist();

  const revoke = await request(`/api/displays/${device.id}/revoke`, {
    method: "POST", cookie: parentCookie, body: {},
  });
  assert.equal(revoke.status, 200);
  assert.equal((await request("/api/display/context", { token })).status, 401);
  const replay = await request("/api/display/pair", { method: "POST", body: { code: pairing.code } });
  assert.equal(replay.status, 400, "revocation does not make the old pairing code reusable");
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function signupOptionsHandler() {
  const routes = {};
  const app = {
    post(route, ...handlers) { routes[`POST ${route}`] = handlers.at(-1); },
    get() {},
    patch() {},
    delete() {},
  };
  require("../lib/routes/auth")(app, {
    currentUser: () => null,
    rpForRequest: () => ({ rpID: "example.test", rpName: "Fam ETC" }),
    crypto: { randomBytes: () => Buffer.from("123456789") },
    generateRegistrationOptions: async (options) => ({ challenge: "challenge", options }),
  });
  return routes["POST /api/webauthn/signup/options"];
}

async function call(body, existingSignup = { challenge: "old" }) {
  const req = { body, session: { waSignup: existingSignup } };
  const response = { statusCode: 200, body: null };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(value) { response.body = value; return this; },
  };
  await signupOptionsHandler()(req, res);
  return { req, response };
}

test("signup rejects a missing or incorrect invite code without creating a passkey challenge", async () => {
  for (const body of [{ name: "Parent" }, { name: "Parent", inviteCode: "wrong" }]) {
    const { req, response } = await call(body);
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.body, { error: "That invite code isn't valid. Check it and try again." });
    assert.equal(req.session.waSignup, undefined);
  }
});

test("signup accepts the configured invite code case-insensitively and stores only pending registration state", async () => {
  const { req, response } = await call({ name: " Parent ", inviteCode: " FITODDS " }, undefined);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.challenge, "challenge");
  assert.equal(req.session.waSignup.challenge, "challenge");
  assert.equal(req.session.waSignup.name, "Parent");
  assert.equal(req.session.waSignup.inviteValidated, true);
  assert.equal("inviteCode" in req.session.waSignup, false);
});

test("signup verification rejects a pending challenge created before invite enforcement", async () => {
  const routes = {};
  const app = {
    post(route, ...handlers) { routes[`POST ${route}`] = handlers.at(-1); },
    get() {},
    patch() {},
    delete() {},
  };
  let verificationCalled = false;
  require("../lib/routes/auth")(app, {
    verifyRegistrationResponse: async () => { verificationCalled = true; return { verified: true }; },
  });
  const req = { body: {}, session: { waSignup: { challenge: "legacy", userId: "u_old", name: "Parent" } } };
  const response = { statusCode: 200, body: null };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(value) { response.body = value; return this; },
  };
  await routes["POST /api/webauthn/signup/verify"](req, res);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "Sign-up session expired — start again." });
  assert.equal(verificationCalled, false);
  assert.equal(req.session.waSignup, undefined);
});

test("signup page and client require and submit the invite code", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "public/signup.html"), "utf8");
  const client = fs.readFileSync(path.join(root, "public/js/auth.js"), "utf8");
  assert.match(html, /id="signup-invite-code"[^>]*required/);
  assert.match(html, /Invite-only access/);
  assert.match(html, /id="signup-error"[^>]*role="alert"[^>]*aria-live="polite"/);
  assert.match(html, /window\.auth\.signUp\(name, inviteCode\)/);
  assert.match(client, /async function signUp\(name, inviteCode\)/);
  assert.match(client, /JSON\.stringify\(\{ name: name \|\| "", inviteCode: inviteCode \|\| "" \}\)/);
});

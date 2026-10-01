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

// CONTRACT CHANGE (docs/SCREEN-TIME-ONLY-PLAN.md §10.1): the invite code no longer
// gates ACCOUNT creation, it gates the full plan. A missing code is allowed (the
// parent can start a Screen Time family); a supplied-but-wrong code is still a
// 403 with `code: "invite_invalid"` and never leaves a pending challenge behind.
test("signup rejects an incorrect invite code without creating a passkey challenge", async () => {
  const { req, response } = await call({ name: "Parent", inviteCode: "wrong" });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, {
    error: "That invite code isn't valid. Check it and try again.",
    code: "invite_invalid",
  });
  assert.equal(req.session.waSignup, undefined);
});

test("signup without an invite code is allowed and records an un-validated pending signup", async () => {
  for (const body of [{ name: "Parent" }, { name: "Parent", inviteCode: "" }, { name: "Parent", inviteCode: "   " }]) {
    const { req, response } = await call(body, undefined);
    assert.equal(response.statusCode, 200, JSON.stringify(body));
    assert.equal(response.body.challenge, "challenge");
    assert.equal(req.session.waSignup.challenge, "challenge");
    assert.equal(req.session.waSignup.inviteValidated, false);
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
  assert.match(html, /Free for STA parents/);
  assert.doesNotMatch(html, /forever|30-day trial|annual plan|TBD|TODO/i);
  assert.match(html, /id="signup-error"[^>]*role="alert"[^>]*aria-live="polite"/);
  assert.match(html, /window\.auth\.signUp\(name, inviteCode\)/);
  assert.match(client, /async function signUp\(name, inviteCode\)/);
  assert.match(client, /JSON\.stringify\(\{ name: name \|\| "", inviteCode: inviteCode \|\| "" \}\)/);
});

// Signup verify records the validated invite on the account so the family step
// can create the full plan without asking again (docs/SCREEN-TIME-ONLY-PLAN.md §10.1).
async function verifyWith(pendingSignup) {
  const routes = {};
  const app = {
    post(route, ...handlers) { routes[`POST ${route}`] = handlers.at(-1); },
    get() {},
    patch() {},
    delete() {},
  };
  const created = [];
  require("../lib/routes/auth")(app, {
    store: {
      findByCredentialId: () => null,
      createUser: (_email, name, opts) => { created.push(opts); return { id: opts.id, data: { profile: { name } } }; },
      addCredential() {},
      sessionGeneration: () => 0,
    },
    analytics: { recordSignup() {} },
    rpForRequest: () => ({ rpID: "fametc.com", origins: ["https://www.fametc.com"] }),
    toB64url: () => "k",
    isIOSClient: () => false,
    publicProfile: (u) => ({ id: u.id }),
    verifyRegistrationResponse: async () => ({
      verified: true,
      registrationInfo: { credential: { id: "c1", publicKey: new Uint8Array([1]), counter: 0, transports: [] }, credentialDeviceType: "multiDevice", credentialBackedUp: true },
    }),
  });
  const req = { body: {}, get: () => "", session: { waSignup: pendingSignup } };
  const response = { statusCode: 200, body: null };
  const res = { status(c) { response.statusCode = c; return this; }, json(v) { response.body = v; return this; } };
  await routes["POST /api/webauthn/signup/verify"](req, res);
  return { created, response, req };
}

test("signup verify stamps inviteValidatedAt only when the invite was validated; both kinds of signup succeed", async () => {
  const invited = await verifyWith({ challenge: "c", userId: "u_a", name: "A", inviteValidated: true });
  assert.equal(invited.response.statusCode, 200);
  assert.match(invited.created[0].inviteValidatedAt, /^\d{4}-\d\d-\d\dT/);

  const open = await verifyWith({ challenge: "c", userId: "u_b", name: "B", inviteValidated: false });
  assert.equal(open.response.statusCode, 200, "a Screen Time-only signup (no invite) completes");
  assert.equal(open.created[0].inviteValidatedAt, undefined);
  assert.equal(open.req.session.uid, "u_b");
});

test("store.createUser persists inviteValidatedAt on user.data", () => {
  const os = require("node:os");
  process.env.FAM_DATA_DIR = process.env.FAM_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "fametc-signup-invite-"));
  const store = require("../lib/store");
  const stamp = new Date().toISOString();
  const a = store.createUser("", "Invited", { inviteValidatedAt: stamp });
  const b = store.createUser("", "Open", {});
  assert.equal(store.getUser(a.id).data.inviteValidatedAt, stamp);
  assert.equal(store.getUser(b.id).data.inviteValidatedAt, undefined);
});

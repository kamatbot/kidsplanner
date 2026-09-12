"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const legacyIOSUV = require("../lib/legacy-ios-uv");

function iosRequest(headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    headers: normalized,
    get(name) { return normalized[String(name).toLowerCase()]; },
  };
}

test("legacy iOS UV bypass is exact-error, client, and time limited", () => {
  const missingUV = new Error(legacyIOSUV.REGISTRATION_UV_ERROR);
  const duringWindow = Date.parse("2026-09-18T00:00:00Z");
  const configuredUntil = "2026-09-20T00:00:00Z";

  assert.equal(legacyIOSUV.isAllowed(
    iosRequest({ "x-fametc-client": "ios" }),
    missingUV,
    duringWindow,
    configuredUntil
  ), true);
  assert.equal(legacyIOSUV.isAllowed(
    iosRequest({ "x-fametc-client": "web" }),
    missingUV,
    duringWindow,
    configuredUntil
  ), false);
  assert.equal(legacyIOSUV.isAllowed(
    iosRequest({ "x-fametc-client": "ios" }),
    new Error("origin mismatch"),
    duringWindow,
    configuredUntil
  ), false);
  assert.equal(legacyIOSUV.isAllowed(
    iosRequest({ "x-fametc-client": "ios" }),
    missingUV,
    duringWindow,
    ""
  ), false);
  assert.equal(legacyIOSUV.isAllowed(
    iosRequest({ "x-fametc-client": "ios" }),
    missingUV,
    legacyIOSUV.HARD_END_MS,
    "2099-01-01T00:00:00Z"
  ), false);
});

function authRoutes(overrides = {}) {
  const routes = {};
  const app = {
    post(route, ...handlers) { routes[`POST ${route}`] = handlers.at(-1); },
    get() {},
    patch() {},
    delete() {},
  };
  const addedCredentials = [];
  const counters = [];
  const defaultUser = {
    id: "u_existing",
    email: "",
    credentials: [],
    data: { profile: { name: "Parent", role: "parent" } },
  };
  const store = {
    findByCredentialId: () => null,
    createUser: (_email, name, opts) => ({
      id: opts.id,
      email: "",
      credentials: [],
      data: { profile: { name, role: "parent" } },
    }),
    addCredential: (userId, credential) => { addedCredentials.push({ userId, credential }); },
    sessionGeneration: () => 0,
    updateCredentialCounter: (id, counter) => { counters.push({ id, counter }); },
    listCredentials: () => [],
    ...overrides.store,
  };
  require("../lib/routes/auth")(app, {
    store,
    analytics: { recordSignup() {} },
    currentUser: () => null,
    rpForRequest: () => ({ rpID: "fametc.com", rpName: "Fam ETC", origins: ["https://www.fametc.com"] }),
    toB64url: () => "public-key",
    fromB64url: () => new Uint8Array([1]),
    isIOSClient: () => true,
    publicProfile: (user) => ({ id: user.id, name: user.data.profile.name }),
    legacyIOSUVBypassAllowed: () => true,
    authWarning() {},
    verifyRegistrationResponse: async () => ({ verified: false }),
    verifyAuthenticationResponse: async () => ({ verified: false }),
    ...overrides,
    store,
  });
  return { routes, addedCredentials, counters, defaultUser };
}

function responseRecorder() {
  const result = { statusCode: 200, body: null };
  return {
    result,
    response: {
      status(code) { result.statusCode = code; return this; },
      json(body) { result.body = body; return this; },
    },
  };
}

function verifiedRegistration(id = "cred-1") {
  return {
    verified: true,
    registrationInfo: {
      credential: { id, publicKey: new Uint8Array([1]), counter: 0, transports: [] },
      credentialDeviceType: "multiDevice",
      credentialBackedUp: true,
    },
  };
}

test("signup retries only the missing-UV verification and tags the accepted credential", async () => {
  const requirements = [];
  const { routes, addedCredentials } = authRoutes({
    verifyRegistrationResponse: async (options) => {
      requirements.push({
        presence: options.requireUserPresence,
        verification: options.requireUserVerification,
      });
      if (options.requireUserVerification) throw new Error(legacyIOSUV.REGISTRATION_UV_ERROR);
      return verifiedRegistration();
    },
  });
  const req = iosRequest({ "x-fametc-client": "ios" });
  req.body = { id: "cred-1" };
  req.session = { waSignup: { challenge: "challenge", userId: "u_new", name: "The Family", inviteValidated: true } };
  const { response, result } = responseRecorder();

  await routes["POST /api/webauthn/signup/verify"](req, response);

  assert.equal(result.statusCode, 200);
  assert.deepEqual(requirements, [
    { presence: true, verification: true },
    { presence: true, verification: false },
  ]);
  assert.equal(addedCredentials.length, 1);
  assert.equal(addedCredentials[0].credential.legacyIOSUVBypass, true);
  assert.equal(req.session.uid, "u_new");
});

test("signup preserves strict rejection when temporary bypass is not allowed", async () => {
  const requirements = [];
  const { routes, addedCredentials } = authRoutes({
    legacyIOSUVBypassAllowed: () => false,
    verifyRegistrationResponse: async (options) => {
      requirements.push(options.requireUserVerification);
      throw new Error(legacyIOSUV.REGISTRATION_UV_ERROR);
    },
  });
  const req = iosRequest({ "x-fametc-client": "ios" });
  req.body = { id: "cred-1" };
  req.session = { waSignup: { challenge: "challenge", userId: "u_new", name: "The Family", inviteValidated: true } };
  const { response, result } = responseRecorder();

  await routes["POST /api/webauthn/signup/verify"](req, response);

  assert.equal(result.statusCode, 400);
  assert.deepEqual(requirements, [true]);
  assert.equal(addedCredentials.length, 0);
  assert.match(result.body.error, /User verification was required/);
});

test("sign-in fallback is restricted to credentials created by the legacy signup bypass", async () => {
  for (const tagged of [false, true]) {
    const requirements = [];
    const credential = {
      id: "cred-1",
      publicKey: "public-key",
      counter: 0,
      transports: [],
      ...(tagged ? { legacyIOSUVBypass: true } : {}),
    };
    const user = {
      id: "u_existing",
      email: "",
      credentials: [credential],
      data: { profile: { name: "Parent", role: "parent" } },
    };
    const { routes, counters } = authRoutes({
      store: { findByCredentialId: () => user },
      verifyAuthenticationResponse: async (options) => {
        requirements.push(options.requireUserVerification);
        if (options.requireUserVerification) throw new Error(legacyIOSUV.AUTHENTICATION_UV_ERROR);
        return { verified: true, authenticationInfo: { newCounter: 4 } };
      },
    });
    const req = iosRequest({ "x-fametc-client": "ios" });
    req.body = { id: "cred-1" };
    req.session = { waAuth: "challenge" };
    const { response, result } = responseRecorder();

    await routes["POST /api/webauthn/auth/verify"](req, response);

    assert.deepEqual(requirements, tagged ? [true, false] : [true]);
    assert.equal(result.statusCode, tagged ? 200 : 400);
    assert.equal(counters.length, tagged ? 1 : 0);
  }
});

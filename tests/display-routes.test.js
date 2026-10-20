"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mount = require("../lib/routes/display");

// Isolate this route module's guards. The companion boundary integration test
// exercises the real signed-cookie and global server middleware.
function fixture() {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "patch", "delete"]) {
    app[method] = (path, ...handlers) => routes.set(`${method.toUpperCase()} ${path}`, handlers);
  }
  const parent = { id: "parent-a", data: { profile: { role: "parent" } } };
  const fam = { id: "family-a", name: "Our household", parentIds: [parent.id], plan: "full" };
  const token = "fdp_" + "a".repeat(43);
  const device = { id: "display-a", familyId: fam.id, createdBy: parent.id, label: "Kitchen", timeZone: "Asia/Bangkok", showHomework: true, showMeals: true };
  const calls = [];
  const deps = {
    CANONICAL_HOST: "https://www.fametc.com",
    currentUser: (req) => req.cookieUser || null,
    family: { familiesForUser: () => [fam], isFull: (family) => family.plan !== "screen_time" },
    authLimiter: (req, res, next) => next(), apiLimiter: (req, res, next) => next(),
    displayAuth: {
      createPairing: (settings) => { calls.push({ action: "pairing", settings }); return { pairing: { id: "pair-a", code: "ABCDEFGH" } }; },
      listDevices: (familyId) => { calls.push({ action: "list", familyId }); return []; },
      updateDevice: (familyId, id, patch) => { calls.push({ action: "update", familyId, id, patch }); return { device: { id } }; },
      revokeDevice: (familyId, id) => { calls.push({ action: "revoke", familyId, id }); return { ok: true }; },
      claimPairing: (code, model) => { calls.push({ action: "claim", code, model }); return { token, device: { id: device.id } }; },
      resolveToken: (value) => value === token ? { family: fam, device } : null,
    },
    displayContext: { buildContext: ({ family, device: display }) => ({ family: { name: family.name }, device: { id: display.id } }) },
    displayPhotos: { MAX_BYTES: 1024, MAX_PHOTOS: 12, list: () => [] },
  };
  mount(app, deps);
  function request(method, path, { user = null, body = {}, headers = {}, params = {}, ...attributes } = {}) {
    const normalized = Object.fromEntries(Object.entries({ "content-type": "application/json", ...headers }).map(([key, value]) => [key.toLowerCase(), value]));
    const req = { cookieUser: user, body, params, get: (key) => normalized[key.toLowerCase()], ...attributes };
    const res = { statusCode: 200, headers: {}, sent: false,
      set(key, value) { this.headers[key.toLowerCase()] = value; return this; },
      status(value) { this.statusCode = value; return this; },
      json(value) { this.body = value; this.sent = true; return this; },
    };
    const handlers = routes.get(`${method} ${path}`);
    assert.ok(handlers, "test request must address an actual mounted display route");
    let index = 0;
    function next() {
      assert.ok(index < handlers.length, "route must produce a response");
      return handlers[index++](req, res, next);
    }
    next();
    assert.equal(res.sent, true);
    assert.equal(res.headers["cache-control"], "no-store");
    return { ...res, req };
  }
  return { request, parent, fam, token, device, calls, deps };
}

test("management requires a signed interactive parent before any device operation", () => {
  const f = fixture();
  assert.equal(f.request("GET", "/api/displays").statusCode, 401);
  assert.equal(f.request("GET", "/api/displays", { headers: { Authorization: `Bearer ${f.token}` } }).statusCode, 401);
  const kid = { id: "kid-a", data: { profile: { role: "kid" } } };
  assert.equal(f.request("GET", "/api/displays", { user: kid }).statusCode, 403);
  assert.equal(f.request("GET", "/api/displays", { user: f.parent, headers: { Authorization: `Bearer ${f.token}` } }).statusCode, 403);
  assert.equal(f.request("GET", "/api/displays", { user: f.parent, watchAuth: {} }).statusCode, 403);
  assert.equal(f.calls.length, 0);
  f.fam.parentIds = [];
  assert.equal(f.request("GET", "/api/displays", { user: f.parent }).statusCode, 403);
  assert.equal(f.calls.length, 0);
});

test("the management guard enforces the current plan but preserves legacy parent profiles", () => {
  const f = fixture();
  f.fam.plan = "screen_time";
  const blocked = f.request("POST", "/api/displays/pairing", { user: f.parent });
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.body.code, "upgrade_required");
  assert.equal(f.calls.length, 0);
  delete f.fam.plan;
  delete f.parent.data.profile.role;
  const listed = f.request("GET", "/api/displays", { user: f.parent });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.body, { devices: [] });
});

test("parent mutations reject foreign origins and cross-site fetches before writing", () => {
  const f = fixture();
  for (const headers of [
    { Origin: "https://unrelated.example" },
    { Origin: "null" },
    { Origin: "https://www.fametc.com.evil.example" },
    { Origin: "https://www.fametc.com", "Sec-Fetch-Site": "cross-site" },
  ]) {
    const response = f.request("POST", "/api/displays/pairing", { user: f.parent, headers });
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.code, "origin_not_allowed");
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.request("POST", "/api/displays/pairing", { user: f.parent, headers: { Origin: "https://www.fametc.com" } }).statusCode, 200);
});

test("pairing and mutations accept only JSON objects, including empty revoke bodies", () => {
  const f = fixture();
  for (const body of [null, [], "code", 2]) {
    assert.equal(f.request("POST", "/api/display/pair", { body }).statusCode, 400);
  }
  assert.equal(f.request("POST", "/api/display/pair", { body: { code: "ABCDEFGH" }, headers: { "content-type": "text/plain" } }).statusCode, 415);
  assert.equal(f.request("POST", "/api/displays/:id/revoke", { user: f.parent, params: { id: "display-a" }, headers: { "content-type": undefined } }).statusCode, 415);
  assert.equal(f.calls.length, 0);
  assert.equal(f.request("POST", "/api/displays/:id/revoke", { user: f.parent, params: { id: "display-a" }, body: {} }).statusCode, 200);
});

test("a parent's family and identity come from membership, never pairing JSON", () => {
  const f = fixture();
  const response = f.request("POST", "/api/displays/pairing", { user: f.parent, body: {
    familyId: "foreign-family", createdBy: "foreign-parent", label: "Kitchen", timeZone: "UTC", showHomework: false, showMeals: true,
  } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(f.calls, [{ action: "pairing", settings: {
    familyId: "family-a", createdBy: "parent-a", label: "Kitchen", timeZone: "UTC", showHomework: false, showMeals: true,
  } }]);
});

test("device context accepts only its own scoped bearer and never creates a user principal", () => {
  const f = fixture();
  assert.equal(f.request("GET", "/api/display/context", { user: f.parent }).statusCode, 401);
  assert.equal(f.request("GET", "/api/display/context", { headers: { Authorization: "Bearer fwt_" + "a".repeat(43) } }).statusCode, 401);
  const otherParent = { id: "foreign-parent", data: { profile: { role: "parent" } } };
  const response = f.request("GET", "/api/display/context", { user: otherParent, headers: { Authorization: `Bearer ${f.token}` } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { family: { name: "Our household" }, device: { id: "display-a" }, photos: [] });
  assert.equal(response.req.user, undefined);
  assert.equal(response.req.family, undefined);
  assert.equal(response.req.displayParent, undefined);
  assert.equal(response.req.displayAccess.family.id, "family-a");
  f.deps.displayAuth.resolveToken = () => ({ error: "This display requires the whole Fam ETC.", status: 403, code: "upgrade_required" });
  const downgraded = f.request("GET", "/api/display/context", { headers: { Authorization: `Bearer ${f.token}` } });
  assert.equal(downgraded.statusCode, 403);
  assert.equal(downgraded.body.code, "upgrade_required");
});

test("device disconnect revokes the credential's family and id, ignoring request-body scope", () => {
  const f = fixture();
  const response = f.request("POST", "/api/display/disconnect", {
    headers: { Authorization: `Bearer ${f.token}` }, body: { familyId: "foreign", id: "another-device" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(f.calls, [{ action: "revoke", familyId: "family-a", id: "display-a" }]);
  assert.equal(response.req.user, undefined);
});

test("pairing is available without a cookie and returns a dedicated credential without a user identity", () => {
  const f = fixture();
  const response = f.request("POST", "/api/display/pair", { body: { code: "ABCDEFGH", model: "Portal+" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.token, f.token);
  assert.equal(response.req.user, undefined);
  assert.deepEqual(f.calls, [{ action: "claim", code: "ABCDEFGH", model: "Portal+" }]);
});

test("storage and projection failures return generic 503 JSON without secret error details", () => {
  const f = fixture();
  f.deps.displayAuth.claimPairing = () => {
    const error = new Error("PRIVATE-FILESYSTEM-PATH-AND-TOKEN");
    error.code = "display_storage_unavailable";
    throw error;
  };
  const claim = f.request("POST", "/api/display/pair", { body: { code: "ABCDEFGH" } });
  assert.equal(claim.statusCode, 503);
  assert.equal(claim.body.code, "display_storage_unavailable");
  assert.equal(JSON.stringify(claim.body).includes("PRIVATE-"), false);
  f.deps.displayContext.buildContext = () => { throw new Error("PRIVATE-SCHOOL-FEED-URL"); };
  const context = f.request("GET", "/api/display/context", { headers: { Authorization: `Bearer ${f.token}` } });
  assert.equal(context.statusCode, 503);
  assert.equal(context.body.code, "display_unavailable");
  assert.equal(JSON.stringify(context.body).includes("PRIVATE-"), false);
});

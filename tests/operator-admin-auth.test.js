"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createOperatorAdminGuard } = require("../lib/operator-admin-auth");

function invoke(guard, { header = "", queryToken = "", ip = "203.0.113.10" } = {}) {
  let allowed = false;
  const req = {
    ip,
    query: { token: queryToken },
    get(name) { return name.toLowerCase() === "x-operator-admin-token" ? header : ""; },
  };
  const res = {
    statusCode: 200,
    body: null,
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  guard(req, res, () => { allowed = true; });
  return { allowed, statusCode: res.statusCode, body: res.body };
}

test("Operator admin guard accepts only its dedicated header credential", () => {
  const guard = createOperatorAdminGuard({ isProduction: true, token: "operator-secret" });
  assert.equal(invoke(guard, { header: "operator-secret" }).allowed, true);
  assert.equal(invoke(guard, { queryToken: "operator-secret" }).statusCode, 401);
  assert.equal(invoke(guard, { header: "analytics-secret", queryToken: "operator-secret" }).statusCode, 401);
});

test("Operator admin guard fails closed in production when unconfigured", () => {
  const guard = createOperatorAdminGuard({ isProduction: true, token: "" });
  assert.equal(invoke(guard, { ip: "127.0.0.1" }).statusCode, 401);
});

test("Operator admin guard permits local development only when unconfigured", () => {
  const guard = createOperatorAdminGuard({ isProduction: false, token: "" });
  assert.equal(invoke(guard, { ip: "127.0.0.1" }).allowed, true);
  assert.equal(invoke(guard).statusCode, 401);
});

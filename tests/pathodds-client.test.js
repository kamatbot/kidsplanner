"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const client = require("../lib/pathodds-client");

test("PathOdds service signature binds method, path and body", () => {
  const secret = "integration-test-secret-0123456789abcdef";
  const input = {
    method: "POST",
    path: "/api/auth/fametc/integration/launch-tickets",
    timestamp: "2026-08-25T03:00:00.000Z",
    requestId: "req_123",
    body: JSON.stringify({ subject: "pws_123", route: "sat.quest" }),
  };
  const bodyHash = crypto.createHash("sha256").update(input.body).digest("hex");
  const canonical = [input.method, input.path, input.timestamp, input.requestId, bodyHash].join("\n");
  const expected = crypto.createHmac("sha256", secret).update(canonical).digest("base64url");
  assert.equal(client.signServiceRequest(input, secret), expected);
  assert.notEqual(client.signServiceRequest({ ...input, path: "/tampered" }, secret), expected);
});

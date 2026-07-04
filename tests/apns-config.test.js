"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { createAPNsClient } = require("../lib/apns-sender");

// A real P-256 PKCS#8 key stands in for a genuine APNs .p8.
function samplePem() {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim();
}

test("createAPNsClient: parses a normal multi-line PEM (APNS_KEY_PATH style)", () => {
  const client = createAPNsClient({
    teamId: "B4F73U5RGR", keyId: "ABC123", bundleId: "com.fametc.app", key: samplePem(),
  });
  assert.ok(client);
});

test("createAPNsClient: parses an inline key with escaped \\n (single-line env-var style)", () => {
  const inline = samplePem().replace(/\n/g, "\\n");
  const client = createAPNsClient({
    teamId: "B4F73U5RGR", keyId: "ABC123", bundleId: "com.fametc.app", key: inline,
  });
  assert.ok(client);
});

test("createAPNsClient: parses an inline key wrapped in quotes with escaped \\n", () => {
  const inline = '"' + samplePem().replace(/\n/g, "\\n") + '"';
  const client = createAPNsClient({
    teamId: "B4F73U5RGR", keyId: "ABC123", bundleId: "com.fametc.app", key: inline,
  });
  assert.ok(client);
});

test("createAPNsClient: a missing .p8 file throws (callers must catch → push disabled)", () => {
  assert.throws(() => createAPNsClient({
    teamId: "B4F73U5RGR", keyId: "ABC123", bundleId: "com.fametc.app", keyPath: "/tmp/definitely-missing.p8",
  }));
});

test("createAPNsClient: an unparseable key throws (does not silently sign with garbage)", () => {
  assert.throws(() => createAPNsClient({
    teamId: "B4F73U5RGR", keyId: "ABC123", bundleId: "com.fametc.app", key: "not-a-pem",
  }));
});

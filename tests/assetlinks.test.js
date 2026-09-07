"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("public/.well-known/assetlinks.json conforms to Digital Asset Links spec for passkeys", () => {
  const filePath = path.join(__dirname, "../public/.well-known/assetlinks.json");
  assert.ok(fs.existsSync(filePath), "assetlinks.json must exist in public/.well-known");

  const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.ok(Array.isArray(content), "assetlinks.json must be an array of statements");

  const packages = content.map((s) => s.target && s.target.package_name);
  assert.ok(packages.includes("com.fametc.app"), "must target com.fametc.app");
  assert.ok(packages.includes("com.fametc.app.debug"), "must target com.fametc.app.debug");

  for (const statement of content) {
    assert.equal(statement.target.namespace, "android_app");
    assert.ok(Array.isArray(statement.relation), "relation must be an array");
    assert.ok(
      statement.relation.includes("delegate_permission/common.handle_all_urls"),
      "must include handle_all_urls relation for passkeys"
    );
    assert.ok(
      statement.relation.includes("delegate_permission/common.get_login_creds"),
      "must include get_login_creds relation for passkeys"
    );
    assert.ok(
      statement.target.sha256_cert_fingerprints.length > 0,
      "must have at least one sha256 fingerprint"
    );
  }
});

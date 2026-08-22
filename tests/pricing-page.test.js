const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const pricing = fs.readFileSync(path.join(__dirname, "..", "public/pricing.html"), "utf8");

test("pricing promises free-forever access for STA parents", () => {
  assert.match(pricing, /Free forever for STA parents/);
  assert.match(pricing, /no trial deadline and no card is required/i);
  assert.match(pricing, /STA invite code/);
  assert.match(pricing, /href="\/signup"/);
  assert.doesNotMatch(pricing, /30-day trial|annual plan|TBD|TODO/i);
});

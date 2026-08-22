const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const pricing = fs.readFileSync(path.join(__dirname, "..", "public/pricing.html"), "utf8");

test("pricing states free STA access without a permanence or trial promise", () => {
  assert.match(pricing, /Free for STA parents/);
  assert.match(pricing, /no card is required/i);
  assert.match(pricing, /STA invite code/);
  assert.match(pricing, /href="\/signup"/);
  assert.doesNotMatch(pricing, /forever|30-day trial|trial deadline|annual plan|TBD|TODO/i);
});

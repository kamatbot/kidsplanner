#!/usr/bin/env node
"use strict";
// Read the new password from stdin; output only its salted hash to a named
// private file. Neither the password nor the hash is printed or logged.
const fs = require("node:fs");
const path = require("node:path");
const { passwordHash } = require("../lib/routes/article-admin");
const output = process.argv[2];
if (!output) { console.error("Usage: read password from stdin; pass a private output file path."); process.exit(1); }
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; if (input.length > 258) { console.error("Password is too long."); process.exit(1); } });
process.stdin.on("end", async () => {
  try {
    const hash = await passwordHash(input.replace(/\r?\n$/, ""));
    fs.writeFileSync(path.resolve(output), `FAM_ARTICLE_ADMIN_PASSWORD_HASH='${hash}'\n`, { mode: 0o600, flag: "wx" });
    console.log("Password hash saved to the private output file. Add it to the server environment.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
});

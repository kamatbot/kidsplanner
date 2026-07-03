#!/usr/bin/env node
"use strict";
/**
 * Generate a DATA_ENCRYPTION_KEY for the at-rest datastore encryption.
 * Run:  node scripts/gen-encryption-key.js
 * Then set the printed value in your host's env panel (or .env) and restart.
 *
 * KEEP IT SAFE AND BACK IT UP. If the key is lost, the encrypted db.json is
 * unrecoverable. If you change it, the old data can no longer be read.
 */
const { generateKey } = require("../lib/datacrypto");
const key = generateKey();
process.stdout.write("DATA_ENCRYPTION_KEY=" + key + "\n");

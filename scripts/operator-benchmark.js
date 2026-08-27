#!/usr/bin/env node
"use strict";

const fs = require("fs");
const benchmark = require("../lib/operator-benchmark");

function readObservations(file) {
  if (!file) return null;
  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) return JSON.parse(raw);
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function main() {
  const validation = benchmark.validateCorpus();
  const file = process.argv[2];
  if (!file) {
    process.stdout.write(JSON.stringify({ schemaVersion: benchmark.corpus.schemaVersion, ...validation }, null, 2) + "\n");
    return;
  }
  const observations = readObservations(file);
  const scored = observations.map((entry) => benchmark.scoreObservation(entry.taskId, entry.observation || entry));
  process.stdout.write(JSON.stringify({ results: scored, summary: benchmark.summarize(scored) }, null, 2) + "\n");
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error && error.message ? error.message : error}\n`);
  process.exitCode = 1;
}

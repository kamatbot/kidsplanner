"use strict";
/**
 * Postinstall self-repair for better-sqlite3 on hosts whose npm can't build
 * native modules (Hostinger's builder has no Python, and prebuild-install
 * fails to match a binary there). If require() fails, download the official
 * prebuilt binary for this exact version/ABI/platform from GitHub releases
 * and drop it into node_modules/better-sqlite3/build/Release/.
 *
 * NEVER exits non-zero: chat falls back to the JSON store at runtime when
 * better-sqlite3 is genuinely unavailable (lib/chat.js), so a failed repair
 * must not fail the whole deploy.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function ok() {
  try {
    require("better-sqlite3");
    return true;
  } catch (e) {
    return false;
  }
}

(async () => {
  if (ok()) {
    console.log("[ensure-sqlite] better-sqlite3 loads — nothing to do");
    return;
  }
  let pkg;
  try {
    pkg = require("better-sqlite3/package.json");
  } catch (e) {
    console.warn("[ensure-sqlite] better-sqlite3 not installed at all — chat will use the JSON fallback");
    return;
  }
  const abi = process.versions.modules;
  // Hostinger/CloudLinux is glibc; only tag musl when node itself reports it.
  const musl = (process.report && process.report.getReport().header.glibcVersionRuntime) ? false
    : (process.platform === "linux" && fs.existsSync("/etc/alpine-release"));
  const platform = process.platform === "linux" && musl ? "linuxmusl" : process.platform;
  const name = `better-sqlite3-v${pkg.version}-node-v${abi}-${platform}-${process.arch}.tar.gz`;
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${pkg.version}/${name}`;
  const moduleDir = path.dirname(require.resolve("better-sqlite3/package.json"));
  const tmp = path.join(os.tmpdir(), name);
  console.log(`[ensure-sqlite] require failed — fetching prebuilt binary ${name}`);
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    // The prebuild tarball contains build/Release/better_sqlite3.node
    execFileSync("tar", ["-xzf", tmp, "-C", moduleDir]);
    fs.rmSync(tmp, { force: true });
    if (ok()) {
      console.log("[ensure-sqlite] repaired — better-sqlite3 now loads");
    } else {
      console.warn("[ensure-sqlite] binary extracted but require still fails — chat will use the JSON fallback");
    }
  } catch (e) {
    console.warn(`[ensure-sqlite] repair failed (${e.message}) — chat will use the JSON fallback`);
  }
})();

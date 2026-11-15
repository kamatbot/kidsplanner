"use strict";
// Several processes started at once (as Hostinger's LiteSpeed does) must end
// up with exactly one running background jobs, the rest forwarding to it, and
// a new leader when the old one exits or hangs.
const test = require("node:test");
const assert = require("node:assert/strict");
const { fork } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const singleInstance = require("../lib/single-instance");

const FIXTURE = path.join(__dirname, "fixtures", "single-instance-app.js");

function request(port, { method = "GET", path: p = "/", body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, agent: false }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}

function start(dir, port, extraEnv = {}) {
  const child = fork(FIXTURE, [], {
    env: {
      ...process.env,
      FAM_SINGLE_INSTANCE: "on",
      FAM_DATA_DIR: dir,
      PORT: String(port),
      FAM_INSTANCE_WATCH_MS: "200",
      FAM_INSTANCE_HUNG_MS: "1500",
      FAM_INSTANCE_BOOT_WAIT_MS: "3000",
      ...extraEnv,
    },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  child.ready = new Promise((r) => child.on("message", (m) => m && m.listening && r()));
  return child;
}

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function jobs(dir) {
  try {
    return fs.readFileSync(path.join(dir, "jobs.log"), "utf8").trim().split("\n").filter(Boolean).map(Number);
  } catch (_) {
    return [];
  }
}

test("enabled() is on in production, off elsewhere, and honours the switch", () => {
  assert.equal(singleInstance.enabled({ NODE_ENV: "production" }), true);
  assert.equal(singleInstance.enabled({ NODE_ENV: "test" }), false);
  assert.equal(singleInstance.enabled({}), false);
  assert.equal(singleInstance.enabled({ NODE_ENV: "production", FAM_SINGLE_INSTANCE: "off" }), false);
  assert.equal(singleInstance.enabled({ FAM_SINGLE_INSTANCE: "on" }), true);
});

test("a long data folder path moves the socket to the temp folder", () => {
  const long = path.join("/data", "x".repeat(120));
  const { sock, lock } = singleInstance.instancePaths(long);
  assert.ok(Buffer.byteLength(sock) <= 100);
  assert.equal(lock, path.join(long, "server.lock"));
});

test("three processes: one leader runs jobs, followers forward, leader exit and hang recover", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fam-si-"));
  const ports = [await freePort(), await freePort(), await freePort()];
  const kids = ports.map((p) => start(dir, p));
  t.after(() => {
    for (const k of kids) { try { process.kill(k.pid, "SIGCONT"); k.kill("SIGKILL"); } catch (_) {} }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await Promise.all(kids.map((k) => k.ready));

  // Every public port answers with the SAME pid: the leader's.
  const leader = await waitFor(async () => {
    const pids = await Promise.all(ports.map((p) => request(p).then((r) => Number(r.body))));
    return pids.every((pid) => pid === pids[0]) && jobs(dir).length === 1 ? pids[0] : null;
  });
  assert.deepEqual(jobs(dir), [leader]);
  const leaderIdx = kids.findIndex((k) => k.pid === leader);
  const followerPort = ports[(leaderIdx + 1) % 3];

  // Bodies, status codes and repeated headers pass through a follower intact.
  const post = await request(followerPort, { method: "POST", path: "/x", body: "hello" });
  assert.equal(post.status, 201);
  assert.equal(post.body, `${leader}:hello`);
  assert.deepEqual(post.headers["set-cookie"], ["a=1", "b=2"]);

  // Leader exits: a survivor takes over and starts the jobs once.
  kids[leaderIdx].kill("SIGKILL");
  const survivors = ports.filter((_, i) => i !== leaderIdx);
  const second = await waitFor(async () => {
    const pids = await Promise.all(survivors.map((p) => request(p).then((r) => (r.status === 200 ? Number(r.body) : 0))));
    return pids[0] && pids.every((pid) => pid === pids[0]) && pids[0] !== leader ? pids[0] : null;
  });
  assert.deepEqual(jobs(dir), [leader, second]);

  // Leader hangs (frozen, like the 2026-11-15 incident): the other one stops it and takes over.
  process.kill(second, "SIGSTOP");
  const lastPort = survivors.find((p, i) => kids.filter((_, j) => j !== leaderIdx)[i].pid !== second);
  const third = await waitFor(async () => {
    const r = await request(lastPort);
    return r.status === 200 && Number(r.body) !== second ? Number(r.body) : null;
  }, 10000);
  assert.deepEqual(jobs(dir), [leader, second, third]);
  assert.equal(singleInstance.pidAlive(second), false);
});

"use strict";
/**
 * Keep ONE server process in charge, even when the host starts several.
 *
 * Why: Hostinger runs Node through LiteSpeed's lsnode, which starts app
 * processes on demand. The runtime log for the 2026-11-14 deploy shows three
 * "listening" lines within 1.4s. This server assumes it is the only process:
 * db.json lives in one in-memory cache and is rewritten whole on save, chat
 * long-poll waiters live in memory, and the background loops (Hermes
 * reminders, school sync) run on setInterval. Several
 * processes means saves that overwrite each other, long-polls that never wake,
 * and reminders sent more than once.
 *
 * How: the first process to create `server.lock` in the data folder becomes
 * the LEADER. It serves requests, runs the background jobs and also listens
 * on a private Unix socket. Every other process becomes a FOLLOWER: it still
 * answers LiteSpeed (so no request is dropped), but forwards each request
 * byte-for-byte to the leader over that socket and never touches the data.
 *
 * Recovery:
 * - Leader exits (LiteSpeed idle stop, crash): followers see the dead pid or
 *   a refused socket, and one of them takes over.
 * - Leader hangs (the 2026-11-15 incident): followers ping it every 10s. After
 *   HUNG_MS without an answer they kill it and one of them takes over.
 * - Leader can't open the socket: it writes proxy:false in the lock, and
 *   followers serve locally (the old behaviour) but still run no jobs.
 *
 * Off outside production unless FAM_SINGLE_INSTANCE=on, so tests and local dev
 * keep the plain app.listen() path. FAM_SINGLE_INSTANCE=off is the kill switch.
 */
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const PING_PATH = "/__fam-instance/ping";
const VIA_HEADER = "x-fam-proxied-by";
const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-connection", "upgrade", "te", "trailer"]);

function enabled(env = process.env) {
  const v = String(env.FAM_SINGLE_INSTANCE || "").trim().toLowerCase();
  if (["off", "0", "false", "no"].includes(v)) return false;
  if (["on", "1", "true", "yes"].includes(v)) return true;
  return env.NODE_ENV === "production";
}

function envMs(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function instancePaths(dataDir) {
  const lock = path.join(dataDir, "server.lock");
  let sock = path.join(dataDir, "server.sock");
  // Unix socket paths are capped at ~107 bytes on Linux.
  if (Buffer.byteLength(sock) > 100) {
    const tag = crypto.createHash("sha256").update(dataDir).digest("hex").slice(0, 12);
    sock = path.join(os.tmpdir(), `fametc-${tag}.sock`);
  }
  return { lock, sock };
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function readLock(lockPath) {
  try {
    const info = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    return info && Number.isInteger(info.pid) ? info : { pid: 0 };
  } catch (e) {
    return e.code === "ENOENT" ? null : { pid: 0 }; // unreadable = stale
  }
}

function safeUnlink(p) {
  try { fs.unlinkSync(p); } catch (_) { /* gone already */ }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms).unref?.());
}

function ping(sock, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ socketPath: sock, path: PING_PATH, timeout: timeoutMs, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        if (res.statusCode !== 200) return resolve(null);
        try { resolve(JSON.parse(body)); } catch (_) { resolve(null); }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

/**
 * Start serving `app`. Returns the public http.Server (the one LiteSpeed or a
 * test talks to) synchronously, like app.listen().
 *
 * opts.listenTarget   port or socket path, as passed to app.listen()
 * opts.onListening    called once the public server listens
 * opts.onLeader       start background jobs; called at most once per process
 * opts.beforeLead     drop caches loaded while this process was a follower
 * opts.dataDir        where server.lock / server.sock live
 */
function serve(app, opts) {
  const { listenTarget, onListening, onLeader, beforeLead, dataDir } = opts;
  if (!enabled()) {
    const server = app.listen(listenTarget, onListening);
    if (onLeader) onLeader();
    return server;
  }

  const { lock, sock } = instancePaths(dataDir);
  const HUNG_MS = envMs("FAM_INSTANCE_HUNG_MS", 60000);
  const WATCH_MS = envMs("FAM_INSTANCE_WATCH_MS", 10000);
  const BOOT_WAIT_MS = envMs("FAM_INSTANCE_BOOT_WAIT_MS", 10000);
  const agent = new http.Agent({ keepAlive: true });

  const state = {
    role: "deciding", // deciding | leader | follower | peer
    leaderPid: null,
    since: new Date().toISOString(),
    lastLeaderOk: Date.now(),
    electing: null,
    internal: null,
    followers: new Map(), // pid -> last seen ms (leader only)
    takeovers: 0,
    killedHungLeader: null,
    proxy: null,
  };
  let ready;
  let markReady;
  const resetReady = () => { ready = new Promise((r) => { markReady = r; }); };
  resetReady();
  let jobsStarted = false;

  function log(msg) { console.log(`[instance ${process.pid}] ${msg}`); }

  function becomeLeader() {
    if (state.role !== "leader" && state.role !== "deciding") {
      state.takeovers += 1;
      try { if (beforeLead) beforeLead(); } catch (e) { log(`beforeLead failed: ${e.message}`); }
    }
    state.role = "leader";
    state.leaderPid = process.pid;
    state.since = new Date().toISOString();
    openInternal();
    if (!jobsStarted && onLeader) {
      jobsStarted = true;
      try { onLeader(); } catch (e) { log(`starting background jobs failed: ${e.message}`); }
    }
    log("leader: serving requests and running background jobs");
  }

  // A leader whose lock now names another live process must not keep running
  // jobs or saving data next to it. Exit; db.js flushes pending saves on exit
  // and LiteSpeed starts a fresh process (a follower) when one is needed.
  function checkStillLeader() {
    const info = readLock(lock);
    if (!info) {
      try {
        fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, proxy: state.proxy, startedAt: state.since }), { flag: "wx" });
      } catch (_) { /* someone just took it; the next check decides */ }
      return;
    }
    if (info.pid === process.pid || !pidAlive(info.pid)) return;
    log(`process ${info.pid} now holds the lock; exiting to avoid two leaders`);
    process.exit(0);
  }

  function writeLock(proxy) {
    state.proxy = proxy;
    try {
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, proxy, startedAt: state.since }));
    } catch (e) {
      log(`could not update ${lock}: ${e.message}`);
    }
  }

  function openInternal() {
    safeUnlink(sock);
    const internal = http.createServer((req, res) => {
      if (req.url === PING_PATH) {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ pid: process.pid, role: state.role }));
      }
      const via = Number(req.headers[VIA_HEADER]);
      if (Number.isInteger(via)) state.followers.set(via, Date.now());
      delete req.headers[VIA_HEADER];
      app(req, res);
    });
    internal.keepAliveTimeout = 65000;
    // LiteSpeed's lsnode wrapper patches http.Server.prototype.listen and
    // silently ignores every call after the first ("http.Server.listen() was
    // called more than once, ignore."), so the private socket is opened with
    // a plain net.Server that hands each connection to the http server.
    const listener = net.createServer((conn) => internal.emit("connection", conn));
    let settled = false;
    const settle = (proxy, why) => {
      if (settled) return;
      settled = true;
      if (!proxy) log(`${why}; other processes will serve locally`);
      writeLock(proxy);
    };
    listener.on("error", (e) => settle(false, `private socket failed (${e.message})`));
    // A listen() that never calls back must not leave followers waiting.
    const giveUp = setTimeout(() => settle(false, "private socket did not open in 5s"), 5000);
    if (giveUp.unref) giveUp.unref();
    listener.listen(sock, () => {
      // Confirm the socket really is at `sock` before telling followers so.
      ping(sock, 2000).then((ok) => {
        clearTimeout(giveUp);
        if (ok && ok.pid === process.pid) settle(true);
        else settle(false, "private socket did not answer");
      });
    });
    state.listener = listener;
    state.internal = internal;
  }

  // Move a dead leader's lock aside. Rename is atomic, so if another process
  // already replaced it with a fresh lock we notice and put that one back.
  function removeStaleLock(stalePid) {
    const grave = `${lock}.stale-${process.pid}-${Date.now()}`;
    try { fs.renameSync(lock, grave); } catch (_) { return; }
    const moved = readLock(grave);
    if (moved && moved.pid !== stalePid && pidAlive(moved.pid)) {
      try { fs.linkSync(grave, lock); } catch (_) { /* a third process holds it now */ }
    }
    safeUnlink(grave);
  }

  async function elect() {
    const deadline = Date.now() + BOOT_WAIT_MS;
    for (;;) {
      const info = readLock(lock);
      if (info && info.pid === process.pid) return becomeLeader();
      if (info && pidAlive(info.pid)) {
        if (state.leaderPid !== info.pid) {
          // Time a new leader from now, not from the last answer of the old one.
          state.leaderPid = info.pid;
          state.lastLeaderOk = Date.now();
        }
        if (info.proxy === false) {
          state.role = "peer";
          return;
        }
        if (info.proxy === true) {
          const ok = await ping(sock, 2000);
          if (ok && ok.pid === info.pid) {
            state.role = "follower";
            state.lastLeaderOk = Date.now();
            log(`follower: forwarding requests to leader ${info.pid}`);
            return;
          }
        }
        // Leader is still opening its socket, or is not answering.
        if (Date.now() > deadline) {
          log(`leader ${info.pid} is not answering; serving locally until it does`);
          if (state.role !== "peer") {
            try { if (beforeLead) beforeLead(); } catch (_) { /* best effort */ }
          }
          state.role = "peer";
          return;
        }
        await sleep(250);
        continue;
      }
      // No lock, or the process that held it is gone. Only the new leader
      // replaces the socket file, so nobody can delete a socket in use.
      if (info) removeStaleLock(info.pid);
      try {
        fs.mkdirSync(path.dirname(lock), { recursive: true });
        fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, proxy: null, startedAt: new Date().toISOString() }), { flag: "wx" });
        return becomeLeader();
      } catch (e) {
        if (e.code === "EEXIST") continue; // another process won the race
        log(`cannot create ${lock} (${e.message}); running without the guard`);
        return becomeLeader();
      }
    }
  }

  function reelect(reason) {
    if (state.electing) return state.electing;
    if (state.role === "leader") return Promise.resolve();
    log(`re-electing: ${reason}`);
    resetReady();
    state.electing = elect()
      .catch((e) => { log(`election failed: ${e.message}`); becomeLeader(); })
      .finally(() => { state.electing = null; markReady(); });
    return state.electing;
  }

  let watching = false;
  async function watch() {
    if (watching) return; // a slow ping must not stack up overlapping checks
    watching = true;
    try {
      await watchOnce();
    } finally {
      watching = false;
    }
  }

  async function watchOnce() {
    if (state.electing) return;
    if (state.role === "leader") return checkStillLeader();
    const info = readLock(lock);
    if (!info || !pidAlive(info.pid)) return reelect("leader process is gone");
    if (info.pid !== state.leaderPid) return reelect(`leader changed to ${info.pid}`);
    // Only a leader whose socket was confirmed working can be judged hung by
    // ping; otherwise (no socket, or still opening it) serve locally, never kill.
    if (info.proxy !== true) {
      if (state.role === "follower") reelect("leader has no working private socket");
      return;
    }
    const ok = await ping(sock, 5000);
    if (state.role === "leader" || state.electing) return;
    if (ok && ok.pid === info.pid) {
      state.lastLeaderOk = Date.now();
      if (state.role === "peer") reelect("leader is answering again");
      return;
    }
    if (Date.now() - state.lastLeaderOk > HUNG_MS) {
      // Re-check right before the kill: never signal a pid that has since
      // stopped being the leader (or been reused by another process).
      const now = readLock(lock);
      if (!now || now.pid !== info.pid || !pidAlive(info.pid)) return reelect("leader changed while checking");
      log(`leader ${info.pid} has not answered for ${Math.round((Date.now() - state.lastLeaderOk) / 1000)}s; stopping it`);
      try { process.kill(info.pid, "SIGKILL"); } catch (_) { /* already gone */ }
      state.killedHungLeader = { pid: info.pid, at: new Date().toISOString() };
      removeStaleLock(info.pid);
      return reelect("hung leader stopped");
    }
  }

  function forward(req, res) {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_HEADERS.has(k)) headers[k] = v;
    headers[VIA_HEADER] = String(process.pid);
    const preq = http.request({ socketPath: sock, method: req.method, path: req.url, headers, agent });
    preq.on("response", (pres) => {
      const out = {};
      for (const [k, v] of Object.entries(pres.headers)) if (!HOP_HEADERS.has(k)) out[k] = v;
      res.writeHead(pres.statusCode, pres.statusMessage, out);
      pres.pipe(res);
      pres.on("aborted", () => res.destroy());
    });
    preq.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "1", "Cache-Control": "no-store" });
        res.end("Fam ETC is restarting. Please try again in a moment.");
      } else {
        res.destroy();
      }
      if (["ECONNREFUSED", "ENOENT", "ECONNRESET"].includes(err.code)) reelect(`leader unreachable (${err.code})`);
    });
    res.on("close", () => { if (!res.writableFinished) preq.destroy(); });
    req.pipe(preq);
  }

  async function dispatch(req, res) {
    if (state.role === "deciding" || state.electing) await ready;
    if (state.role === "follower") return forward(req, res);
    return app(req, res);
  }

  const server = http.createServer((req, res) => {
    dispatch(req, res).catch((e) => {
      log(`dispatch failed: ${e.message}`);
      if (!res.headersSent) { res.writeHead(500); res.end(); }
    });
  });
  server.listen(listenTarget, onListening);

  reelect("startup");
  const watcher = setInterval(() => { watch().catch((e) => log(`watch failed: ${e.message}`)); }, WATCH_MS);
  if (watcher.unref) watcher.unref();

  process.on("exit", () => {
    if (state.role !== "leader") return;
    const info = readLock(lock);
    if (info && info.pid === process.pid) {
      safeUnlink(lock);
      safeUnlink(sock);
    }
  });

  serve.status = () => {
    const now = Date.now();
    const followers = [];
    for (const [pid, at] of state.followers) {
      if (now - at < 5 * 60 * 1000) followers.push({ pid, lastSeenSecondsAgo: Math.round((now - at) / 1000) });
      else state.followers.delete(pid);
    }
    return {
      guard: "on",
      pid: process.pid,
      role: state.role,
      leaderPid: state.leaderPid,
      since: state.since,
      forwarding: state.role === "leader" ? state.proxy === true : undefined,
      followers: state.role === "leader" ? followers : undefined,
      takeovers: state.takeovers || undefined,
      killedHungLeader: state.killedHungLeader || undefined,
    };
  };
  return server;
}

function status() {
  return typeof serve.status === "function" ? serve.status() : { guard: "off", pid: process.pid, role: "leader" };
}

module.exports = { serve, status, enabled, instancePaths, pidAlive, PING_PATH };

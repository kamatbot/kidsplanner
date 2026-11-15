"use strict";
// Tiny stand-in for server.js used by tests/single-instance.test.js. Each
// process records whether it started background jobs and answers with its pid.
const fs = require("fs");
const path = require("path");
const http = require("http");

// Mimic LiteSpeed's lsnode, which ignores every http.Server listen() after the
// first one ("http.Server.listen() was called more than once, ignore.").
if (process.env.FAM_TEST_LSNODE === "1") {
  const original = http.Server.prototype.listen;
  let called = false;
  http.Server.prototype.listen = function (...args) {
    if (called) {
      console.error("http.Server.listen() was called more than once, ignore.");
      return this;
    }
    called = true;
    return original.apply(this, args);
  };
}
const singleInstance = require("../../lib/single-instance");

const dataDir = process.env.FAM_DATA_DIR;
const app = (req, res) => {
  if (req.url === "/slow") {
    return setTimeout(() => res.end(String(process.pid)), 300);
  }
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    return req.on("end", () => {
      res.writeHead(201, { "Content-Type": "text/plain", "Set-Cookie": ["a=1", "b=2"] });
      res.end(`${process.pid}:${body}`);
    });
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(String(process.pid));
};
singleInstance.serve(app, {
  listenTarget: Number(process.env.PORT),
  dataDir,
  onListening: () => process.send && process.send({ listening: true }),
  onLeader: () => fs.appendFileSync(path.join(dataDir, "jobs.log"), `${process.pid}\n`),
  beforeLead: () => {},
});

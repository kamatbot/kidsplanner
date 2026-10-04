"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const preview = require("../lib/article-preview");
const publicDNS = async () => [{ address: "93.184.216.34", family: 4 }];
function requestFixture(responses, seen = []) {
  return (url, options, callback) => {
    seen.push(url.href);
    const req = new EventEmitter(); req.destroy = () => {};
    options.lookup(url.hostname, { all: true }, (error, addresses) => {
      assert.equal(error, null); assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]);
    });
    queueMicrotask(() => {
      const entry = responses.shift(); const res = new PassThrough();
      res.statusCode = entry.status || 200; res.headers = entry.headers || { "content-type": "text/html" };
      callback(res); res.end(entry.body || "<title>A thoughtful article</title>");
    });
    return req;
  };
}
test("URL and network guards deny internal, credentialed, unusual-port and non-HTTPS targets", async () => {
  for (const url of ["https://127.1", "https://2130706433/a", "https://[::ffff:127.0.0.1]", "https://localhost", "https://metadata.google.internal", "http://www.nasa.gov", "https://a:b@www.nasa.gov", "https://www.nasa.gov:444/"]) assert.throws(() => preview.articleURL(url));
  for (const ip of ["0.1.1.1", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.31.1.1", "192.168.1.1", "198.18.0.1", "224.0.0.1", "::1"]) assert.equal(preview.publicIPv4(ip), false, ip);
  await assert.rejects(preview.fetchHTML("https://www.nasa.gov", { lookup: async () => [...await publicDNS(), { address: "10.0.0.1" }], request: () => assert.fail("unsafe socket") }), /safely/);
});
test("pins the socket address, follows only revalidated redirects, bounds bodies and never imports publisher HTML", async () => {
  const seen = [];
  const data = await preview.preview("https://www.nasa.gov/a", { lookup: publicDNS, request: requestFixture([
    { status: 302, headers: { location: "/b" } },
    { body: '<title>Fallback</title><meta property="og:title" content="A &amp; B"><meta name="description" content="&lt;script&gt;alert(1)&lt;/script&gt; Safe science story">' },
  ], seen) });
  assert.deepEqual(seen, ["https://www.nasa.gov/a", "https://www.nasa.gov/b"]);
  assert.equal(data.headline, "A & B"); assert.equal(data.summary, "Safe science story");
  await assert.rejects(preview.fetchHTML("https://www.nasa.gov", { lookup: publicDNS, request: requestFixture([{ status: 302, headers: { location: "https://169.254.169.254/latest" } }]) }));
  await assert.rejects(preview.fetchHTML("https://www.nasa.gov", { lookup: publicDNS, request: requestFixture([{ body: "a".repeat(512 * 1024 + 1) }]) }), /too large/);
  await assert.rejects(preview.fetchHTML("https://www.nasa.gov", { lookup: publicDNS, request: requestFixture([{ headers: { "content-type": "application/pdf" } }]) }), /HTML preview/);
});

"use strict";

const dns = require("node:dns");
const https = require("node:https");
const net = require("node:net");
const MAX_BYTES = 512 * 1024;

function publicIPv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
}

function articleURL(value) {
  if (typeof value !== "string" || value.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(value)) throw new Error("Use a public HTTPS article link.");
  let url;
  try { url = new URL(value); } catch (_) { throw new Error("Use a public HTTPS article link."); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || !url.hostname.includes(".") || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)
    || (net.isIP(url.hostname.replace(/^\[|\]$/g, "")) && !publicIPv4(url.hostname))) {
    throw new Error("Use a public HTTPS article link.");
  }
  url.hash = "";
  return url;
}

// Pin the actual socket lookup to the validated DNS result, including every
// redirect. No credentials, cookies or other application headers go upstream.
// ponytail: IPv4-only publisher fetching; add verified public IPv6 ranges if
// a supported publisher becomes IPv6-only. Never fall back to unchecked DNS.
async function fetchHTML(value, options = {}) {
  const lookup = options.lookup || dns.promises.lookup;
  const request = options.request || https.get;
  const deadline = Date.now() + 12000;
  let url = articleURL(value);
  for (let hop = 0; hop <= 3; hop++) {
    let timer;
    const addresses = await Promise.race([
      lookup(url.hostname, { family: 4, all: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Article preview timed out.")), Math.max(1, deadline - Date.now())); }),
    ]).finally(() => clearTimeout(timer));
    if (!addresses.length || addresses.some(({ address }) => !publicIPv4(address))) throw new Error("This article link cannot be fetched safely.");
    if (Date.now() >= deadline) throw new Error("Article preview timed out.");
    const result = await new Promise((resolve, reject) => {
      let settled = false;
      let timeout;
      const finish = (error, result) => {
        if (settled) return;
        settled = true; clearTimeout(timeout);
        if (error) reject(error); else resolve(result);
      };
      const req = request(url, {
        agent: false,
        headers: { accept: "text/html", "accept-encoding": "identity", "user-agent": "FamETC-ArticlePreview/1.0" },
        lookup(_host, opts, callback) {
          const address = { address: addresses[0].address, family: 4 };
          if (opts.all) callback(null, [address]); else callback(null, address.address, 4);
        },
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          finish(null, { redirect: res.headers.location }); res.destroy(); return;
        }
        if (res.statusCode !== 200 || !/^text\/html\b/i.test(res.headers["content-type"] || "")
          || ![undefined, "identity"].includes(res.headers["content-encoding"])) {
          finish(new Error("Publisher did not provide an HTML preview. Enter the title yourself.")); res.destroy(); return;
        }
        let size = 0; const chunks = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) { finish(new Error("Article preview is too large. Enter the title yourself.")); res.destroy(); }
          else chunks.push(chunk);
        });
        res.on("end", () => finish(null, { html: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", () => finish(new Error("Could not read article preview.")));
        res.on("aborted", () => finish(new Error("Article preview was interrupted.")));
      });
      req.on("error", () => finish(new Error("Could not reach this publisher. Enter the title yourself.")));
      timeout = setTimeout(() => { finish(new Error("Article preview timed out.")); req.destroy(); }, Math.max(1, deadline - Date.now()));
    });
    if (result.html !== undefined) return { html: result.html, url: url.href };
    if (!result.redirect || hop === 3) throw new Error("Article link redirects too many times.");
    url = articleURL(new URL(result.redirect, url).href);
  }
}

function metadata(html, url) {
  // Reuse the feed parser's text-only sanitization and entity handling.
  const clean = require("./news").cleanText;
  const meta = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4];
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (key && attrs.content && !meta[key]) meta[key] = attrs.content;
  }
  return {
    url, source: new URL(url).hostname.replace(/^www\./, ""),
    headline: clean(meta["og:title"] || /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "", 240),
    summary: clean(meta["og:description"] || meta.description || "", 800).split(/\s+/).slice(0, 25).join(" "),
  };
}

async function preview(url, options) {
  const result = await fetchHTML(url, options);
  return metadata(result.html, result.url);
}
module.exports = { articleURL, publicIPv4, fetchHTML, metadata, preview };

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mock } = require("node:test");

const MODULE_PATH = require.resolve("../lib/news");
const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function freshNews() {
  delete require.cache[MODULE_PATH];
  return require(MODULE_PATH);
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function item({ title, date, url, summary = "A short summary.", category, includeDate = true }) {
  const fields = [];
  if (title !== undefined) fields.push(`<title>${title}</title>`);
  if (summary !== undefined) fields.push(`<description>${summary}</description>`);
  if (url !== undefined) fields.push(`<link>${url}</link>`);
  if (category !== undefined) fields.push(`<category>${category}</category>`);
  if (includeDate && date !== undefined) fields.push(`<pubDate>${date}</pubDate>`);
  return `<item>${fields.join("")}</item>`;
}

function feed(items) {
  return `<rss version="2.0"><channel>${items.join("")}</channel></rss>`;
}

function textResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "" },
    text: async () => body,
  };
}

function streamResponse(chunks, status = 200) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
      controller.close();
    },
  });
  return { ok: status >= 200 && status < 300, status, body };
}

test("recent NASA news filters the boundary, sanitizes text, orders, deduplicates, and maps categories", async () => {
  const duplicateUrl = "https://www.nasa.gov/news/duplicate";
  const xml = feed([
    item({ title: "Too old", date: iso(NOW - 15 * DAY), url: "https://www.nasa.gov/news/old" }),
    item({ title: "Invalid date", date: "not a date", url: "https://www.nasa.gov/news/invalid" }),
    item({ title: "Missing date", url: "https://www.nasa.gov/news/missing" }),
    item({ title: undefined, date: iso(NOW - DAY), url: "https://www.nasa.gov/news/no-title" }),
    item({ title: "Too far ahead", date: iso(NOW + 61 * 60 * 1000), url: "https://www.nasa.gov/news/future" }),
    item({ title: "Wrong protocol", date: iso(NOW - DAY), url: "http://www.nasa.gov/news/http" }),
    item({ title: "Wrong host", date: iso(NOW - DAY), url: "https://example.com/news" }),
    item({ title: "Lookalike host", date: iso(NOW - DAY), url: "https://nasa.gov.example.com/news" }),
    item({
      title: "Older duplicate",
      date: iso(NOW - 2 * DAY),
      url: duplicateUrl,
      summary: "The older copy.",
    }),
    item({
      title: "Newer duplicate",
      date: iso(NOW - DAY),
      url: duplicateUrl,
      summary: "The newer copy.",
    }),
    item({
      title: "<![CDATA[<b>Fresh &amp; Flight</b>]]>",
      date: iso(NOW - 3 * DAY),
      url: "https://science.nasa.gov/news/tech",
      category: "Technology",
      summary: "<![CDATA[<p>Launch &amp; <strong>science</strong> &hellip; &#x1F680;</p>]]>",
    }),
    item({ title: "Climate watch", date: iso(NOW - 4 * DAY), url: "https://earth.nasa.gov/news/climate", category: "Environment" }),
    item({ title: "Science update", date: iso(NOW - 5 * DAY), url: "https://science.nasa.gov/news/update", category: "Science" }),
    item({ title: "A space story", date: iso(NOW - 6 * DAY), url: "https://www.nasa.gov/news/space", category: "NASA" }),
    item({ title: "Fresh boundary", date: iso(NOW - (13 * DAY + 23 * 60 * 60 * 1000)), url: "https://www.nasa.gov/news/boundary" }),
    item({ title: "Allowed one-hour future", date: iso(NOW + 30 * 60 * 1000), url: "https://www.nasa.gov/news/soon" }),
  ]);
  let calls = 0;
  let calledUrl = "";
  const result = await freshNews().getRecentNews({
    now: NOW,
    fetch: async (url) => {
      calls++;
      calledUrl = url;
      return textResponse(xml);
    },
  });

  assert.equal(calls, 1);
  assert.equal(calledUrl, "https://www.nasa.gov/feed/");
  assert.equal(result.maxAgeDays, 14);
  assert.deepEqual(result.items.map((news) => news.headline), [
    "Allowed one-hour future",
    "Newer duplicate",
    "Fresh & Flight",
    "Climate watch",
    "Science update",
    "A space story",
    "Fresh boundary",
  ]);
  assert.equal(result.items[1].id, duplicateUrl);
  assert.equal(result.items[2].cat, "💡 Tech");
  assert.equal(result.items[3].cat, "🌿 Environment");
  assert.equal(result.items[4].cat, "🔬 Science");
  assert.equal(result.items[5].cat, "🚀 Space");
  assert.equal(result.items[2].summary, "Launch & science … 🚀");
  assert.equal(result.items.every((news) => news.source === "NASA"), true);
  assert.equal(result.items.every((news) => news.url.startsWith("https://") && new URL(news.url).hostname.endsWith("nasa.gov")), true);
  assert.equal(result.items.some((news) => news.headline === "Too old"), false);
});

test("successful results are cached for 30 minutes, then a failed fetch reuses only still-fresh items", async () => {
  const xml = feed([
    item({ title: "Still fresh", date: iso(NOW - 2 * DAY), url: "https://www.nasa.gov/news/fresh" }),
  ]);
  const news = freshNews();
  let calls = 0;
  const fetch = async () => {
    calls++;
    if (calls > 1) throw new Error("network down");
    return textResponse(xml);
  };

  const first = await news.getRecentNews({ now: NOW, fetch });
  const hit = await news.getRecentNews({ now: NOW + 29 * 60 * 1000, fetch });
  const staleFallback = await news.getRecentNews({ now: NOW + 31 * 60 * 1000, fetch });

  assert.equal(calls, 2);
  assert.deepEqual(hit, first);
  assert.deepEqual(staleFallback.items.map((item) => item.headline), ["Still fresh"]);
  assert.equal(staleFallback.maxAgeDays, 14);
});

test("an expired cache is re-filtered on a failed fetch instead of returning stale news", async () => {
  const xml = feed([
    item({
      title: "At the 14-day edge",
      date: iso(NOW - (13 * DAY + 23 * 60 * 60 * 1000)),
      url: "https://www.nasa.gov/news/edge",
    }),
  ]);
  const news = freshNews();
  await news.getRecentNews({ now: NOW, fetch: async () => textResponse(xml) });
  const result = await news.getRecentNews({
    now: NOW + 2 * 60 * 60 * 1000,
    fetch: async () => { throw new Error("network down"); },
  });

  assert.deepEqual(result, { items: [], maxAgeDays: 14 });
});

test("a fetch failure without a cache returns the stable empty DTO", async () => {
  const result = await freshNews().getRecentNews({
    now: NOW,
    fetch: async () => { throw new Error("network down"); },
  });
  assert.deepEqual(result, { items: [], maxAgeDays: 14 });
});

test("caps the feed body at 512 KiB and never parses an oversized response", async () => {
  const oversized = "x".repeat(512 * 1024 + 1);
  const result = await freshNews().getRecentNews({
    now: NOW,
    fetch: async () => streamResponse([oversized]),
  });
  assert.deepEqual(result, { items: [], maxAgeDays: 14 });
});

test("aborts a request after five seconds", async () => {
  const news = freshNews();
  let aborted = false;
  mock.timers.enable();
  try {
    const pending = news.getRecentNews({
      now: NOW,
      fetch: async (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        }, { once: true });
      }),
    });
    mock.timers.tick(5000);
    const result = await pending;
    assert.equal(aborted, true);
    assert.deepEqual(result, { items: [], maxAgeDays: 14 });
  } finally {
    mock.timers.reset();
  }
});

test("limits output to 20 newest unique items and bounds text fields", async () => {
  const entries = [];
  for (let index = 0; index < 25; index++) {
    entries.push(item({
      title: index === 0 ? "H".repeat(500) : `Story ${index}`,
      date: iso(NOW - index * 60 * 60 * 1000),
      url: `https://www.nasa.gov/news/${index}`,
      summary: index === 0 ? `<p>${"S".repeat(2000)}</p>` : "Summary",
    }));
  }
  const result = await freshNews().getRecentNews({
    now: NOW,
    fetch: async () => textResponse(feed(entries)),
  });

  assert.equal(result.items.length, 20);
  assert.equal(result.items[0].headline.length, 240);
  assert.equal(result.items[0].summary.length, 800);
  assert.equal(result.items[19].headline, "Story 19");
  assert.deepEqual(new Set(result.items.map((item) => item.url)).size, 20);
});

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

function item({ title, date, url, summary = "A short summary.", category, categories, includeDate = true }) {
  const fields = [];
  if (title !== undefined) fields.push(`<title>${title}</title>`);
  if (summary !== undefined) fields.push(`<description>${summary}</description>`);
  if (url !== undefined) fields.push(`<link>${url}</link>`);
  if (category !== undefined) fields.push(`<category>${category}</category>`);
  for (const value of categories || []) fields.push(`<category><![CDATA[${value}]]></category>`);
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

test("a configured production feed filters fresh stories across varied domains", async () => {
  const duplicateUrl = "https://www.snexplores.org/news/duplicate";
  const testFeed = {
    url: "https://www.snexplores.org/feed/",
    source: "Science News Explores",
    hosts: ["snexplores.org"],
    production: true,
    defaultCategory: "🔬 Science",
  };
  const xml = feed([
    item({ title: "Too old", date: iso(NOW - 15 * DAY), url: "https://www.snexplores.org/news/old" }),
    item({ title: "Invalid date", date: "not a date", url: "https://www.snexplores.org/news/invalid" }),
    item({ title: "Missing date", url: "https://www.snexplores.org/news/missing" }),
    item({ title: undefined, date: iso(NOW - DAY), url: "https://www.snexplores.org/news/no-title" }),
    item({ title: "Too far ahead", date: iso(NOW + 61 * 60 * 1000), url: "https://www.snexplores.org/news/future" }),
    item({ title: "Wrong protocol", date: iso(NOW - DAY), url: "http://www.snexplores.org/news/http" }),
    item({ title: "Wrong host", date: iso(NOW - DAY), url: "https://example.com/news" }),
    item({ title: "Lookalike host", date: iso(NOW - DAY), url: "https://snexplores.org.example.com/news" }),
    item({ title: "Crossword solution", date: iso(NOW - DAY), url: "https://www.snexplores.org/news/puzzle" }),
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
      url: "https://www.snexplores.org/news/tech",
      category: "Technology",
      summary: "<![CDATA[<p>Launch &amp; <strong>science</strong> &hellip; &#x1F680;</p>]]>",
    }),
    item({ title: "Climate watch", date: iso(NOW - 4 * DAY), url: "https://www.snexplores.org/news/climate", category: "Environment" }),
    item({ title: "Science update", date: iso(NOW - 5 * DAY), url: "https://www.snexplores.org/news/update", category: "Science" }),
    item({ title: "A space story", date: iso(NOW - 6 * DAY), url: "https://www.snexplores.org/news/space", category: "Space" }),
    item({ title: "Planet fossil discovery", date: iso(NOW - 7 * DAY), url: "https://www.snexplores.org/news/fossil", categories: ["Feature", "Fossils"] }),
    item({ title: "Unclassified research", date: iso(NOW - 8 * DAY), url: "https://www.snexplores.org/news/general", category: "Research update" }),
    item({ title: "Fresh boundary", date: iso(NOW - (13 * DAY + 23 * 60 * 60 * 1000)), url: "https://www.snexplores.org/news/boundary", category: "Nature" }),
    item({ title: "Allowed one-hour future", date: iso(NOW + 30 * 60 * 1000), url: "https://www.snexplores.org/news/soon", category: "Health" }),
  ]);
  let calls = 0;
  let calledUrl = "";
  const result = await freshNews().getRecentNews({
    now: NOW,
    feeds: [testFeed],
    fetch: async (url) => {
      calls++;
      calledUrl = url;
      return textResponse(xml);
    },
  });

  assert.equal(calls, 1);
  assert.equal(calledUrl, "https://www.snexplores.org/feed/");
  assert.equal(result.maxAgeDays, 14);
  assert.deepEqual(result.items.map((news) => news.headline), [
    "Allowed one-hour future",
    "Newer duplicate",
    "Fresh & Flight",
    "Climate watch",
    "Science update",
    "A space story",
    "Planet fossil discovery",
    "Unclassified research",
    "Fresh boundary",
  ]);
  assert.equal(result.items[1].id, duplicateUrl);
  assert.equal(result.items[2].cat, "💡 Tech");
  assert.equal(result.items[3].cat, "🌿 Environment");
  assert.equal(result.items[4].cat, "🔬 Science");
  assert.equal(result.items[5].cat, "🚀 Space");
  assert.equal(result.items[6].cat, "🌱 Nature");
  assert.equal(result.items[7].cat, "🔬 Science");
  assert.equal(result.items[2].summary, "Launch & science … 🚀");
  assert.equal(result.items.every((news) => news.source === "Science News Explores"), true);
  assert.equal(result.items.every((news) => typeof news.question === "string" && news.question.endsWith("?")), true);
  assert.equal(result.items.every((news) => news.url.startsWith("https://") && (new URL(news.url).hostname === "snexplores.org" || new URL(news.url).hostname.endsWith(".snexplores.org"))), true);
  assert.equal(result.items.some((news) => news.headline === "Too old"), false);
  assert.equal(result.items.some((news) => news.headline === "Crossword solution"), false);
});

test("production feed registry covers trusted world, tech, health, environment, and science publishers", () => {
  const news = freshNews();
  const expected = [
    ["https://www.snexplores.org/feed/", "Science News Explores", "🔬 Science"],
    ["https://news.un.org/feed/subscribe/en/news/all/rss.xml", "UN News", "🌍 World"],
    ["https://feeds.bbci.co.uk/news/world/rss.xml", "BBC World", "🌍 World"],
    ["https://feeds.bbci.co.uk/news/technology/rss.xml", "BBC Technology", "💡 Tech"],
    ["https://feeds.bbci.co.uk/news/health/rss.xml", "BBC Health", "🩺 Health"],
    ["https://www.technologyreview.com/feed/", "MIT Technology Review", "💡 Tech"],
    ["https://www.who.int/rss-feeds/news-english.xml", "WHO News", "🩺 Health"],
    ["https://www.noaa.gov/rss.xml", "NOAA", "🌿 Environment"],
    ["https://www.smithsonianmag.com/rss/science-nature/", "Smithsonian Magazine", "🔬 Science"],
  ];

  assert.deepEqual(news.FEEDS.map((feed) => [feed.url, feed.source, feed.defaultCategory]), expected);
  for (const feed of news.FEEDS) {
    const hostname = new URL(feed.url).hostname;
    assert.equal(new URL(feed.url).protocol, "https:");
    assert.equal(feed.production, true);
    assert.ok(feed.hosts.length > 0);
    assert.ok(feed.hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`)));
  }
  assert.ok(news.FEEDS.some((feed) => feed.defaultCategory === "🌍 World"));
  assert.ok(news.FEEDS.some((feed) => feed.defaultCategory === "💡 Tech"));
  assert.ok(news.FEEDS.some((feed) => feed.defaultCategory === "🩺 Health"));
  assert.ok(news.FEEDS.some((feed) => feed.defaultCategory === "🌿 Environment"));
  assert.ok(news.FEEDS.some((feed) => feed.defaultCategory === "🔬 Science"));
});

test("custom injected feeds remain available to focused parser tests", async () => {
  const primary = { url: "https://custom.example/feed/", source: "Custom source", hosts: ["custom.example"] };
  const secondary = { url: "https://science.custom.example/feed/", source: "Custom STEM", hosts: ["custom.example"] };
  const bodies = {
    [primary.url]: feed([item({ title: "A new Earth view", date: iso(NOW - DAY), url: "https://custom.example/earth/story", category: "Environment" })]),
    [secondary.url]: feed([item({ title: "Robot explores Mars", date: iso(NOW - 2 * DAY), url: "https://custom.example/robot", category: "Technology" })]),
  };
  const result = await freshNews().getRecentNews({
    now: NOW,
    feeds: [primary, secondary],
    fetch: async (url) => textResponse(bodies[url]),
  });
  assert.deepEqual(result.items.map((story) => story.source), ["Custom source", "Custom STEM"]);
  assert.match(result.items[0].question, /trade-off/);
  assert.match(result.items[1].question, /Who could/);
});

test("fresh multi-source results interleave sources while preserving each source's newest-first order", async () => {
  const feeds = [
    { url: "https://alpha.example/feed", source: "Alpha", hosts: ["alpha.example"], defaultCategory: "🌍 World" },
    { url: "https://beta.example/feed", source: "Beta", hosts: ["beta.example"], defaultCategory: "💡 Tech" },
    { url: "https://gamma.example/feed", source: "Gamma", hosts: ["gamma.example"], defaultCategory: "🩺 Health" },
  ];
  const bodies = {
    [feeds[0].url]: feed([
      item({ title: "Alpha newest", date: iso(NOW - DAY), url: "https://alpha.example/a-new" }),
      item({ title: "Alpha older", date: iso(NOW - 5 * DAY), url: "https://alpha.example/a-old" }),
    ]),
    [feeds[1].url]: feed([
      item({ title: "Beta newest", date: iso(NOW - 2 * DAY), url: "https://beta.example/b-new" }),
      item({ title: "Beta older", date: iso(NOW - 6 * DAY), url: "https://beta.example/b-old" }),
    ]),
    [feeds[2].url]: feed([
      item({ title: "Gamma newest", date: iso(NOW - 3 * DAY), url: "https://gamma.example/g-new" }),
      item({ title: "Gamma older", date: iso(NOW - 7 * DAY), url: "https://gamma.example/g-old" }),
    ]),
  };
  const result = await freshNews().getRecentNews({
    now: NOW,
    feeds,
    fetch: async (url) => textResponse(bodies[url]),
  });

  assert.deepEqual(result.items.map((story) => story.source), ["Alpha", "Beta", "Gamma", "Alpha", "Beta", "Gamma"]);
  assert.deepEqual(result.items.map((story) => story.headline), [
    "Alpha newest", "Beta newest", "Gamma newest", "Alpha older", "Beta older", "Gamma older",
  ]);
  assert.equal(new Set(result.items.map((story) => story.url)).size, result.items.length);
});

test("partial feed failures still return successful sources and default categories/questions", async () => {
  const feeds = [
    { url: "https://world.example/feed", source: "World source", hosts: ["world.example"], defaultCategory: "🌍 World" },
    { url: "https://broken.example/feed", source: "Broken source", hosts: ["broken.example"], defaultCategory: "💡 Tech" },
    { url: "https://culture.example/feed", source: "Culture source", hosts: ["culture.example"], defaultCategory: "🏛️ Culture" },
  ];
  const result = await freshNews().getRecentNews({
    now: NOW,
    feeds,
    fetch: async (url) => {
      if (url === feeds[1].url) throw new Error("offline");
      return textResponse(feed([
        item({ title: url === feeds[0].url ? "An unclassified current update" : "An unclassified archive update", date: iso(NOW - DAY), url: `${url}/story` }),
      ]));
    },
  });

  assert.deepEqual(result.items.map((story) => story.source), ["World source", "Culture source"]);
  assert.equal(result.items[0].cat, "🌍 World");
  assert.equal(result.items[1].cat, "🏛️ Culture");
  assert.match(result.items[0].question, /evidence/);
  assert.match(result.items[1].question, /perspective/);
});

test("a feed redirect outside its trusted hosts fails closed", async () => {
  const testFeed = {
    url: "https://trusted.example/feed",
    source: "Trusted source",
    hosts: ["trusted.example"],
    defaultCategory: "🌍 World",
  };
  const result = await freshNews().getRecentNews({
    now: NOW,
    feeds: [testFeed],
    fetch: async () => ({
      ...textResponse(feed([
        item({ title: "Untrusted redirect", date: iso(NOW - DAY), url: "https://trusted.example/story" }),
      ])),
      url: "https://untrusted.example/feed",
    }),
  });

  assert.deepEqual(result, { items: [], maxAgeDays: 14 });
});

test("category-specific reflection prompts cover global events, medicine, environment, and culture", () => {
  const news = freshNews();
  assert.match(news.questionFor("🌍 World", "A global event"), /who could be affected/i);
  assert.match(news.questionFor("🩺 Health", "A medical study"), /evidence/i);
  assert.match(news.questionFor("🌿 Environment", "A climate decision"), /trade-off/i);
  assert.match(news.questionFor("🏛️ Culture", "A history discovery"), /perspective/i);
  assert.match(news.questionFor("🔬 Science", "A research result"), /evidence/i);
});

test("successful results are cached for 30 minutes, then a failed fetch reuses only still-fresh items", async () => {
  const testFeed = { url: "https://example.test/feed", source: "Test source", hosts: ["example.test"] };
  const xml = feed([
    item({ title: "Still fresh", date: iso(NOW - 2 * DAY), url: "https://example.test/news/fresh" }),
  ]);
  const news = freshNews();
  let calls = 0;
  const fetch = async () => {
    calls++;
    if (calls > 1) throw new Error("network down");
    return textResponse(xml);
  };

  const first = await news.getRecentNews({ now: NOW, feeds: [testFeed], fetch });
  const hit = await news.getRecentNews({ now: NOW + 29 * 60 * 1000, feeds: [testFeed], fetch });
  const staleFallback = await news.getRecentNews({ now: NOW + 31 * 60 * 1000, feeds: [testFeed], fetch });

  assert.equal(calls, 2);
  assert.deepEqual(hit, first);
  assert.deepEqual(staleFallback.items.map((item) => item.headline), ["Still fresh"]);
  assert.equal(staleFallback.maxAgeDays, 14);
});

test("an expired cache is re-filtered on a failed fetch instead of returning stale news", async () => {
  const testFeed = { url: "https://example.test/feed", source: "Test source", hosts: ["example.test"] };
  const xml = feed([
    item({
      title: "At the 14-day edge",
      date: iso(NOW - (13 * DAY + 23 * 60 * 60 * 1000)),
      url: "https://example.test/news/edge",
    }),
  ]);
  const news = freshNews();
  await news.getRecentNews({ now: NOW, feeds: [testFeed], fetch: async () => textResponse(xml) });
  const result = await news.getRecentNews({
    now: NOW + 2 * 60 * 60 * 1000,
    feeds: [testFeed],
    fetch: async () => { throw new Error("network down"); },
  });

  assert.deepEqual(result, { items: [], maxAgeDays: 14 });
});

test("all failed feeds fall back to a cache that is still freshness-filtered", async () => {
  const feeds = [
    { url: "https://one.example/feed", source: "One", hosts: ["one.example"] },
    { url: "https://two.example/feed", source: "Two", hosts: ["two.example"] },
  ];
  const news = freshNews();
  await news.getRecentNews({
    now: NOW,
    feeds,
    fetch: async (url) => textResponse(feed([
      item({ title: url.includes("one") ? "Cached one" : "Cached two", date: iso(NOW - DAY), url: `${url}/story` }),
    ])),
  });
  const result = await news.getRecentNews({
    now: NOW + 31 * 60 * 1000,
    feeds,
    fetch: async () => { throw new Error("all feeds offline"); },
  });

  assert.deepEqual(result.items.map((story) => story.source), ["One", "Two"]);
  assert.equal(result.maxAgeDays, 14);
});

test("a fetch failure without a cache returns the stable empty DTO", async () => {
  const result = await freshNews().getRecentNews({
    now: NOW,
    fetch: async () => { throw new Error("network down"); },
  });
  assert.deepEqual(result, { items: [], maxAgeDays: 14 });
});

test("caps the feed body at 512 KiB and never parses an oversized response", async () => {
  const testFeed = { url: "https://example.test/feed", source: "Test source", hosts: ["example.test"] };
  const oversized = "x".repeat(512 * 1024 + 1);
  const result = await freshNews().getRecentNews({
    now: NOW,
    feeds: [testFeed],
    fetch: async () => streamResponse([oversized]),
  });
  assert.deepEqual(result, { items: [], maxAgeDays: 14 });
});

test("aborts a request after five seconds", async () => {
  const testFeed = { url: "https://example.test/feed", source: "Test source", hosts: ["example.test"] };
  const news = freshNews();
  let aborted = false;
  mock.timers.enable();
  try {
    const pending = news.getRecentNews({
      now: NOW,
      feeds: [testFeed],
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
  const testFeed = { url: "https://example.test/feed", source: "Test source", hosts: ["example.test"] };
  const entries = [];
  for (let index = 0; index < 25; index++) {
    entries.push(item({
      title: index === 0 ? "H".repeat(500) : `Story ${index}`,
      date: iso(NOW - index * 60 * 60 * 1000),
      url: `https://example.test/news/${index}`,
      summary: index === 0 ? `<p>${"S".repeat(2000)}</p>` : "Summary",
    }));
  }
  const result = await freshNews().getRecentNews({
    now: NOW,
    feeds: [testFeed],
    fetch: async () => textResponse(feed(entries)),
  });

  assert.equal(result.items.length, 20);
  assert.equal(result.items[0].headline.length, 240);
  assert.equal(result.items[0].summary.length, 800);
  assert.equal(result.items[19].headline, "Story 19");
  assert.deepEqual(new Set(result.items.map((item) => item.url)).size, 20);
});

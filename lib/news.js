"use strict";

// The production feed is intentionally one stable, first-party source. Custom
// feeds are still accepted by the pure parser/fetch seam used in tests.
const FEEDS = Object.freeze([
  { url: "https://www.snexplores.org/feed/", source: "Science News Explores", hosts: ["snexplores.org"], production: true },
]);
const MAX_AGE_DAYS = 14;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 60 * 60 * 1000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_ITEMS = 20;
const MAX_HEADLINE_CHARS = 240;
const MAX_SUMMARY_CHARS = 800;
const MAX_URL_CHARS = 2048;

let cache = null;

const NAMED_ENTITIES = Object.freeze({
  amp: "&",
  apos: "'",
  bull: "•",
  copy: "©",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsaquo: "‹",
  lsquo: "‘",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  not: "¬",
  para: "¶",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  rsaquo: "›",
  rsquo: "’",
  reg: "®",
  trade: "™",
  gt: ">",
  lt: "<",
});

function decodeEntities(value) {
  let text = String(value == null ? "" : value);
  // A second pass handles the common XML form `&amp;lt;` without making the
  // parser depend on a browser DOM or a third-party HTML entity table.
  for (let pass = 0; pass < 2; pass++) {
    const decoded = text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, entity) => {
      const lower = entity.toLowerCase();
      if (lower[0] === "#") {
        const hexadecimal = lower[1] === "x";
        const digits = lower.slice(hexadecimal ? 2 : 1);
        const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
        if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff
          || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
          return match;
        }
        try {
          return String.fromCodePoint(codePoint);
        } catch (error) {
          return match;
        }
      }
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, lower)
        ? NAMED_ENTITIES[lower]
        : match;
    });
    if (decoded === text) break;
    text = decoded;
  }
  return text;
}

function unwrapCdata(value) {
  return String(value == null ? "" : value).replace(
    /<!\[CDATA\[([\s\S]*?)\]\]>/gi,
    "$1",
  );
}

function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  // Avoid returning half of a UTF-16 surrogate while keeping the bound easy
  // for callers to reason about using String#length.
  return text.slice(0, maxChars).replace(/[\uD800-\uDBFF]$/, "").trimEnd();
}

function cleanText(value, maxChars) {
  let text = decodeEntities(unwrapCdata(value));
  text = text
    .replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\s*br\s*\/?>/gi, " ")
    .replace(/<\/(?:p|div|li|h[1-6]|section|article|tr|blockquote)\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  text = decodeEntities(text).replace(/\s+/g, " ").trim();
  return truncate(text, maxChars);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTag(block, names) {
  for (const name of names) {
    const tag = escapeRegExp(name);
    const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`, "i").exec(block);
    if (match) return match[1];
  }
  return "";
}

function extractTags(block, names) {
  const values = [];
  for (const name of names) {
    const tag = escapeRegExp(name);
    const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi");
    let match;
    while ((match = pattern.exec(block))) values.push(match[1]);
  }
  return values;
}

function extractAttribute(attributes, name) {
  const attr = escapeRegExp(name);
  const match = new RegExp(`(?:^|\\s)${attr}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(attributes);
  return match ? match[2] : "";
}

function extractLink(block) {
  const withBody = /<link\b([^>]*)>([\s\S]*?)<\/link\s*>/i.exec(block);
  if (withBody) {
    const href = extractAttribute(withBody[1], "href");
    const value = href || withBody[2];
    return decodeEntities(unwrapCdata(value)).replace(/<[^>]*>/g, "").trim();
  }
  const selfClosing = /<link\b([^>]*?)(?:\/\s*>|>)/i.exec(block);
  return selfClosing ? decodeEntities(extractAttribute(selfClosing[1], "href")).trim() : "";
}

function safeTrustedUrl(value, feed) {
  const raw = decodeEntities(unwrapCdata(value).trim());
  if (!raw || raw.length > MAX_URL_CHARS) return null;
  let url;
  try {
    url = new URL(raw);
  } catch (error) {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  const allowed = (feed.hosts || []).some((host) => hostname === host || hostname.endsWith(`.${host}`));
  if (url.protocol !== "https:" || url.username || url.password || !allowed) {
    return null;
  }
  return url.toString();
}

const SCIENCE_DOMAINS = Object.freeze([
  { pattern: /\b(?:space|astronomy|planet|planets|moon|mars|solar|stars|universe)\b/i, cat: "🚀 Space" },
  { pattern: /\b(?:health|medicine|medical|body|disease|nutrition|wellness|human|humans|brain)\b/i, cat: "🩺 Health" },
  { pattern: /\b(?:nature|animal|animals|wildlife|habitat|plant|plants|species|ecosystem|life|microbe|microbes|fossil|fossils)\b/i, cat: "🌱 Nature" },
  { pattern: /\b(?:environment|climate|earth|ecology|sustainability|carbon|wildfire|ocean|water|forest|conservation)\b/i, cat: "🌿 Environment" },
  { pattern: /\b(?:technology|tech|robot|robotics|software|engineering|innovation|invention|artificial intelligence|\bai\b)\b/i, cat: "💡 Tech" },
  { pattern: /\b(?:science|research|biology|physics|chemistry|experiment|scientist)\b/i, cat: "🔬 Science" },
]);

function scienceCategory(section, topic, headline) {
  const text = `${section} ${topic} ${headline}`.toLowerCase();
  return SCIENCE_DOMAINS.find((domain) => domain.pattern.test(text))?.cat || null;
}

function categoryFor(category, headline) {
  return scienceCategory(cleanText(category, 240), "", "")
    || scienceCategory("", "", headline)
    || "🔬 Science";
}

const NON_ARTICLE_HEADLINE = /\b(?:crossword|word[- ]search|answer key|subscription|subscribe|site survey)\b/i;

function firstNonEmptyTag(block, names) {
  for (const name of names) {
    const value = extractTag(block, [name]);
    if (cleanText(value, MAX_SUMMARY_CHARS)) return value;
  }
  return "";
}

function questionFor(category, headline) {
  const text = `${category} ${headline}`.toLowerCase();
  if (/health|medicine|medical|body|disease|nutrition/.test(text)) {
    return "How could this science help people, and what would scientists need to learn next?";
  }
  if (/nature|animal|wildlife|habitat|plant|ecosystem/.test(text)) {
    return "How might this change what we know about living things, and what should we observe next?";
  }
  if (/environment|climate|earth|ocean|water|forest|wildfire/.test(text)) {
    return "What could people do differently because of this story, and what trade-off might they face?";
  }
  if (/tech|robot|software|engineering|artificial intelligence|\bai\b/.test(text)) {
    return "Who could this discovery help, and what problem should its creators think about next?";
  }
  return "What new question should scientists investigate next, and why would its answer matter?";
}

function parseEntry(block, feed) {
  const headline = cleanText(extractTag(block, ["title"]), MAX_HEADLINE_CHARS);
  if (!headline) return null;

  if (feed.production && NON_ARTICLE_HEADLINE.test(headline)) return null;

  const summarySource = firstNonEmptyTag(block, ["content:encoded", "description", "summary", "content"]);
  const summary = cleanText(summarySource, MAX_SUMMARY_CHARS);
  const url = safeTrustedUrl(extractLink(block), feed);
  if (!url) return null;

  const dateText = cleanText(extractTag(block, ["pubDate", "published", "updated", "dc:date"]), 120);
  const publishedMs = Date.parse(dateText);
  if (!Number.isFinite(publishedMs)) return null;

  const categories = extractTags(block, ["category", "dc:subject"]).join(" ");
  const cat = categoryFor(categories, headline);
  return {
    id: url,
    cat,
    headline,
    summary,
    url,
    publishedAt: new Date(publishedMs).toISOString(),
    source: feed.source,
    question: questionFor(cat, headline),
    publishedMs,
  };
}

function parseFeed(xml, feed = FEEDS[0]) {
  if (typeof xml !== "string") return [];
  const rssItems = xml.match(/<item\b[^>]*>[\s\S]*?<\/item\s*>/gi) || [];
  const entries = rssItems.length
    ? rssItems
    : (xml.match(/<entry\b[^>]*>[\s\S]*?<\/entry\s*>/gi) || []);
  return entries.map((entry) => parseEntry(entry, feed)).filter(Boolean);
}

function filterItems(items, nowMs) {
  const oldestAllowed = nowMs - MAX_AGE_MS;
  const newestAllowed = nowMs + MAX_FUTURE_MS;
  const sorted = items
    .filter((item) => Number.isFinite(item.publishedMs)
      && item.publishedMs >= oldestAllowed
      && item.publishedMs <= newestAllowed)
    .sort((a, b) => {
      const byDate = b.publishedMs - a.publishedMs;
      if (byDate) return byDate;
      return a.url < b.url ? -1 : (a.url > b.url ? 1 : 0);
    });

  const seen = new Set();
  const seenHeadlines = new Set();
  const unique = [];
  for (const item of sorted) {
    let storyKey = item.url;
    try {
      const url = new URL(item.url);
      url.hash = "";
      for (const name of [...url.searchParams.keys()]) {
        if (/^utm_/i.test(name) || /^(?:fbclid|gclid)$/i.test(name)) url.searchParams.delete(name);
      }
      url.pathname = url.pathname.replace(/\/+$/, "") || "/";
      storyKey = url.toString().toLowerCase();
    } catch (error) { /* parseEntry already rejects unsafe URLs */ }
    const headlineKey = cleanText(item.headline, MAX_HEADLINE_CHARS).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(storyKey) || (headlineKey && seenHeadlines.has(headlineKey))) continue;
    seen.add(storyKey);
    if (headlineKey) seenHeadlines.add(headlineKey);
    unique.push(item);
    if (unique.length === MAX_ITEMS) break;
  }
  return unique;
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  return Buffer.from(String(value == null ? "" : value), "utf8");
}

function getHeader(response, name) {
  if (!response || !response.headers) return "";
  if (typeof response.headers.get === "function") return response.headers.get(name) || "";
  return response.headers[name] || response.headers[name.toLowerCase()] || "";
}

function assertBodySize(received) {
  if (received > MAX_BODY_BYTES) throw new Error("Science News Explores feed response is too large.");
}

async function readCappedBody(response) {
  const contentLength = Number.parseInt(getHeader(response, "content-length"), 10);
  if (Number.isFinite(contentLength)) assertBodySize(contentLength);

  const chunks = [];
  let received = 0;
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = asBuffer(value);
        received += chunk.length;
        assertBodySize(received);
        chunks.push(chunk);
      }
    } catch (error) {
      try { await reader.cancel(); } catch (cancelError) { /* best effort */ }
      throw error;
    } finally {
      try { reader.releaseLock(); } catch (error) { /* already released */ }
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  if (response.body && typeof response.body[Symbol.asyncIterator] === "function") {
    for await (const value of response.body) {
      const chunk = asBuffer(value);
      received += chunk.length;
      assertBodySize(received);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  if (typeof response.arrayBuffer === "function") {
    const chunk = asBuffer(await response.arrayBuffer());
    assertBodySize(chunk.length);
    return chunk.toString("utf8");
  }

  if (typeof response.text === "function") {
    const chunk = asBuffer(await response.text());
    assertBodySize(chunk.length);
    return chunk.toString("utf8");
  }

  throw new Error("Science News Explores feed response has no readable body.");
}

async function fetchFeed(fetchImpl, feed) {
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable.");
  const controller = new AbortController();
  let timer;
  const request = (async () => {
    const response = await fetchImpl(feed.url, {
      signal: controller.signal,
      headers: { accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8" },
    });
    const status = Number(response && response.status);
    if (!response || response.ok === false || (Number.isFinite(status) && (status < 200 || status >= 300))) {
      throw new Error(`${feed.source} feed returned HTTP ${Number.isFinite(status) ? status : "an error"}.`);
    }
    return readCappedBody(response);
  })();
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const error = new Error(`${feed.source} feed request timed out.`);
      error.name = "AbortError";
      reject(error);
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function resolveNow(options) {
  const source = options && options.now;
  const value = typeof source === "function" ? source() : source;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : Date.now();
  const number = value == null ? Date.now() : Number(value);
  return Number.isFinite(number) ? number : Date.now();
}

function dto(items) {
  return {
    items: items.map((item) => ({
      id: item.id,
      cat: item.cat,
      headline: item.headline,
      summary: item.summary,
      url: item.url,
      publishedAt: item.publishedAt,
      source: item.source,
      question: item.question,
    })),
    maxAgeDays: MAX_AGE_DAYS,
  };
}

async function getRecentNews(options = {}) {
  const nowMs = resolveNow(options);
  if (cache && nowMs - cache.cachedAt < CACHE_TTL_MS) {
    return dto(filterItems(cache.items, nowMs));
  }

  try {
    const fetchImpl = options.fetch || options.fetchImpl || globalThis.fetch;
    const feeds = options.feeds || FEEDS;
    const settled = await Promise.allSettled(feeds.map(async (feed) => parseFeed(await fetchFeed(fetchImpl, feed), feed)));
    const freshItems = filterItems(settled.flatMap((result) => result.status === "fulfilled" ? result.value : []), nowMs);
    if (!freshItems.length && settled.every((result) => result.status === "rejected")) throw settled[0].reason;
    cache = { cachedAt: nowMs, items: freshItems };
    return dto(freshItems);
  } catch (error) {
    // A stale cache is only a temporary transport fallback. Re-run the full
    // time window so an old item can never escape through an outage.
    return dto(filterItems(cache ? cache.items : [], nowMs));
  }
}

module.exports = { getRecentNews, parseFeed, questionFor, FEEDS };

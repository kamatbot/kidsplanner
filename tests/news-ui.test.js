"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const publicRoot = path.join(__dirname, "..");
const authSource = fs.readFileSync(path.join(publicRoot, "public/js/auth.js"), "utf8");
const appSource = fs.readFileSync(path.join(publicRoot, "public/js/app.js"), "utf8");
const iosDashboardSource = fs.readFileSync(path.join(publicRoot, "ios/FamETC/Features/Today/DashboardWidgets.swift"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`async function ${name}(`) >= 0
    ? source.indexOf(`async function ${name}(`)
    : source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`could not extract ${name}`);
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, force) {
    const enabled = force === undefined ? !this.values.has(value) : !!force;
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.textContent = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.href = "";
    this.target = "";
    this.rel = "";
    this.saveButton = null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "href") this.href = String(value);
    if (name === "target") this.target = String(value);
    if (name === "rel") this.rel = String(value);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "href") this.href = "";
    if (name === "target") this.target = "";
    if (name === "rel") this.rel = "";
  }
  getAttribute(name) { return this.attributes.get(name) || null; }
  querySelector(selector) {
    return selector === ".fam-save-btn" ? this.saveButton : null;
  }
}

function newsDom() {
  const ids = [
    "news-badge",
    "news-headline",
    "news-summary",
    "news-link",
    "news-details",
    "news-more-btn",
    "news-reflect-prompt",
    "news-reflect-text",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  elements["news-details"].saveButton = new FakeElement();
  return elements;
}

function newsHelpers({ auth } = {}) {
  const elements = newsDom();
  const notes = [];
  const sandbox = {
    URL,
    Date,
    document: { getElementById: (id) => elements[id] || null },
    window: { auth: auth || { getRecentNews: async () => ({ items: [] }) } },
    dailyPick: (items) => items[0],
    saveNoteFromWidget: async (...args) => {
      notes.push(args);
      return { id: "note_1" };
    },
    toast: () => {},
  };
  const functions = [
    extractFunction(appSource, "newsUrlIsHttps"),
    extractFunction(appSource, "newsPublishedAtIsFresh"),
    extractFunction(appSource, "isRecentNewsItem"),
    extractFunction(appSource, "newsFreshnessLabel"),
    extractFunction(appSource, "newsArticleLink"),
    extractFunction(appSource, "setNewsLinkState"),
    extractFunction(appSource, "setNewsReflectionAvailability"),
    extractFunction(appSource, "clearNewsState"),
    extractFunction(appSource, "renderNewsLoading"),
    extractFunction(appSource, "renderNewsUnavailable"),
    extractFunction(appSource, "renderNewsItem"),
    extractFunction(appSource, "loadRecentNews"),
    extractFunction(appSource, "saveNewsReflection"),
    "const NEWS_MAX_AGE_DAYS = 14;",
    "const NEWS_MAX_AGE_MS = NEWS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;",
    "const NEWS_FUTURE_SKEW_MS = 60 * 60 * 1000;",
    "const NEWS_EMPTY_STATE = 'No recent stories right now.';",
    "let currentNews = null;",
    "let newsRequestToken = 0;",
    "this.news = { newsUrlIsHttps, newsPublishedAtIsFresh, isRecentNewsItem, newsFreshnessLabel, newsArticleLink, renderNewsLoading, renderNewsUnavailable, renderNewsItem, loadRecentNews, saveNewsReflection, currentNews: () => currentNews, setToken: (value) => { newsRequestToken = value; } };",
  ];
  vm.runInNewContext(functions.join("\n"), sandbox, { filename: "news-helpers.js" });
  return Object.assign(sandbox.news, { elements, notes, sandbox });
}

function item(now, ageHours, overrides = {}) {
  return Object.assign({
    id: "story_1",
    cat: "🔬 Science",
    headline: "Fresh discovery",
    summary: "A current summary.",
    url: "https://example.com/story-1",
    publishedAt: new Date(now.getTime() - ageHours * 60 * 60 * 1000).toISOString(),
    source: "UN News",
    question: "What should scientists investigate next, and why?",
  }, overrides);
}

test("recent-news auth wrapper uses the authenticated GET route", async () => {
  const calls = [];
  const payload = { items: [], maxAgeDays: 14 };
  const sandbox = {
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => payload };
    },
    window: {},
  };
  vm.runInNewContext(authSource, sandbox, { filename: "auth.js" });

  assert.deepEqual(await sandbox.window.auth.getRecentNews(), payload);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/news/recent");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "same-origin");
});

test("client accepts only fresh HTTPS stories and renders the source/freshness cue", async () => {
  const now = new Date("2026-08-10T12:00:00.000Z");
  const fresh = item(now, 13 * 24 + 23);
  const helpers = newsHelpers({ auth: {
    getRecentNews: async () => ({
      items: [
        fresh,
        item(now, 15 * 24),
        item(now, 2, { id: "future", headline: "Future story", publishedAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString() }),
        item(now, 2, { id: "invalid-date", publishedAt: "not-a-date" }),
        item(now, 2, { id: "http", url: "http://example.com/story" }),
      ],
      maxAgeDays: 14,
    }),
  } });

  helpers.renderNewsLoading();
  assert.equal(helpers.elements["news-headline"].textContent, "Loading recent stories…");
  assert.equal(helpers.elements["news-more-btn"].disabled, true);

  helpers.setToken(1);
  await helpers.loadRecentNews(1, now);

  assert.equal(helpers.currentNews(), fresh);
  assert.equal(helpers.newsPublishedAtIsFresh(fresh.publishedAt, now), true);
  assert.equal(helpers.isRecentNewsItem(item(now, 15 * 24), now), false);
  assert.equal(helpers.isRecentNewsItem(item(now, 2, { url: "http://example.com/story" }), now), false);
  assert.equal(helpers.newsFreshnessLabel(fresh.publishedAt, now), "13 days ago");
  assert.match(helpers.elements["news-badge"].textContent, /UN News · 13 days ago/);
  assert.equal(helpers.elements["news-headline"].textContent, "Fresh discovery");
  assert.equal(helpers.elements["news-summary"].textContent, "A current summary.");
  assert.equal(helpers.elements["news-headline"].href, fresh.url);
  assert.equal(helpers.elements["news-link"].href, fresh.url);
  assert.equal(helpers.elements["news-more-btn"].disabled, false);
  assert.equal(helpers.elements["news-reflect-text"].disabled, false);
  assert.equal(helpers.elements["news-details"].hidden, false);
  assert.equal(helpers.elements["news-reflect-prompt"].textContent, fresh.question);
});

test("client selects deterministically from the already-diversified API list", async () => {
  const now = new Date("2026-08-10T12:00:00.000Z");
  const second = item(now, 24, {
    id: "stem",
    headline: "How a telescope helps us see space",
    source: "Science News Explores",
  });
  const helpers = newsHelpers({ auth: {
    getRecentNews: async () => ({ items: [item(now, 1), second], maxAgeDays: 14 }),
  } });

  helpers.setToken(1);
  await helpers.loadRecentNews(1, now);

  assert.equal(helpers.currentNews().source, "UN News");
  assert.match(helpers.elements["news-badge"].textContent, /UN News/);
});

test("empty and error states remove stale story state and disable reflection actions", async () => {
  const now = new Date("2026-08-10T12:00:00.000Z");
  let mode = "empty";
  const helpers = newsHelpers({ auth: {
    getRecentNews: async () => {
      if (mode === "error") throw new Error("offline");
      return { items: [item(now, 15 * 24), item(now, 2, { url: "http://example.com/nope" })], maxAgeDays: 14 };
    },
  } });

  helpers.renderNewsItem(item(now, 2), now);
  helpers.elements["news-reflect-text"].value = "stale reflection";
  helpers.renderNewsUnavailable();
  assert.equal(helpers.currentNews(), null);
  assert.equal(helpers.elements["news-headline"].textContent, "No recent stories right now.");
  assert.equal(helpers.elements["news-headline"].getAttribute("href"), null);
  assert.equal(helpers.elements["news-link"].href, "");
  assert.equal(helpers.elements["news-more-btn"].hidden, true);
  assert.equal(helpers.elements["news-more-btn"].disabled, true);
  assert.equal(helpers.elements["news-reflect-text"].hidden, true);
  assert.equal(helpers.elements["news-reflect-text"].disabled, true);
  assert.equal(helpers.elements["news-reflect-text"].value, "");
  assert.equal(helpers.elements["news-details"].hidden, true);
  await helpers.saveNewsReflection();
  assert.equal(helpers.notes.length, 0);

  mode = "error";
  helpers.setToken(1);
  await helpers.loadRecentNews(1, now);
  assert.equal(helpers.currentNews(), null);
  assert.equal(helpers.elements["news-headline"].textContent, "No recent stories right now.");
});

test("stale news responses cannot overwrite a later render", async () => {
  const now = new Date("2026-08-10T12:00:00.000Z");
  const resolvers = [];
  const helpers = newsHelpers({ auth: {
    getRecentNews: () => new Promise((resolve) => resolvers.push(resolve)),
  } });

  helpers.setToken(1);
  const first = helpers.loadRecentNews(1, now);
  helpers.setToken(2);
  const second = helpers.loadRecentNews(2, now);

  const secondStory = item(now, 1, { id: "second", headline: "Second response" });
  resolvers[1]({ items: [secondStory], maxAgeDays: 14 });
  await second;
  assert.equal(helpers.currentNews(), secondStory);

  const firstStory = item(now, 1, { id: "first", headline: "Stale response" });
  resolvers[0]({ items: [firstStory], maxAgeDays: 14 });
  await first;
  assert.equal(helpers.currentNews(), secondStory);
  assert.equal(helpers.elements["news-headline"].textContent, "Second response");
});

test("valid stories still save reflections with the explicit article URL", async () => {
  const now = new Date("2026-08-10T12:00:00.000Z");
  const story = item(now, 2);
  const helpers = newsHelpers();
  helpers.renderNewsItem(story, now);
  helpers.elements["news-reflect-text"].value = "This matters to our family.";

  await helpers.saveNewsReflection();

  assert.equal(helpers.notes.length, 1);
  assert.equal(helpers.notes[0][0], "This matters to our family.");
  assert.equal(helpers.notes[0][1], "news");
  assert.match(helpers.notes[0][2].context, /https:\/\/example\.com\/story-1/);
  assert.equal(helpers.elements["news-reflect-text"].value, "");
});

test("the dashboard no longer contains a static news rotation", () => {
  assert.doesNotMatch(appSource, /\bNEWS_ITEMS\b/);
  assert.match(appSource, /window\.auth\.getRecentNews\(\)/);
  assert.match(appSource, /const requestToken = \+\+newsRequestToken/);
  assert.doesNotMatch(appSource, /NASA STEM|NASA Kids/);
  assert.doesNotMatch(iosDashboardSource, /NASA STEM|NASA Kids/);
  assert.match(iosDashboardSource, /news = items\[Daily\.index\(items\.count\)\]/);
});

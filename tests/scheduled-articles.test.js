"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
process.env.FAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fam-editor-test-"));
process.env.DATA_ENCRYPTION_KEY = "a".repeat(64);
const db = require("../lib/db");
const articles = require("../lib/scheduled-articles");
const NOW = Date.parse("2026-10-04T12:00:00Z");
const draft = (date = "2026-10-04", url = "https://www.nasa.gov/learning") => ({ date, url, headline: "A new view of space", summary: "A short invitation to read.", question: "What did you notice?" });
function reset() { db.load().scheduledArticles = []; }

test("one global pick goes live at Bangkok midnight, ends next midnight, and survives encrypted restart", async () => {
  reset();
  const future = articles.save(draft("2026-10-05"), null, NOW);
  assert.ok(future.article);
  assert.equal(await articles.featured(Date.parse("2026-10-04T16:59:59Z"), () => assert.fail("too early")), null);
  const calls = [];
  const pick = await articles.featured(Date.parse("2026-10-04T17:00:00Z"), async url => { calls.push(url); return { summary: "Fetched today" }; });
  assert.equal(pick.id, future.article.id);
  assert.equal(pick.scheduledFor, "2026-10-05");
  assert.equal(pick.publishedAt, "2026-10-04T17:00:00.000Z");
  assert.equal(calls.length, 1);
  await articles.featured(Date.parse("2026-10-05T08:00:00Z"), () => assert.fail("already fetched"));
  assert.equal(await articles.featured(Date.parse("2026-10-05T17:00:00Z")), null);
  db.persist(); db.flushSync();
  assert.match(fs.readFileSync(db.DB_FILE, "utf8"), /^ENC1:/);
  const child = spawnSync(process.execPath, ["-e", 'process.stdout.write(JSON.stringify(require("./lib/scheduled-articles").list()))'], { cwd: path.join(__dirname, ".."), env: process.env, encoding: "utf8" });
  assert.equal(child.status, 0);
  assert.equal(JSON.parse(child.stdout)[0].id, future.article.id);
});

test("validates dates, duplicate dates and unsafe links; edits and removals are immediate", async () => {
  reset();
  for (const date of ["2026-02-30", "2026-10-03", "2028-01-01", "oops"]) assert.equal(articles.save(draft(date), null, NOW).status, 400);
  for (const url of ["http://example.org", "https://127.0.0.1/a", "https://user:pw@example.org/", "https://example.org:444/a", "javascript:alert(1)"]) assert.equal(articles.save(draft(undefined, url), null, NOW).status, 400);
  const first = articles.save(draft(), null, NOW).article;
  assert.equal(articles.save(draft(), null, NOW).status, 409);
  const changed = articles.save({ ...draft(), headline: "Changed headline" }, first.id, NOW).article;
  assert.notEqual(changed.revision, first.revision);
  assert.equal((await articles.featured(NOW, async () => ({ summary: "" }))).headline, "Changed headline");
  assert.deepEqual(articles.remove(first.id), { ok: true });
  assert.equal(await articles.featured(NOW), null);
});

test("publisher outage uses saved content and concurrent requests share one bounded fetch", async () => {
  reset(); articles.save(draft(), null, NOW);
  let calls = 0;
  const unavailable = async () => { calls++; throw new Error("private error should not reach clients"); };
  const [a, b] = await Promise.all([articles.featured(NOW, unavailable), articles.featured(NOW, unavailable)]);
  assert.equal(calls, 1); assert.deepEqual(a, b); assert.equal(a.headline, draft().headline);
  assert.equal(a.fetchError, undefined);
  await articles.featured(NOW + 1000, unavailable); assert.equal(calls, 1);
  await articles.featured(NOW + 30 * 60000, unavailable); assert.equal(calls, 2);
});

test("editing or deleting during a fetch cannot resurrect the old article", async () => {
  reset(); const row = articles.save(draft(), null, NOW).article;
  let release; const gate = new Promise(resolve => { release = resolve; });
  const pending = articles.featured(NOW, async () => { await gate; return { summary: "stale content" }; });
  articles.remove(row.id); release();
  assert.equal(await pending, null); assert.equal(articles.list().length, 0);
});

test("daily response places the shared pick first, deduplicates its URL and retains automatic categories even on feed outage", async () => {
  reset();
  articles.save(draft(), null, NOW);
  await articles.featured(NOW, async () => ({ summary: "" }));
  const news = require("../lib/news");
  const feeds = [{ url: "https://www.nasa.gov/feed", source: "NASA", hosts: ["nasa.gov"] }];
  const result = await news.getDailyNews("2026-10-04", { now: NOW, feeds, fetch: async () => ({ status: 200, ok: true, text: async () => '<rss><item><title>Same article</title><link>https://www.nasa.gov/learning?utm_source=test</link><category>Science</category><pubDate>Sun, 04 Oct 2026 01:00:00 GMT</pubDate></item><item><title>Research into planets</title><link>https://www.nasa.gov/planets</link><category>Science</category><pubDate>Sun, 04 Oct 2026 01:00:00 GMT</pubDate></item></rss>' }) });
  assert.deepEqual(result.choices.map(row => row.category), ["featured", "regional", "science", "culture"]);
  assert.equal(result.items[0].headline, draft().headline);
  assert.equal(result.items.filter(item => item.url.includes("learning")).length, 1);
  assert.ok(result.choices[2].article);
  // Asking for a future automatic edition never reveals a future scheduled pick.
  articles.save(draft("2026-10-05", "https://www.nasa.gov/future"), null, NOW);
  const futureRequest = await news.getDailyNews("2026-10-05", { now: NOW });
  assert.equal(futureRequest.items[0].scheduledFor, "2026-10-04");
  delete require.cache[require.resolve("../lib/news")];
  const outage = await require("../lib/news").getDailyNews("2026-10-04", { now: NOW, feeds, fetch: async () => { throw new Error("offline"); } });
  assert.equal(outage.items.length, 1); assert.equal(outage.choices[0].category, "featured");
});

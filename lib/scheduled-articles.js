"use strict";

const crypto = require("node:crypto");
const db = require("./db");
const { articleURL, preview } = require("./article-preview");
const TIME_ZONE = "Asia/Bangkok";
const inFlight = new Map();

function today(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function records() {
  const root = db.load();
  if (!Array.isArray(root.scheduledArticles)) root.scheduledArticles = [];
  return root.scheduledArticles;
}
function list() { return records().map(row => ({ ...row })).sort((a, b) => b.date.localeCompare(a.date)); }
function save(input, id = null, now = Date.now()) {
  const clean = require("./news").cleanText;
  if (!input || !validDate(input.date) || input.date < today(now)
    || input.date > today(now + 366 * 86400000)) return { error: "Choose today or a date within the next year.", status: 400 };
  let url;
  try { url = articleURL(input.url).href; } catch (error) { return { error: error.message, status: 400 }; }
  for (const [field, max] of [["headline", 240], ["summary", 800], ["question", 400]]) {
    if (input[field] != null && (typeof input[field] !== "string" || input[field].length > max)) return { error: `${field} must be text of at most ${max} characters.`, status: 400 };
  }
  const headline = clean(input.headline, 240);
  if (!headline) return { error: "Add a title before scheduling the article.", status: 400 };
  const rows = records();
  const previous = id && rows.find(row => row.id === id);
  if (id && !previous) return { error: "Article not found.", status: 404 };
  if (rows.some(row => row.date === input.date && row.id !== id)) return { error: "An article is already scheduled for that day. Edit it or choose another day.", status: 409 };
  if (!id && rows.length >= 1000) return { error: "Remove older articles before adding more.", status: 409 };
  const article = {
    id: id || `article_${crypto.randomUUID()}`, date: input.date, url,
    headline, summary: clean(input.summary, 800).split(/\s+/).slice(0, 25).join(" "),
    question: clean(input.question, 400), source: new URL(url).hostname.replace(/^www\./, ""),
    createdAt: previous?.createdAt || new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    revision: crypto.randomUUID(), lastFetchedAt: null, fetchError: null,
  };
  if (previous) rows.splice(rows.indexOf(previous), 1, article); else rows.push(article);
  db.persist();
  return { article: { ...article } };
}
function remove(id) {
  const rows = records();
  const index = rows.findIndex(row => row.id === id);
  if (index < 0) return { error: "Article not found.", status: 404 };
  rows.splice(index, 1); db.persist(); return { ok: true };
}

async function featured(now = Date.now(), fetchPreview = preview) {
  // The featured edition rolls over globally at Bangkok midnight, irrespective
  // of a client's clock or requested automatic-news archive date.
  const row = records().find(item => item.date === today(now));
  if (!row) return null;
  const revision = row.revision;
  if (!row.lastFetchedAt && (!row.lastAttemptAt || now - Date.parse(row.lastAttemptAt) >= 30 * 60000)) {
    if (!inFlight.has(revision)) {
      inFlight.set(revision, (async () => {
        let result, error;
        try { result = await fetchPreview(row.url); }
        catch (_) { error = "Publisher preview unavailable; the saved title and link will be shown. Retrying automatically."; }
        // An editor may replace/delete this entry while a publisher is slow.
        const current = records().find(item => item.id === row.id && item.revision === revision);
        if (!current) return;
        current.lastAttemptAt = new Date(now).toISOString();
        current.fetchError = error || null;
        if (result) {
          current.lastFetchedAt = new Date(now).toISOString();
          current.fetchedSummary = result.summary;
        }
        db.persist();
      })().finally(() => inFlight.delete(revision)));
    }
    await inFlight.get(revision);
  }
  const current = records().find(item => item.id === row.id && item.revision === revision);
  if (!current || current.date !== today(now)) return null;
  return {
    id: current.id, cat: "Editor's pick", headline: current.headline,
    summary: current.summary || current.fetchedSummary || "", url: current.url,
    source: current.source, scheduledFor: current.date,
    // Selection date, not a claim about when the publisher wrote the story.
    publishedAt: new Date(`${current.date}T00:00:00+07:00`).toISOString(),
    question: current.question || "What did you learn from this article, and what would you like to find out next?",
  };
}
module.exports = { TIME_ZONE, today, validDate, list, save, remove, featured };

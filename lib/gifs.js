"use strict";
/**
 * Giphy proxy — family chat GIF picker (net-new for Fam ETC).
 *
 * The client never talks to Giphy directly (CSP connect-src stays 'self');
 * this module fetches on the client's behalf and maps the response down to
 * the small shape the picker needs. FAMILY-SAFE: every request is pinned to
 * rating=pg — never let a caller override this.
 *
 * If GIPHY_API_KEY is unset the feature is simply off (callers get an empty
 * gifs array, never an error) — see server.js routes.
 */
const GIPHY_BASE = "https://api.giphy.com/v1/gifs";
const TIMEOUT_MS = 8000;
const RATING = "pg";

function apiKey() {
  return (process.env.GIPHY_API_KEY || "").trim();
}

function enabled() {
  return !!apiKey();
}

// Picks the best available preview/full image from a Giphy `images` object,
// with fallbacks for GIFs missing a given rendition.
function mapGif(item) {
  const images = (item && item.images) || {};
  const preview = images.fixed_width_small || images.preview_gif || images.downsized_still || images.fixed_width || {};
  const full = images.fixed_width || images.downsized || images.original || preview;
  return {
    id: String(item.id),
    previewUrl: preview.url || "",
    url: full.url || "",
    width: Number(full.width) || 0,
    height: Number(full.height) || 0,
    title: String(item.title || "").slice(0, 100),
  };
}

async function callGiphy(pathname, params) {
  const key = apiKey();
  if (!key) return { gifs: [] };
  const qs = new URLSearchParams(Object.assign({ api_key: key, rating: RATING }, params));
  const url = `${GIPHY_BASE}/${pathname}?${qs.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Giphy returned HTTP ${res.status}`);
    const body = await res.json();
    const data = Array.isArray(body && body.data) ? body.data : [];
    return { gifs: data.map(mapGif).filter((g) => g.previewUrl && g.url) };
  } finally {
    clearTimeout(timeout);
  }
}

function clampLimit(limit, def) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), 50);
}

async function trending(limit) {
  return callGiphy("trending", { limit: clampLimit(limit, 24) });
}

async function search(q, limit) {
  const query = String(q || "").trim().slice(0, 200);
  if (!query) return trending(limit);
  return callGiphy("search", { q: query, limit: clampLimit(limit, 24) });
}

module.exports = { enabled, trending, search };

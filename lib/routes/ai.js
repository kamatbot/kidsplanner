"use strict";

// Server-side proxy for the two AI-parse features (schedule photo -> events,
// homework diary photo -> homework items). The client used to call
// api.anthropic.com directly with a key shipped to the browser via
// /config.js; that's both a key-exposure risk and dead in production (CSP
// connect-src 'self' blocks it). This route holds the key server-side and
// does the same parsing, reachable at POST /api/ai/parse.

const ALLOWED_KINDS = new Set(["schedule", "homework", "pantry"]);
const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_DECODED_BYTES = 8 * 1024 * 1024; // 8 MB, matches the client's old upload cap
const MAX_BOOKING_TEXT_CHARS = 20000; // POST /api/ai/parse-booking (docs/TRIPS-PLAN.md v1.1)
const AI_TIMEOUT_MS = Math.max(1000, Number(process.env.AI_PROVIDER_TIMEOUT_MS) || 20000);
const MODEL = "claude-sonnet-4-6";

class AIProviderError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "AIProviderError";
    this.code = code;
    this.providerStatus = details.providerStatus || null;
  }
}

// Provider I/O is deliberately contained in one helper. Express 4 does not
// automatically turn an async-handler rejection into error middleware, so no
// response body parse or timeout should be allowed to reject outside a local
// try/catch. A malformed 2xx response is an upstream failure, not a process
// failure or an application-level 422.
async function callAnthropic(apiKey, messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  if (timer.unref) timer.unref();
  try {
    let response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: MODEL, max_tokens: 4096, messages }),
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new AIProviderError("AI provider timed out.", "AI_TIMEOUT");
      }
      throw new AIProviderError("AI provider request failed.", "AI_NETWORK");
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new AIProviderError("AI provider returned malformed JSON.", "AI_BAD_RESPONSE", { providerStatus: response.status });
    }

    if (!response.ok) {
      const providerMessage = data && data.error && data.error.message;
      console.error("[ai] Anthropic API error:", response.status, providerMessage || "unknown provider error");
      throw new AIProviderError("AI provider rejected the request.", "AI_UPSTREAM", { providerStatus: response.status });
    }
    if (!data || !Array.isArray(data.content)) {
      throw new AIProviderError("AI provider returned an unexpected response.", "AI_BAD_RESPONSE", { providerStatus: response.status });
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function sendProviderError(res, error) {
  if (error instanceof AIProviderError) {
    if (error.code === "AI_TIMEOUT") {
      return res.status(504).json({ error: "AI parsing took too long — please try again." });
    }
    if (error.code !== "AI_UPSTREAM") {
      console.error("[ai] provider failure:", error.code, error.message);
    }
    return res.status(502).json({ error: "Couldn't reach the AI service — please try again." });
  }
  console.error("[ai] unexpected provider failure:", error && error.message || error);
  return res.status(502).json({ error: "Couldn't reach the AI service — please try again." });
}

function responseText(data) {
  const block = data && data.content && data.content.find((item) => item && item.type === "text" && typeof item.text === "string");
  if (!block) throw new AIProviderError("AI provider response had no text block.", "AI_BAD_RESPONSE");
  return block.text.trim();
}

// Local-date YYYY-MM-DD, mirroring isoDate() in public/js/util.js — the
// homework prompt needs "today" as a reference point for phrasing like
// "this Friday".
function isoDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function promptFor(kind) {
  if (kind === "schedule") {
    return `Parse this school timetable image into a JSON array.
Each element must have exactly these fields:
{
  "day": one of "Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday",
  "subject": "subject or class name",
  "teacher": "teacher name or empty string",
  "room": "room/location or empty string",
  "startTime": "HH:MM in 24-hour format",
  "endTime": "HH:MM in 24-hour format (estimate from next period if not shown)"
}
Rules:
- Skip registration/form periods unless they have a distinct subject.
- Derive endTime from the next period's startTime if not explicitly shown.
- Return ONLY a valid JSON array with no markdown, no code blocks, no extra text.`;
  }
  if (kind === "pantry") {
    return `Parse this photo of a food shelf, fridge, or pantry into a JSON array of the food items you can see.
Each element must have exactly these fields:
{
  "name": "the food item, in plain English (e.g. \"Basmati rice\", \"Toor dal\", \"Coconut milk\")",
  "category": one of "produce","protein","dairy","grain","pantry","frozen","spice","other",
  "levelGuess": one of "plenty","some","low" — judge from how full the container or shelf looks,
  "unitHint": "the packaging if visible, e.g. \"1 kg bag\", \"400ml tin\", or an empty string"
}
Rules:
- One entry per distinct item. Do not guess at items you cannot actually see.
- Indian and Thai staples are likely (dals, spice tins, fish sauce, curry paste, coconut milk) — name them specifically when legible.
- Never answer "out": an empty shelf simply has no entry for that item.
- Return ONLY a valid JSON array with no markdown, no code blocks, no extra text.`;
  }
  return `Parse this photo of a homework diary/planner page into a JSON array of homework items.
Each element must have exactly these fields:
{
  "subject": "subject or class name",
  "title": "short description of the homework/assignment",
  "dueDate": "YYYY-MM-DD — infer the year from context if not shown; use today's date ${isoDateLocal(new Date())} as a reference point for 'this Friday' etc. style phrasing"
}
Rules:
- One entry per homework/assignment item, even if several are for the same subject.
- If no due date is visible for an item, make your best guess based on context (e.g. tomorrow) rather than omitting it.
- Return ONLY a valid JSON array with no markdown, no code blocks, no extra text.`;
}

// POST /api/ai/parse-booking (docs/TRIPS-PLAN.md v1.1 "Paste-to-import
// bookings"): a pasted flight/lodging confirmation -> {flights, lodging}.
// Dates/times MUST come back in the "Jun 3, 21:50" shape (month-abbrev day,
// comma, 24h HH:MM) — that exact grain is what the calendar merge's
// parseTripFreeTextDate (public/js side) can read.
function bookingPrompt() {
  return `Parse this pasted travel booking confirmation (email or text) into JSON.
Return ONLY a valid JSON object with exactly this shape — no markdown, no code fences, no extra text:
{
  "flights": [
    { "airline": "", "flightNo": "", "confirmation": "", "from": "", "to": "", "departs": "", "arrives": "" }
  ],
  "lodging": [
    { "name": "", "address": "", "confirmation": "", "checkIn": "", "checkOut": "", "note": "" }
  ]
}
Rules:
- Both "flights" and "lodging" keys MUST be present, each an array — use [] when the text has none of that kind.
- "from"/"to" are IATA airport codes (e.g. "JFK") when they can be inferred from the text; empty string otherwise.
- Render every date/time field ("departs", "arrives", "checkIn", "checkOut") in the exact shape "Jun 3, 21:50" — three-letter month abbreviation, day, a comma, then 24-hour HH:MM. Empty string when a value isn't in the text.
- Use an empty string for any field you can't find in the text — never omit a field or invent a value.
- One array entry per flight leg / per lodging stay.
- Return ONLY the JSON object, nothing else.`;
}

// ponytail: 20 calls/user/day via an in-memory Map, reset by comparing the
// stored day string — good enough for a single-process Hostinger deploy.
// Move to a shared store if this ever runs multi-process.
const DAILY_QUOTA = 20;
const quotaByUser = new Map(); // userId -> { day, count }

function checkAndBumpQuota(userId) {
  const day = isoDateLocal(new Date());
  const rec = quotaByUser.get(userId);
  if (!rec || rec.day !== day) {
    quotaByUser.set(userId, { day, count: 1 });
    return true;
  }
  if (rec.count >= DAILY_QUOTA) return false;
  rec.count++;
  return true;
}

module.exports = (app, deps) => {
  const { requireAuth, requireFamily } = deps;

  app.post("/api/ai/parse", requireAuth, requireFamily, async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(503).json({ error: "AI parsing isn't configured on this server." });

    const body = req.body || {};
    const kind = String(body.kind || "");
    if (!ALLOWED_KINDS.has(kind)) return res.status(400).json({ error: "Invalid kind — must be 'schedule', 'homework', or 'pantry'." });

    const mediaType = String(body.mediaType || "");
    if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
      return res.status(400).json({ error: "Unsupported image type. Please use JPG, PNG, GIF, or WEBP." });
    }

    const dataBase64 = String(body.dataBase64 || "");
    if (!dataBase64) return res.status(400).json({ error: "Missing image data." });
    // Decoded-byte check (not just the base64 string length) so the cap means
    // what it says regardless of encoding padding.
    const decodedBytes = Math.floor((dataBase64.length * 3) / 4);
    if (decodedBytes > MAX_DECODED_BYTES) {
      return res.status(400).json({ error: "Image is too large — please use a file under 8 MB." });
    }

    if (!checkAndBumpQuota(req.user.id)) {
      return res.status(429).json({ error: `You've hit today's limit of ${DAILY_QUOTA} AI parses — please try again tomorrow.` });
    }

    let data;
    try {
      data = await callAnthropic(apiKey, [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: dataBase64 } },
          { type: "text", text: promptFor(kind) },
        ],
      }]);
    } catch (error) {
      return sendProviderError(res, error);
    }

    let rawText;
    try {
      rawText = responseText(data);
    } catch (error) {
      return sendProviderError(res, error);
    }
    const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) rawText = fenceMatch[1].trim();

    let items;
    try {
      items = JSON.parse(rawText);
      if (!Array.isArray(items) || items.length === 0) throw new Error("empty");
    } catch (e) {
      return res.status(422).json({ error: kind === "schedule" ? "No events found in the schedule image." : "No homework items found in the photo." });
    }

    res.json({ items });
  });

  // requireAuth ONLY (no requireFamily) — a guest with no family (trip-only
  // membership) must be able to use this; parsing is stateless and the trip
  // add endpoints (lib/routes/trips.js) enforce trip permissions on the
  // resulting add, not this endpoint.
  app.post("/api/ai/parse-booking", requireAuth, async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(503).json({ error: "AI parsing isn't configured on this server." });

    const body = req.body || {};
    const text = String(body.text || "");
    if (!text.trim()) return res.status(400).json({ error: "Paste some booking confirmation text first." });
    if (text.length > MAX_BOOKING_TEXT_CHARS) {
      return res.status(400).json({ error: `Text is too long — please paste under ${MAX_BOOKING_TEXT_CHARS.toLocaleString()} characters.` });
    }

    if (!checkAndBumpQuota(req.user.id)) {
      return res.status(429).json({ error: `You've hit today's limit of ${DAILY_QUOTA} AI parses — please try again tomorrow.` });
    }

    let data;
    try {
      data = await callAnthropic(apiKey, [{
        role: "user",
        content: [{ type: "text", text: `${bookingPrompt()}\n\n---\n${text}` }],
      }]);
    } catch (error) {
      return sendProviderError(res, error);
    }

    let rawText;
    try {
      rawText = responseText(data);
    } catch (error) {
      return sendProviderError(res, error);
    }
    const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) rawText = fenceMatch[1].trim();

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      return res.status(422).json({ error: "Couldn't find any booking details in that text." });
    }
    const flights = Array.isArray(parsed && parsed.flights) ? parsed.flights : [];
    const lodging = Array.isArray(parsed && parsed.lodging) ? parsed.lodging : [];
    if (flights.length === 0 && lodging.length === 0) {
      return res.status(422).json({ error: "Couldn't find any booking details in that text." });
    }
    res.json({ flights, lodging });
  });
};

// Shared with lib/routes/meals.js so the menu planner draws on the SAME
// per-user daily budget as the image parsers rather than a second one.
module.exports.checkAndBumpQuota = checkAndBumpQuota;
module.exports.DAILY_QUOTA = DAILY_QUOTA;
module.exports.MODEL = MODEL;
module.exports.AI_TIMEOUT_MS = AI_TIMEOUT_MS;

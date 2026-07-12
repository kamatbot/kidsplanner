"use strict";

// Server-side proxy for the two AI-parse features (schedule photo -> events,
// homework diary photo -> homework items). The client used to call
// api.anthropic.com directly with a key shipped to the browser via
// /config.js; that's both a key-exposure risk and dead in production (CSP
// connect-src 'self' blocks it). This route holds the key server-side and
// does the same parsing, reachable at POST /api/ai/parse.

const ALLOWED_KINDS = new Set(["schedule", "homework"]);
const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_DECODED_BYTES = 8 * 1024 * 1024; // 8 MB, matches the client's old upload cap

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
    if (!ALLOWED_KINDS.has(kind)) return res.status(400).json({ error: "Invalid kind — must be 'schedule' or 'homework'." });

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

    let anthropicRes;
    try {
      anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: dataBase64 } },
              { type: "text", text: promptFor(kind) },
            ],
          }],
        }),
      });
    } catch (e) {
      return res.status(502).json({ error: "Couldn't reach the AI service — please try again." });
    }

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.json().catch(() => ({}));
      console.error("[ai] Anthropic API error:", anthropicRes.status, errBody.error && errBody.error.message);
      return res.status(502).json({ error: "AI parsing failed — please try again." });
    }

    const data = await anthropicRes.json();
    let rawText = (data.content && data.content[0] && data.content[0].text || "").trim();
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
};

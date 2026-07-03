"use strict";
/**
 * School account (Moodle) integration — Part 1: the pure HTTP/HTML client.
 *
 * Talks to a school's Moodle instance (verified against
 * bangkok.learn.nae.school) to (a) log a parent in with their stored school
 * credentials and (b) scrape the homework + timetable pages for a given
 * child's Moodle user id.
 *
 * NEVER log the username/password anywhere (console, errors, thrown
 * messages) — see lib/school-account.js for where credentials are decrypted
 * and passed in transiently.
 *
 * No cookie-jar dependency: Node 20's global fetch + manual Set-Cookie
 * capture/replay, matching the project's "no new heavy deps" convention
 * (see lib/ical.js's hand-rolled parsing for precedent).
 */
const TIMEOUT_MS = 15000;

// ---------- low-level fetch w/ timeout ----------
async function timedFetch(url, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
  } finally {
    clearTimeout(timeout);
  }
}

// ---------- cookie handling (manual, no jar dependency) ----------
// Merges Set-Cookie response headers into a simple name->value map. Moodle
// typically sets a single MoodleSession cookie, but this handles multiples
// (e.g. testcookie) defensively.
function mergeSetCookies(res, jar) {
  const getAll = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : null;
  const raw = getAll || (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
  for (const line of raw) {
    const first = String(line).split(";")[0];
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (name) jar[name] = value;
  }
  return jar;
}

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

// ---------- login ----------
// Extracts the CSRF `logintoken` hidden input value from the login page HTML.
function extractLoginToken(html) {
  const m = /<input[^>]+name=["']logintoken["'][^>]*value=["']([^"']*)["']/i.exec(html)
    || /<input[^>]+value=["']([^"']*)["'][^>]*name=["']logintoken["']/i.exec(html);
  return m ? m[1] : null;
}

function looksLikeSSO(html) {
  return /oauth2|Sign in with (Microsoft|Google)|login\/oauth2|resetpassword/i.test(html || "")
    && !/name=["']password["']/i.test(html || "");
}

// Does the login page OFFER Microsoft/Google SSO alongside the local form?
// (Distinct from looksLikeSSO, which is SSO-ONLY.) Used to explain a failed
// local login: an SSO account has no local Moodle password, so local login
// fails with a generic "incorrect password" even when the person's real
// (SSO) credentials are correct.
function offersSSO(html) {
  return /potentialidp|login\/oauth2|Sign in with (Microsoft|Google)|auth\/oidc/i.test(html || "");
}

// Attempts a server-side Moodle login. Returns:
//   { ok: true, session: { baseUrl, cookies } }
//   { ok: false, error, reason }  reason: "sso" | "bad_credentials" | "unreachable" | "parse_error"
// NEVER logs username/password — only structural info (status codes, hostnames).
async function login(baseUrl, username, password) {
  const origin = String(baseUrl || "").replace(/\/+$/, "");
  if (!origin || !/^https?:\/\//i.test(origin)) {
    return { ok: false, error: "Invalid school portal URL.", reason: "config" };
  }
  const loginUrl = `${origin}/login/index.php`;
  const jar = {};

  // Step 1: GET the login page — capture session cookie + CSRF token.
  let getRes;
  try {
    getRes = await timedFetch(loginUrl, { redirect: "manual" });
  } catch (e) {
    return { ok: false, error: "Could not reach the school portal. Please try again later.", reason: "unreachable" };
  }
  if (!getRes || (getRes.status >= 400 && getRes.status !== 401)) {
    return { ok: false, error: "The school portal is not reachable right now.", reason: "unreachable" };
  }
  mergeSetCookies(getRes, jar);
  let html;
  try {
    html = await getRes.text();
  } catch (e) {
    return { ok: false, error: "Unexpected response from the school portal.", reason: "parse_error" };
  }
  const contentType = getRes.headers.get("content-type") || "";
  if (!/text\/html/i.test(contentType) && !/<html/i.test(html)) {
    return { ok: false, error: "Unexpected response from the school portal.", reason: "parse_error" };
  }

  const logintoken = extractLoginToken(html);
  if (!logintoken) {
    // No local login form found at all — likely an SSO-only tenant.
    return {
      ok: false,
      error: "Login failed — if your school uses 'Sign in with Microsoft/Google' (SSO), stored credentials can't be used.",
      reason: "sso",
    };
  }

  // Step 2: POST credentials, following redirects MANUALLY so we can inspect
  // the Location header for an oauth2/SSO bounce.
  // Include the empty `anchor` hidden field the real Moodle login form posts,
  // to match its exact request shape.
  const body = new URLSearchParams({ anchor: "", username: String(username || ""), password: String(password || ""), logintoken }).toString();
  let postRes;
  try {
    postRes = await timedFetch(loginUrl, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": cookieHeader(jar),
      },
      body,
    });
  } catch (e) {
    return { ok: false, error: "Could not reach the school portal. Please try again later.", reason: "unreachable" };
  }
  mergeSetCookies(postRes, jar);

  let hops = 0;
  let res = postRes;
  let location = res.headers.get("location");
  while (res.status >= 300 && res.status < 400 && location && hops < 5) {
    const nextUrl = new URL(location, loginUrl).toString();
    if (/login\/oauth2|microsoftonline|accounts\.google\.com|okta\.com/i.test(nextUrl)) {
      return {
        ok: false,
        error: "Login failed — if your school uses 'Sign in with Microsoft/Google' (SSO), stored credentials can't be used.",
        reason: "sso",
      };
    }
    if (/\/login\/index\.php(\?|$)/i.test(nextUrl) && !/testsession/i.test(nextUrl)) {
      // Redirected back to the login page — almost always bad credentials,
      // but keep following (Moodle sometimes bounces through testsession
      // cookie-check redirects) up to the hop limit.
    }
    try {
      res = await timedFetch(nextUrl, { redirect: "manual", headers: { Cookie: cookieHeader(jar) } });
    } catch (e) {
      return { ok: false, error: "Could not reach the school portal. Please try again later.", reason: "unreachable" };
    }
    mergeSetCookies(res, jar);
    location = res.headers.get("location");
    hops++;
  }

  let finalHtml = "";
  try {
    finalHtml = await res.text();
  } catch (e) {
    finalHtml = "";
  }

  if (looksLikeSSO(finalHtml)) {
    return {
      ok: false,
      error: "Login failed — if your school uses 'Sign in with Microsoft/Google' (SSO), stored credentials can't be used.",
      reason: "sso",
    };
  }

  // Success signal: we landed somewhere other than the login form, and the
  // page doesn't show Moodle's login-error banner. Failure signal: still on
  // /login/index.php with a login form + error, or an explicit error string.
  const stillOnLoginForm = /name=["']password["']/i.test(finalHtml) && /name=["']username["']/i.test(finalHtml);
  const hasLoginError = /loginerrors|Invalid login|incorrect username or password/i.test(finalHtml);
  if (stillOnLoginForm || hasLoginError) {
    // If the page also offers Microsoft/Google SSO, a failed LOCAL login most
    // likely means an SSO account (no local Moodle password) rather than a
    // typo — say so, since stored credentials fundamentally can't work then.
    if (offersSSO(finalHtml) || offersSSO(html)) {
      return {
        ok: false,
        reason: "sso_likely",
        error: "Login was rejected. If you normally sign into the school portal by clicking “Sign in with Microsoft” or “Sign in with Google,” your account has no separate Moodle password, so stored credentials can’t be used. Otherwise, double-check your Moodle username and password.",
      };
    }
    return { ok: false, error: "Incorrect Moodle username or password.", reason: "bad_credentials" };
  }

  // Confirm the session actually works by checking for a logged-in marker
  // (Moodle's global nav / logout link / user menu) rather than trusting the
  // redirect alone.
  const loggedInMarker = /logout\.php|usermenu|<body[^>]*id=["']page-my-index["']|class=["'][^"']*userinitials/i.test(finalHtml);
  if (!loggedInMarker && stillOnLoginForm) {
    return { ok: false, error: "Incorrect Moodle username or password.", reason: "bad_credentials" };
  }

  return { ok: true, session: { baseUrl: origin, cookies: jar } };
}

// ---------- shared authenticated GET ----------
async function authedGet(session, path) {
  const url = `${session.baseUrl}${path}`;
  let res;
  try {
    res = await timedFetch(url, { headers: { Cookie: cookieHeader(session.cookies) } });
  } catch (e) {
    const err = new Error("Could not reach the school portal. Please try again later.");
    err.reason = "unreachable";
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`School portal returned an error (${res.status}).`);
    err.reason = "unreachable";
    throw err;
  }
  const html = await res.text();
  if (!/<html/i.test(html)) {
    const err = new Error("Unexpected response from the school portal.");
    err.reason = "parse_error";
    throw err;
  }
  return html;
}

// ---------- HTML helpers ----------
function stripTags(s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

// Splits a string on top-level occurrences of a marker div, by finding each
// `<div class="accordion-item...">` start and matching balanced </div>s.
function extractDivsByClass(html, classToken) {
  const out = [];
  const openRe = /<div\b([^>]*)>/gi;
  let m;
  while ((m = openRe.exec(html))) {
    const attrs = m[1] || "";
    const classMatch = /class=["']([^"']*)["']/i.exec(attrs);
    const classes = classMatch ? classMatch[1] : "";
    if (!classes.split(/\s+/).includes(classToken)) continue;
    // Balance divs starting from this <div ...>
    let depth = 1;
    let idx = openRe.lastIndex;
    const divTagRe = /<div\b[^>]*>|<\/div>/gi;
    divTagRe.lastIndex = idx;
    let tagMatch;
    let endIdx = html.length;
    while ((tagMatch = divTagRe.exec(html))) {
      if (tagMatch[0].toLowerCase() === "</div>") {
        depth--;
        if (depth === 0) { endIdx = tagMatch.index; break; }
      } else {
        depth++;
      }
    }
    out.push({ classes, inner: html.slice(idx, endIdx), fullAttrs: attrs });
    openRe.lastIndex = endIdx;
  }
  return out;
}

// ---------- homework parsing ----------
// "Thu 18 June" (no year) -> infer academic year: Aug-Dec = earlier year,
// Jan-Jul = later year, relative to `now`.
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function inferDate(dayMonthStr, now = new Date()) {
  if (!dayMonthStr) return null;
  const m = /(\d{1,2})\s+([A-Za-z]+)/.exec(dayMonthStr);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const monthName = m[2].toLowerCase();
  const monthIdx = MONTHS.findIndex((mo) => mo.startsWith(monthName.slice(0, 3)));
  if (monthIdx < 0 || !day) return null;
  const curYear = now.getFullYear();
  const curMonth = now.getMonth(); // 0-based
  // Academic year convention: Aug(7)-Dec(11) = "earlier" calendar year of the
  // academic year; Jan(0)-Jul(6) = "later" calendar year. We pick whichever
  // calendar year keeps the date closest to `now` within a plausible academic
  // year window, per the brief's rule.
  let year;
  if (monthIdx >= 7) {
    // Aug-Dec: belongs to the academic year that STARTED this calendar year
    // if we're currently in Aug-Dec, else the previous one if we're in Jan-Jul.
    year = curMonth >= 7 ? curYear : curYear - 1;
  } else {
    // Jan-Jul: belongs to the academic year ending this calendar year if
    // we're currently Jan-Jul, else next calendar year if we're in Aug-Dec.
    year = curMonth >= 7 ? curYear + 1 : curYear;
  }
  const mm = String(monthIdx + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

// Parses the homework list page HTML into
// [{subject, title, dueDate, setDate, completed}]
function parseHomeworkHtml(html, now = new Date()) {
  if (!html) return [];
  const items = extractDivsByClass(html, "applyhwclass");
  const results = [];
  for (const item of items) {
    const completed = item.classes.split(/\s+/).includes("tickon");
    const subjectM = /<span[^>]*class=["'][^"']*\bsubject\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(item.inner);
    const titleM = /<span[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(item.inner);
    const dateBlockM = /<div[^>]*class=["'][^"']*\bdate\b[^"']*["'][^>]*title=["']([^"']*)["'][^>]*>([\s\S]*?)<\/div>/i.exec(item.inner);
    const subject = subjectM ? stripTags(subjectM[1]) : "";
    const title = titleM ? stripTags(titleM[1]) : "";
    if (!title && !subject) continue; // not a real homework block
    const visibleDateRaw = dateBlockM ? stripTags(dateBlockM[2]) : "";
    const titleAttrRaw = dateBlockM ? dateBlockM[1] : "";
    // titleAttr looks like: "This task was completed on <D> \n It was set <D>"
    // (completed) or just "It was set <D>" (not completed).
    const setMatch = /It was set\s+([A-Za-z]+\s+\d{1,2}\s+[A-Za-z]+)/i.exec(stripTags(titleAttrRaw.replace(/&#10;|\\n/g, " ")))
      || /It was set\s+(\d{1,2}\s+[A-Za-z]+)/i.exec(stripTags(titleAttrRaw));
    const dueDate = inferDate(visibleDateRaw, now);
    const setDate = setMatch ? inferDate(setMatch[1], now) : null;
    results.push({ subject, title, dueDate, setDate, completed });
  }
  return results;
}

// ---------- timetable parsing ----------
// Parses the weekly timetable table into
// [{day, period, time, subject, teacher, room}]
function parseTimetableHtml(html) {
  if (!html) return [];
  const tableM = /<table[^>]*class=["'][^"']*\bsta_timetable\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/i.exec(html);
  if (!tableM) return [];
  const tableInner = tableM[1];

  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [];
  let rm;
  while ((rm = rowRe.exec(tableInner))) rows.push(rm[1]);
  if (!rows.length) return [];

  // Header row: th/td cells labelled like "Reg07:45","P108:00", possibly with
  // a leading empty cell for the day-name column.
  const headerCellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
  const headerCells = [];
  let hm;
  while ((hm = headerCellRe.exec(rows[0]))) headerCells.push(stripTags(hm[1]));

  const periods = []; // { index, code, time }
  headerCells.forEach((cellText, idx) => {
    const m = /^([A-Za-z0-9]+?)(\d{1,2}:\d{2})$/.exec(cellText.replace(/\s+/g, ""));
    if (m) periods.push({ index: idx, code: m[1], time: m[2] });
  });
  if (!periods.length) return [];

  const results = [];
  for (let r = 1; r < rows.length; r++) {
    const cellRe = /<t[hd]\b([^>]*)>([\s\S]*?)<\/t[hd]>/gi;
    const cells = [];
    let cm;
    while ((cm = cellRe.exec(rows[r]))) cells.push({ attrs: cm[1] || "", html: cm[2] });
    if (!cells.length) continue;
    const dayName = stripTags(cells[0].html);
    if (!dayName) continue;
    for (const period of periods) {
      const cell = cells[period.index];
      if (!cell) continue;
      const isCellClass = /class=["'][^"']*\bcell\b[^"']*["']/i.test(cell.attrs) || period.index > 0;
      if (!isCellClass) continue;
      const text = stripTags(cell.html);
      if (!text) continue;
      // Best-effort split: "RegAndy D3p Gold" -> subject="Reg", teacher/room
      // heuristics are unreliable without a stable delimiter in the source
      // markup, so we keep the raw concatenated text as `subject` and only
      // extract teacher/room when the source has separate inline elements.
      const parts = [];
      const partRe = /<(?:span|div)[^>]*>([\s\S]*?)<\/(?:span|div)>/gi;
      let pm;
      while ((pm = partRe.exec(cell.html))) {
        const t = stripTags(pm[1]);
        if (t) parts.push(t);
      }
      let subject = text;
      let teacher = null;
      let room = null;
      if (parts.length >= 2) {
        subject = parts[0];
        teacher = parts[1] || null;
        room = parts[2] || null;
      }
      results.push({
        day: dayName,
        period: period.code,
        time: period.time,
        subject,
        teacher,
        room,
      });
    }
  }
  return results;
}

// ---------- public fetch wrappers ----------
async function fetchHomework(session, moodleUserId, now = new Date()) {
  const html = await authedGet(session, `/mod/homework/view.php?h=2&userid=${encodeURIComponent(moodleUserId)}&showcompleted=1&limit=0`);
  return parseHomeworkHtml(html, now);
}

async function fetchTimetable(session, moodleUserId) {
  const html = await authedGet(session, `/local/sta/pages/timetable.php?id=${encodeURIComponent(moodleUserId)}`);
  return parseTimetableHtml(html);
}

module.exports = {
  login,
  fetchHomework,
  fetchTimetable,
  // exported for tests
  parseHomeworkHtml,
  parseTimetableHtml,
  inferDate,
  extractLoginToken,
  looksLikeSSO,
};

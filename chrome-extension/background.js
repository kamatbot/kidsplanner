"use strict";
/* ============================================================
   Fam ETC School Helper — background.js (MV3 service worker)

   The bridge between the Moodle content script and an open, logged-in
   fametc.com tab. Runs window.famImportSchoolData()
   inside the tab via chrome.scripting.executeScript world:"MAIN" — the
   default "isolated" world shares the DOM but NOT the page's window globals,
   so those functions (defined by the page's public/js/app.js) are only
   reachable from MAIN, exactly like a same-origin script running in the
   page itself would see them.

   Message types (all sent from content.js or popup.js via
   chrome.runtime.sendMessage):
     - AUTO_SYNC_CHECK -> { famOpen }
     - IMPORT_STATS { schoolStats } -> update result
     - OPEN_FAMETC -> opens/focuses a fametc.com tab
============================================================ */

const FAMETC_URL_PATTERNS = ["https://www.fametc.com/*", "https://fametc.com/*"];
const FAMETC_CANONICAL_ORIGIN = "https://www.fametc.com";
const MOODLE_ORIGIN = "https://bangkok.learn.nae.school";
const COMPLETIONS_PENDING_URL = `${FAMETC_CANONICAL_ORIGIN}/api/school/completions/pending`;
const COMPLETIONS_CLAIM_URL = `${FAMETC_CANONICAL_ORIGIN}/api/school/completions/claim`;
const COMPLETIONS_ACK_URL = `${FAMETC_CANONICAL_ORIGIN}/api/school/completions/ack`;
const COMPLETION_SYNC_HASH = "#fametc-completion-sync";
const COMPLETION_BATCH_LIMIT = 50;
const COMPLETION_TIMEOUT_MS = 15000;

let completionSyncInFlight = null;

async function findFamEtcTab() {
  const tabs = await chrome.tabs.query({ url: FAMETC_URL_PATTERNS });
  return tabs[0] || null;
}

async function findCanonicalFamEtcTab() {
  const tabs = await chrome.tabs.query({ url: [`${FAMETC_CANONICAL_ORIGIN}/*`] });
  return tabs[0] || null;
}

function boundedCompletionResult(overrides = {}) {
  const count = (value) => Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  const errors = Array.from(new Set(Array.isArray(overrides.errors) ? overrides.errors : []))
    .filter((code) => typeof code === "string" && /^[A-Z_]{1,40}$/.test(code))
    .slice(0, 5);
  return {
    attempted: count(overrides.attempted),
    verified: count(overrides.verified),
    acknowledged: count(overrides.acknowledged),
    pending: count(overrides.pending),
    errors,
  };
}

function validCompletionRequest(item) {
  return !!item && typeof item === "object" &&
    item.schemaVersion === 1 && item.desiredState === "done" &&
    typeof item.requestId === "string" && item.requestId.length <= 128 &&
    /^mcr_[A-Za-z0-9_-]+$/.test(item.requestId) &&
    !!item.moodle && typeof item.moodle === "object" &&
    item.moodle.origin === MOODLE_ORIGIN && item.moodle.homeworkViewId === "2" &&
    typeof item.moodle.userId === "string" && /^\d{1,20}$/.test(item.moodle.userId) &&
    typeof item.moodle.taskId === "string" && /^\d{1,200}$/.test(item.moodle.taskId);
}

async function fetchFamEtcInPage(tabId, url, request) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (endpoint, options) => {
      try {
        if (location.origin !== "https://www.fametc.com") return { ok: false };
        const response = await fetch(endpoint, options);
        if (!response.ok) return { ok: false };
        const payload = await response.json();
        return { ok: true, payload };
      } catch (e) {
        return { ok: false };
      }
    },
    args: [url, request],
  });
  return result && result.ok ? result : null;
}

async function requestFamEtc(url, request) {
  try {
    const response = await fetch(url, request);
    if (response.ok) {
      return { ok: true, payload: await response.json() };
    }
  } catch (e) {
    // The extension fetch may not share the page's authenticated cookie jar.
  }

  try {
    const tab = await findCanonicalFamEtcTab();
    if (!tab || tab.id == null) return null;
    return await fetchFamEtcInPage(tab.id, url, request);
  } catch (e) {
    return null;
  }
}

async function readPendingCompletions() {
  const result = await requestFamEtc(COMPLETIONS_PENDING_URL, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  if (!result || !result.payload || !Array.isArray(result.payload.completions)) return null;
  return {
    completions: result.payload.completions,
    hasMore: result.payload.hasMore === true,
  };
}

async function claimCompletion(requestId) {
  const result = await requestFamEtc(COMPLETIONS_CLAIM_URL, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId }),
  });
  const completion = result && result.payload && result.payload.completion;
  return validCompletionRequest(completion) && completion.requestId === requestId ? completion : null;
}

async function acknowledgeCompletions(requestIds) {
  if (!requestIds.length) return [];
  const result = await requestFamEtc(COMPLETIONS_ACK_URL, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestIds }),
  });
  const acknowledged = result && result.payload && result.payload.acknowledgedRequestIds;
  if (!Array.isArray(acknowledged)) return null;
  const submitted = new Set(requestIds);
  return Array.from(new Set(acknowledged.filter(
    (id) => typeof id === "string" && submitted.has(id)
  )));
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (error) reject(error);
      else resolve();
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    const timer = setTimeout(() => finish(new Error("TAB_TIMEOUT")), COMPLETION_TIMEOUT_MS);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab && tab.status === "complete") finish();
    });
  });
}

/* This function is deliberately self-contained: Chrome serializes it into the
   hidden Moodle tab's MAIN world, where it uses that tab's live Moodle session. */
async function runMoodleCompletionOperation(taskId, userId, timeoutMs) {
  const origin = "https://bangkok.learn.nae.school";
  const homeworkPath = "/mod/homework/view.php";

  const validViewUrl = (value, completed) => {
    try {
      const url = new URL(value);
      return url.origin === origin && url.pathname === homeworkPath &&
        url.searchParams.get("h") === "2" && url.searchParams.get("userid") === userId &&
        url.searchParams.get("showcompleted") === (completed ? "1" : "0") &&
        url.searchParams.get("limit") === "0";
    } catch (e) {
      return false;
    }
  };
  const looksLoggedOut = (doc) => !!doc.querySelector('form#login, input[name="password"]#password');
  const exactRows = (doc) => Array.from(doc.querySelectorAll(".accordion-item.applyhwclass"))
    .filter((row) => row.getAttribute("data-id") === taskId);
  const completedUrl = `${origin}${homeworkPath}?h=2&userid=${encodeURIComponent(userId)}&showcompleted=1&limit=0`;
  const fetchWithTimeout = async (url, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  const verifyCompleted = async () => {
    try {
      const response = await fetchWithTimeout(completedUrl, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok || !validViewUrl(response.url, true)) return { state: "invalid" };
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      if (looksLoggedOut(doc)) return { state: "invalid" };
      const rows = exactRows(doc);
      if (rows.length > 1) return { state: "ambiguous" };
      return { state: rows.length === 1 && rows[0].classList.contains("tickon") ? "complete" : "missing" };
    } catch (e) {
      return { state: "invalid" };
    }
  };
  const readQuotedString = (source, start) => {
    let index = start;
    while (/\s/.test(source[index] || "")) index += 1;
    const quote = source[index];
    if (quote !== '"' && quote !== "'") return null;
    let value = "";
    for (index += 1; index < source.length; index += 1) {
      const char = source[index];
      if (char === quote) return { value, end: index + 1 };
      if (char !== "\\") {
        value += char;
        continue;
      }
      index += 1;
      if (index >= source.length) return null;
      const escaped = source[index];
      const simple = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" };
      if (Object.prototype.hasOwnProperty.call(simple, escaped)) value += simple[escaped];
      else if (escaped === "x" && /^[0-9a-fA-F]{2}$/.test(source.slice(index + 1, index + 3))) {
        value += String.fromCharCode(parseInt(source.slice(index + 1, index + 3), 16));
        index += 2;
      } else if (escaped === "u" && /^[0-9a-fA-F]{4}$/.test(source.slice(index + 1, index + 5))) {
        value += String.fromCharCode(parseInt(source.slice(index + 1, index + 5), 16));
        index += 4;
      } else value += escaped;
    }
    return null;
  };
  const readInitMetadata = () => {
    const candidates = [];
    for (const script of document.querySelectorAll("script")) {
      const source = script.textContent || "";
      let offset = 0;
      while ((offset = source.indexOf("amd.init", offset)) !== -1) {
        const previous = source[offset - 1] || "";
        if (/[A-Za-z0-9_$]/.test(previous)) {
          offset += 8;
          continue;
        }
        let open = offset + 8;
        while (/\s/.test(source[open] || "")) open += 1;
        if (source[open] !== "(") {
          offset += 8;
          continue;
        }
        const first = readQuotedString(source, open + 1);
        if (first) {
          let comma = first.end;
          while (/\s/.test(source[comma] || "")) comma += 1;
          if (source[comma] === ",") {
            const second = readQuotedString(source, comma + 1);
            if (second && first.value && first.value.length <= 500 && second.value.length <= 500) {
              const candidate = { stampcollid: first.value, title: second.value };
              if (!candidates.some((item) => item.stampcollid === candidate.stampcollid && item.title === candidate.title)) {
                candidates.push(candidate);
              }
            }
          }
        }
        offset += 8;
      }
    }
    return candidates.length === 1 ? candidates[0] : null;
  };

  if (!/^\d+$/.test(taskId) || !/^\d+$/.test(userId) ||
      !validViewUrl(location.href, false) || location.hash !== "#fametc-completion-sync" ||
      looksLoggedOut(document)) return { verified: false, error: "MOODLE_VIEW_INVALID" };

  const before = await verifyCompleted();
  if (before.state === "complete") return { verified: true };
  if (before.state === "ambiguous") return { verified: false, error: "TASK_AMBIGUOUS" };
  if (before.state === "invalid") return { verified: false, error: "MOODLE_VERIFY_FAILED" };

  const rows = exactRows(document);
  if (rows.length > 1) return { verified: false, error: "TASK_AMBIGUOUS" };
  if (rows.length !== 1) return { verified: false, error: "TASK_MISSING" };
  if (rows[0].querySelectorAll('.tick.ajax[data-type="tick"]').length !== 1) {
    return { verified: false, error: "TASK_CONTROL_INVALID" };
  }
  const metadata = readInitMetadata();
  const sesskey = globalThis.M && globalThis.M.cfg && globalThis.M.cfg.sesskey;
  if (!metadata || typeof sesskey !== "string" || !sesskey || sesskey.length > 500) {
    return { verified: false, error: "MOODLE_SESSION_INVALID" };
  }

  const body = new URLSearchParams({
    id: taskId,
    type: "tick",
    val: "1",
    sesskey,
    stampcollid: metadata.stampcollid,
    title: metadata.title,
  });
  try {
    await fetchWithTimeout(`${origin}/mod/homework/view_ajax.php`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body,
    });
  } catch (e) {
    // A timed-out state-setting request may still have reached Moodle.
  }

  const after = await verifyCompleted();
  if (after.state === "complete") return { verified: true };
  if (after.state === "ambiguous") return { verified: false, error: "TASK_AMBIGUOUS" };
  return { verified: false, error: "MOODLE_VERIFY_FAILED" };
}

async function deliverCompletionRequest(snapshot) {
  const hiddenUrl = `${MOODLE_ORIGIN}/mod/homework/view.php?h=2&userid=${encodeURIComponent(snapshot.moodle.userId)}&showcompleted=0&limit=0${COMPLETION_SYNC_HASH}`;
  let tabId = null;
  let claimed = false;
  try {
    const tab = await chrome.tabs.create({ url: hiddenUrl, active: false });
    if (!tab || tab.id == null) return { verified: false, claimed, error: "HIDDEN_TAB_FAILED" };
    tabId = tab.id;
    await waitForTabLoad(tabId);
    // Claim only after the Moodle page is ready, immediately before entering
    // the MAIN-world verification/write path. An undo or identity change that
    // wins before this atomic server gate prevents any Moodle mutation.
    const operation = await claimCompletion(snapshot.requestId);
    if (!operation) return { verified: false, claimed, error: "CLAIM_REJECTED" };
    claimed = true;
    if (operation.moodle.userId !== snapshot.moodle.userId || operation.moodle.taskId !== snapshot.moodle.taskId) {
      return { verified: false, claimed, error: "CLAIM_MISMATCH" };
    }
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: runMoodleCompletionOperation,
      args: [operation.moodle.taskId, operation.moodle.userId, COMPLETION_TIMEOUT_MS],
    });
    if (result && result.verified === true) return { verified: true, claimed };
    const allowed = new Set([
      "MOODLE_VIEW_INVALID", "MOODLE_VERIFY_FAILED", "TASK_AMBIGUOUS", "TASK_MISSING",
      "TASK_CONTROL_INVALID", "MOODLE_SESSION_INVALID",
    ]);
    return { verified: false, claimed, error: allowed.has(result && result.error) ? result.error : "HIDDEN_TAB_FAILED" };
  } catch (e) {
    return { verified: false, claimed, error: "HIDDEN_TAB_FAILED" };
  } finally {
    if (tabId != null) {
      try { await chrome.tabs.remove(tabId); } catch (e) { /* best-effort cleanup */ }
    }
  }
}

async function runCompletionBatch() {
  const pendingBatch = await readPendingCompletions();
  if (!pendingBatch) return boundedCompletionResult({ errors: ["QUEUE_FETCH_FAILED"] });
  const queued = pendingBatch.completions;

  const errors = [];
  const seen = new Set();
  const operations = [];
  let invalidCount = 0;
  const capped = queued.slice(0, COMPLETION_BATCH_LIMIT);
  for (const item of capped) {
    if (!validCompletionRequest(item)) {
      invalidCount += 1;
      continue;
    }
    if (seen.has(item.requestId)) continue;
    seen.add(item.requestId);
    operations.push(item);
  }
  if (invalidCount) errors.push("INVALID_REQUEST");
  const hasMore = pendingBatch.hasMore || queued.length > COMPLETION_BATCH_LIMIT;
  if (hasMore) errors.push("QUEUE_LIMIT_REACHED");

  const verifiedIds = [];
  let claimedCount = 0;
  let unclaimedRetryCount = 0;
  for (const operation of operations) {
    const result = await deliverCompletionRequest(operation);
    if (result.claimed) claimedCount += 1;
    else unclaimedRetryCount += 1;
    if (result.verified) verifiedIds.push(operation.requestId);
    else errors.push(result.error || "HIDDEN_TAB_FAILED");
  }

  let acknowledged = 0;
  if (verifiedIds.length) {
    const acknowledgedIds = await acknowledgeCompletions(verifiedIds);
    if (acknowledgedIds) acknowledged = acknowledgedIds.length;
    if (!acknowledgedIds || acknowledged < verifiedIds.length) errors.push("ACK_FAILED");
  }
  const overflow = hasMore ? 1 : 0;
  return boundedCompletionResult({
    attempted: claimedCount,
    verified: verifiedIds.length,
    acknowledged,
    pending: claimedCount - acknowledged + unclaimedRetryCount + invalidCount + overflow,
    errors,
  });
}

function handleCompletionSync(sender) {
  try {
    if (!sender || !sender.tab || sender.tab.id == null || new URL(sender.tab.url).origin !== MOODLE_ORIGIN) {
      return Promise.resolve(boundedCompletionResult({ errors: ["INVALID_SENDER"] }));
    }
  } catch (e) {
    return Promise.resolve(boundedCompletionResult({ errors: ["INVALID_SENDER"] }));
  }
  if (!completionSyncInFlight) {
    completionSyncInFlight = runCompletionBatch()
      .catch(() => boundedCompletionResult({ errors: ["COMPLETION_SYNC_FAILED"] }))
      .finally(() => { completionSyncInFlight = null; });
  }
  return completionSyncInFlight;
}

async function importIntoTab(tabId, payload) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (data) => {
      if (typeof window.famImportSchoolData !== "function") {
        return { error: "NOT_LOADED" };
      }
      return window.famImportSchoolData(data);
    },
    args: [payload],
  });
  return result;
}

async function handleAutoSyncCheck() {
  const tab = await findFamEtcTab();
  return { famOpen: !!tab };
}

async function handleStatsImport(msg) {
  const tab = await findFamEtcTab();
  if (!tab) return { error: "NO_FAMETC_TAB" };
  const payload = {
    schoolStats: msg.schoolStats || [],
  };
  try {
    const result = await importIntoTab(tab.id, payload);
    if (!result || result.error === "NOT_LOADED") {
      return { error: "NOT_LOADED" };
    }
    return { result };
  } catch (e) {
    return { error: (e && e.message) || "IMPORT_FAILED" };
  }
}

async function handleOpenFametc() {
  const existing = await findFamEtcTab();
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return { opened: false, focused: true };
  }
  await chrome.tabs.create({ url: "https://www.fametc.com/" });
  return { opened: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === "AUTO_SYNC_CHECK") {
    handleAutoSyncCheck().then(sendResponse);
    return true; // keep the message channel open for the async response
  }

  if (msg.type === "IMPORT_STATS") {
    handleStatsImport(msg).then(sendResponse);
    return true;
  }

  if (msg.type === "OPEN_FAMETC") {
    handleOpenFametc().then(sendResponse);
    return true;
  }

  if (msg.type === "SYNC_MOODLE_COMPLETIONS") {
    handleCompletionSync(sender).then(sendResponse);
    return true;
  }

  return false;
});

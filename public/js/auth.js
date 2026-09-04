/* ============================================================
   AUTH.JS — WebAuthn (passkey) + family bootstrapping helpers
   Fam ETC — parent-only signup, no kid signup path anywhere.
   Attaches a plain global `window.auth` object (no bundler).
============================================================ */
(function () {
  "use strict";

  /* ---------- base64url <-> ArrayBuffer helpers ---------- */
  function b64urlToBuffer(b64url) {
    const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
    const base64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    return buf.buffer;
  }

  function bufferToB64url(buf) {
    const bytes = new Uint8Array(buf);
    let str = "";
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    const base64 = btoa(str);
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /* ---------- convert server-issued options (base64url strings)
     into the ArrayBuffer/Uint8Array shape navigator.credentials expects ---------- */
  function convertCreationOptions(options) {
    const out = Object.assign({}, options);
    out.challenge = b64urlToBuffer(options.challenge);
    out.user = Object.assign({}, options.user, { id: b64urlToBuffer(options.user.id) });
    if (Array.isArray(options.excludeCredentials)) {
      out.excludeCredentials = options.excludeCredentials.map((c) =>
        Object.assign({}, c, { id: b64urlToBuffer(c.id) })
      );
    }
    return out;
  }

  function convertRequestOptions(options) {
    const out = Object.assign({}, options);
    out.challenge = b64urlToBuffer(options.challenge);
    if (Array.isArray(options.allowCredentials)) {
      out.allowCredentials = options.allowCredentials.map((c) =>
        Object.assign({}, c, { id: b64urlToBuffer(c.id) })
      );
    }
    return out;
  }

  /* ---------- convert a browser-created credential back into the
     base64url-safe JSON body the server expects ---------- */
  function credentialToJSON(cred) {
    const response = cred.response;
    const isRegistration = typeof response.attestationObject !== "undefined";
    const base = {
      id: cred.id,
      rawId: bufferToB64url(cred.rawId),
      type: cred.type,
      clientExtensionResults: (cred.getClientExtensionResults && cred.getClientExtensionResults()) || {},
    };
    if (isRegistration) {
      base.response = {
        clientDataJSON: bufferToB64url(response.clientDataJSON),
        attestationObject: bufferToB64url(response.attestationObject),
        transports: (response.getTransports && response.getTransports()) || [],
      };
    } else {
      base.response = {
        clientDataJSON: bufferToB64url(response.clientDataJSON),
        authenticatorData: bufferToB64url(response.authenticatorData),
        signature: bufferToB64url(response.signature),
        userHandle: response.userHandle ? bufferToB64url(response.userHandle) : undefined,
      };
    }
    return base;
  }

  /* ---------- fetch helper ---------- */
  async function api(path, opts) {
    const res = await fetch(path, Object.assign({
      method: "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
    }, opts));
    let body = null;
    try { body = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((body && body.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  /* ---------- passkey sign-up (PARENT ONLY — no kid signup route exists) ---------- */
  async function signUp(name, inviteCode) {
    if (!window.PublicKeyCredential) throw new Error("Passkeys are not supported in this browser.");
    const options = await api("/api/webauthn/signup/options", {
      method: "POST",
      body: JSON.stringify({ name: name || "", inviteCode: inviteCode || "" }),
    });
    const publicKey = convertCreationOptions(options);
    const credential = await navigator.credentials.create({ publicKey });
    if (!credential) throw new Error("Passkey creation was cancelled.");
    const payload = credentialToJSON(credential);
    return api("/api/webauthn/signup/verify", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  /* ---------- passkey sign-in ---------- */
  async function signIn() {
    if (!window.PublicKeyCredential) throw new Error("Passkeys are not supported in this browser.");
    const options = await api("/api/webauthn/auth/options", { method: "POST" });
    const publicKey = convertRequestOptions(options);
    const credential = await navigator.credentials.get({ publicKey });
    if (!credential) throw new Error("Sign-in was cancelled.");
    const payload = credentialToJSON(credential);
    return api("/api/webauthn/auth/verify", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  /* ---------- backup-code sign-in (account recovery) ---------- */
  async function backupCodeSignIn(code) {
    return api("/api/auth/backup/verify", {
      method: "POST",
      body: JSON.stringify({ code: code || "" }),
    });
  }

  /* ---------- session ---------- */
  async function signOut() {
    return api("/api/logout", { method: "POST" });
  }

  async function getMe() {
    try {
      return await api("/api/me", { method: "GET" });
    } catch (e) {
      if (e.status === 401) return null;
      throw e;
    }
  }

  /* ---------- family ---------- */
  async function getFamilies() {
    const data = await api("/api/family", { method: "GET" });
    return (data && data.families) || [];
  }

  async function createFamily(name) {
    return api("/api/family", { method: "POST", body: JSON.stringify({ name: name || "" }) });
  }

  async function joinFamily(code) {
    return api("/api/family/join", { method: "POST", body: JSON.stringify({ code: code || "" }) });
  }

  async function addKid(name, grade, color) {
    return api("/api/family/kids", {
      method: "POST",
      body: JSON.stringify({ name: name || "", grade: grade || "", color: color || "" }),
    });
  }

  async function updateKid(kidId, patch) {
    return api("/api/family/kids/" + encodeURIComponent(kidId), {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  }

  async function removeKid(kidId) {
    return api("/api/family/kids/" + encodeURIComponent(kidId), { method: "DELETE" });
  }

  async function removeMember(userId) {
    return api("/api/family/members/" + encodeURIComponent(userId), { method: "DELETE" });
  }

  /* ---------- family-scoped Hermes connection ---------- */
  async function getHermesConnection() {
    return api("/api/hermes/connect", { method: "GET" });
  }

  async function connectHermes() {
    return api("/api/hermes/connect", { method: "POST" });
  }

  async function disconnectHermes() {
    return api("/api/hermes/connect", { method: "DELETE" });
  }

  /* ---------- passkey / credential management (security.html) ---------- */
  async function getCredentials() {
    const data = await api("/api/webauthn/credentials", { method: "GET" });
    return (data && data.credentials) || [];
  }

  async function renameCredential(id, name) {
    const data = await api("/api/webauthn/credentials/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify({ name: name || "" }),
    });
    return (data && data.credentials) || [];
  }

  async function removeCredential(id) {
    const data = await api("/api/webauthn/credentials/" + encodeURIComponent(id), { method: "DELETE" });
    return (data && data.credentials) || [];
  }

  async function registerAdditionalPasskey(label) {
    const options = await api("/api/webauthn/register/options", { method: "POST" });
    const publicKey = convertCreationOptions(options);
    const credential = await navigator.credentials.create({ publicKey });
    if (!credential) throw new Error("Passkey creation was cancelled.");
    const payload = credentialToJSON(credential);
    payload.label = label || "";
    return api("/api/webauthn/register/verify", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  /* ---------- kid sign-in: request → parent approves → register passkey ----------
     Runs on the KID's OWN device — no parent session needed there. The kid
     submits the family invite code + name, a parent approves remotely, then the
     kid registers a device passkey and is signed straight in. See lib/kid-access.js
     and APP-BRIEF.md "Kid sign-in". */
  function guessDeviceLabel() {
    const ua = navigator.userAgent || "";
    if (/iPad/i.test(ua)) return "an iPad";
    if (/iPhone/i.test(ua)) return "an iPhone";
    if (/Android/i.test(ua)) return "an Android device";
    if (/Macintosh/i.test(ua)) return "a Mac";
    if (/Windows/i.test(ua)) return "a Windows PC";
    return "a device";
  }
  async function requestKidAccess(inviteCode, name) {
    return api("/api/kid/access-request", {
      method: "POST",
      body: JSON.stringify({ inviteCode: inviteCode || "", name: name || "", deviceLabel: guessDeviceLabel() }),
    });
  }
  async function kidAccessStatus(requestId, pollToken) {
    return api(
      "/api/kid/access-request/" + encodeURIComponent(requestId) + "?token=" + encodeURIComponent(pollToken),
      { method: "GET" }
    );
  }
  // After a parent approves, register a passkey on this device and get signed in.
  async function registerKidPasskey(requestId, pollToken) {
    if (!window.PublicKeyCredential) throw new Error("Passkeys are not supported in this browser.");
    const options = await api(
      "/api/kid/access-request/" + encodeURIComponent(requestId) + "/register/options",
      { method: "POST", body: JSON.stringify({ token: pollToken }) }
    );
    const publicKey = convertCreationOptions(options);
    const credential = await navigator.credentials.create({ publicKey });
    if (!credential) throw new Error("Passkey setup was cancelled.");
    return api("/api/kid/access-request/" + encodeURIComponent(requestId) + "/register/verify", {
      method: "POST",
      body: JSON.stringify({ token: pollToken, response: credentialToJSON(credential) }),
    });
  }
  // Parent side: pending kid access requests + approve/deny.
  async function getKidAccessRequests() {
    const data = await api("/api/family/access-requests", { method: "GET" });
    return (data && data.requests) || [];
  }
  async function approveKidAccess(requestId) {
    return api("/api/family/access-requests/" + encodeURIComponent(requestId) + "/approve", { method: "POST" });
  }
  async function denyKidAccess(requestId) {
    return api("/api/family/access-requests/" + encodeURIComponent(requestId) + "/deny", { method: "POST" });
  }

  /* ---------- standalone Apple Watch pairing ---------- */
  async function startWatchPairing(target, kidId) {
    return api("/api/watch/pairing/start", {
      method: "POST",
      body: JSON.stringify({ target: target || "self", kidId: kidId || undefined }),
    });
  }

  async function getWatchDevices() {
    return api("/api/watch/devices", { method: "GET" });
  }

  async function revokeWatchDevice(deviceId) {
    return api("/api/watch/devices/" + encodeURIComponent(deviceId) + "/revoke", { method: "POST" });
  }

  async function issueBackupCodes() {
    return api("/api/auth/backup/issue", { method: "POST" });
  }

  async function regenerateBackupCodes() {
    return api("/api/auth/backup/regenerate", { method: "POST" });
  }

  /* ---------- billing (billing.html) ---------- */
  async function getBillingStatus() {
    return api("/api/billing/status", { method: "GET" });
  }

  async function startCheckout(plan) {
    return api("/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify(plan ? { plan } : {}),
    });
  }

  async function openBillingPortal() {
    return api("/api/billing/portal", { method: "POST" });
  }

  /* ---------- web push ---------- */
  async function getVapidPublicKey() {
    const data = await api("/api/push/vapid-public-key", { method: "GET" });
    return (data && data.publicKey) || null;
  }

  async function subscribeWebPush(subscription) {
    return api("/api/push/web/subscribe", {
      method: "POST",
      body: JSON.stringify({ subscription }),
    });
  }

  async function unsubscribeWebPush(endpoint) {
    return api("/api/push/web/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint }),
    });
  }

  // "Notify myself" — used by the school stats change/threshold detection
  // (see app.js famImportSchoolData) to push a real notification to this
  // user's own subscribed devices even if the tab is backgrounded. Best-
  // effort: callers should not treat a rejection as fatal.
  async function notifySelf(title, body, tag) {
    return api("/api/notify/self", {
      method: "POST",
      body: JSON.stringify({ title: title || "", body: body || "", tag: tag || undefined }),
    });
  }

  /* ---------- chat ---------- */
  async function getMessages(since) {
    const qs = since ? ("?since=" + encodeURIComponent(since)) : "";
    const data = await api("/api/chat/messages" + qs, { method: "GET" });
    return (data && data.messages) || [];
  }

  async function sendChatMessage(text, media) {
    const body = { text: text || "" };
    if (media) body.media = media;
    return api("/api/chat/messages", { method: "POST", body: JSON.stringify(body) });
  }

  async function deleteChatMessage(id) {
    return api("/api/chat/messages/" + encodeURIComponent(id), { method: "DELETE" });
  }

  async function flagChatMessage(id, reason) {
    return api("/api/chat/messages/" + encodeURIComponent(id) + "/flag", {
      method: "POST",
      body: JSON.stringify({ reason: reason || "" }),
    });
  }

  /* ---------- GIFs (Giphy, proxied through our server — see server.js) ---------- */
  async function trendingGifs(limit) {
    const qs = limit ? ("?limit=" + encodeURIComponent(limit)) : "";
    const data = await api("/api/gifs/trending" + qs, { method: "GET" });
    return (data && data.gifs) || [];
  }

  async function searchGifs(q, limit) {
    const params = new URLSearchParams();
    params.set("q", q || "");
    if (limit) params.set("limit", limit);
    const data = await api("/api/gifs/search?" + params.toString(), { method: "GET" });
    return (data && data.gifs) || [];
  }

  /* ---------- school calendar (Phase 2) ---------- */
  async function getCalendarFeeds() {
    return api("/api/calendar/feeds", { method: "GET" });
  }

  async function previewCalendarFeed(url) {
    return api("/api/calendar/feeds/preview", {
      method: "POST",
      body: JSON.stringify({ url: url || "" }),
    });
  }

  async function subscribeCalendarFeed(opts) {
    return api("/api/calendar/feeds/subscribe", {
      method: "POST",
      body: JSON.stringify(opts || {}),
    });
  }

  async function unsubscribeCalendarFeed(opts) {
    return api("/api/calendar/feeds/unsubscribe", {
      method: "POST",
      body: JSON.stringify(opts || {}),
    });
  }

  async function syncCalendar(force) {
    return api("/api/calendar/sync", {
      method: "POST",
      body: JSON.stringify(force ? { force: true } : {}),
    });
  }

  async function hideSchoolEvent(subscriptionId, uid) {
    return api("/api/calendar/school-events/hide", {
      method: "POST",
      body: JSON.stringify({ subscriptionId: subscriptionId || "", uid: uid || "" }),
    });
  }

  /* ---------- family calendar events (manual appointments, server-synced) ---------- */
  async function getCalendarEvents() {
    const data = await api("/api/calendar/events", { method: "GET" });
    return (data && data.events) || [];
  }

  // payload: {title, date, time, endTime, notes, category, kidId, silent,
  //           endDate, repeat, repeatUntil, sourceType, sourceId} — optional
  //           fields are forwarded untouched; the server validates them.
  // silent:true skips the server's family-chat announcement (bulk imports).
  async function addCalendarEvent(payload) {
    return api("/api/calendar/events", { method: "POST", body: JSON.stringify(payload || {}) });
  }

  async function deleteCalendarEvent(id) {
    return api("/api/calendar/events/" + encodeURIComponent(id), { method: "DELETE" });
  }

  // payload: same editable fields as addCalendarEvent. For recurring events the
  // id is the series id and the edit applies to the whole series (server-side).
  async function updateCalendarEvent(id, payload) {
    return api("/api/calendar/events/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(payload || {}),
    });
  }

  /* ---------- family actions (Today queue) ---------- */
  async function getFamilyActions() {
    const data = await api("/api/family/actions", { method: "GET" });
    return (data && data.actions) || [];
  }

  async function createFamilyAction(payload) {
    return api("/api/family/actions", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
  }

  async function updateFamilyAction(id, patch) {
    return api("/api/family/actions/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  }

  async function deleteFamilyAction(id) {
    return api("/api/family/actions/" + encodeURIComponent(id), { method: "DELETE" });
  }

  /* ---------- homework (Phase 3) ---------- */
  async function getHomework(opts) {
    const params = new URLSearchParams();
    if (opts && opts.kidId) params.set("kidId", opts.kidId);
    if (opts && opts.subject) params.set("subject", opts.subject);
    const qs = params.toString() ? ("?" + params.toString()) : "";
    const data = await api("/api/homework" + qs, { method: "GET" });
    return (data && data.homework) || [];
  }

  async function addHomework(payload) {
    return api("/api/homework", { method: "POST", body: JSON.stringify(payload || {}) });
  }

  async function updateHomework(id, patch) {
    return api("/api/homework/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  }

  async function deleteHomework(id) {
    return api("/api/homework/" + encodeURIComponent(id), { method: "DELETE" });
  }

  /* ---------- school account (Moodle) import ---------- */
  async function getSchoolStatus() {
    return api("/api/school/status", { method: "GET" });
  }

  async function saveSchoolFeeds(kidId, homeworkUrl, timetableUrl) {
    return api("/api/school/feeds", {
      method: "POST",
      body: JSON.stringify({ kidId: kidId || "", homeworkUrl: homeworkUrl || "", timetableUrl: timetableUrl || "" }),
    });
  }

  async function syncSchoolFeeds(kidId) {
    return api("/api/school/feeds/sync", {
      method: "POST",
      body: JSON.stringify(kidId ? { kidId } : {}),
    });
  }

  async function disconnectSchoolFeeds(kidId) {
    return api("/api/school/feeds/disconnect", {
      method: "POST",
      body: JSON.stringify({ kidId: kidId || "" }),
    });
  }

  async function connectSchoolAccount(username, password) {
    return api("/api/school/connect", {
      method: "POST",
      body: JSON.stringify({ username: username || "", password: password || "" }),
    });
  }

  async function mapSchoolKid(kidId, moodleUserId) {
    return api("/api/school/map", {
      method: "POST",
      body: JSON.stringify({ kidId: kidId || "", moodleUserId: moodleUserId || "" }),
    });
  }

  // Alias — same endpoint as mapSchoolKid, named to match the Settings "School
  // (Moodle) IDs" card's mental model (kid -> their Moodle numeric id).
  const setKidMoodleId = mapSchoolKid;

  async function importSchoolData(kidId) {
    return api("/api/school/import", {
      method: "POST",
      body: JSON.stringify({ kidId: kidId || "" }),
    });
  }

  async function confirmSchoolImport(kidId, homeworkList, timetableList) {
    return api("/api/school/import/confirm", {
      method: "POST",
      body: JSON.stringify({ kidId: kidId || "", homework: homeworkList || [], timetable: timetableList || [] }),
    });
  }

  async function disconnectSchoolAccount() {
    return api("/api/school/disconnect", { method: "POST" });
  }

  /* ---------- goals (Phase W3) ---------- */
  async function getGoals(opts) {
    const qs = opts && opts.kidId ? ("?kidId=" + encodeURIComponent(opts.kidId)) : "";
    const data = await api("/api/goals" + qs, { method: "GET" });
    return (data && data.goals) || [];
  }

  async function addGoal(payload) {
    return api("/api/goals", { method: "POST", body: JSON.stringify(payload || {}) });
  }

  async function checkGoalToday(id) {
    return api("/api/goals/" + encodeURIComponent(id) + "/check", { method: "PATCH" });
  }

  async function incrementGoalProgress(id, amount) {
    return api("/api/goals/" + encodeURIComponent(id) + "/progress", {
      method: "PATCH",
      body: JSON.stringify({ amount: amount == null ? 1 : amount }),
    });
  }

  async function deleteGoal(id) {
    return api("/api/goals/" + encodeURIComponent(id), { method: "DELETE" });
  }

  /* ---------- activities (Phase W3) ---------- */
  async function getActivities(opts) {
    const qs = opts && opts.kidId ? ("?kidId=" + encodeURIComponent(opts.kidId)) : "";
    const data = await api("/api/activities" + qs, { method: "GET" });
    return (data && data.activities) || [];
  }

  async function addActivity(payload) {
    return api("/api/activities", { method: "POST", body: JSON.stringify(payload || {}) });
  }

  async function updateActivity(id, patch) {
    return api("/api/activities/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  }

  async function deleteActivity(id) {
    return api("/api/activities/" + encodeURIComponent(id), { method: "DELETE" });
  }

  /* ---------- notes (enrichment) ---------- */
  async function getRecentNews() {
    return api("/api/news/recent", { method: "GET" });
  }

  async function getNotes(opts) {
    const params = new URLSearchParams();
    if (opts && opts.authorId) params.set("authorId", opts.authorId);
    if (opts && opts.from) params.set("from", opts.from);
    if (opts && opts.to) params.set("to", opts.to);
    const qs = params.toString() ? ("?" + params.toString()) : "";
    const data = await api("/api/notes" + qs, { method: "GET" });
    return (data && data.notes) || [];
  }

  async function addNote(payload) {
    return api("/api/notes", { method: "POST", body: JSON.stringify(payload || {}) });
  }

  async function updateNote(id, patch) {
    return api("/api/notes/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  }

  async function deleteNote(id) {
    return api("/api/notes/" + encodeURIComponent(id), { method: "DELETE" });
  }

  /* ---------- word bank (enrichment) ---------- */
  async function getWordBank(kidId) {
    const qs = kidId ? ("?kidId=" + encodeURIComponent(kidId)) : "";
    return api("/api/wordbank" + qs, { method: "GET" });
  }

  async function wordBankInteract(word, correct) {
    return api("/api/wordbank/interact", {
      method: "POST",
      body: JSON.stringify({ word: word || "", correct: !!correct }),
    });
  }

  async function wordBankPlacement(known) {
    return api("/api/wordbank/placement", {
      method: "POST",
      body: JSON.stringify({ known: known || [] }),
    });
  }

  async function wordBankQuiz(n) {
    const qs = n ? ("?n=" + encodeURIComponent(n)) : "";
    return api("/api/wordbank/quiz" + qs, { method: "GET" });
  }

  /* ---------- brain teaser (enrichment) ---------- */
  async function getBrainTeaserToday() {
    return api("/api/brainteaser/today", { method: "GET" });
  }

  async function answerBrainTeaser(qid, correct) {
    return api("/api/brainteaser/answer", {
      method: "POST",
      body: JSON.stringify({ qid: qid || "", correct: !!correct }),
    });
  }

  async function getDailyPuzzle(date) {
    return api("/api/enrichment/puzzle/today?date=" + encodeURIComponent(date || ""), { method: "GET" });
  }

  /* ---------- AI parse (schedule/homework photo -> structured items) ---------- */
  async function parseWithAI(kind, mediaType, dataBase64) {
    return api("/api/ai/parse", {
      method: "POST",
      body: JSON.stringify({ kind, mediaType, dataBase64 }),
    });
  }

  /* ---------- trips (Phase C — see docs/TRIPS-PLAN.md "API surface") ----------
     One-liner wrappers over the trips API, same style as every wrapper above.
     The trip chat LONG-POLL is the one exception: public/js/trips.js hits
     /api/trips/:id/chat/messages with a raw fetch + AbortController (mirrors
     app.js's chatLongPollFetch), so it isn't wrapped here — getTripChatMessages
     below is only for one-shot fetches (initial load, post-send catch-up). */
  async function getTrips() {
    const data = await api("/api/trips", { method: "GET" });
    return (data && data.trips) || [];
  }

  async function createTrip(payload) {
    return api("/api/trips", { method: "POST", body: JSON.stringify(payload || {}) });
  }

  async function getTrip(tripId) {
    return api("/api/trips/" + encodeURIComponent(tripId), { method: "GET" });
  }

  async function updateTrip(tripId, patch) {
    return api("/api/trips/" + encodeURIComponent(tripId), {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  }

  async function deleteTrip(tripId) {
    return api("/api/trips/" + encodeURIComponent(tripId), { method: "DELETE" });
  }

  async function regenerateTripInvite(tripId) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/invite/regenerate", { method: "POST" });
  }

  async function disableTripInvite(tripId) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/invite/disable", { method: "POST" });
  }

  async function joinTripPreview(code) {
    return api("/api/trips/join/" + encodeURIComponent(code), { method: "GET" });
  }

  async function joinTrip(code) {
    return api("/api/trips/join/" + encodeURIComponent(code), { method: "POST" });
  }

  async function removeTripMember(tripId, userId) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/members/" + encodeURIComponent(userId), {
      method: "DELETE",
    });
  }

  async function addTripItineraryItem(tripId, payload) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/itinerary", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
  }

  async function updateTripItineraryItem(tripId, itemId, patch) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/itinerary/" + encodeURIComponent(itemId), {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  }

  async function moveTripItineraryItem(tripId, itemId, payload) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/itinerary/" + encodeURIComponent(itemId) + "/move", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
  }

  async function deleteTripItineraryItem(tripId, itemId) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/itinerary/" + encodeURIComponent(itemId), {
      method: "DELETE",
    });
  }

  async function previewTripItineraryChatImport(tripId, messageId) {
    return api(
      "/api/trips/" + encodeURIComponent(tripId) + "/itinerary/import-chat/" + encodeURIComponent(messageId) + "/preview",
      { method: "POST", body: JSON.stringify({}) }
    );
  }

  async function importTripItineraryChat(tripId, messageId) {
    return api(
      "/api/trips/" + encodeURIComponent(tripId) + "/itinerary/import-chat/" + encodeURIComponent(messageId),
      { method: "POST", body: JSON.stringify({}) }
    );
  }

  async function voteTripItineraryItem(tripId, itemId) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/itinerary/" + encodeURIComponent(itemId) + "/vote", {
      method: "POST",
    });
  }

  async function addTripComment(tripId, itemId, text) {
    return api(
      "/api/trips/" + encodeURIComponent(tripId) + "/itinerary/" + encodeURIComponent(itemId) + "/comments",
      { method: "POST", body: JSON.stringify({ text: text || "" }) }
    );
  }

  async function deleteTripComment(tripId, itemId, commentId) {
    return api(
      "/api/trips/" + encodeURIComponent(tripId) + "/itinerary/" + encodeURIComponent(itemId) +
        "/comments/" + encodeURIComponent(commentId),
      { method: "DELETE" }
    );
  }

  async function flagTripComment(tripId, itemId, commentId, reason) {
    return api(
      "/api/trips/" + encodeURIComponent(tripId) + "/itinerary/" + encodeURIComponent(itemId) +
        "/comments/" + encodeURIComponent(commentId) + "/flag",
      { method: "POST", body: JSON.stringify({ reason: reason || "" }) }
    );
  }

  async function addTripFlight(tripId, payload) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/flights", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
  }

  async function updateTripFlight(tripId, flightId, patch) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/flights/" + encodeURIComponent(flightId), {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  }

  async function deleteTripFlight(tripId, flightId) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/flights/" + encodeURIComponent(flightId), {
      method: "DELETE",
    });
  }

  async function addTripLodging(tripId, payload) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/lodging", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
  }

  async function updateTripLodging(tripId, lodgingId, patch) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/lodging/" + encodeURIComponent(lodgingId), {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  }

  async function deleteTripLodging(tripId, lodgingId) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/lodging/" + encodeURIComponent(lodgingId), {
      method: "DELETE",
    });
  }

  async function getTripChatMessages(tripId, opts) {
    const params = new URLSearchParams();
    if (opts && opts.afterId) params.set("afterId", opts.afterId);
    if (opts && opts.wait) params.set("wait", "1");
    if (opts && opts.since) params.set("since", opts.since);
    if (opts && opts.limit) params.set("limit", opts.limit);
    const qs = params.toString() ? ("?" + params.toString()) : "";
    const data = await api("/api/trips/" + encodeURIComponent(tripId) + "/chat/messages" + qs, { method: "GET" });
    return (data && data.messages) || [];
  }

  async function sendTripChatMessage(tripId, text, media) {
    const body = { text: text || "" };
    if (media) body.media = media;
    return api("/api/trips/" + encodeURIComponent(tripId) + "/chat/messages", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async function deleteTripChatMessage(tripId, msgId) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/chat/messages/" + encodeURIComponent(msgId), {
      method: "DELETE",
    });
  }

  async function flagTripChatMessage(tripId, msgId, reason) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/chat/messages/" + encodeURIComponent(msgId) + "/flag", {
      method: "POST",
      body: JSON.stringify({ reason: reason || "" }),
    });
  }

  /* ---------- trips v1.1 (Wanderlog-gap features — see docs/TRIPS-PLAN.md
     "v1.1 — Wanderlog-gap features"): paste-to-import + packing checklists.
     Same one-liner style as every wrapper above. ---------- */
  async function parseBooking(payload) {
    return api("/api/ai/parse-booking", { method: "POST", body: JSON.stringify(payload || {}) });
  }

  async function createTripChecklist(tripId, payload) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/checklists", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
  }

  async function getOrCreateMyPacking(tripId) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/checklists/personal", { method: "POST" });
  }

  async function renameTripChecklist(tripId, listId, patch) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/checklists/" + encodeURIComponent(listId), {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  }

  async function deleteTripChecklist(tripId, listId) {
    return api("/api/trips/" + encodeURIComponent(tripId) + "/checklists/" + encodeURIComponent(listId), {
      method: "DELETE",
    });
  }

  async function addTripChecklistItem(tripId, listId, payload) {
    return api(
      "/api/trips/" + encodeURIComponent(tripId) + "/checklists/" + encodeURIComponent(listId) + "/items",
      { method: "POST", body: JSON.stringify(payload || {}) }
    );
  }

  async function updateTripChecklistItem(tripId, listId, itemId, patch) {
    return api(
      "/api/trips/" + encodeURIComponent(tripId) + "/checklists/" + encodeURIComponent(listId) +
        "/items/" + encodeURIComponent(itemId),
      { method: "PATCH", body: JSON.stringify(patch || {}) }
    );
  }

  async function deleteTripChecklistItem(tripId, listId, itemId) {
    return api(
      "/api/trips/" + encodeURIComponent(tripId) + "/checklists/" + encodeURIComponent(listId) +
        "/items/" + encodeURIComponent(itemId),
      { method: "DELETE" }
    );
  }

  /* ---------- meals (see docs/MEALS-PLAN.md "API surface" §5) ----------
     One-liner wrappers, same style as every wrapper above. getMealsRecipes/
     getMealsRecipe aren't in §5 (the recipe library ships as pure server-
     side helpers there) but public/js/meals.js's Recipes tab needs a way to
     browse/search them, so these assume a thin read route wraps the same
     library — see the contract-gap note at the top of meals.js; unlike the
     rest of this section they're unverified against a live route.
     updateMyMealProfile hits the real, already-landed lib/routes/meals.js
     route (PATCH /api/meals/profile, self-only — sets the CALLING parent's
     own portion/allergies/proteinTargetG). A kid's portion/allergies are
     just fields on the kid record, so that reuses the existing updateKid()
     above — there is no generic "set any member's prefs by id" route on the
     server, so meals.js never calls one. */
  async function getMeals() {
    return api("/api/meals", { method: "GET" });
  }

  async function getShoppingItems() {
    return api("/api/meals/shopping", { method: "GET" });
  }

  async function updateMealPrefs(patch) {
    return api("/api/meals/prefs", { method: "PATCH", body: JSON.stringify(patch || {}) });
  }

  async function addPantryItem(payload) {
    return api("/api/meals/pantry", { method: "POST", body: JSON.stringify(payload || {}) });
  }

  async function updatePantryItem(id, patch) {
    return api("/api/meals/pantry/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  }

  async function deletePantryItem(id) {
    return api("/api/meals/pantry/" + encodeURIComponent(id), { method: "DELETE" });
  }

  async function bulkPantry(items) {
    return api("/api/meals/pantry/bulk", { method: "POST", body: JSON.stringify({ items: items || [] }) });
  }

  async function undoPantry(eventId) {
    return api("/api/meals/pantry/undo", { method: "POST", body: JSON.stringify({ eventId: eventId || "" }) });
  }

  async function planMenu(payload) {
    return api("/api/meals/menu/plan", { method: "POST", body: JSON.stringify(payload || {}) });
  }

  async function previewMealPlanChatImport(messageId, startDate) {
    return api("/api/meals/menu/import-chat/" + encodeURIComponent(messageId) + "/preview", {
      method: "POST",
      body: JSON.stringify({ startDate: startDate || "" }),
    });
  }

  async function importMealPlanChat(messageId, startDate, replaceExisting) {
    return api("/api/meals/menu/import-chat/" + encodeURIComponent(messageId), {
      method: "POST",
      body: JSON.stringify({ startDate: startDate || "", replaceExisting: replaceExisting === true }),
    });
  }

  async function addMenuEntry(payload) {
    return api("/api/meals/menu", { method: "POST", body: JSON.stringify(payload || {}) });
  }

  async function updateMenuEntry(id, patch) {
    return api("/api/meals/menu/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  }

  async function deleteMenuEntry(id) {
    return api("/api/meals/menu/" + encodeURIComponent(id), { method: "DELETE" });
  }

  async function markMenuCooked(id) {
    return api("/api/meals/menu/" + encodeURIComponent(id) + "/cooked", { method: "POST" });
  }

  async function addShoppingItem(payload) {
    return api("/api/meals/shopping", { method: "POST", body: JSON.stringify(payload || {}) });
  }

  async function updateShoppingItem(id, patch) {
    return api("/api/meals/shopping/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  }

  async function deleteShoppingItem(id) {
    return api("/api/meals/shopping/" + encodeURIComponent(id), { method: "DELETE" });
  }

  async function shoppingFromPantry() {
    return api("/api/meals/shopping/from-pantry", { method: "POST" });
  }

  async function restockPantry() {
    return api("/api/meals/shopping/restock", { method: "POST" });
  }

  async function updateMyMealProfile(patch) {
    return api("/api/meals/profile", { method: "PATCH", body: JSON.stringify(patch || {}) });
  }

  async function getMealsRecipes(params) {
    const qs = new URLSearchParams(params || {}).toString();
    return api("/api/meals/recipes" + (qs ? "?" + qs : ""), { method: "GET" });
  }

  async function getMealsRecipe(id) {
    return api("/api/meals/recipes/" + encodeURIComponent(id), { method: "GET" });
  }

  window.auth = {
    signUp,
    signIn,
    signOut,
    getMe,
    createFamily,
    joinFamily,
    getFamilies,
    addKid,
    updateKid,
    removeKid,
    removeMember,
    getHermesConnection,
    connectHermes,
    disconnectHermes,
    getCalendarFeeds,
    previewCalendarFeed,
    subscribeCalendarFeed,
    unsubscribeCalendarFeed,
    syncCalendar,
    hideSchoolEvent,
    getCalendarEvents,
    addCalendarEvent,
    updateCalendarEvent,
    deleteCalendarEvent,
    getFamilyActions,
    createFamilyAction,
    updateFamilyAction,
    deleteFamilyAction,
    backupCodeSignIn,
    getCredentials,
    renameCredential,
    removeCredential,
    registerAdditionalPasskey,
    requestKidAccess,
    kidAccessStatus,
    registerKidPasskey,
    getKidAccessRequests,
    approveKidAccess,
    denyKidAccess,
    startWatchPairing,
    getWatchDevices,
    revokeWatchDevice,
    issueBackupCodes,
    regenerateBackupCodes,
    getBillingStatus,
    startCheckout,
    openBillingPortal,
    getVapidPublicKey,
    subscribeWebPush,
    unsubscribeWebPush,
    notifySelf,
    getMessages,
    sendChatMessage,
    deleteChatMessage,
    flagChatMessage,
    trendingGifs,
    searchGifs,
    getHomework,
    addHomework,
    updateHomework,
    deleteHomework,
    getGoals,
    addGoal,
    checkGoalToday,
    incrementGoalProgress,
    deleteGoal,
    getActivities,
    addActivity,
    updateActivity,
    deleteActivity,
    getSchoolStatus,
    saveSchoolFeeds,
    syncSchoolFeeds,
    disconnectSchoolFeeds,
    connectSchoolAccount,
    mapSchoolKid,
    setKidMoodleId,
    importSchoolData,
    confirmSchoolImport,
    disconnectSchoolAccount,
    getNotes,
    getRecentNews,
    addNote,
    updateNote,
    deleteNote,
    getWordBank,
    wordBankInteract,
    wordBankPlacement,
    wordBankQuiz,
    getBrainTeaserToday,
    answerBrainTeaser,
    getDailyPuzzle,
    parseWithAI,
    getTrips,
    createTrip,
    getTrip,
    updateTrip,
    deleteTrip,
    regenerateTripInvite,
    disableTripInvite,
    joinTripPreview,
    joinTrip,
    removeTripMember,
    addTripItineraryItem,
    updateTripItineraryItem,
    moveTripItineraryItem,
    deleteTripItineraryItem,
    previewTripItineraryChatImport,
    importTripItineraryChat,
    voteTripItineraryItem,
    addTripComment,
    deleteTripComment,
    flagTripComment,
    addTripFlight,
    updateTripFlight,
    deleteTripFlight,
    addTripLodging,
    updateTripLodging,
    deleteTripLodging,
    getTripChatMessages,
    sendTripChatMessage,
    deleteTripChatMessage,
    flagTripChatMessage,
    parseBooking,
    createTripChecklist,
    getOrCreateMyPacking,
    renameTripChecklist,
    deleteTripChecklist,
    addTripChecklistItem,
    updateTripChecklistItem,
    deleteTripChecklistItem,
    getMeals,
    getShoppingItems,
    updateMealPrefs,
    addPantryItem,
    updatePantryItem,
    deletePantryItem,
    bulkPantry,
    undoPantry,
    planMenu,
    previewMealPlanChatImport,
    importMealPlanChat,
    addMenuEntry,
    updateMenuEntry,
    deleteMenuEntry,
    markMenuCooked,
    addShoppingItem,
    updateShoppingItem,
    deleteShoppingItem,
    shoppingFromPantry,
    restockPantry,
    updateMyMealProfile,
    getMealsRecipes,
    getMealsRecipe,
  };
})();

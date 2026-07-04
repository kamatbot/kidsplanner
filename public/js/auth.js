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
  async function signUp(name) {
    if (!window.PublicKeyCredential) throw new Error("Passkeys are not supported in this browser.");
    const options = await api("/api/webauthn/signup/options", {
      method: "POST",
      body: JSON.stringify({ name: name || "" }),
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

  /* ---------- notes (enrichment) ---------- */
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
    getCalendarFeeds,
    previewCalendarFeed,
    subscribeCalendarFeed,
    unsubscribeCalendarFeed,
    syncCalendar,
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
    getSchoolStatus,
    connectSchoolAccount,
    mapSchoolKid,
    setKidMoodleId,
    importSchoolData,
    confirmSchoolImport,
    disconnectSchoolAccount,
    getNotes,
    addNote,
    updateNote,
    deleteNote,
    getWordBank,
    wordBankInteract,
    wordBankPlacement,
    wordBankQuiz,
    getBrainTeaserToday,
    answerBrainTeaser,
  };
})();

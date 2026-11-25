/* ============================================================
   SCREEN-TIME-TODAY.JS — Screen Time on the main Today page.
   Parents: kids' asks (more time / stay up later) with one-tap
   answers, and a per-kid bedtime chip with "+30m tonight".
   Kids: an "Ask a parent" card. Attaches window.famScreenTimeToday.
   Server contract: docs/SCREEN-TIME-PLAN.md (bedtime exceptions).
   ============================================================ */
(function () {
  "use strict";

  let state = null; // parent: { kids: [...] } | kid: { policy, requests }
  let role = null;
  let scope = "";
  let generation = 0;
  let askKind = null; // null | 'time' | 'bedtime'
  let askMinutes = null;

  const h = (v) => (typeof esc === "function" ? esc(v) : String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"));
  const say = (m) => { if (typeof toast === "function") toast(m); };
  const todayIso = () => (typeof isoDate === "function" ? isoDate(new Date()) : new Date().toISOString().slice(0, 10));
  const weekday = () => new Date().getDay() + 1; // 1 = Sunday, like the server
  const kidName = (id) => {
    const k = (typeof currentFamily !== "undefined" && currentFamily && currentFamily.kids || []).find((x) => x.id === id);
    return k ? k.name : "Your kid";
  };
  const addMin = (hhmm, m) => {
    const [a, b] = hhmm.split(":").map(Number);
    const t = a * 60 + b + m;
    return t >= 1440 ? null : `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  };

  async function api(url, body) {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  function root() { return document.getElementById("st-today"); }

  async function refresh() {
    const el = root();
    if (!el) return;
    const signedIn = typeof sessionUser !== "undefined" && sessionUser && typeof currentFamily !== "undefined" && currentFamily;
    if (!signedIn) { clear(); return; }
    const kid = typeof isKidSession === "function" && isKidSession();
    const nextScope = `${sessionUser.id}:${currentFamily.id}:${kid ? "kid" : "parent"}`;
    if (nextScope !== scope) { state = null; askKind = null; askMinutes = null; scope = nextScope; }
    role = kid ? "kid" : "parent";
    const gen = ++generation;
    try {
      const data = await api(kid ? "/api/screen-time/mine" : "/api/screen-time");
      if (gen !== generation) return;
      state = data;
    } catch (_) {
      if (gen !== generation) return;
      state = null;
    }
    paint();
  }

  // Tonight's bedtime as the kid's devices enforce it (a later one when a parent said yes).
  function tonight(policy, projected) {
    const list = (policy && policy.downtime) || [];
    const wd = weekday();
    if (projected) {
      const late = list.find((d) => d.id === "bedtime_late" && d.days.includes(wd));
      if (late) return { start: late.start, late: true };
    }
    const bed = list.find((d) => d.id === "bedtime" && d.days.includes(wd));
    if (!bed) return null;
    const ex = !projected && policy.bedtimeException && policy.bedtimeException.date === todayIso() ? policy.bedtimeException : null;
    return ex ? { start: ex.until, usual: bed.start, late: true } : { start: bed.start, late: false };
  }

  function paint() {
    const el = root();
    if (!el) return;
    if (!state) { el.hidden = true; el.innerHTML = ""; return; }
    const html = role === "kid" ? kidHtml() : parentHtml();
    el.hidden = !html;
    el.innerHTML = html || "";
  }

  // ---------- parent ----------
  // " · 🏠 1h 20m at home" once the home Wi-Fi filter (Canopy) has reported today.
  function homeLine(kidId) {
    const u = state.homeNetwork && state.homeNetwork.usage && state.homeNetwork.usage[kidId];
    if (!u || !u.usedMinutes) return "";
    const hrs = Math.floor(u.usedMinutes / 60);
    return ` · 🏠 ${hrs ? `${hrs}h ${u.usedMinutes % 60}m` : `${u.usedMinutes}m`} at home`;
  }

  function parentHtml() {
    const kids = (state.kids || []).filter((k) => k.policy && k.policy.enabled);
    if (!kids.length) return "";
    const pending = [];
    for (const k of kids) for (const r of k.requests || []) if (r.status === "pending") pending.push({ ...r, kidId: k.kidId });
    const rows = pending.map((r) => {
      const name = h(kidName(r.kidId));
      const bed = r.kind === "bedtime";
      const title = bed ? `🌙 ${name} wants to stay up until ${h(r.bedtimeUntil || `+${r.minutes} min`)}` : `⏰ ${name} asks for +${h(r.minutes)} min${r.fams ? ` (${h(r.fams)} fams)` : ""}`;
      return `
        <div class="st-row st-ask-row">
          <div class="st-row-text"><strong>${title}</strong>${r.note ? `<span>“${h(r.note)}”</span>` : ""}</div>
          <div class="st-row-actions">
            <button type="button" class="st-btn st-btn-primary" onclick="famScreenTimeToday.decide('${h(r.kidId)}','${h(r.id)}',true,'${bed ? "bedtime" : "time"}')">${bed ? `🌙 Yes, until ${h(r.bedtimeUntil || "")}` : `Approve +${h(r.minutes)}m`}</button>
            <button type="button" class="st-btn st-btn-ghost" onclick="famScreenTimeToday.decide('${h(r.kidId)}','${h(r.id)}',false,'${bed ? "bedtime" : "time"}')">${bed ? "Not tonight" : "Decline"}</button>
          </div>
        </div>`;
    }).join("");
    const chips = kids.map((k) => {
      const bt = tonight(k.policy, false);
      if (!bt) return "";
      const name = h(kidName(k.kidId));
      const paused = k.policy.pauseUntil && Date.parse(k.policy.pauseUntil) > Date.now();
      return `
        <div class="st-row st-kid-row">
          <div class="st-row-text"><strong>${name}</strong><span>${paused ? "⏸ Paused · " : ""}🌙 Bedtime ${h(bt.start)}${bt.late ? ` tonight <em class="st-badge">later</em>` : ""}${homeLine(k.kidId)}</span></div>
          <div class="st-row-actions">
            ${bt.late
              ? `<button type="button" class="st-btn st-btn-ghost is-on" title="Put bedtime back to ${h(bt.usual || "")}" onclick="famScreenTimeToday.allowTonight('${h(k.kidId)}',0)">Undo</button>`
              : `<button type="button" class="st-btn st-btn-ghost" title="Let ${name} stay up 30 minutes later tonight" onclick="famScreenTimeToday.allowTonight('${h(k.kidId)}',30)">🌙 +30m tonight</button>`}
          </div>
        </div>`;
    }).join("");
    if (!rows && !chips) return "";
    return `
      <div class="st-head"><h2>Screen Time</h2>${pending.length ? `<span class="st-count">${pending.length} waiting</span>` : ""}</div>
      ${rows}${chips}`;
  }

  async function decide(kidId, id, approve, kind) {
    try {
      await api(`/api/screen-time/kids/${encodeURIComponent(kidId)}/requests/${encodeURIComponent(id)}/${approve ? "approve" : "decline"}`, {});
      say(kind === "bedtime" ? (approve ? "Bedtime moved for tonight 🌙" : "Bedtime stays the same") : (approve ? "Extra time approved" : "Request declined"));
    } catch (err) { say(err.message || "Could not update request"); }
    await refresh();
  }

  async function allowTonight(kidId, minutes) {
    try {
      const st = await api(`/api/screen-time/kids/${encodeURIComponent(kidId)}/bedtime`, { minutes });
      const ex = st && st.policy && st.policy.bedtimeException;
      say(minutes && ex ? `Bedtime is ${ex.until} tonight 🌙` : "Bedtime is back to normal");
    } catch (err) { say(err.message || "Could not change bedtime"); }
    await refresh();
  }

  // ---------- kid ----------
  function kidHtml() {
    const policy = state.policy || {};
    if (!policy.enabled) return "";
    const hasTotal = (policy.limits || []).some((l) => l.kind === "total");
    const bed = tonight(policy, true);
    if (!hasTotal && !bed) return "";
    const reqs = (state.requests || []).filter((r) => r.date === todayIso());
    const pending = reqs.find((r) => r.status === "pending");
    const decided = reqs.find((r) => r.status === "approved" || r.status === "declined");
    let status = "";
    if (pending) {
      status = pending.kind === "bedtime" ? `⏳ Waiting for a parent: stay up until ${h(pending.bedtimeUntil || "")}` : `⏳ Waiting for a parent: +${h(pending.minutes)} min`;
    } else if (decided) {
      const yes = decided.status === "approved";
      status = decided.kind === "bedtime"
        ? (yes ? `🎉 Yes! You can stay up until ${h(decided.bedtimeUntil || "")}` : "Not tonight — sleep well 💜")
        : (yes ? `🎉 +${h(decided.minutes)} minutes today` : "Not today — that's OK 💜");
    }
    const choices = (askKind === "bedtime" ? [15, 30, 60] : [15, 30, 45, 60])
      .filter((m) => askKind !== "bedtime" || (bed && addMin(bed.start, m)));
    const picker = askKind ? `
      <form class="st-picker" onsubmit="famScreenTimeToday.send(event)">
        <div class="st-chips" role="radiogroup" aria-label="${askKind === "bedtime" ? "How much later" : "How many minutes"}">
          ${choices.map((m) => `<button type="button" role="radio" aria-checked="${askMinutes === m}" class="st-chip${askMinutes === m ? " is-on" : ""}" onclick="famScreenTimeToday.pick(${m})">${askKind === "bedtime" ? `${h(addMin(bed.start, m))}<small>+${m} min</small>` : `+${m}<small>min</small>`}</button>`).join("")}
        </div>
        <input id="st-ask-note" class="st-note" maxlength="80" aria-label="Reason (optional)" placeholder="${askKind === "bedtime" ? "Why tonight? e.g. family movie" : "What for? e.g. finish my level"}">
        <div class="st-row-actions">
          <button type="submit" class="st-btn st-btn-primary" ${askMinutes ? "" : "disabled"}>Ask a parent</button>
          <button type="button" class="st-btn st-btn-ghost" onclick="famScreenTimeToday.open(null)">Cancel</button>
        </div>
      </form>` : "";
    return `
      <div class="st-kid">
        <div class="st-kid-text">
          <div class="st-kicker">Ask a parent</div>
          <div class="st-title">${bed ? `🌙 Bedtime tonight ${h(bed.start)}${bed.late ? ` <em class="st-badge">later tonight</em>` : ""}` : "Need a little more?"}</div>
          ${status ? `<div class="st-status" aria-live="polite">${status}</div>` : ""}
        </div>
        ${pending || askKind ? "" : `<div class="st-row-actions">
          ${hasTotal ? `<button type="button" class="st-btn st-btn-ghost" onclick="famScreenTimeToday.open('time')">⏰ More time</button>` : ""}
          ${bed ? `<button type="button" class="st-btn st-btn-ghost" onclick="famScreenTimeToday.open('bedtime')">🌙 Stay up later</button>` : ""}
        </div>`}
      </div>
      ${picker}`;
  }

  function open(kind) { askKind = kind; askMinutes = null; paint(); }
  function pick(m) {
    const note = document.getElementById("st-ask-note");
    const keep = note ? note.value : "";
    askMinutes = m;
    paint();
    const again = document.getElementById("st-ask-note");
    if (again) again.value = keep;
  }
  async function send(event) {
    if (event) event.preventDefault();
    if (!askKind || !askMinutes) return;
    const note = (document.getElementById("st-ask-note") || {}).value;
    try {
      await api("/api/screen-time/requests", { kind: askKind, minutes: askMinutes, date: todayIso(), note: (note || "").trim() || null });
      say("Sent! A parent will answer soon.");
      askKind = null; askMinutes = null;
    } catch (err) { say(err.message || "Could not send"); }
    await refresh();
  }

  function clear() {
    generation++;
    state = null; role = null; scope = ""; askKind = null; askMinutes = null;
    const el = root();
    if (el) { el.hidden = true; el.innerHTML = ""; }
  }

  window.famScreenTimeToday = { refresh, clear, decide, allowTonight, open, pick, send };
})();

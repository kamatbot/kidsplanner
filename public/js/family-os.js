/* ============================================================
   FAMILY-OS.JS — First-principles Actions & Insights controller
   Attaches `window.famOS`. Respects role/privacy boundaries,
   fam_ storage keys, and first-party CSP.
   ============================================================ */
(function () {
  "use strict";

  const TABLE_TALK_KEY = "fam_table_talk_open";
  const RUNSHEET_MODE_KEY = "fam_runsheet_mode";

  let briefCache = null;
  let briefScope = "";
  let briefGeneration = 0;
  let signalFilter = "all"; // 'all' | 'urgent' | 'decisions' | kidId
  let homeSubTab = "meals"; // 'meals' | 'trips' | 'notes'
  let runsheetMode = loadPref(RUNSHEET_MODE_KEY, "list"); // 'list' | 'strip'
  let tableTalkOpen = loadPref(TABLE_TALK_KEY, false) === true;

  // Kid-only 15-minute focus timer (device-local)
  let focusRunning = false;
  let focusSeconds = 15 * 60;
  let focusInterval = null;

  function loadPref(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function savePref(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function e(val) {
    if (typeof esc === "function") return esc(val);
    return String(val == null ? "" : val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function notify(msg) {
    if (typeof toast === "function") toast(msg);
  }

  function scopeKey() {
    if (typeof sessionUser === "undefined" || !sessionUser || typeof currentFamily === "undefined" || !currentFamily) return "";
    return `${sessionUser.id}:${currentFamily.id}:${sessionUser.role || ""}`;
  }

  async function apiJson(url, opts) {
    const res = await fetch(url, Object.assign({
      method: "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
    }, opts));
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  function fmtTime(hhmm) {
    if (!hhmm) return "All day";
    if (typeof fmt12 === "function") return fmt12(hhmm);
    return hhmm;
  }

  function fmtCountdown(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  // ---------------- FETCH COMMAND BRIEF ----------------
  async function refresh(force = false) {
    const scope = scopeKey();
    if (!scope) { clear(); return; }
    if (scope !== briefScope) {
      briefCache = null;
      briefScope = scope;
    }
    syncTableTalkUI();
    syncRunsheetModeUI();
    if (briefCache && !force) {
      renderAll(briefCache);
    }
    const gen = ++briefGeneration;
    try {
      const data = await apiJson("/api/command/brief");
      if (gen !== briefGeneration || scope !== scopeKey()) return;
      briefCache = data;
      renderAll(data);
    } catch (_) {
      if (gen !== briefGeneration || scope !== scopeKey()) return;
      // Graceful fallback: hide optional strips rather than crashing Today
      renderPhaseFallback();
    }
  }

  function renderPhaseFallback() {
    const pill = document.getElementById("fos-phase-pill");
    if (!pill) return;
    const h = new Date().getHours();
    const kid = typeof isKidSession === "function" && isKidSession();
    pill.textContent = h < 12 ? (kid ? "Morning · Bag & Go" : "Morning Launch")
      : h < 18 ? (kid ? "Afternoon · After School" : "Afternoon · School Run")
        : (kid ? "Evening · Wind Down" : "Evening Reset");
    pill.hidden = false;
  }

  function renderAll(brief) {
    if (!brief) return;
    renderPhasePill(brief);
    renderInsights(brief);
    renderUnifiedSignals(brief);
    renderHomePulse(brief);
    renderRunsheet(brief);
    renderKidFocus(brief);
    renderScheduleRadar(brief);
    decorateKidCardsWithScreenTime(brief);
    syncTableTalkUI();
  }

  function renderPhasePill(brief) {
    const pill = document.getElementById("fos-phase-pill");
    if (!pill) return;
    pill.textContent = brief.phaseLabel || "";
    pill.hidden = !brief.phaseLabel;
  }

  // ---------------- PROACTIVE INSIGHTS ----------------
  function renderInsights(brief) {
    const strip = document.getElementById("fos-insights-strip");
    const grid = document.getElementById("fos-insights-grid");
    if (!strip || !grid) return;
    const list = Array.isArray(brief.insights) ? brief.insights : [];
    if (!list.length) {
      strip.hidden = true;
      grid.innerHTML = "";
      return;
    }
    strip.hidden = false;
    grid.innerHTML = list.map((ins) => {
      const tone = ins.tone ? `tone-${e(ins.tone)}` : "";
      const primaryBtn = ins.primaryAction ? renderInsightBtn(ins.primaryAction, true) : "";
      const secBtn = ins.secondaryAction ? renderInsightBtn(ins.secondaryAction, false) : "";
      return `
        <article class="fos-insight-card ${tone}">
          <div>
            <div class="fos-insight-tag">${e(ins.tag)}</div>
            <p class="fos-insight-text">${e(ins.text)}</p>
          </div>
          ${(primaryBtn || secBtn) ? `<div class="fos-insight-actions">${primaryBtn}${secBtn}</div>` : ""}
        </article>`;
    }).join("");
  }

  function renderInsightBtn(act, isPrimary) {
    const cls = isPrimary ? "fos-btn-primary" : "fos-btn-ghost";
    const attrs = `data-fos-kind="${e(act.kind)}" data-fos-event="${e(act.eventId || "")}" data-fos-tab="${e(act.tab || "")}" data-fos-sub="${e(act.sub || "")}" data-fos-kid="${e(act.kidId || "")}" data-fos-hw="${e(act.homeworkId || "")}"`;
    return `<button type="button" class="${cls}" ${attrs} onclick="window.famOS.runInsightAction(this)">${e(act.label)}</button>`;
  }

  async function runInsightAction(btn) {
    if (!btn) return;
    const kind = btn.dataset.fosKind;
    if (kind === "claim-driver" && btn.dataset.fosEvent) {
      await claimDriver(btn.dataset.fosEvent);
    } else if (kind === "open-tab" && btn.dataset.fosTab && typeof switchNavTab === "function") {
      switchNavTab(btn.dataset.fosTab);
    } else if (kind === "open-home") {
      openHome(btn.dataset.fosSub || "meals");
    } else if (kind === "open-child" && btn.dataset.fosKid && typeof openChildView === "function") {
      openChildView(btn.dataset.fosKid);
    } else if (kind === "review-homework" && btn.dataset.fosHw && typeof reviewTodayHomework === "function") {
      reviewTodayHomework(btn.dataset.fosHw);
    } else if (kind === "start-focus") {
      toggleFocusTimer(true);
    } else if (kind === "scroll-daily4") {
      const el = document.querySelector(".fr-learning-tiles");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // ---------------- UNIFIED ACTION SIGNALS ----------------
  function renderUnifiedSignals(brief) {
    const filtersEl = document.getElementById("fos-action-filters");
    const inboxEl = document.getElementById("fos-unified-inbox");
    if (!inboxEl) return;

    const all = Array.isArray(brief.unifiedSignals) ? brief.unifiedSignals : [];
    const isParent = brief.role === "parent";

    if (filtersEl) {
      if (!all.length) {
        filtersEl.hidden = true;
        filtersEl.innerHTML = "";
      } else {
        const pills = [
          { id: "all", label: `All (${all.length})` },
          { id: "urgent", label: "Urgent" },
        ];
        if (all.some((s) => s.kind === "decision")) pills.push({ id: "decisions", label: "Decisions" });
        if (isParent && typeof currentFamily !== "undefined" && currentFamily && Array.isArray(currentFamily.kids)) {
          for (const k of currentFamily.kids) {
            if (all.some((s) => s.kidId === k.id)) pills.push({ id: k.id, label: k.name });
          }
        }
        filtersEl.hidden = false;
        filtersEl.innerHTML = pills.map((p) =>
          `<button type="button" class="fos-filter-pill${signalFilter === p.id ? " active" : ""}" onclick="window.famOS.setSignalFilter('${e(p.id)}')">${e(p.label)}</button>`
        ).join("");
      }
    }

    const filtered = all.filter((s) => {
      if (signalFilter === "all") return true;
      if (signalFilter === "urgent") return s.priority === "P0" || s.priority === "P1";
      if (signalFilter === "decisions") return s.kind === "decision";
      return s.kidId === signalFilter;
    });

    if (!filtered.length) {
      inboxEl.innerHTML = "";
      return;
    }

    inboxEl.innerHTML = filtered.map((s) => {
      const pCls = s.priority === "P0" ? "p0" : s.priority === "P1" ? "p1" : "";
      let controls = "";
      if (s.kind === "screen_time_alert") {
        controls = `<button type="button" class="fos-btn-ghost" onclick="window.famOS.ackScreenTimeAlert('${e(s.payload.kidId)}','${e(s.payload.id)}')">Acknowledge</button>`;
      } else if (s.kind === "screen_time_request") {
        controls = `
          <button type="button" class="fos-btn-primary" onclick="window.famOS.decideScreenTimeRequest('${e(s.payload.kidId)}','${e(s.payload.id)}',true)">Approve +${e(s.payload.minutes)}m</button>
          <button type="button" class="fos-btn-danger-ghost" onclick="window.famOS.decideScreenTimeRequest('${e(s.payload.kidId)}','${e(s.payload.id)}',false)">Decline</button>`;
      } else if (s.kind === "hermes_nudge") {
        controls = (s.payload.actions || []).map((a, idx) =>
          `<button type="button" class="${idx === 0 || a.style === "primary" ? "fos-btn-primary" : "fos-btn-ghost"}" onclick="window.famOS.actHermes('${e(s.payload.messageId)}','${e(a.id)}')">${e(a.label)}</button>`
        ).join("");
      } else if (s.kind === "driver_gap") {
        controls = `<button type="button" class="fos-btn-primary" onclick="window.famOS.claimDriver('${e(s.payload.eventId)}')">I’ll drive</button>`;
      } else if (s.kind === "packing_exception") {
        controls = `<button type="button" class="fos-btn-ghost" onclick="openChildView('${e(s.payload.kidId)}')">Open ${e(s.payload.kidName)}</button>`;
      } else if (s.kind === "decision") {
        controls = (s.payload.options || []).map((opt) =>
          `<button type="button" class="fos-vote-pill${s.payload.myVote === opt.id ? " is-voted" : ""}" onclick="window.famOS.voteDecision('${e(s.payload.id)}','${e(opt.id)}')">${e(opt.label)}${opt.votes ? ` (${opt.votes})` : ""}</button>`
        ).join("");
      }

      return `
        <article class="fos-signal-row priority-${e(s.priority)}">
          <div class="fos-signal-main">
            <div class="fos-signal-title-line">
              <span class="fos-prio-badge ${pCls}">${e(s.priority)}</span>
              <span class="fos-signal-title">${e(s.title)}</span>
            </div>
            <div class="fos-signal-meta">${e(s.meta)}</div>
          </div>
          <div class="fos-signal-controls">${controls}</div>
        </article>`;
    }).join("");
  }

  function setSignalFilter(filter) {
    signalFilter = filter || "all";
    if (briefCache) renderUnifiedSignals(briefCache);
  }

  // ---------------- DINNER & HOME PULSE ----------------
  function renderHomePulse(brief) {
    const el = document.getElementById("fos-home-pulse");
    if (!el) return;
    if (brief.role !== "parent") {
      el.hidden = true;
      return;
    }
    const home = brief.home || {};
    const dinnerText = home.dinner ? home.dinner.title : "Dinner not planned yet";
    const subParts = [];
    subParts.push(`${home.openShoppingCount || 0} on shopping list`);
    if (home.tripCount) subParts.push(`${home.tripCount} active trip${home.tripCount === 1 ? "" : "s"}`);
    if (home.openDecisionCount) subParts.push(`${home.openDecisionCount} open poll${home.openDecisionCount === 1 ? "" : "s"}`);
    el.hidden = false;
    el.innerHTML = `
      <div class="fos-home-pulse-info">
        <div class="fos-home-pulse-icon" aria-hidden="true">🍽</div>
        <div>
          <div class="fos-home-pulse-kicker">Tonight &amp; Home</div>
          <div class="fos-home-pulse-title">${e(dinnerText)}</div>
          <div class="fos-home-pulse-sub">${e(subParts.join(" · "))}</div>
        </div>
      </div>
      <div class="fos-insight-actions">
        <button type="button" class="fos-btn-primary" onclick="window.famOS.openHome('meals')">${home.dinner ? "Open Meals" : "Plan Dinner"}</button>
        ${home.tripCount ? `<button type="button" class="fos-btn-ghost" onclick="window.famOS.openHome('trips')">Trips</button>` : ""}
      </div>`;
  }

  // ---------------- LIVE DAY RUNSHEET ----------------
  function renderRunsheet(brief) {
    const el = document.getElementById("fos-runsheet");
    if (!el) return;
    const rs = brief.runsheet || { today: [], tomorrowPreview: [] };
    const items = rs.today || [];
    const tomorrow = rs.tomorrowPreview || [];

    if (!items.length && !tomorrow.length) {
      el.innerHTML = `<p class="today-empty">Your runsheet is clear today.</p>`;
      syncRunsheetModeUI();
      return;
    }

    const todayHtml = items.length
      ? items.map((ev) => {
        const barColor = ev.kidColor || "var(--fr-you)";
        const timeStr = ev.time ? `${fmtTime(ev.time)}${ev.endTime ? "–" + fmtTime(ev.endTime) : ""}` : "All day";
        const chips = [];
        if (ev.driverName) {
          chips.push(`<span class="fos-chip">🚗 ${e(ev.driverName)}</span>`);
        } else if (ev.editable && ev.needsDriver && brief.role === "parent") {
          chips.push(`<button type="button" class="fos-chip fos-chip-driver-gap" onclick="window.famOS.claimDriver('${e(ev.id)}')">⚠ No driver · Claim</button>`);
        }
        if (ev.moved) chips.push(`<span class="fos-chip fos-chip-moved">Moved</span>`);
        for (const g of ev.gear || []) chips.push(`<span class="fos-chip">🎒 ${e(g)}</span>`);
        if (ev.sourceLabel) chips.push(`<span class="fos-chip">${e(ev.sourceLabel)}</span>`);
        return `
          <div class="fos-runsheet-item">
            <span class="fos-runsheet-bar" style="background:${e(barColor)}"></span>
            <div class="fos-runsheet-body">
              <div class="fos-runsheet-top">
                <span class="fos-runsheet-time">${e(timeStr)}</span>
                <span>${e(ev.kidName || "Family")}</span>
              </div>
              <div class="fos-runsheet-title">${e(ev.title)}</div>
              ${ev.location ? `<div class="fos-signal-meta">${e(ev.location)}</div>` : ""}
              ${chips.length ? `<div class="fos-runsheet-chips">${chips.join("")}</div>` : ""}
            </div>
          </div>`;
      }).join("")
      : `<p class="today-empty">Nothing else timed today.</p>`;

    const tomorrowHtml = tomorrow.length
      ? `<div class="fos-tomorrow-peek">
          <div class="fos-tomorrow-peek-title">Tomorrow peek</div>
          ${tomorrow.map((t) => `<div class="fos-tomorrow-peek-row"><span><strong>${e(t.time ? fmtTime(t.time) : "All day")}</strong> · ${e(t.title)}</span><span>${e(t.kidName || "Family")}</span></div>`).join("")}
        </div>`
      : "";

    el.innerHTML = todayHtml + tomorrowHtml;
    syncRunsheetModeUI();
  }

  function toggleRunsheetMode() {
    runsheetMode = runsheetMode === "list" ? "strip" : "list";
    savePref(RUNSHEET_MODE_KEY, runsheetMode);
    syncRunsheetModeUI();
  }

  function syncRunsheetModeUI() {
    const listEl = document.getElementById("fos-runsheet");
    const stripEl = document.getElementById("today-schedule-list");
    const btn = document.getElementById("fos-runsheet-mode-btn");
    if (listEl) listEl.hidden = runsheetMode !== "list";
    if (stripEl) stripEl.hidden = runsheetMode !== "strip";
    if (btn) btn.textContent = runsheetMode === "list" ? "Timeline strip" : "Runsheet";
  }

  // ---------------- KID FOCUS HERO ----------------
  function renderKidFocus(brief) {
    const el = document.getElementById("fos-kid-focus");
    if (!el) return;
    if (brief.role !== "kid") {
      el.hidden = true;
      return;
    }
    const hw = brief.kidFocus;
    el.hidden = false;
    if (!hw) {
      el.innerHTML = `
        <div>
          <div class="fos-kid-focus-kicker">Start Next</div>
          <div class="fos-kid-focus-title">All homework is caught up!</div>
          <div class="fos-kid-focus-meta">Check your Daily 4 loop below to keep your streak going.</div>
        </div>`;
      return;
    }
    const nextStep = (hw.checklist || []).find((c) => c && !c.done);
    el.innerHTML = `
      <div>
        <div class="fos-kid-focus-kicker">Start Next · ${e(hw.subject)}</div>
        <div class="fos-kid-focus-title">${e(hw.title)}</div>
        <div class="fos-kid-focus-meta">${nextStep ? `Next step: ${e(nextStep.text || nextStep.title || "")}` : (hw.effortMin ? `Estimated ~${hw.effortMin} min` : "Take 15 calm minutes to get started")}</div>
      </div>
      <div class="fos-kid-focus-actions">
        <button type="button" id="fos-focus-timer-btn" class="fos-btn-primary" onclick="window.famOS.toggleFocusTimer()">${focusRunning ? `⏸ Pause ${fmtCountdown(focusSeconds)}` : `▶ Focus ${fmtCountdown(focusSeconds)}`}</button>
        <button type="button" class="fos-btn-ghost" onclick="openHomeworkDetail('${e(hw.id)}')">Open Steps</button>
      </div>`;
  }

  function toggleFocusTimer(forceStart = false) {
    if (focusRunning && !forceStart) {
      clearInterval(focusInterval);
      focusInterval = null;
      focusRunning = false;
    } else if (!focusRunning) {
      focusRunning = true;
      focusInterval = setInterval(() => {
        if (focusSeconds > 0) {
          focusSeconds -= 1;
          const btn = document.getElementById("fos-focus-timer-btn");
          if (btn) btn.textContent = `⏸ Pause ${fmtCountdown(focusSeconds)}`;
        } else {
          clearInterval(focusInterval);
          focusInterval = null;
          focusRunning = false;
          focusSeconds = 15 * 60;
          notify("15-minute focus session complete!");
          if (briefCache) renderKidFocus(briefCache);
        }
      }, 1000);
    }
    if (briefCache) renderKidFocus(briefCache);
  }

  // ---------------- PARENT TABLE TALK (COLLAPSIBLE DAILY 4) ----------------
  function toggleTableTalk() {
    tableTalkOpen = !tableTalkOpen;
    savePref(TABLE_TALK_KEY, tableTalkOpen);
    syncTableTalkUI();
  }

  function syncTableTalkUI() {
    const shell = document.getElementById("fos-learning-shell");
    const cta = document.getElementById("fos-tabletalk-cta");
    const btn = document.getElementById("fos-tabletalk-bar");
    if (!shell) return;
    const isKid = typeof isKidSession === "function" && isKidSession();
    const collapsed = !isKid && !tableTalkOpen;
    shell.classList.toggle("is-collapsed", collapsed);
    if (cta) cta.textContent = tableTalkOpen ? "Hide" : "Open";
    if (btn) btn.setAttribute("aria-expanded", String(!collapsed));
  }

  // ---------------- SCREEN TIME DECORATION ON KID CARDS ----------------
  function decorateKidCardsWithScreenTime(brief) {
    if (brief.role !== "parent" || !brief.screenTimeKids) return;
    document.querySelectorAll("#today-fams-body .fr-kid-card").forEach((card) => {
      const btn = card.querySelector("[onclick*='openChildView']");
      if (!btn) return;
      const m = /openChildView\('([^']+)'\)/.exec(btn.getAttribute("onclick") || "");
      if (!m) return;
      const kidId = m[1];
      const st = brief.screenTimeKids[kidId];
      const existing = card.querySelector(".fos-kid-st-bar");
      if (existing) existing.remove();
      if (!st || !st.deviceCount) return;
      const bar = document.createElement("div");
      bar.className = "fos-kid-st-bar";
      bar.innerHTML = `
        <span>${st.paused ? "⏸ Screen Time paused" : `Screen Time active (${st.deviceCount} device${st.deviceCount === 1 ? "" : "s"})`}</span>
        <button type="button" class="fos-btn-ghost" onclick="window.famOS.toggleKidPause('${e(kidId)}',${st.paused ? "false" : "true"})">${st.paused ? "Resume" : "Pause 30m"}</button>`;
      card.appendChild(bar);
    });
  }

  // ---------------- SCHEDULE WORKLOAD RADAR ----------------
  function renderScheduleRadar(brief) {
    const el = document.getElementById("fos-schedule-radar");
    if (!el) return;
    const days = brief && Array.isArray(brief.weekWorkload) ? brief.weekWorkload : [];
    if (!days.length) {
      el.hidden = true;
      return;
    }
    const heaviest = [...days].sort((a, b) => b.score - a.score)[0];
    el.hidden = false;
    el.innerHTML = `
      <div class="fos-workload-head">
        <strong>Week Workload Radar</strong>
        <span>${heaviest && heaviest.score >= 65 ? `${e(heaviest.label)} looks busiest (${heaviest.eventCount} events, ${heaviest.homeworkCount} homework)` : "Balanced week ahead"}</span>
      </div>
      <div class="fos-workload-days">
        ${days.map((d) => `
          <div class="fos-workload-day level-${e(d.level)}${d.isToday ? " is-today" : ""}">
            <div class="fos-workload-day-top"><span>${e(d.label)}</span><span>${d.dayNum}</span></div>
            <div class="fos-workload-bar"><i style="width:${Math.max(8, d.score)}%"></i></div>
            <div class="fos-workload-meta">${d.eventCount} ev · ${d.homeworkCount} hw</div>
          </div>`).join("")}
      </div>`;
  }

  // ---------------- UNIFIED HOME TAB (MEALS · TRIPS · DECISIONS & NOTES) ----------------
  function openHome(sub) {
    if (sub) homeSubTab = sub;
    if (typeof switchNavTab === "function") switchNavTab("home");
    else renderHomeTab();
  }

  function setHomeSubTab(sub) {
    homeSubTab = sub || "meals";
    renderHomeTab();
  }

  async function renderHomeTab() {
    const root = document.getElementById("fos-home-body");
    if (!root) return;
    const isKid = typeof isKidSession === "function" && isKidSession();
    document.querySelectorAll(".fos-home-seg").forEach((b) => {
      b.classList.toggle("active", b.dataset.homeSub === homeSubTab);
    });

    root.innerHTML = `<div class="fos-card"><p class="today-empty">Loading ${e(homeSubTab)}…</p></div>`;

    if (homeSubTab === "meals") {
      await renderHomeMeals(root, isKid);
    } else if (homeSubTab === "trips") {
      await renderHomeTrips(root);
    } else {
      await renderHomeDecisionsNotes(root);
    }
  }

  async function renderHomeMeals(root, isKid) {
    try {
      const todayIso = typeof isoDate === "function" ? isoDate(new Date()) : new Date().toISOString().slice(0, 10);
      if (isKid) {
        const shopData = await apiJson("/api/meals/shopping");
        const items = (shopData && shopData.shopping) || [];
        root.innerHTML = `
          <div class="fos-home-grid">
            <section class="fos-card">
              <div class="fos-card-head">
                <h2>Shared Shopping List</h2>
                <span>${items.filter((i) => !i.done).length} left</span>
              </div>
              ${renderShoppingListHtml(items)}
            </section>
          </div>`;
        return;
      }
      const [mealsData, recipesData] = await Promise.all([
        apiJson("/api/meals"),
        apiJson("/api/meals/recipes").catch(() => ({ recipes: [] })),
      ]);
      const menu = (mealsData && mealsData.menu) || [];
      const shopping = (mealsData && mealsData.shopping) || [];
      const recipes = ((recipesData && recipesData.recipes) || []).slice(0, 4);
      const tonight = menu.find((m) => m.date === todayIso && (m.slot || "dinner") === "dinner");
      const upcoming = menu.filter((m) => m.date >= todayIso).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

      root.innerHTML = `
        <div class="fos-home-grid">
          <section class="fos-card">
            <div class="fos-card-head">
              <h2>Tonight’s Dinner</h2>
              <a href="/meals" class="today-link">Full Meal Studio →</a>
            </div>
            <p class="fos-home-pulse-title" style="margin-bottom:10px">${tonight ? e(tonight.title) : "Not planned yet"}</p>
            <form class="fos-inline-form" onsubmit="window.famOS.quickSetDinner(event)">
              <input type="text" id="fos-quick-dinner-input" placeholder="Quick set tonight’s dinner (e.g. Pasta & salad)" maxlength="120" required />
              <button type="submit" class="fos-btn-primary">Save</button>
            </form>
            ${upcoming.length ? `
              <div style="margin-top:16px">
                <div class="fos-tomorrow-peek-title">Upcoming menu</div>
                ${upcoming.map((m) => `<div class="fos-tomorrow-peek-row"><span><strong>${e(m.date)}</strong> · ${e(m.title)}</span><span>${e(m.slot || "dinner")}</span></div>`).join("")}
              </div>` : ""}
            ${recipes.length ? `
              <div style="margin-top:16px">
                <div class="fos-tomorrow-peek-title">Quick recipe ideas</div>
                <div class="fos-runsheet-chips">
                  ${recipes.map((r) => `<button type="button" class="fos-vote-pill" onclick="window.famOS.setDinnerTitle('${e(r.title)}')">${e(r.title)}${r.timeMins ? ` · ${r.timeMins}m` : ""}</button>`).join("")}
                </div>
              </div>` : ""}
          </section>

          <section class="fos-card">
            <div class="fos-card-head">
              <h2>Shared Shopping List</h2>
              <span>${shopping.filter((i) => !i.done).length} left</span>
            </div>
            ${renderShoppingListHtml(shopping)}
          </section>
        </div>`;
    } catch (err) {
      root.innerHTML = `<div class="fos-card"><p class="today-empty">${e(err.message || "Could not load meals.")}</p><a href="/meals" class="today-link">Open Meals page →</a></div>`;
    }
  }

  function renderShoppingListHtml(items) {
    const sorted = [...items].sort((a, b) => Number(!!a.done) - Number(!!b.done));
    const listHtml = sorted.length
      ? sorted.slice(0, 15).map((item) => `
          <label class="fos-shop-row${item.done ? " is-done" : ""}">
            <input type="checkbox" ${item.done ? "checked" : ""} onchange="window.famOS.toggleShopping('${e(item.id)}',this.checked)" />
            <span>${e(item.text)}</span>
          </label>`).join("")
      : `<p class="today-empty">Shopping list is empty.</p>`;
    return `${listHtml}
      <form class="fos-inline-form" onsubmit="window.famOS.quickAddShopping(event)">
        <input type="text" id="fos-shop-add-input" placeholder="Add grocery item…" maxlength="120" required />
        <button type="submit" class="fos-btn-primary">Add</button>
      </form>`;
  }

  async function renderHomeTrips(root) {
    try {
      const data = await apiJson("/api/trips");
      const list = (data && data.trips) || [];
      root.innerHTML = `
        <div class="fos-home-grid">
          <section class="fos-card" style="grid-column: 1 / -1">
            <div class="fos-card-head">
              <h2>Family &amp; Shared Trips</h2>
              <a href="/trips" class="fos-btn-primary" style="text-decoration:none">Open Full Trip Planner →</a>
            </div>
            ${list.length ? `
              <div class="fos-insights-grid">
                ${list.map((t) => `
                  <article class="fos-insight-card">
                    <div>
                      <div class="fos-insight-tag">${e(t.startDate || "Dates TBD")}${t.endDate ? ` – ${e(t.endDate)}` : ""}</div>
                      <p class="fos-insight-text"><strong>${e(t.title || t.name || "Untitled trip")}</strong>${t.destination ? ` · ${e(t.destination)}` : ""}</p>
                    </div>
                    <div class="fos-insight-actions">
                      <a href="/trips/${e(t.id)}" class="fos-btn-ghost" style="text-decoration:none">Open itinerary →</a>
                    </div>
                  </article>`).join("")}
              </div>` : `<p class="today-empty">No trips planned yet. Start a shared vacation itinerary in the Trip Planner.</p>`}
          </section>
        </div>`;
    } catch (err) {
      root.innerHTML = `<div class="fos-card"><p class="today-empty">${e(err.message || "Could not load trips.")}</p><a href="/trips" class="today-link">Open Trips →</a></div>`;
    }
  }

  async function renderHomeDecisionsNotes(root) {
    try {
      const [decData, notesData] = await Promise.all([
        apiJson("/api/family/decisions"),
        apiJson("/api/notes").catch(() => ({ notes: [] })),
      ]);
      const decs = ((decData && decData.decisions) || []).filter((d) => d.status === "open");
      const notes = ((notesData && notesData.notes) || []).slice(0, 6);
      const myId = typeof sessionUser !== "undefined" && sessionUser ? sessionUser.id : "";

      root.innerHTML = `
        <div class="fos-home-grid">
          <section class="fos-card">
            <div class="fos-card-head">
              <h2>Family Decisions &amp; Polls</h2>
              <span>${decs.length} open</span>
            </div>
            ${decs.length ? decs.map((d) => {
              const myVote = Array.isArray(d.responses)
                ? (d.responses.find((r) => r.userId === myId) || {}).optionId
                : (d.responses && d.responses[myId]);
              return `
                <div class="fos-signal-row" style="margin-bottom:8px">
                  <div class="fos-signal-main">
                    <div class="fos-signal-title">${e(d.question)}</div>
                    <div class="fos-signal-meta">${d.deadline ? `Closes ${e(d.deadline)}` : "Open family poll"}</div>
                  </div>
                  <div class="fos-signal-controls">
                    ${(d.options || []).map((o) => `<button type="button" class="fos-vote-pill${myVote === o.id ? " is-voted" : ""}" onclick="window.famOS.voteDecision('${e(d.id)}','${e(o.id)}')">${e(o.label)}${o.votes ? ` (${o.votes})` : ""}</button>`).join("")}
                  </div>
                </div>`;
            }).join("") : `<p class="today-empty">No open family polls right now.</p>`}
            <form class="fos-inline-form" style="flex-direction:column" onsubmit="window.famOS.createDecision(event)">
              <input type="text" id="fos-dec-q" placeholder="Ask the family (e.g. Friday movie night?)" maxlength="160" required />
              <div style="display:flex;gap:8px">
                <input type="text" id="fos-dec-opts" placeholder="Options separated by comma (e.g. Pizza, Tacos)" required />
                <button type="submit" class="fos-btn-primary">Create Poll</button>
              </div>
            </form>
          </section>

          <section class="fos-card">
            <div class="fos-card-head">
              <h2>Recent Family Notes</h2>
              <button type="button" class="today-link" onclick="switchNavTab('notes')">All Notes →</button>
            </div>
            ${notes.length ? notes.map((n) => `
              <div class="fos-shop-row" style="flex-direction:column;align-items:flex-start;gap:3px">
                <strong>${e((n.text || "").slice(0, 120))}</strong>
                <small style="color:var(--fr-ink-2)">${e(n.authorName || "")}${n.createdAt ? ` · ${e(n.createdAt.slice(0, 10))}` : ""}</small>
              </div>`).join("") : `<p class="today-empty">No saved notes yet.</p>`}
          </section>
        </div>`;
    } catch (err) {
      root.innerHTML = `<div class="fos-card"><p class="today-empty">${e(err.message || "Could not load decisions & notes.")}</p></div>`;
    }
  }

  // ---------------- 1-TAP MUTATIONS ----------------
  async function claimDriver(eventId) {
    if (!eventId || typeof sessionUser === "undefined" || !sessionUser) return;
    try {
      await apiJson(`/api/calendar/events/${encodeURIComponent(eventId)}`, {
        method: "PATCH",
        body: JSON.stringify({ driverMemberId: sessionUser.id }),
      });
      notify("Assigned you as driver");
      if (typeof loadFamilyEvents === "function") await loadFamilyEvents();
      await refresh(true);
      if (typeof renderTodaySchedule === "function" && typeof isoDate === "function") renderTodaySchedule(isoDate(new Date()));
    } catch (err) {
      notify(err.message || "Could not assign driver");
    }
  }

  async function voteDecision(decisionId, optionId) {
    try {
      await apiJson(`/api/family/decisions/${encodeURIComponent(decisionId)}/respond`, {
        method: "POST",
        body: JSON.stringify({ optionId }),
      });
      notify("Vote recorded");
      await refresh(true);
      const homeTab = document.getElementById("tab-home");
      if (homeTab && homeTab.classList.contains("active")) renderHomeTab();
    } catch (err) {
      notify(err.message || "Could not record vote");
    }
  }

  async function createDecision(event) {
    event.preventDefault();
    const qEl = document.getElementById("fos-dec-q");
    const optsEl = document.getElementById("fos-dec-opts");
    const question = (qEl && qEl.value || "").trim();
    const options = (optsEl && optsEl.value || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!question || options.length < 2) { notify("Enter a question and at least 2 comma-separated options"); return; }
    try {
      await apiJson("/api/family/decisions", {
        method: "POST",
        body: JSON.stringify({ question, options }),
      });
      if (qEl) qEl.value = "";
      if (optsEl) optsEl.value = "";
      notify("Family poll created");
      await refresh(true);
      renderHomeTab();
    } catch (err) {
      notify(err.message || "Could not create poll");
    }
  }

  async function actHermes(messageId, actionId) {
    try {
      await apiJson(`/api/hermes/thread/messages/${encodeURIComponent(messageId)}/actions`, {
        method: "POST",
        body: JSON.stringify({ actionId }),
      });
      notify("Updated Hermes item");
      if (typeof loadHermesMessages === "function") await loadHermesMessages();
      await refresh(true);
    } catch (err) {
      notify(err.message || "Could not update Hermes item");
    }
  }

  async function decideScreenTimeRequest(kidId, reqId, approve) {
    try {
      await apiJson(`/api/screen-time/kids/${encodeURIComponent(kidId)}/requests/${encodeURIComponent(reqId)}/${approve ? "approve" : "decline"}`, {
        method: "POST",
        body: "{}",
      });
      notify(approve ? "Extra time approved" : "Request declined");
      await refresh(true);
    } catch (err) {
      notify(err.message || "Could not update request");
    }
  }

  async function ackScreenTimeAlert(kidId, alertId) {
    try {
      await apiJson(`/api/screen-time/kids/${encodeURIComponent(kidId)}/alerts/${encodeURIComponent(alertId)}/ack`, {
        method: "POST",
        body: "{}",
      });
      notify("Alert acknowledged");
      await refresh(true);
    } catch (err) {
      notify(err.message || "Could not acknowledge alert");
    }
  }

  async function toggleKidPause(kidId, pause) {
    try {
      await apiJson(`/api/screen-time/kids/${encodeURIComponent(kidId)}/pause`, {
        method: "POST",
        body: JSON.stringify({ minutes: pause ? 30 : 0 }),
      });
      notify(pause ? "Paused Screen Time for 30 min" : "Resumed Screen Time");
      await refresh(true);
    } catch (err) {
      notify(err.message || "Could not update Screen Time");
    }
  }

  async function setDinnerTitle(title) {
    const clean = String(title || "").trim();
    if (!clean) return;
    const todayIso = typeof isoDate === "function" ? isoDate(new Date()) : new Date().toISOString().slice(0, 10);
    try {
      await apiJson("/api/meals/menu", {
        method: "POST",
        body: JSON.stringify({ date: todayIso, slot: "dinner", title: clean }),
      });
      notify(`Tonight’s dinner set: ${clean}`);
      await refresh(true);
      const homeTab = document.getElementById("tab-home");
      if (homeTab && homeTab.classList.contains("active")) renderHomeTab();
    } catch (err) {
      notify(err.message || "Could not save dinner");
    }
  }

  async function quickSetDinner(event) {
    event.preventDefault();
    const input = document.getElementById("fos-quick-dinner-input");
    if (!input) return;
    await setDinnerTitle(input.value);
    input.value = "";
  }

  async function quickAddShopping(event) {
    event.preventDefault();
    const input = document.getElementById("fos-shop-add-input");
    const text = (input && input.value || "").trim();
    if (!text) return;
    try {
      await apiJson("/api/meals/shopping", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      input.value = "";
      notify(`Added “${text}”`);
      await refresh(true);
      renderHomeTab();
    } catch (err) {
      notify(err.message || "Could not add shopping item");
    }
  }

  async function toggleShopping(id, done) {
    try {
      await apiJson(`/api/meals/shopping/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ done: !!done }),
      });
      await refresh(true);
      renderHomeTab();
    } catch (err) {
      notify(err.message || "Could not update shopping item");
    }
  }

  // ---------------- QUICK CAPTURE MENU ----------------
  function toggleQuickCapture(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById("fos-quick-capture-menu");
    const btn = document.getElementById("fos-quick-capture-btn");
    if (!menu) return;
    const nextHidden = !menu.hidden;
    menu.hidden = nextHidden;
    if (btn) btn.setAttribute("aria-expanded", String(!nextHidden));
  }

  function closeQuickCapture() {
    const menu = document.getElementById("fos-quick-capture-menu");
    const btn = document.getElementById("fos-quick-capture-btn");
    if (menu) menu.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  document.addEventListener("click", (ev) => {
    const wrap = document.querySelector(".fos-quick-capture-wrap");
    if (wrap && !wrap.contains(ev.target)) closeQuickCapture();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeQuickCapture();
  });

  // ---------------- CLEAR ON LOGOUT ----------------
  function clear() {
    briefCache = null;
    briefScope = "";
    briefGeneration++;
    signalFilter = "all";
    if (focusInterval) { clearInterval(focusInterval); focusInterval = null; }
    focusRunning = false;
    focusSeconds = 15 * 60;
    for (const id of ["fos-insights-grid", "fos-unified-inbox", "fos-home-pulse", "fos-runsheet", "fos-kid-focus", "fos-schedule-radar", "fos-home-body"]) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = "";
    }
  }

  window.famOS = {
    refresh,
    clear,
    runInsightAction,
    setSignalFilter,
    toggleRunsheetMode,
    toggleTableTalk,
    toggleFocusTimer,
    toggleQuickCapture,
    closeQuickCapture,
    openHome,
    setHomeSubTab,
    renderHomeTab,
    claimDriver,
    voteDecision,
    createDecision,
    actHermes,
    decideScreenTimeRequest,
    ackScreenTimeAlert,
    toggleKidPause,
    setDinnerTitle,
    quickSetDinner,
    quickAddShopping,
    toggleShopping,
  };
})();

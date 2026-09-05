/* ============================================================
   TODAY ACTION QUEUE — pure grouping/sorting helpers
   The dashboard owns fetching and rendering. Keeping the queue's ordering
   rules here makes them easy to test and keeps the API's list order from
   becoming an accidental product decision.
============================================================ */
(function (root) {
  "use strict";

  function asDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function localIsoDate(value) {
    const date = asDate(value) || new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dateAfter(value, days) {
    const date = asDate(value) || new Date();
    date.setDate(date.getDate() + days);
    return date;
  }

  function timePart(date) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function snoozeUntil(preset, nowValue) {
    const now = asDate(nowValue) || new Date();
    const target = new Date(now.getTime());
    if (preset === "later-today") {
      target.setMinutes(0, 0, 0);
      target.setHours(target.getHours() + 2);
      if (target.getDate() !== now.getDate()) {
        target.setDate(now.getDate());
        target.setMonth(now.getMonth());
        target.setFullYear(now.getFullYear());
        target.setHours(23, 59, 0, 0);
      }
      if (target.getTime() <= now.getTime()) target.setTime(now.getTime() + 30 * 60 * 1000);
    } else if (preset === "tomorrow") {
      target.setDate(target.getDate() + 1);
      target.setHours(9, 0, 0, 0);
    } else if (preset === "next-week") {
      target.setDate(target.getDate() + 7);
      target.setHours(9, 0, 0, 0);
    } else {
      return null;
    }
    return target.toISOString();
  }

  function effectiveDue(action, nowValue) {
    const now = asDate(nowValue) || new Date();
    const snoozedMs = action && action.snoozedUntil ? Date.parse(action.snoozedUntil) : NaN;
    if (action && action.status === "snoozed" && Number.isFinite(snoozedMs) && snoozedMs > now.getTime()) {
      const snoozed = new Date(snoozedMs);
      return {
        date: localIsoDate(snoozed),
        time: timePart(snoozed),
        snoozed: true,
        timestamp: snoozedMs,
      };
    }
    if (action && action.dueDate) {
      return {
        date: String(action.dueDate),
        time: action.dueTime ? String(action.dueTime) : "",
        snoozed: false,
        timestamp: NaN,
      };
    }
    if (action && action.status === "snoozed" && Number.isFinite(snoozedMs)) {
      return { date: localIsoDate(now), time: "", snoozed: false, timestamp: snoozedMs };
    }
    return null;
  }

  function compareText(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  function compareActions(a, b, nowValue) {
    const aDue = effectiveDue(a, nowValue);
    const bDue = effectiveDue(b, nowValue);
    const aDueKey = aDue ? `${aDue.date} ${aDue.time || "99:99"}` : "9999-12-31 99:99";
    const bDueKey = bDue ? `${bDue.date} ${bDue.time || "99:99"}` : "9999-12-31 99:99";
    const dueOrder = compareText(aDueKey, bDueKey);
    if (dueOrder) return dueOrder;
    const createdOrder = compareText(String(a && a.createdAt || ""), String(b && b.createdAt || ""));
    if (createdOrder) return createdOrder;
    return compareText(String(a && a.id || ""), String(b && b.id || ""));
  }

  function sortActions(items, nowValue) {
    return (Array.isArray(items) ? items : []).slice().sort((a, b) => compareActions(a, b, nowValue));
  }

  function groupActions(items, nowValue) {
    const now = asDate(nowValue) || new Date();
    const today = localIsoDate(now);
    const nextWeek = localIsoDate(dateAfter(now, 7));
    const groups = {
      now: [],
      next7: [],
      sharedNoDate: [],
      later: [],
      completed: [],
    };

    (Array.isArray(items) ? items : []).forEach((action) => {
      if (!action) return;
      if (action.status === "done") {
        groups.completed.push(action);
        return;
      }

      const due = effectiveDue(action, now);
      if (!due) groups.sharedNoDate.push(action);
      else if (due.date <= today) groups.now.push(action);
      else if (due.date <= nextWeek) groups.next7.push(action);
      else groups.later.push(action);
    });

    Object.keys(groups).forEach((key) => { groups[key] = sortActions(groups[key], now); });
    return groups;
  }

  // Today stays a focused preview, not a second homework backlog. A snoozed
  // item re-enters only when its snooze expires; all records remain in All.
  function previewActions(items, nowValue) {
    const now = asDate(nowValue) || new Date();
    const eligible = (Array.isArray(items) ? items : []).filter((item) => item &&
      item.status !== "done" && !(item.status === "snoozed" && Date.parse(item.snoozedUntil) > now.getTime()));
    const groups = groupActions(eligible, now);
    return groups.now.concat(groups.next7, groups.sharedNoDate, groups.later).slice(0, 3);
  }

  root.famActionQueue = {
    previewActions,
    localIsoDate,
    effectiveDue,
    snoozeUntil,
    compareActions,
    sortActions,
    groupActions,
  };
})(typeof window !== "undefined" ? window : globalThis);

/* ============================================================
   HERMES OPERATOR CASE CARDS — parent-only progressive surface
   Injected here because action-queue.js is already loaded on the Today page.
   The API remains the source of truth; no Operator authority is stored in DOM.
============================================================ */
(function (root) {
  "use strict";
  if (!root || !root.document || typeof root.fetch !== "function") return;

  const document = root.document;
  const TERMINAL = new Set(["completed", "failed", "cancelled"]);
  let loadingCases = false;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function humanEvent(eventType) {
    const labels = {
      "case.created": "Hermes started this case",
      "case.state_changed": "Case stage changed",
      "case.step_added": "Hermes added a work step",
      "approval.requested": "Approval requested",
      "approval.approved": "Parent approved the action",
      "approval.rejected": "Parent rejected the action",
      "approval.expired": "Approval expired",
      "execution.authorized": "Execution authorized",
      "execution.claimed": "Execution claimed",
      "execution.started": "Execution started",
      "execution.completed": "Execution completed",
      "execution.failed": "Execution failed",
      "execution.token_expired": "Execution token expired",
      "policy.action_evaluated": "Action policy checked",
      "beta.execution_blocked": "Beta safety control blocked execution",
      "beta.feedback_submitted": "Parent feedback recorded",
    };
    return labels[eventType] || String(eventType || "Activity").replace(/[._]/g, " ");
  }

  function actionSummary(proposal) {
    if (!proposal || !proposal.action) return "";
    const action = proposal.action;
    const parts = [];
    if (action.title) parts.push(action.title);
    if (action.date) parts.push(action.date + (action.time ? ` at ${action.time}` : ""));
    if (action.to) parts.push(`to ${action.to}`);
    if (action.amount) parts.push(String(action.amount));
    if (!parts.length) parts.push(proposal.actionType || "Proposed action");
    return parts.join(" · ");
  }

  function actionFieldLabel(key) {
    const labels = {
      title: "Title", date: "Date", time: "Start time", endTime: "End time",
      endDate: "End date", notes: "Notes", category: "Category", kidId: "For",
      repeat: "Repeats", repeatUntil: "Repeats until", to: "Recipient", amount: "Amount",
    };
    return labels[key] || String(key || "Detail").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
  }

  function actionFieldValue(value) {
    if (value && typeof value === "object") {
      try { return JSON.stringify(value); } catch (_) { return "Unable to display"; }
    }
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
  }

  function renderActionDetails(proposal) {
    if (!proposal || !proposal.action || typeof proposal.action !== "object") return "";
    const entries = Object.entries(proposal.action).filter(([, value]) => value !== null && value !== undefined && value !== "");
    if (!entries.length) return "";
    return `<dl class="hermes-op-action-details">${entries.map(([key, value]) => `<div><dt>${escapeHtml(actionFieldLabel(key))}</dt><dd>${escapeHtml(actionFieldValue(value))}</dd></div>`).join("")}</dl>`;
  }

  function ensureStyles() {
    if (document.getElementById("hermes-operator-style")) return;
    const style = document.createElement("style");
    style.id = "hermes-operator-style";
    style.textContent = `
      #hermes-operator-cases-card{margin-bottom:18px}
      .hermes-op-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}
      .hermes-op-header h2{margin:0 0 4px;font-size:20px}.hermes-op-header p{margin:0;color:var(--text-2);font-size:13px;line-height:1.45}
      .hermes-op-list{display:grid;gap:10px}.hermes-op-case{border:1px solid var(--border);border-radius:14px;padding:14px;background:var(--surface)}
      .hermes-op-row{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.hermes-op-title{font-weight:700}.hermes-op-stage{font-size:11px;padding:4px 8px;border:1px solid var(--border);border-radius:999px;white-space:nowrap}
      .hermes-op-goal{margin:6px 0 0;color:var(--text-2);font-size:13px}.hermes-op-proposal{margin-top:12px;padding:11px;border-radius:10px;background:var(--bg);border:1px solid var(--border)}
      .hermes-op-proposal-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-2);margin-bottom:5px}.hermes-op-proposal-text{font-weight:650;font-size:13px}
      .hermes-op-action-details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 14px;margin:10px 0 0}.hermes-op-action-details div{min-width:0}.hermes-op-action-details dt{color:var(--text-2);font-size:11px}.hermes-op-action-details dd{margin:2px 0 0;font-size:13px;overflow-wrap:anywhere;white-space:pre-wrap}
      .hermes-op-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}.hermes-op-actions button{min-width:82px;min-height:44px}.hermes-op-meta{font-size:11px;color:var(--text-2);margin-top:8px;word-break:break-word}
      .hermes-op-decision-status{min-height:18px;margin-top:6px;font-size:12px;color:var(--text-2)}.hermes-op-evidence{margin-top:10px;font-size:12px}.hermes-op-evidence strong{display:block;margin-bottom:3px}.hermes-op-activity{margin-top:10px}.hermes-op-activity summary{cursor:pointer;display:flex;align-items:center;min-height:44px;font-size:12px;font-weight:650}.hermes-op-timeline{list-style:none;padding:7px 0 0;margin:0;display:grid;gap:6px}.hermes-op-timeline li{display:flex;gap:8px;font-size:12px;color:var(--text-2)}
      .hermes-op-feedback{margin-top:12px;padding:11px;border-radius:10px;border:1px solid var(--border);background:var(--bg)}.hermes-op-feedback strong{font-size:13px}.hermes-op-feedback p{margin:4px 0 0;color:var(--text-2);font-size:12px}.hermes-op-feedback-done{margin-top:10px;color:var(--text-2);font-size:12px}
      .hermes-op-dot{width:7px;height:7px;border-radius:50%;background:currentColor;margin-top:5px;flex:0 0 auto}.hermes-op-empty{color:var(--text-2);font-size:13px;padding:5px 0}.hermes-op-error{color:var(--danger,#b42318);font-size:12px}.hermes-op-retry{margin-top:8px;min-height:44px}
      .hermes-op-actions button:focus-visible,.hermes-op-header button:focus-visible,.hermes-op-activity summary:focus-visible,.hermes-op-retry:focus-visible{outline:3px solid var(--accent-soft);outline-offset:2px}
      @media(max-width:640px){.hermes-op-header,.hermes-op-row{flex-direction:column}.hermes-op-header button{min-height:44px}.hermes-op-stage{white-space:normal}.hermes-op-action-details{grid-template-columns:1fr}.hermes-op-actions button{flex:1}}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    let panel = document.getElementById("hermes-operator-cases-card");
    if (panel) return panel;
    const anchor = document.getElementById("today-actions-card");
    if (!anchor || !anchor.parentNode) return null;
    ensureStyles();
    panel = document.createElement("section");
    panel.id = "hermes-operator-cases-card";
    panel.className = "card parent-only";
    panel.hidden = true;
    panel.setAttribute("aria-labelledby", "hermes-operator-title");
    panel.innerHTML = `<div class="hermes-op-header"><div><h2 id="hermes-operator-title">Hermes is working on…</h2><p>See what Hermes is doing, review exact actions, and inspect the activity trail.</p></div><button type="button" class="btn-link" id="hermes-operator-refresh">Refresh</button></div><div id="hermes-operator-list" class="hermes-op-list" aria-live="polite"></div>`;
    anchor.parentNode.insertBefore(panel, anchor);
    panel.querySelector("#hermes-operator-refresh").addEventListener("click", loadCases);
    return panel;
  }

  function renderActivity(activity) {
    const list = Array.isArray(activity) ? activity : [];
    if (!list.length) return "";
    return `<details class="hermes-op-activity"><summary>Activity · ${list.length}</summary><ul class="hermes-op-timeline">${list.map((event) => `<li><span class="hermes-op-dot"></span><span><strong>${escapeHtml(humanEvent(event.eventType))}</strong>${escapeHtml(formatTime(event.createdAt))}</span></li>`).join("")}</ul></details>`;
  }

  function renderEvidence(evidence) {
    const items = Array.isArray(evidence) ? evidence : [];
    if (!items.length) return "";
    return `<div class="hermes-op-evidence"><strong>Evidence / confirmation</strong>${items.map((item) => {
      const result = item.result || {};
      const error = item.error || {};
      const detail = result.eventId || result.actionId || result.itineraryItemId || result.confirmationNumber || result.reference || error.message || item.state || "Recorded";
      return `<div>${escapeHtml(item.actionType || item.kind || "Operator")} · ${escapeHtml(detail)}</div>`;
    }).join("")}</div>`;
  }

  function renderFeedback(feedback) {
    if (!feedback || !feedback.required) return "";
    if (feedback.submitted) {
      const saved = feedback.feedback || {};
      return `<div class="hermes-op-feedback-done">Feedback recorded${saved.outcome ? ` · ${escapeHtml(saved.outcome.replace(/-/g, " "))}` : ""}.</div>`;
    }
    const blocked = feedback.reason === "blocked";
    const intro = blocked ? "Was it right for FamETC to block this action?" : "Was this Hermes result useful?";
    const buttons = blocked
      ? `<button type="button" class="btn-secondary" data-op-feedback="block-correct">Yes, block was right</button><button type="button" class="btn-secondary" data-op-feedback="block-incorrect">No, it should have run</button>`
      : `<button type="button" class="btn-secondary" data-op-feedback="helpful">Helpful</button><button type="button" class="btn-secondary" data-op-feedback="not-helpful">Not helpful</button>`;
    return `<div class="hermes-op-feedback"><strong>Quick feedback</strong><p>${escapeHtml(intro)}</p><div class="hermes-op-actions">${buttons}</div><div class="hermes-op-decision-status" role="status" aria-live="polite"></div></div>`;
  }

  function renderCase(card) {
    const proposal = card.proposedAction;
    const pending = proposal && proposal.approvalId;
    const policy = proposal && proposal.policy;
    const risk = policy && policy.riskLevel ? ` · ${escapeHtml(policy.riskLevel)} risk` : "";
    const approval = pending ? `<div class="hermes-op-proposal"><div class="hermes-op-proposal-label">Proposed action${risk}</div><div class="hermes-op-proposal-text">${escapeHtml(actionSummary(proposal))}</div>${renderActionDetails(proposal)}<div class="hermes-op-meta">${escapeHtml(proposal.actionType)} · action ${escapeHtml(String(proposal.actionHash || "").slice(0, 12))}…</div><div class="hermes-op-actions"><button type="button" class="btn-primary" data-op-decision="approve" data-approval-id="${escapeHtml(proposal.approvalId)}" data-action-hash="${escapeHtml(proposal.actionHash)}">Approve</button><button type="button" class="btn-secondary" data-op-decision="reject" data-approval-id="${escapeHtml(proposal.approvalId)}" data-action-hash="${escapeHtml(proposal.actionHash)}">Reject</button></div><div class="hermes-op-decision-status" role="status" aria-live="polite"></div></div>` : "";
    return `<article class="hermes-op-case" data-case-id="${escapeHtml(card.id)}"><div class="hermes-op-row"><div><div class="hermes-op-title">${escapeHtml(card.title)}</div><p class="hermes-op-goal">${escapeHtml(card.goal)}</p></div><span class="hermes-op-stage">${escapeHtml(card.stageLabel || card.state)}</span></div>${approval}${renderEvidence(card.evidence)}${renderFeedback(card.feedback)}${renderActivity(card.activity)}</article>`;
  }

  function bindDecisionButtons(panel) {
    panel.querySelectorAll("[data-op-decision]").forEach((button) => {
      button.addEventListener("click", async () => {
        const decision = button.dataset.opDecision;
        const approvalId = button.dataset.approvalId;
        const actionHash = button.dataset.actionHash;
        if (!approvalId || !actionHash || !["approve", "reject"].includes(decision)) return;
        const actions = button.closest(".hermes-op-actions");
        const decisionButtons = actions ? [...actions.querySelectorAll("button")] : [button];
        const status = actions && actions.parentNode ? actions.parentNode.querySelector(".hermes-op-decision-status") : null;
        decisionButtons.forEach((control) => { control.disabled = true; });
        if (status) status.textContent = decision === "approve" ? "Approving this exact action…" : "Rejecting this action…";
        try {
          const response = await root.fetch(`/api/operator/approvals/${encodeURIComponent(approvalId)}/decision`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision, actionHash }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || "Operator decision failed.");
          await loadCases();
        } catch (error) {
          decisionButtons.forEach((control) => { control.disabled = false; });
          if (status) status.textContent = "";
          const article = button.closest(".hermes-op-case");
          if (article) {
            let message = article.querySelector(".hermes-op-error");
            if (!message) { message = document.createElement("div"); message.className = "hermes-op-error"; message.setAttribute("role", "alert"); article.appendChild(message); }
            message.textContent = error && error.message ? error.message : "Operator decision failed.";
          }
        }
      });
    });
  }

  function bindFeedbackButtons(panel) {
    panel.querySelectorAll("[data-op-feedback]").forEach((button) => {
      button.addEventListener("click", async () => {
        const outcome = button.dataset.opFeedback;
        const article = button.closest(".hermes-op-case");
        const caseId = article && article.dataset.caseId;
        if (!caseId || !["helpful", "not-helpful", "block-correct", "block-incorrect"].includes(outcome)) return;
        const actions = button.closest(".hermes-op-actions");
        const buttons = actions ? [...actions.querySelectorAll("button")] : [button];
        const status = actions && actions.parentNode ? actions.parentNode.querySelector(".hermes-op-decision-status") : null;
        buttons.forEach((control) => { control.disabled = true; });
        if (status) status.textContent = "Saving feedback…";
        try {
          const rating = outcome === "helpful" || outcome === "block-correct" ? 5 : 2;
          const response = await root.fetch(`/api/operator/cases/${encodeURIComponent(caseId)}/feedback`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ outcome, rating }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || "Could not save Operator feedback.");
          await loadCases();
        } catch (error) {
          buttons.forEach((control) => { control.disabled = false; });
          if (status) status.textContent = error && error.message ? error.message : "Could not save feedback.";
        }
      });
    });
  }

  async function loadCases() {
    if (loadingCases) return;
    const panel = ensurePanel();
    if (!panel) return;
    const list = panel.querySelector("#hermes-operator-list");
    const refresh = panel.querySelector("#hermes-operator-refresh");
    loadingCases = true;
    list.setAttribute("aria-busy", "true");
    if (refresh) refresh.disabled = true;
    try {
      const response = await root.fetch("/api/operator/cases?limit=12", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (response.status === 401 || response.status === 403 || response.status === 404) { panel.hidden = true; return; }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load Hermes cases.");
      const cases = Array.isArray(payload.cases) ? payload.cases : [];
      const visible = cases.filter((card) => card && (!TERMINAL.has(card.state) || card.state === "failed" || card.evidence && card.evidence.length || card.feedback && card.feedback.required));
      if (!visible.length) { panel.hidden = true; list.innerHTML = ""; return; }
      panel.hidden = false;
      list.innerHTML = visible.map(renderCase).join("");
      bindDecisionButtons(panel);
      bindFeedbackButtons(panel);
    } catch (error) {
      panel.hidden = false;
      list.innerHTML = `<div class="hermes-op-empty" role="alert">Hermes case activity is temporarily unavailable.<br><button type="button" class="btn-secondary hermes-op-retry">Try again</button></div>`;
      const retry = list.querySelector(".hermes-op-retry");
      if (retry) retry.addEventListener("click", loadCases);
    } finally {
      loadingCases = false;
      list.setAttribute("aria-busy", "false");
      if (refresh) refresh.disabled = false;
    }
  }

  root.famHermesOperator = { loadCases };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(loadCases, 0));
  else setTimeout(loadCases, 0);
  root.setInterval(loadCases, 30000);
})(typeof window !== "undefined" ? window : null);
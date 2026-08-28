(function () {
  "use strict";

  const pendingEl = document.getElementById("memory-pending");
  const activeEl = document.getElementById("memory-active");
  const statusEl = document.getElementById("memory-status");

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>\"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }
  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ credentials: "same-origin", headers: { "Content-Type": "application/json" } }, opts || {}));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }
  function valueText(memory) {
    if (typeof memory.value === "string") return memory.value;
    try { return JSON.stringify(memory.value); } catch (_) { return String(memory.value); }
  }
  function meta(memory) {
    const p = memory.provenance || {};
    const bits = [memory.kind, memory.scope, memory.sensitivity];
    if (p.productId) bits.push(`source: ${p.productId}`);
    if (memory.expiresAt) bits.push(`expires ${new Date(memory.expiresAt).toLocaleString()}`);
    return bits.map(esc).join(" · ");
  }
  function pendingMarkup(items) {
    if (!items.length) return '<p class="text-muted">No memory proposals are waiting for review.</p>';
    return items.map((memory) => `
      <article class="card" style="padding:14px;margin:10px 0">
        <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start">
          <div><strong>${esc(memory.key)}</strong><div style="margin-top:5px">${esc(valueText(memory))}</div><div class="text-muted" style="font-size:12px;margin-top:7px">${meta(memory)}</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-primary" data-memory-approve="${esc(memory.id)}">Approve</button>
            <button class="btn-secondary" data-memory-reject="${esc(memory.id)}">Reject</button>
          </div>
        </div>
      </article>`).join("");
  }
  function activeMarkup(items) {
    if (!items.length) return '<p class="text-muted">No active Family Memory yet.</p>';
    return items.map((memory) => `
      <article class="card" style="padding:14px;margin:10px 0">
        <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start">
          <div><strong>${esc(memory.key)}</strong><div style="margin-top:5px">${esc(valueText(memory))}</div><div class="text-muted" style="font-size:12px;margin-top:7px">${meta(memory)}</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-secondary" data-memory-edit="${esc(memory.id)}" data-memory-value="${esc(valueText(memory))}">Edit</button>
            <button class="btn-danger" data-memory-delete="${esc(memory.id)}">Delete</button>
          </div>
        </div>
      </article>`).join("");
  }
  async function load() {
    statusEl.textContent = "Loading Family Memory…";
    try {
      const [pending, active] = await Promise.all([
        api("/api/operator/memory?state=pending"),
        api("/api/operator/memory?state=active"),
      ]);
      pendingEl.innerHTML = pendingMarkup(pending.memories || []);
      activeEl.innerHTML = activeMarkup(active.memories || []);
      statusEl.textContent = "";
    } catch (error) {
      statusEl.textContent = error.message;
    }
  }
  async function decide(id, decision) {
    statusEl.textContent = `${decision === "approve" ? "Approving" : "Rejecting"} memory…`;
    try {
      await api(`/api/operator/memory/${encodeURIComponent(id)}/decision`, { method: "POST", body: JSON.stringify({ decision }) });
      await load();
    } catch (error) { statusEl.textContent = error.message; }
  }
  async function remove(id) {
    if (!window.confirm("Delete this Family Memory item?")) return;
    try { await api(`/api/operator/memory/${encodeURIComponent(id)}`, { method: "DELETE" }); await load(); }
    catch (error) { statusEl.textContent = error.message; }
  }
  async function edit(id, current) {
    const value = window.prompt("Update the remembered value", current || "");
    if (value == null) return;
    try { await api(`/api/operator/memory/${encodeURIComponent(id)}/update`, { method: "POST", body: JSON.stringify({ value }) }); await load(); }
    catch (error) { statusEl.textContent = error.message; }
  }

  document.addEventListener("click", (event) => {
    const approve = event.target.closest("[data-memory-approve]");
    if (approve) return decide(approve.dataset.memoryApprove, "approve");
    const reject = event.target.closest("[data-memory-reject]");
    if (reject) return decide(reject.dataset.memoryReject, "reject");
    const del = event.target.closest("[data-memory-delete]");
    if (del) return remove(del.dataset.memoryDelete);
    const editButton = event.target.closest("[data-memory-edit]");
    if (editButton) return edit(editButton.dataset.memoryEdit, editButton.dataset.memoryValue);
  });
  document.getElementById("memory-refresh").addEventListener("click", load);
  document.getElementById("memory-add-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const key = document.getElementById("memory-key").value.trim();
    const value = document.getElementById("memory-value").value.trim();
    try {
      await api("/api/operator/memory", {
        method: "POST",
        body: JSON.stringify({ scope: "household", key, kind: "preference", value, assertionType: "asserted", confidence: 1, sensitivity: "personal-preferences", provenance: { productId: "fametc", sourceType: "parent-ui", authority: "parent" } }),
      });
      event.target.reset();
      await load();
    } catch (error) { statusEl.textContent = error.message; }
  });

  load();
})();

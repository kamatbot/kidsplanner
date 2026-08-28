(function () {
  "use strict";

  const caseInput = document.getElementById("operator-case-id");
  const fileInput = document.getElementById("operator-attachment-file");
  const listEl = document.getElementById("operator-attachment-list");
  const statusEl = document.getElementById("operator-attachment-status");

  const MIME_BY_EXT = {
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    txt: "text/plain", csv: "text/csv", json: "application/json", eml: "message/rfc822",
  };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>\"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }
  function caseId() { return String(caseInput.value || "").trim(); }
  function apiPath(suffix) { return `/api/operator/cases/${encodeURIComponent(caseId())}/attachments${suffix || ""}`; }
  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ credentials: "same-origin", headers: { "Content-Type": "application/json" } }, opts || {}));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }
  function bytesToBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    return btoa(binary);
  }
  function mimeFor(file) {
    if (file.type) return file.type.toLowerCase();
    const ext = String(file.name || "").split(".").pop().toLowerCase();
    return MIME_BY_EXT[ext] || "";
  }
  function render(items) {
    if (!items.length) {
      listEl.innerHTML = '<p class="text-muted">No files are attached to this case.</p>';
      return;
    }
    listEl.innerHTML = items.map((item) => `
      <article class="card" style="padding:14px;margin:10px 0">
        <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start">
          <div>
            <strong>${esc(item.filename)}</strong>
            <div class="text-muted" style="font-size:12px;margin-top:6px">${esc(item.mimeType)} · ${Math.ceil(Number(item.sizeBytes || 0) / 1024)} KB · extraction: ${esc(item.extractionStatus)}</div>
            <div class="text-muted" style="font-size:11px;margin-top:4px">SHA-256 ${esc(item.contentHash)}</div>
          </div>
          <button class="btn-danger" type="button" data-attachment-delete="${esc(item.id)}">Delete</button>
        </div>
      </article>`).join("");
  }
  async function load() {
    if (!caseId()) { listEl.innerHTML = '<p class="text-muted">Enter a case ID to see its attachments.</p>'; return; }
    statusEl.textContent = "Loading attachments…";
    try {
      const result = await api(apiPath());
      render(result.attachments || []);
      statusEl.textContent = "";
    } catch (error) { statusEl.textContent = error.message; }
  }
  async function remove(id) {
    if (!window.confirm("Delete this attachment and its extracted data?")) return;
    try { await api(apiPath(`/${encodeURIComponent(id)}`), { method: "DELETE" }); await load(); }
    catch (error) { statusEl.textContent = error.message; }
  }

  const query = new URLSearchParams(window.location.search);
  if (query.get("caseId")) caseInput.value = query.get("caseId");
  document.getElementById("operator-attachment-refresh").addEventListener("click", load);
  caseInput.addEventListener("change", load);
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-attachment-delete]");
    if (button) remove(button.dataset.attachmentDelete);
  });
  document.getElementById("operator-attachment-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = fileInput.files && fileInput.files[0];
    if (!caseId()) { statusEl.textContent = "Enter the Operator case ID first."; return; }
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { statusEl.textContent = "File is larger than 8 MB."; return; }
    const mimeType = mimeFor(file);
    if (!mimeType) { statusEl.textContent = "This file type is not supported."; return; }
    statusEl.textContent = "Encrypting and attaching file…";
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await api(apiPath(), {
        method: "POST",
        body: JSON.stringify({ filename: file.name, mimeType, dataBase64: bytesToBase64(bytes) }),
      });
      fileInput.value = "";
      await load();
    } catch (error) { statusEl.textContent = error.message; }
  });

  load();
})();

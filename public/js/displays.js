/* Parent-only household display setup. Pairing codes live only in this page. */
(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const state = {
    authorized: false, busy: false, loading: false, disposed: false,
    epoch: 0, loadRevision: 0, devices: [], editId: null, pairing: null,
    requests: new Set(), lastAttempt: 0,
    photos: [], photoMax: 12, photosLoaded: false,
  };

  class DisplayApiError extends Error {
    constructor(message, status = 0, code = "") {
      super(message);
      this.name = "DisplayApiError";
      this.status = status;
      this.code = code;
    }
  }

  function cancelled() {
    const error = new Error("Request no longer belongs to this page.");
    error.name = "AbortError";
    return error;
  }

  function status(id, message, kind = "") {
    const node = byId(id);
    node.textContent = message;
    node.classList.toggle("is-error", kind === "error");
    node.classList.toggle("is-success", kind === "success");
  }

  function pageMessage(message, isError = false) {
    const node = byId("page-message");
    node.textContent = message;
    node.hidden = !message;
    node.classList.toggle("notice-error", isError);
  }

  function controls() {
    const blocked = !state.authorized || state.busy || state.disposed;
    byId("pair-fields").disabled = blocked;
    byId("edit-fields").disabled = blocked;
    byId("refresh-devices").disabled = state.loading || state.busy || state.disposed;
    byId("create-pairing").disabled = blocked || !!state.pairing;
    byId("device-list").setAttribute("aria-busy", String(state.loading));
    document.querySelectorAll("[data-device-action]").forEach((button) => { button.disabled = blocked; });
    byId("copy-code").disabled = !state.pairing || blocked;
    byId("hide-code").disabled = !state.pairing;
    const photoOff = blocked || !state.photosLoaded || state.photos.length >= state.photoMax;
    byId("photo-input").disabled = photoOff;
    byId("photo-add").classList.toggle("is-disabled", photoOff);
    byId("photo-grid").setAttribute("aria-busy", String(!state.photosLoaded));
    document.querySelectorAll("[data-photo-action]").forEach((button) => { button.disabled = blocked; });
  }

  function clearPairing() {
    state.pairing = null;
    byId("pair-code").textContent = "";
    byId("pair-code-label").textContent = "";
    byId("pair-expiry").textContent = "";
    byId("pair-code-panel").hidden = true;
    status("pair-code-status", "");
    controls();
  }

  function clearPrivateView() {
    clearPairing();
    state.devices = [];
    state.editId = null;
    byId("pair-form").reset();
    byId("edit-panel").hidden = true;
    byId("edit-form").reset();
    byId("edit-title").textContent = "Display settings";
    status("edit-status", "");
    status("devices-status", "");
    byId("device-list").replaceChildren();
    byId("device-count").textContent = "";
    byId("device-count").hidden = true;
    state.photos = [];
    state.photosLoaded = false;
    byId("photos-section").hidden = true;
    byId("photo-grid").replaceChildren();
    byId("photo-count").hidden = true;
    status("photos-status", "");
  }

  function accessDenied(error) {
    state.epoch += 1;
    state.authorized = false;
    state.busy = false;
    state.loading = false;
    for (const controller of state.requests) controller.abort();
    clearPrivateView();
    const message = error.status === 401
      ? "Your sign-in has expired. Sign in again to manage displays."
      : error.code === "upgrade_required"
        ? "Household displays are part of the whole Fam ETC. Open Family settings to manage your family’s plan."
        : error.code === "origin_not_allowed"
          ? "Open display settings at www.fametc.com to connect your Portal."
          : "A parent in this family must sign in to manage household displays.";
    pageMessage(message, true);
    status("pair-form-status", message, "error");
    status("devices-status", "");
    controls();
    if (error.status === 401) window.location.replace("/login?next=%2Fdisplays");
  }

  async function api(path, options = {}) {
    const epoch = state.epoch;
    const controller = new AbortController();
    state.requests.add(controller);
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, options.timeout || 20000);
    const upload = options.body instanceof FormData; // the browser sets the multipart boundary
    try {
      const response = await fetch(path, {
        method: options.method || "GET", credentials: "same-origin", cache: "no-store",
        headers: { Accept: "application/json", ...(options.body && !upload ? { "Content-Type": "application/json" } : {}) },
        ...(options.body ? { body: upload ? options.body : JSON.stringify(options.body) } : {}), signal: controller.signal,
      });
      let data;
      try { data = await response.json(); } catch (_) { data = {}; }
      if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
      if (state.disposed || epoch !== state.epoch) throw cancelled();
      if (!response.ok) {
        const error = new DisplayApiError(
          typeof data.error === "string" ? data.error : "That request could not be completed. Please try again.",
          response.status, typeof data.code === "string" ? data.code : "",
        );
        if (response.status === 401 || response.status === 403) accessDenied(error);
        throw error;
      }
      return data;
    } catch (error) {
      if (timedOut) throw new DisplayApiError("The request took too long. Check your connection and try again.");
      if (error.name === "AbortError" || error instanceof DisplayApiError) throw error;
      throw new DisplayApiError("Could not reach Fam ETC. Check your connection and try again.");
    } finally {
      window.clearTimeout(timeout);
      state.requests.delete(controller);
    }
  }

  function deviceFrom(value) {
    if (!value || typeof value.id !== "string" || !value.id || typeof value.label !== "string"
      || typeof value.timeZone !== "string" || typeof value.showHomework !== "boolean"
      || typeof value.showMeals !== "boolean") throw new DisplayApiError("Display information could not be read. Refresh to try again.");
    return {
      id: value.id, label: value.label, timeZone: value.timeZone,
      showHomework: value.showHomework, showMeals: value.showMeals,
      model: typeof value.model === "string" ? value.model : "",
      createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
      lastSeenAt: typeof value.lastSeenAt === "string" ? value.lastSeenAt : null,
      revokedAt: typeof value.revokedAt === "string" ? value.revokedAt : null,
    };
  }

  function dateLabel(value) {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return "Not yet connected";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderDevices() {
    const container = byId("device-list");
    container.replaceChildren();
    const active = state.devices.filter((device) => !device.revokedAt);
    byId("device-count").textContent = String(active.length);
    byId("device-count").setAttribute("aria-label", `${active.length} paired displays`);
    byId("device-count").hidden = !state.authorized;
    if (!state.devices.length) {
      const empty = el("div", "empty-state");
      empty.append(el("h3", "", "A place for the family week"), el("p", "", "Your displays will appear here after pairing. Create a code above to connect the first one."));
      container.append(empty);
    }
    state.devices.forEach((device) => {
      const card = el("article", "device-card" + (device.revokedAt ? " is-revoked" : ""));
      const main = el("div", "device-main");
      const symbol = el("span", "device-symbol");
      symbol.setAttribute("aria-hidden", "true");
      const details = el("div", "device-details");
      details.append(el("h3", "", device.label || "Family display"));
      details.append(el("p", "device-meta", [device.timeZone, device.model].filter(Boolean).join(" · ")));
      const sharing = ["Family schedule"];
      if (device.showHomework) sharing.push("Homework");
      if (device.showMeals) sharing.push("Meals");
      details.append(el("p", "device-meta", sharing.join(" · ")));
      details.append(el("p", "device-meta", device.revokedAt
        ? `Disconnected ${dateLabel(device.revokedAt)}`
        : device.lastSeenAt ? `Last connected ${dateLabel(device.lastSeenAt)}` : "Waiting for its first dashboard update"));
      details.append(el("span", "device-state" + (device.revokedAt ? " disconnected" : ""), device.revokedAt ? "Disconnected" : "Paired"));
      main.append(symbol, details);
      card.append(main);
      if (!device.revokedAt) {
        const actions = el("div", "device-actions");
        const edit = el("button", "button button-secondary", "Settings");
        edit.type = "button";
        edit.id = `display-settings-${device.id}`;
        edit.dataset.deviceAction = "edit";
        edit.setAttribute("aria-label", `Settings for ${device.label}`);
        edit.addEventListener("click", () => openEditor(device));
        const revoke = el("button", "button button-danger", "Disconnect");
        revoke.type = "button";
        revoke.dataset.deviceAction = "revoke";
        revoke.setAttribute("aria-label", `Disconnect ${device.label}`);
        revoke.addEventListener("click", () => revokeDevice(device));
        actions.append(edit, revoke);
        card.append(actions);
      }
      container.append(card);
    });
    controls();
  }

  async function loadDevices(quiet = false) {
    if (state.disposed || state.busy || state.loading) return;
    if (state.authorized && Date.now() - state.lastAttempt < 750) return;
    const revision = ++state.loadRevision;
    const epoch = state.epoch;
    state.loading = true;
    state.lastAttempt = Date.now();
    if (!quiet) status("devices-status", "Loading displays…");
    controls();
    try {
      const data = await api("/api/displays");
      if (revision !== state.loadRevision || epoch !== state.epoch || state.disposed) return;
      if (!Array.isArray(data.devices)) throw new DisplayApiError("Display information could not be read. Please refresh.");
      const devices = data.devices.map(deviceFrom);
      state.devices = devices;
      state.authorized = true;
      pageMessage("");
      status("pair-form-status", state.pairing ? "Enter the code below on your Portal." : "Only a parent can connect a new display.");
      status("devices-status", devices.length ? "Display list is up to date." : "Ready to connect your first display.");
      if (state.editId && !devices.some((device) => device.id === state.editId && !device.revokedAt)) {
        closeEditor(false);
        pageMessage("That display is no longer connected. Pair it again to change its settings.");
      }
      renderDevices();
      byId("photos-section").hidden = false;
      loadPhotos();
    } catch (error) {
      if (error.name !== "AbortError" && error.status !== 401 && error.status !== 403
        && epoch === state.epoch && revision === state.loadRevision) {
        status("devices-status", error.message, "error");
        if (!state.authorized) status("pair-form-status", "We could not check your family access. Use Refresh to try again.", "error");
      }
    } finally {
      if (revision === state.loadRevision && epoch === state.epoch) state.loading = false;
      controls();
    }
  }

  function readSettings(prefix) {
    const label = byId(`${prefix}-label`);
    const zone = byId(`${prefix}-timezone`);
    label.value = label.value.trim();
    zone.value = zone.value.trim();
    label.setCustomValidity(label.value ? "" : "Give this display a name.");
    zone.setCustomValidity("");
    try {
      if (!zone.value) throw new Error("Missing time zone");
      new Intl.DateTimeFormat("en", { timeZone: zone.value }).format(new Date());
    } catch (_) { zone.setCustomValidity("Enter a valid time zone, such as Asia/Bangkok."); }
    if (!byId(`${prefix}-form`).reportValidity()) return null;
    return { label: label.value, timeZone: zone.value, showHomework: byId(`${prefix}-homework`).checked, showMeals: byId(`${prefix}-meals`).checked };
  }

  function beginMutation() {
    if (!state.authorized || state.busy || state.disposed) return false;
    state.busy = true;
    // A prior list request may finish later; it must not undo a completed edit.
    state.loadRevision += 1;
    state.loading = false;
    controls();
    return true;
  }

  async function createPairing(event) {
    event.preventDefault();
    if (state.pairing) return;
    const settings = readSettings("pair");
    if (!settings || !beginMutation()) return;
    const epoch = state.epoch;
    status("pair-form-status", "Creating your pairing code…");
    try {
      const data = await api("/api/displays/pairing", { method: "POST", body: settings });
      if (epoch !== state.epoch || state.disposed) return;
      const pairing = data.pairing;
      const expiresAt = pairing && Date.parse(pairing.expiresAt);
      if (!pairing || typeof pairing.code !== "string" || !/^[A-Z2-9]{8}$/.test(pairing.code)
        || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new DisplayApiError("The code could not be displayed. Create a new code and use only the latest one.");
      }
      state.pairing = { code: pairing.code, expiresAt, createdMonotonic: performance.now(), lifetime: Math.min(expiresAt - Date.now(), 600000) };
      byId("pair-code").textContent = `${pairing.code.slice(0, 4)} ${pairing.code.slice(4)}`;
      byId("pair-code-label").textContent = typeof pairing.label === "string" ? pairing.label : settings.label;
      byId("pair-code-panel").hidden = false;
      tickPairing();
      status("pair-form-status", "Code ready. Open Fam ETC on your Portal and enter this code.", "success");
      byId("pair-code-panel").focus();
    } catch (error) {
      if (error.name !== "AbortError" && error.status !== 401 && error.status !== 403 && epoch === state.epoch) {
        clearPairing();
        status("pair-form-status", error.message, "error");
      }
    } finally {
      if (epoch === state.epoch) state.busy = false;
      controls();
    }
  }

  function tickPairing() {
    const pairing = state.pairing;
    if (!pairing) return;
    const remaining = Math.min(pairing.expiresAt - Date.now(), pairing.lifetime - (performance.now() - pairing.createdMonotonic));
    if (remaining <= 0) {
      const hadFocus = byId("pair-code-panel").contains(document.activeElement);
      clearPairing();
      status("pair-form-status", "That code has expired. Create a new one when your Portal is ready.");
      if (hadFocus) byId("create-pairing").focus();
      return;
    }
    const seconds = Math.ceil(remaining / 1000);
    byId("pair-expiry").textContent = `Expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} · one display only`;
  }

  async function copyPairing() {
    tickPairing();
    if (!state.pairing) return;
    const pairing = state.pairing;
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(pairing.code);
      if (state.pairing === pairing) status("pair-code-status", "Code copied. Paste it only into your family’s Portal.", "success");
    } catch (_) {
      if (state.pairing === pairing) status("pair-code-status", "Press and hold the code to select and copy it.");
    }
  }

  function openEditor(device) {
    if (state.busy || !state.authorized || device.revokedAt) return;
    state.editId = device.id;
    byId("edit-label").value = device.label;
    byId("edit-timezone").value = device.timeZone;
    byId("edit-homework").checked = device.showHomework;
    byId("edit-meals").checked = device.showMeals;
    byId("edit-label").setCustomValidity("");
    byId("edit-timezone").setCustomValidity("");
    byId("edit-title").textContent = `Settings for ${device.label}`;
    byId("edit-panel").hidden = false;
    status("edit-status", "The display will pick up changes when it next connects.");
    controls();
    byId("edit-title").focus();
  }

  function closeEditor(restoreFocus = true) {
    const id = state.editId;
    state.editId = null;
    byId("edit-panel").hidden = true;
    byId("edit-form").reset();
    status("edit-status", "");
    if (restoreFocus && id) (byId(`display-settings-${id}`) || byId("devices-title")).focus();
  }

  async function saveDevice(event) {
    event.preventDefault();
    if (!state.editId) return;
    const settings = readSettings("edit");
    if (!settings || !beginMutation()) return;
    const epoch = state.epoch;
    const id = state.editId;
    status("edit-status", "Saving display settings…");
    try {
      const data = await api(`/api/displays/${encodeURIComponent(id)}`, { method: "PATCH", body: settings });
      if (epoch !== state.epoch || state.disposed) return;
      const device = deviceFrom(data.device);
      if (device.id !== id) throw new DisplayApiError("The settings response did not match this display. Refresh before trying again.");
      state.devices = state.devices.map((item) => item.id === id ? device : item);
      closeEditor(false);
      renderDevices();
      status("devices-status", `Settings saved for ${device.label}.`, "success");
      byId("devices-title").focus();
    } catch (error) {
      if (error.name !== "AbortError" && error.status !== 401 && error.status !== 403 && epoch === state.epoch) status("edit-status", error.message, "error");
    } finally {
      if (epoch === state.epoch) state.busy = false;
      controls();
    }
  }

  async function revokeDevice(device) {
    if (!state.authorized || state.busy || device.revokedAt) return;
    if (!window.confirm(`Disconnect ${device.label}?\n\nIt will stop syncing. If it is offline, its last approved view can remain for up to 12 hours. You can pair it again later.`)) return;
    if (!beginMutation()) return;
    const epoch = state.epoch;
    status("devices-status", `Disconnecting ${device.label}…`);
    try {
      const data = await api(`/api/displays/${encodeURIComponent(device.id)}/revoke`, { method: "POST", body: {} });
      if (epoch !== state.epoch || state.disposed) return;
      if (data.ok !== true) throw new DisplayApiError("Disconnection could not be confirmed. Refresh and check this display.");
      state.devices = state.devices.map((item) => item.id === device.id ? { ...item, revokedAt: new Date().toISOString() } : item);
      if (state.editId === device.id) closeEditor(false);
      renderDevices();
      status("devices-status", `${device.label} is disconnected.`, "success");
      byId("devices-title").focus();
    } catch (error) {
      if (error.name !== "AbortError" && error.status !== 401 && error.status !== 403 && epoch === state.epoch) status("devices-status", error.message, "error");
    } finally {
      if (epoch === state.epoch) state.busy = false;
      controls();
    }
  }

  // ---- Night photos -------------------------------------------------------
  const PHOTO_LONG_EDGE = 2048;

  function renderPhotos() {
    const grid = byId("photo-grid");
    grid.replaceChildren();
    const count = byId("photo-count");
    count.textContent = `${state.photos.length} of ${state.photoMax}`;
    count.setAttribute("aria-label", `${state.photos.length} of ${state.photoMax} photos`);
    count.hidden = false;
    if (!state.photos.length) {
      const empty = el("li", "photo-empty", "No photos yet. Add a favourite family photo for the night screen.");
      grid.append(empty);
    }
    state.photos.forEach((photo, index) => {
      const item = el("li", "photo-item");
      const img = el("img", "photo-thumb");
      img.src = `/api/displays/photos/${encodeURIComponent(photo.id)}`;
      img.alt = `Night photo ${index + 1}`;
      img.loading = "lazy";
      img.decoding = "async";
      const remove = el("button", "button button-danger photo-remove", "Remove");
      remove.type = "button";
      remove.dataset.photoAction = "remove";
      remove.setAttribute("aria-label", "Remove photo");
      remove.addEventListener("click", () => removePhoto(photo));
      item.append(img, remove);
      grid.append(item);
    });
    controls();
  }

  async function loadPhotos() {
    const epoch = state.epoch;
    try {
      const data = await api("/api/displays/photos");
      if (epoch !== state.epoch || state.disposed) return;
      if (!Array.isArray(data.photos)) throw new DisplayApiError("Photos could not be read. Refresh to try again.");
      state.photos = data.photos.filter((p) => p && typeof p.id === "string" && p.id);
      if (Number.isInteger(data.max) && data.max > 0) state.photoMax = data.max;
      state.photosLoaded = true;
      renderPhotos();
    } catch (error) {
      if (error.name !== "AbortError" && error.status !== 401 && error.status !== 403 && epoch === state.epoch) {
        status("photos-status", error.message, "error");
      }
    }
  }

  async function decodeImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_) { /* option or format unsupported */ }
      try { return await createImageBitmap(file); } catch (_) { /* fall through to <img> */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }

  // Re-drawing onto a canvas drops EXIF/GPS metadata and shrinks the upload.
  async function reencodePhoto(file) {
    let source;
    try { source = await decodeImage(file); } catch (_) { throw new DisplayApiError("That file isn't a photo we can use."); }
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    const scale = Math.min(1, PHOTO_LONG_EDGE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF"; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (source.close) source.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob) throw new DisplayApiError("That photo could not be prepared. Try a different one.");
    return blob;
  }

  async function addPhotos() {
    const input = byId("photo-input");
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length || !beginMutation()) return;
    const epoch = state.epoch;
    const room = Math.max(0, state.photoMax - state.photos.length);
    const queue = files.slice(0, room);
    let added = 0;
    let failure = files.length > room ? `A display can show up to ${state.photoMax} photos. Remove one first.` : "";
    try {
      for (let i = 0; i < queue.length; i += 1) {
        status("photos-status", `Adding ${i + 1} of ${queue.length}…`);
        const form = new FormData();
        form.append("photo", await reencodePhoto(queue[i]), "photo.jpg");
        await api("/api/displays/photos", { method: "POST", body: form, timeout: 60000 });
        if (epoch !== state.epoch || state.disposed) return;
        added += 1;
        await loadPhotos();
      }
    } catch (error) {
      if (error.name === "AbortError" || error.status === 401 || error.status === 403 || epoch !== state.epoch) return;
      failure = error.message;
    } finally {
      if (epoch === state.epoch) state.busy = false;
      controls();
    }
    if (epoch !== state.epoch) return;
    const done = added ? `Added ${added} photo${added === 1 ? "" : "s"}. ` : "";
    status("photos-status", done + failure, failure ? "error" : "success");
  }

  async function removePhoto(photo) {
    if (!state.authorized || state.busy) return;
    if (!window.confirm("Remove this photo from the night screen?")) return;
    if (!beginMutation()) return;
    const epoch = state.epoch;
    status("photos-status", "Removing photo…");
    try {
      const data = await api(`/api/displays/photos/${encodeURIComponent(photo.id)}`, { method: "DELETE" });
      if (epoch !== state.epoch || state.disposed) return;
      if (data.ok !== true) throw new DisplayApiError("Removal could not be confirmed. Refresh and check your photos.");
      state.photos = state.photos.filter((item) => item.id !== photo.id);
      renderPhotos();
      status("photos-status", "Photo removed.", "success");
      byId("photos-title").focus();
    } catch (error) {
      if (error.name !== "AbortError" && error.status !== 401 && error.status !== 403 && epoch === state.epoch) status("photos-status", error.message, "error");
    } finally {
      if (epoch === state.epoch) state.busy = false;
      controls();
    }
  }

  byId("pair-form").addEventListener("submit", createPairing);
  byId("photo-input").addEventListener("change", addPhotos);
  byId("edit-form").addEventListener("submit", saveDevice);
  byId("refresh-devices").addEventListener("click", () => loadDevices());
  byId("cancel-edit").addEventListener("click", () => { if (!state.busy) closeEditor(); });
  byId("copy-code").addEventListener("click", copyPairing);
  byId("hide-code").addEventListener("click", () => {
    clearPairing();
    status("pair-form-status", "Code hidden. It can still be used until it expires. Create a new code only if needed.");
    byId("create-pairing").focus();
  });
  ["pair-label", "pair-timezone", "edit-label", "edit-timezone"].forEach((id) => {
    byId(id).addEventListener("input", () => byId(id).setCustomValidity(""));
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !state.disposed) {
      tickPairing();
      if (!state.busy && !state.loading && !state.editId) loadDevices(true);
    }
  });
  window.addEventListener("pagehide", () => {
    state.disposed = true;
    state.epoch += 1;
    state.authorized = false;
    state.busy = false;
    state.loading = false;
    for (const controller of state.requests) controller.abort();
    clearPrivateView();
    controls();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      state.disposed = false;
      state.epoch += 1;
      status("pair-form-status", "Checking your family access…");
      loadDevices();
    }
  });
  window.setInterval(() => {
    if (state.disposed) return;
    tickPairing();
    if (state.pairing && !document.hidden && !state.busy && !state.loading && !state.editId && Date.now() - state.lastAttempt >= 30000) loadDevices(true);
  }, 1000);

  // The display belongs to the household; the parent's current travel timezone
  // must not silently replace the agreed household default.
  controls();
  loadDevices();
})();

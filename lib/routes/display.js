"use strict";

module.exports = (app, deps) => {
  const { currentUser, family, authLimiter, apiLimiter, schoolFeeds, schoolApi, events, homework, meals } = deps;
  const displayAuth = deps.displayAuth || require("../display-auth");
  const displayContext = deps.displayContext || require("../display-context");
  const displayPhotos = deps.displayPhotos || require("../display-photos");
  const multer = require("multer");
  const receivePhoto = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: displayPhotos.MAX_BYTES, files: 1, fields: 2 },
  }).single("photo");
  const canonicalOrigin = new URL(deps.CANONICAL_HOST || "https://www.fametc.com").origin;

  function noStore(req, res, next) {
    res.set("Cache-Control", "no-store");
    res.set("Pragma", "no-cache");
    next();
  }

  function jsonOnly(req, res, next) {
    const type = (req.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return res.status(415).json({ error: "Send a JSON request." });
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "Send a JSON object." });
    }
    next();
  }

  function parentOrigin(req, res, next) {
    const origin = req.get("origin");
    if ((origin && origin !== canonicalOrigin) || req.get("sec-fetch-site") === "cross-site") {
      return res.status(403).json({ error: "Open display settings in Fam ETC.", code: "origin_not_allowed" });
    }
    next();
  }

  // Deliberately bypass the general requireAuth bearer fallback. Membership
  // and plan are checked here with the signed interactive cookie's real user.
  function requireInteractiveParent(req, res, next) {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to manage family displays." });
    if (req.get("authorization") || req.watchAuth || req.displayAuth) {
      return res.status(403).json({ error: "A parent must manage displays from their own account." });
    }
    const role = user.data && user.data.profile && user.data.profile.role;
    if (role && role !== "parent") return res.status(403).json({ error: "Parents manage family displays." });
    const fam = family.familiesForUser(user.id)[0];
    if (!fam || !Array.isArray(fam.parentIds) || !fam.parentIds.includes(user.id)) {
      return res.status(403).json({ error: "Join a family as a parent to manage displays." });
    }
    if (!family.isFull(fam)) {
      return res.status(403).json({ error: "This display requires the whole Fam ETC.", code: "upgrade_required" });
    }
    req.displayParent = user;
    req.displayFamily = fam;
    next();
  }

  function requireDisplay(req, res, next) {
    const match = /^Bearer (fdp_[A-Za-z0-9_-]{43})$/i.exec(req.get("authorization") || "");
    const access = match && displayAuth.resolveToken(match[1]);
    if (!access) return res.status(401).json({ error: "Pair this display again.", code: "display_unpaired" });
    if (access.error) return sendResult(res, access);
    req.displayAccess = access;
    next();
  }

  function sendResult(res, result) {
    if (result && result.error) {
      return res.status(result.status || 400).json({ error: result.error, ...(result.code ? { code: result.code } : {}) });
    }
    return res.json(result);
  }

  function handler(fn) {
    return (req, res, next) => {
      try {
        return fn(req, res, next);
      } catch (error) {
        // Never reflect source feed errors, credential material or filesystem
        // paths into display responses or logs.
        return res.status(503).json({
          error: "The display service is temporarily unavailable. Please try again.",
          code: error && error.code === "display_storage_unavailable" ? error.code : "display_unavailable",
        });
      }
    };
  }

  const parentOnly = handler(requireInteractiveParent);

  function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(() => {
      if (!res.headersSent) res.status(503).json({ error: "The display service is temporarily unavailable. Please try again.", code: "display_unavailable" });
    });
  }

  // Multipart parsing runs only after the parent checks, so anonymous callers
  // never get an 8 MB body buffered.
  function photoUpload(req, res, next) {
    receivePhoto(req, res, (error) => {
      if (!error) return next();
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? "Use a photo under 8 MB." : "Send one photo in the photo field." });
    });
  }

  async function sendPhoto(res, familyId, id) {
    const record = await displayPhotos.read(familyId, id);
    if (!record) return res.status(404).json({ error: "Photo not found." });
    res.set("Content-Type", record.meta.mimeType);
    res.set("Content-Disposition", "inline");
    res.set("X-Content-Type-Options", "nosniff");
    return res.send(record.buffer);
  }

  app.post("/api/displays/pairing", noStore, authLimiter, jsonOnly, parentOrigin, parentOnly, handler((req, res) => {
    return sendResult(res, displayAuth.createPairing({
      familyId: req.displayFamily.id,
      createdBy: req.displayParent.id,
      label: req.body.label,
      timeZone: req.body.timeZone,
      showHomework: req.body.showHomework,
      showMeals: req.body.showMeals,
    }));
  }));

  app.get("/api/displays", noStore, apiLimiter, parentOnly, handler((req, res) => {
    return res.json({ devices: displayAuth.listDevices(req.displayFamily.id) });
  }));

  app.patch("/api/displays/:id", noStore, apiLimiter, jsonOnly, parentOrigin, parentOnly, handler((req, res) => {
    return sendResult(res, displayAuth.updateDevice(req.displayFamily.id, req.params.id, req.body));
  }));

  app.post("/api/displays/:id/revoke", noStore, authLimiter, jsonOnly, parentOrigin, parentOnly, handler((req, res) => {
    return sendResult(res, displayAuth.revokeDevice(req.displayFamily.id, req.params.id));
  }));

  app.get("/api/displays/photos", noStore, apiLimiter, parentOnly, handler((req, res) => {
    return res.json({ photos: displayPhotos.list(req.displayFamily.id), max: displayPhotos.MAX_PHOTOS });
  }));

  app.post("/api/displays/photos", noStore, apiLimiter, parentOrigin, parentOnly, photoUpload, asyncHandler(async (req, res) => {
    return sendResult(res, await displayPhotos.add(req.displayFamily.id, req.displayParent.id, req.file));
  }));

  app.get("/api/displays/photos/:id", noStore, apiLimiter, parentOnly, asyncHandler((req, res) => {
    return sendPhoto(res, req.displayFamily.id, req.params.id);
  }));

  app.delete("/api/displays/photos/:id", noStore, apiLimiter, parentOrigin, parentOnly, handler((req, res) => {
    return sendResult(res, displayPhotos.remove(req.displayFamily.id, req.params.id));
  }));

  app.get("/api/display/photos/:id", noStore, apiLimiter, handler(requireDisplay), asyncHandler((req, res) => {
    return sendPhoto(res, req.displayAccess.family.id, req.params.id);
  }));

  app.post("/api/display/pair", noStore, authLimiter, jsonOnly, handler((req, res) => {
    return sendResult(res, displayAuth.claimPairing(req.body.code, req.body.model));
  }));

  app.get("/api/display/context", noStore, apiLimiter, handler(requireDisplay), handler((req, res) => {
    const context = displayContext.buildContext({
      family: req.displayAccess.family,
      device: req.displayAccess.device,
      schoolFeeds, schoolApi, events, homework, meals,
    });
    return res.json({ ...context, photos: displayPhotos.list(req.displayAccess.family.id) });
  }));

  app.post("/api/display/disconnect", noStore, authLimiter, jsonOnly, handler(requireDisplay), handler((req, res) => {
    const device = req.displayAccess.device;
    return sendResult(res, displayAuth.revokeDevice(device.familyId, device.id));
  }));
};

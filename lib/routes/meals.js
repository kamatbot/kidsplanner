"use strict";

module.exports = (app, deps) => {
  const { meals, store, family, requireAuth, requireParent, requireFamily, userRole } = deps;

  // Resolve a parent userId -> Meals-relevant profile fields for
  // meals.buildHousehold() and the menu protein-opt-in check (§6.5). Profile
  // fields only — never email (mirrors lib/routes/trips.js's resolveName,
  // which also keeps ./store access at the route layer, out of lib/meals.js).
  function resolveParentProfile(userId) {
    const u = store.getUser(userId);
    if (!u) return null;
    const p = (u.data && u.data.profile) || {};
    return {
      name: p.name || null,
      portion: p.portion,
      allergies: p.allergies,
      proteinTargetG: p.proteinTargetG != null ? p.proteinTargetG : null,
    };
  }

  // True if ANY parent in the family opted in to a protein target (§2/§6.5) —
  // only then does a recipe-derived menu entry get a display-only proteinG.
  function anyParentOptedIn(fam) {
    return (fam.parentIds || []).some((pid) => {
      const p = resolveParentProfile(pid);
      return p && p.proteinTargetG != null;
    });
  }

  // ===================== composite read =====================

  app.get("/api/meals", requireAuth, requireFamily, (req, res) => {
    res.set("Cache-Control", "no-store");
    const state = meals.getState(req.family.id);
    const household = meals.buildHousehold(req.family, resolveParentProfile);
    res.json({
      pantry: state.pantry,
      menu: state.menu,
      shopping: state.shopping,
      prefs: state.prefs,
      household,
    });
  });

  // ===================== prefs (parent-only, §4) =====================

  app.patch("/api/meals/prefs", requireAuth, requireParent, requireFamily, (req, res) => {
    const result = meals.updatePrefs(req.family.id, req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ prefs: result.prefs });
  });

  // ===================== pantry (parent-only, §4) =====================

  app.post("/api/meals/pantry", requireAuth, requireParent, requireFamily, (req, res) => {
    const body = req.body || {};
    const result = meals.addPantryItem(req.family.id, req.user.id, {
      name: body.name, category: body.category, level: body.level, unitHint: body.unitHint, expiresOn: body.expiresOn,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ item: result.item });
  });

  app.patch("/api/meals/pantry/:id", requireAuth, requireParent, requireFamily, (req, res) => {
    if (!meals.getPantryItem(req.family.id, req.params.id)) return res.status(404).json({ error: "Pantry item not found." });
    const body = req.body || {};
    const result = meals.updatePantryItem(req.family.id, req.user.id, req.params.id, {
      name: body.name, category: body.category, level: body.level, unitHint: body.unitHint, expiresOn: body.expiresOn,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ item: result.item });
  });

  app.delete("/api/meals/pantry/:id", requireAuth, requireParent, requireFamily, (req, res) => {
    if (!meals.getPantryItem(req.family.id, req.params.id)) return res.status(404).json({ error: "Pantry item not found." });
    const result = meals.removePantryItem(req.family.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  // Scan-confirm write (§5/§6): the AI proxy only ever RETURNS suggestions;
  // this is the one place a shelf scan actually writes the pantry, and it's
  // always a human confirming an editable sheet, never automatic.
  app.post("/api/meals/pantry/bulk", requireAuth, requireParent, requireFamily, (req, res) => {
    const result = meals.bulkAddPantryItems(req.family.id, req.user.id, (req.body || {}).items);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ items: result.items });
  });

  app.post("/api/meals/pantry/undo", requireAuth, requireParent, requireFamily, (req, res) => {
    const eventId = (req.body || {}).eventId;
    if (!meals.getPantryEvent(req.family.id, eventId)) return res.status(404).json({ error: "Event not found." });
    const result = meals.undoEvent(req.family.id, req.user.id, eventId);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ item: result.item });
  });

  // ===================== menu (parent-only, §4) =====================

  app.post("/api/meals/menu", requireAuth, requireParent, requireFamily, (req, res) => {
    const body = req.body || {};
    const household = meals.buildHousehold(req.family, resolveParentProfile);
    const result = meals.addMenuEntry(req.family.id, req.user.id, {
      date: body.date,
      slot: body.slot,
      title: body.title,
      note: body.note,
      prep: body.prep,
      usesItemIds: body.usesItemIds,
      recipeId: body.recipeId,
      servesPortions: body.servesPortions != null ? body.servesPortions : household.totalPortions,
      allowProtein: anyParentOptedIn(req.family),
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ entry: result.entry });
  });

  app.patch("/api/meals/menu/:id", requireAuth, requireParent, requireFamily, (req, res) => {
    if (!meals.getMenuEntry(req.family.id, req.params.id)) return res.status(404).json({ error: "Menu entry not found." });
    const body = req.body || {};
    const result = meals.updateMenuEntry(req.family.id, req.params.id, {
      date: body.date, slot: body.slot, title: body.title, note: body.note,
      prep: body.prep, usesItemIds: body.usesItemIds, servesPortions: body.servesPortions,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ entry: result.entry });
  });

  app.delete("/api/meals/menu/:id", requireAuth, requireParent, requireFamily, (req, res) => {
    if (!meals.getMenuEntry(req.family.id, req.params.id)) return res.status(404).json({ error: "Menu entry not found." });
    const result = meals.removeMenuEntry(req.family.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  // Integration: AI plan route registered separately
  // (POST /api/meals/menu/plan — owned by another agent, lib/routes/ai.js §6)

  app.post("/api/meals/menu/:id/cooked", requireAuth, requireParent, requireFamily, (req, res) => {
    if (!meals.getMenuEntry(req.family.id, req.params.id)) return res.status(404).json({ error: "Menu entry not found." });
    const result = meals.cookMenuEntry(req.family.id, req.user.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ entry: result.entry, pantry: result.pantry });
  });

  // ===================== shopping — the one kid-write surface (§4) =====================
  // Add: both roles. Tick `done`: both roles, on ANY item. Everything else
  // (text/assignee edits, delete, from-pantry, restock): parent-only. Models
  // the Trips checklist carve-out (lib/routes/trips.js checklistWriteAllowed)
  // but simpler — here it's a fixed field allowlist, not per-list ownership.

  app.post("/api/meals/shopping", requireAuth, requireFamily, (req, res) => {
    const body = req.body || {};
    const result = meals.addShoppingItem(req.family.id, req.user.id, {
      text: body.text, category: body.category, assigneeUserId: body.assigneeUserId,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ item: result.item });
  });

  app.patch("/api/meals/shopping/:id", requireAuth, requireFamily, (req, res) => {
    if (!meals.getShoppingItem(req.family.id, req.params.id)) return res.status(404).json({ error: "Shopping item not found." });
    const body = req.body || {};
    const role = userRole(req.user);
    if (role === "kid") {
      if (body.text !== undefined || body.assigneeUserId !== undefined) {
        return res.status(403).json({ error: "Kids can only mark shopping items done — ask a parent to edit or reassign." });
      }
      const result = meals.updateShoppingItem(req.family.id, req.user.id, req.params.id, { done: body.done });
      if (result.error) return res.status(400).json({ error: result.error });
      return res.json({ item: result.item });
    }
    const result = meals.updateShoppingItem(req.family.id, req.user.id, req.params.id, {
      done: body.done, text: body.text, assigneeUserId: body.assigneeUserId,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ item: result.item });
  });

  app.delete("/api/meals/shopping/:id", requireAuth, requireParent, requireFamily, (req, res) => {
    if (!meals.getShoppingItem(req.family.id, req.params.id)) return res.status(404).json({ error: "Shopping item not found." });
    const result = meals.removeShoppingItem(req.family.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  app.post("/api/meals/shopping/from-pantry", requireAuth, requireParent, requireFamily, (req, res) => {
    const result = meals.seedShoppingFromPantry(req.family.id, req.user.id);
    res.json({ items: result.items });
  });

  app.post("/api/meals/shopping/restock", requireAuth, requireParent, requireFamily, (req, res) => {
    const result = meals.restockFromShopping(req.family.id, req.user.id);
    res.json({ items: result.items, pantry: result.pantry });
  });

  // ===================== self-service portion/allergies/protein (item 3) =====================
  // A parent sets their OWN Meals profile fields on user.data.profile — the
  // "parent equivalents" of family.kids[].portion/.allergies (docs/
  // MEALS-PLAN.md §3). Not in §5's API surface (that's pantry/menu/shopping/
  // prefs); this is the member-profile route item 3 of this build calls for.
  // requireParent only (no requireFamily) — a parent may set this before
  // creating/joining a family.
  app.patch("/api/meals/profile", requireAuth, requireParent, (req, res) => {
    const body = req.body || {};
    const current = (req.user.data && req.user.data.profile) || {};
    const patch = {};
    if (body.portion !== undefined) patch.portion = family.sanitizePortion(body.portion, current.portion || "regular");
    if (body.allergies !== undefined) patch.allergies = family.sanitizeAllergies(body.allergies);
    if (body.proteinTargetG !== undefined) {
      if (body.proteinTargetG === null) {
        patch.proteinTargetG = null;
      } else {
        const n = Number(body.proteinTargetG);
        if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: "proteinTargetG must be a positive number or null." });
        patch.proteinTargetG = Math.min(400, Math.round(n)); // §6.5: display-only, clamped to a sane range
      }
    }
    const data = store.updateData(req.user.id, (d) => {
      if (!d.profile) d.profile = {};
      Object.assign(d.profile, patch);
    });
    if (!data) return res.status(404).json({ error: "User not found." });
    res.json({
      profile: {
        portion: data.profile.portion || "regular",
        allergies: data.profile.allergies || [],
        proteinTargetG: data.profile.proteinTargetG != null ? data.profile.proteinTargetG : null,
      },
    });
  });
};

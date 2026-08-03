"use strict";

module.exports = (app, deps) => {
  const { meals, store, family, chat, notifications, requireAuth, requireFamily, requireParent } = deps;
  // The recipe library and the AI proxy's shared quota helper (lib/routes/ai.js
  // exports it so the planner draws on ONE per-user budget, not a second one).
  const recipes = deps.recipes || require("../recipes");
  const ai = require("./ai");

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

  app.get("/api/meals", requireAuth, requireFamily, requireParent, (req, res) => {
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

  app.patch("/api/meals/prefs", requireAuth, requireFamily, requireParent, (req, res) => {
    const result = meals.updatePrefs(req.family.id, req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ prefs: result.prefs });
  });

  // ===================== pantry (parent-only, §4) =====================

  app.post("/api/meals/pantry", requireAuth, requireFamily, requireParent, (req, res) => {
    const body = req.body || {};
    const result = meals.addPantryItem(req.family.id, req.user.id, {
      name: body.name, category: body.category, level: body.level, unitHint: body.unitHint, expiresOn: body.expiresOn,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ item: result.item });
  });

  app.patch("/api/meals/pantry/:id", requireAuth, requireFamily, requireParent, (req, res) => {
    if (!meals.getPantryItem(req.family.id, req.params.id)) return res.status(404).json({ error: "Pantry item not found." });
    const body = req.body || {};
    const result = meals.updatePantryItem(req.family.id, req.user.id, req.params.id, {
      name: body.name, category: body.category, level: body.level, unitHint: body.unitHint, expiresOn: body.expiresOn,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ item: result.item });
  });

  app.delete("/api/meals/pantry/:id", requireAuth, requireFamily, requireParent, (req, res) => {
    if (!meals.getPantryItem(req.family.id, req.params.id)) return res.status(404).json({ error: "Pantry item not found." });
    const result = meals.removePantryItem(req.family.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  // Scan-confirm write (§5/§6): the AI proxy only ever RETURNS suggestions;
  // this is the one place a shelf scan actually writes the pantry, and it's
  // always a human confirming an editable sheet, never automatic.
  // Seed an empty pantry with Indian-kitchen staples (lib/recipes.js STAPLES)
  // so Meals is useful on day one instead of after an hour of typing.
  app.post("/api/meals/pantry/staples", requireAuth, requireFamily, requireParent, (req, res) => {
    const result = meals.seedStaples(req.family.id, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ items: result.items, pantry: result.pantry });
  });

  app.post("/api/meals/pantry/bulk", requireAuth, requireFamily, requireParent, (req, res) => {
    const result = meals.bulkAddPantryItems(req.family.id, req.user.id, (req.body || {}).items);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ items: result.items });
  });

  app.post("/api/meals/pantry/undo", requireAuth, requireFamily, requireParent, (req, res) => {
    const eventId = (req.body || {}).eventId;
    if (!meals.getPantryEvent(req.family.id, eventId)) return res.status(404).json({ error: "Event not found." });
    const result = meals.undoEvent(req.family.id, req.user.id, eventId);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ item: result.item });
  });

  // ===================== menu (parent-only, §4) =====================

  app.post("/api/meals/menu", requireAuth, requireFamily, requireParent, (req, res) => {
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

  app.patch("/api/meals/menu/:id", requireAuth, requireFamily, requireParent, (req, res) => {
    if (!meals.getMenuEntry(req.family.id, req.params.id)) return res.status(404).json({ error: "Menu entry not found." });
    const body = req.body || {};
    const result = meals.updateMenuEntry(req.family.id, req.params.id, {
      date: body.date, slot: body.slot, title: body.title, note: body.note,
      prep: body.prep, usesItemIds: body.usesItemIds, servesPortions: body.servesPortions,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ entry: result.entry });
  });

  app.delete("/api/meals/menu/:id", requireAuth, requireFamily, requireParent, (req, res) => {
    if (!meals.getMenuEntry(req.family.id, req.params.id)) return res.status(404).json({ error: "Menu entry not found." });
    const result = meals.removeMenuEntry(req.family.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  // ===================== the planner (§6) =====================

  // Every allergen and dislike the household holds, as plain lowercase terms.
  // Kid allergies count even though kids can't open Meals — a parent planning
  // dinner is still cooking for them.
  function householdExcludeTerms(fam, prefs) {
    const household = meals.buildHousehold(fam, resolveParentProfile);
    const terms = new Set();
    for (const m of household.members || []) for (const a of m.allergies || []) terms.add(String(a).toLowerCase().trim());
    for (const a of (prefs && prefs.avoid) || []) terms.add(String(a).toLowerCase().trim());
    return { terms: [...terms].filter(Boolean), household };
  }

  // §6.3: allergens are enforced HERE, deterministically, on whatever the
  // model said — never by trusting it to have honoured the constraint. Matches
  // the title, the note and every ingredient name, plus the library's own
  // allergen-name table so "tahini" trips "sesame".
  function violatesExclusions(entry, terms) {
    if (!terms.length) return false;
    const hay = [entry.title, entry.note, ...(entry.ingredients || [])].join(" ").toLowerCase();
    for (const t of terms) {
      if (!t) continue;
      if (hay.includes(t)) return true;
      if (recipes && typeof recipes.allergenInIngredient === "function" && recipes.allergenInIngredient(t, hay)) return true;
    }
    return false;
  }

  function planDates(startDate, days) {
    const out = [];
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(startDate || "")) ? new Date(`${startDate}T00:00:00`) : new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime());
      d.setDate(d.getDate() + i);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  async function callPlannerModel(prompt) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    if (!ai.checkAndBumpQuota) return null;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: ai.MODEL || "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    let raw = ((data.content && data.content[0] && data.content[0].text) || "").trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) raw = fence[1].trim();
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) { return null; }
  }

  // §6.1: the model is told counts and constraints — never a member's name or
  // id. It sees "4 eaters, 3.6 portions, avoid: mushroom", nothing more.
  function plannerPrompt({ dates, slots, household, prefs, terms, pantry }) {
    const stock = pantry.filter((p) => p.level !== "out")
      .map((p) => `${p.name}${p.level === "low" ? " (LOW — use it up)" : ""}`).join(", ");
    const t = (prefs && prefs.targets) || {};
    return `Plan ${dates.length} days of home cooking for a household of ${household.members.length} eaters (${household.totalPortions} portions total).
Dates: ${dates.join(", ")}. Meals to plan each day: ${slots.join(", ")}.
Cook mostly INDIAN and THAI home food — this is an Indian family living in Bangkok. Everyday weeknight cooking, not restaurant dishes.
${prefs.diets && prefs.diets.length ? `Household diets (hard constraints): ${prefs.diets.join(", ")}.` : ""}
${terms.length ? `NEVER include these (allergies and dislikes): ${terms.join(", ")}.` : ""}
${t.proteinGPerMeal ? `Aim for at least ${t.proteinGPerMeal}g protein per portion.` : ""}
${t.fiberGPerMeal ? `Aim for at least ${t.fiberGPerMeal}g fibre per portion.` : ""}
Prefer dishes that use what's already in the pantry, and put anything marked LOW in the first three days: ${stock || "(pantry is empty)"}.
Return ONLY a JSON array, no markdown, one object per planned meal:
[{"date":"YYYY-MM-DD","slot":"dinner","title":"Dal Tadka","note":"short method in 1-2 sentences","ingredients":["toor dal","cumin seeds"],"prep":[{"label":"Soak toor dal","leadHours":2}],"proteinGPerPortion":18}]`;
  }

  app.post("/api/meals/menu/plan", requireAuth, requireFamily, requireParent, async (req, res) => {
    const body = req.body || {};
    const days = Math.min(Math.max(parseInt(body.days, 10) || 7, 1), 14);
    const slots = (Array.isArray(body.slots) && body.slots.length ? body.slots : ["dinner"])
      .filter((s) => ["breakfast", "lunch", "dinner"].includes(s));
    if (!slots.length) return res.status(400).json({ error: "slots must include breakfast, lunch, or dinner." });

    const state = meals.getState(req.family.id);
    const prefs = state.prefs;
    const { terms, household } = householdExcludeTerms(req.family, prefs);
    const dates = planDates(body.startDate, days);
    const allowProtein = anyParentOptedIn(req.family);

    let planned = [];
    let source = "pantry";

    // AI path. Any failure — unconfigured, network, quota, unparseable, or an
    // allergen-filtered empty result — falls through to the deterministic
    // planner rather than surfacing an error: a household asking for a week's
    // menu should always get one.
    if (process.env.ANTHROPIC_API_KEY && ai.checkAndBumpQuota) {
      if (!ai.checkAndBumpQuota(req.user.id)) {
        return res.status(429).json({ error: `You've hit today's limit of ${ai.DAILY_QUOTA} AI requests — please try again tomorrow.` });
      }
      let items = null;
      try {
        items = await callPlannerModel(plannerPrompt({ dates, slots, household, prefs, terms, pantry: state.pantry }));
      } catch (e) { items = null; }
      if (Array.isArray(items)) {
        const kept = items.filter((it) => it && it.title && !violatesExclusions(it, terms));
        if (kept.length) { planned = kept; source = "ai"; }
      }
    }

    // Deterministic fallback — the recipe library, filtered by the same diets,
    // allergens and macro floors. This is why the library exists.
    if (!planned.length) {
      const picks = recipes.suggest(state.pantry, {
        count: dates.length * slots.length,
        slots,
        avoid: prefs.avoid || [],
        allergens: terms,
        diets: prefs.diets || [],
        minProteinG: (prefs.targets && prefs.targets.proteinGPerMeal) || undefined,
        minFiberG: (prefs.targets && prefs.targets.fiberGPerMeal) || undefined,
      });
      let i = 0;
      for (const date of dates) {
        for (const slot of slots) {
          const r = picks[i++];
          if (!r) break;
          planned.push({ date, slot, recipeId: r.id });
        }
      }
      source = "pantry";
    }

    const written = [];
    for (const item of planned) {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || "")) ? item.date : dates[0];
      const slot = slots.includes(item.slot) ? item.slot : slots[0];
      meals.clearMenuSlot(req.family.id, date, slot);
      const opts = item.recipeId
        ? { date, slot, recipeId: item.recipeId, servesPortions: household.totalPortions, allowProtein }
        : {
            date, slot,
            title: item.title,
            note: item.note,
            prep: item.prep,
            // §6.2: pantry membership is recomputed here from the returned
            // ingredient NAMES; whatever ids the model invented are ignored.
            usesItemIds: meals.matchPantryItemsForRecipe({ ingredients: (item.ingredients || []).map((n) => ({ name: n })) }, state.pantry),
            servesPortions: household.totalPortions,
            allowProtein,
            proteinG: allowProtein ? item.proteinGPerPortion : null,
          };
      const result = meals.addMenuEntry(req.family.id, req.user.id, opts);
      if (result.entry) {
        meals.stampPrepSchedule(req.family.id, result.entry.id);
        written.push(result.entry);
      }
    }

    if (!written.length) return res.status(422).json({ error: "Couldn't build a menu from your pantry and preferences yet — add a few staples and try again." });

    // One card per plan, never per meal (§7). Chat must never fail the plan.
    try {
      const lines = written.slice(0, 7).map((e) => `${e.date}: ${e.title}`).join("\n");
      chat.sendMessage(req.family.id, {
        senderType: "parent",
        senderId: req.user.id,
        postedByUserId: req.user.id,
        text: `This week's menu:\n${lines}`,
        card: { type: "menu", id: written[0].id, title: "This week's menu" },
      });
    } catch (e) { /* chat must never block the plan */ }

    res.json({ menu: meals.getState(req.family.id).menu, source });
  });

  // ===================== prep reminder sweep (§7) =====================
  // No scheduler in this repo, so due reminders go out when the family next
  // touches Meals. Idempotent: each prep step is stamped once.
  async function sweepPrepReminders(req) {
    try {
      const due = meals.duePrepReminders(req.family.id);
      for (const d of due) {
        meals.markPrepNotified(req.family.id, d.entryId, d.prepId);
        await notifications.notifyMealPrep({
          familyParentIds: req.family.parentIds || [],
          label: d.label, mealTitle: d.mealTitle, mealId: d.entryId, leadHours: d.leadHours,
        });
      }
    } catch (e) { /* reminders must never block a Meals request */ }
  }

  app.post("/api/meals/prep/sweep", requireAuth, requireFamily, requireParent, async (req, res) => {
    await sweepPrepReminders(req);
    res.json({ ok: true });
  });

  app.post("/api/meals/menu/:id/cooked", requireAuth, requireFamily, requireParent, (req, res) => {
    if (!meals.getMenuEntry(req.family.id, req.params.id)) return res.status(404).json({ error: "Menu entry not found." });
    const result = meals.cookMenuEntry(req.family.id, req.user.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ entry: result.entry, pantry: result.pantry });
  });

  // ===================== shopping =====================
  // Parents only, like the rest of Meals (owner decision 2026-08-03: meal
  // planning is a parent tool). The earlier kid tick-off carve-out is gone —
  // `requireParent` now gates every route in this file, so there is no
  // role-branching left inside any handler.

  app.post("/api/meals/shopping", requireAuth, requireFamily, requireParent, (req, res) => {
    const body = req.body || {};
    const result = meals.addShoppingItem(req.family.id, req.user.id, {
      text: body.text, category: body.category, assigneeUserId: body.assigneeUserId,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ item: result.item });
  });

  app.patch("/api/meals/shopping/:id", requireAuth, requireFamily, requireParent, (req, res) => {
    if (!meals.getShoppingItem(req.family.id, req.params.id)) return res.status(404).json({ error: "Shopping item not found." });
    const body = req.body || {};
    const result = meals.updateShoppingItem(req.family.id, req.user.id, req.params.id, {
      done: body.done, text: body.text, assigneeUserId: body.assigneeUserId,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ item: result.item });
  });

  app.delete("/api/meals/shopping/:id", requireAuth, requireFamily, requireParent, (req, res) => {
    if (!meals.getShoppingItem(req.family.id, req.params.id)) return res.status(404).json({ error: "Shopping item not found." });
    const result = meals.removeShoppingItem(req.family.id, req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  app.post("/api/meals/shopping/from-pantry", requireAuth, requireFamily, requireParent, (req, res) => {
    const result = meals.seedShoppingFromPantry(req.family.id, req.user.id);
    res.json({ items: result.items });
  });

  app.post("/api/meals/shopping/restock", requireAuth, requireFamily, requireParent, (req, res) => {
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

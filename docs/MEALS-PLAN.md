# Fam ETC — Meals (fametc.com/meals)

> Adapted 2026-08-01 from a design originally written for FitOdds
> (`docs/WEEKLY-MENU.md` on that repo). The owner's call: it fits a family hub
> better than a solo fitness app. This is the FamETC contract — data model,
> API, permissions, integration points. Nothing is built yet.
>
> Companion docs: [APP-BRIEF.md](../APP-BRIEF.md) (contract),
> [TRIPS-PLAN.md](TRIPS-PLAN.md) (the patterns this reuses).

## 0. Why it fits here better

FitOdds needed a thesis argument to justify household data ("the GLP-1 user
doesn't cook for themselves"). Fam ETC needs none: the brief already promises
"school calendars, homework, activities, goals, and family chat" — *and
dinner* is the most-negotiated recurring item in any household with kids.
Meals is the etcetera the hub is named for.

It also lands on machinery that already exists here and didn't exist there:
a family model, a shared calendar, group chat, push to every member, an
image-parsing AI proxy, encryption at rest, and (as of Trips) a shared
checklist pattern with a kid-write carve-out. Most of the FitOdds design
survives; the parts that don't are the parts that were compensating for a
solo-user app.

## 1. What carries over, what changes

| FitOdds design | Fam ETC | Why |
|---|---|---|
| Pantry as a 4-rung ladder (plenty/some/low/out), never grams | **Keep verbatim** | The insight holds: grams are what nobody maintains. |
| Restock by checking off the shopping list | **Keep — and it gets better** | Reuses the Trips checklist pattern, and here a *kid* can tick items off at the shop (kid-write carve-out precedent, already tested). |
| Cooking steps items down one rung, stops at `low`; only a human says `out` | **Keep verbatim** | Prevents the app confidently claiming an empty pantry. |
| `PantryEvent` audit log so undo works and "why does it think I'm low on rice?" is answerable | **Keep verbatim** | Cheap, and it's the difference between trust and mystery. |
| Shelf photo → dedicated `/api/pantry-scan` | **Fold into the existing `/api/ai/parse`** as `kind: "pantry"` | That route already does image + env-gated key + 20/day quota + fenced-JSON. A new endpoint would duplicate it. |
| Menu plan from what's left, low/near-expiry items prioritised into the first three days | **Keep verbatim** | The core value. |
| Server recomputes pantry membership rather than trusting the model | **Keep — and extend to allergens** (§6) | Same model-trust discipline used for Trips. |
| Soak/sprout prep reminders; quiet-hours conflicts shift **backward** | **Keep the rule, drop the budget** | Fam ETC has no engagement budget to be exempt from. Backward-shift stays: the lead time exists because the soak takes 10 hours. |
| Frozen `FITNESS-MATH §15` + `Core/HouseholdMath.swift` protein bands | **Does not port** | No frozen-math discipline here, and see §2. |
| Per-person protein targets incl. children | **Replaced by portion scaling** | See §2 — this is the one decision that needs your sign-off. |
| Household data stays on-device | **Server-side, encrypted at rest** | The family already lives on the server. Privacy is enforced at the *AI boundary* instead (§6). |
| GLP-1 / HealthKit / engagement budget | **Dropped** | FitOdds constructs. |

## 2. ⚠ The one decision: protein targets for kids

The FitOdds design's centrepiece computes per-person protein from age, sex,
weight and activity — for every household member, children included. Porting
that verbatim would mean:

1. **Storing children's body weight, age and sex** in an app whose brief says,
   as a contract row: *"Collect the minimum for kid profiles (name, grade,
   color); no kid emails required."* Kid profiles today hold exactly that and
   nothing else. Adding body weight is a material change to the kid-data
   posture, not an incremental field.
2. **Showing a minor a numeric daily protein goal** in a parent-facing app
   rated 4+. Numeric nutrition targets for adolescents carry real
   disordered-eating risk, and they invite App Store health-claim scrutiny
   that the current listing deliberately avoids.

**Recommendation — portion scaling, not per-kid nutrition targets.** The
actual question a parent needs answered is *"how much do I cook?"*, and that
is answered by portions:

- Each member has a `portion` factor: `small` (0.6) · `regular` (1.0) ·
  `big` (1.4), set by a parent, defaulting to `small` for kids and `regular`
  for adults. No weight, no age, no sex, no calculation about a child's body.
- Recipes scale by the household's summed portion factor. "Dinner for 3.6
  portions" is honest, useful, and says nothing about anyone's body.
- **Optional, adults only, opt-in:** a parent may set their own protein
  target (a plain number they type, or eventually one imported from a fitness
  app — that math belongs in FitOdds, not here). It surfaces as a per-meal
  protein estimate on the menu, only for the adult who opted in.
- Allergies and dislikes live on every member (§3) — that's what the FitOdds
  "clinician protein-restricted" carve-out becomes here, and it's needed for
  menu planning regardless.

This keeps the useful 90% (plan meals, cook the right amount, use what you
have) and drops the part that would put children's body data in a family
planner. **If you want per-kid nutrition targets anyway, say so and I'll
write it up — but it changes an APP-BRIEF contract row and should be an
explicit, recorded decision, not a side effect of this port.**

## 3. Data model

`root.meals[familyId]` (db.json, whole-file encrypted at rest):

```js
{
  pantry: [{
    id: "pi_"+hex9,
    name,                      // ≤80, e.g. "Basmati rice"
    category,                  // produce|protein|dairy|grain|pantry|frozen|spice|other
    level,                     // "plenty"|"some"|"low"|"out"
    unitHint,                  // ≤40 free text, e.g. "1 kg bag" — display only
    expiresOn | null,          // "YYYY-MM-DD", optional
    updatedAt, updatedBy,
  }],
  pantryEvents: [{             // audit trail, capped at 200
    at, userId, itemId, from, to,
    source,                    // "manual"|"scan"|"shopping"|"cooked"|"undo"
  }],
  menu: [{                     // the current plan; one entry per planned meal
    id: "mm_"+hex9,
    date: "YYYY-MM-DD",
    slot,                      // "breakfast"|"lunch"|"dinner"
    title,                     // ≤120
    note,                      // ≤1000, method/notes
    usesItemIds: [pantryItemId],
    prep: [{ id, label ≤80, leadHours }] | [],   // soak/marinate/thaw/sprout
    proteinG | null,           // display-only estimate; null unless an adult opted in
    servesPortions,            // number, the summed portion factor it was planned for
    source,                    // "ai"|"manual"
    createdBy, createdAt,
  }],
  shopping: [{                 // ONE list per family (not per trip — see §5)
    id: "si_"+hex9,
    text ≤200,
    category,                  // same set as pantry
    pantryItemId | null,       // set when it came from a low/out pantry item
    assigneeUserId | null,     // may be a KID user — see §4
    done, doneBy | null, doneAt | null,
    addedBy, createdAt,
  }],
  prefs: {
    dinnerTime: "18:30",       // used for prep-reminder lead times + calendar
    cuisines: [String ≤40],    // liked, max 12
    avoid: [String ≤40],       // household-wide dislikes, max 20
  },
}
```

Per-member fields (extend the existing records, not a new roster — the family
already IS the household):
- `family.kids[].portion` and `family.kids[].allergies: [String ≤40]`
- parent equivalents on `user.data.profile.portion` / `.allergies`, plus the
  opt-in `.proteinTargetG | null`

No new "household member" concept. A family of 2 parents + 2 kids is already
modelled; duplicating it would create two sources of truth.

## 4. Permissions

| Action | Parent | Kid |
|---|---|---|
| View pantry, menu, shopping list | ✓ | ✓ |
| Edit pantry levels, scan shelves | ✓ | — |
| Generate / edit / delete menu entries | ✓ | — |
| Add items to the shopping list | ✓ | ✓ *(their own additions only)* |
| **Tick shopping items done** | ✓ | ✓ |
| Set portions / allergies for anyone | ✓ | — |
| Edit prefs (dinner time, cuisines, avoid) | ✓ | — |

The kid write surface is deliberately the shopping list only — the same
carve-out shape as Trips packing lists (`requireFamily` + per-handler
ownership checks; a kid ticking "milk" at the shop is the point). Everything
else is parent-gated with `requireParent`.

## 5. API surface

All under `requireAuth, requireFamily` (family-scoped, unlike trips), house
conventions: `{thing}` / `{error}`, `Cache-Control: no-store` on GETs,
`db.persist()` per mutation.

```
GET    /api/meals                          → {pantry, menu, shopping, prefs, household}
                                             // household = portion/allergy summary, no weights
PATCH  /api/meals/prefs                    {dinnerTime?, cuisines?, avoid?} → {prefs}

POST   /api/meals/pantry                   {name, category, level, unitHint?, expiresOn?} → {item}
PATCH  /api/meals/pantry/:id               {level?|name?|category?|expiresOn?} → {item}
DELETE /api/meals/pantry/:id               → {ok}
POST   /api/meals/pantry/bulk              {items:[…]} → {items}   // scan confirm + shopping restock
POST   /api/meals/pantry/undo              {eventId} → {item}      // reverse one PantryEvent

POST   /api/meals/menu/plan                {days=7, slots=["dinner"]} → {menu}   // AI, see §6
POST   /api/meals/menu                     {date, slot, title, note?, prep?, usesItemIds?} → {entry}
PATCH  /api/meals/menu/:id                 → {entry}
DELETE /api/meals/menu/:id                 → {ok}
POST   /api/meals/menu/:id/cooked          → {entry, pantry}       // steps usesItemIds down one rung, floor `low`

POST   /api/meals/shopping                 {text, category?, assigneeUserId?} → {item}   // kids allowed
PATCH  /api/meals/shopping/:id             {done?|text?|assigneeUserId?} → {item}        // kids: done only
DELETE /api/meals/shopping/:id             → {ok}
POST   /api/meals/shopping/from-pantry     → {items}   // seed from every low/out pantry item
POST   /api/meals/shopping/restock         → {items, pantry}  // ticked items → pantry `plenty`
```

Image scan reuses the existing proxy: `POST /api/ai/parse` with
`kind: "pantry"` → `[{name, category, levelGuess, unitHint}]`, always
presented as an **editable confirm sheet** — a scan never writes the pantry
directly.

## 6. AI boundary (hard invariants)

`POST /api/meals/menu/plan` is a stateless Claude call through the existing
env-gated proxy pattern (`ANTHROPIC_API_KEY`, shared daily quota, fenced-JSON
stripping, 503 unconfigured / 422 unusable / 429 over quota).

1. **No names leave the device boundary.** The prompt receives counts and
   factors — `"4 eaters, 3.6 portions, avoid: mushrooms, allergens: peanut,
   sesame"` — never a kid's name, grade, or id. Menu entries come back keyed
   to slots, and the server re-attaches ids.
2. **Pantry membership is recomputed server-side.** `usesItemIds` returned by
   the model is discarded and rebuilt by matching returned ingredient names
   against the real pantry. The model never decides what you own.
3. **Allergens are enforced deterministically, server-side.** Every returned
   entry is dropped if its text matches any household allergen or avoid term
   (normalised substring match, plus a small synonym table: peanut/groundnut,
   sesame/tahini, milk/dairy…). The model is never trusted to have honoured
   the constraint.
4. **Allergy safety is never claimed.** The UI states plainly that suggestions
   are a starting point and the cook checks labels. An LLM meal suggestion is
   the one way this feature could actually hurt someone; the copy and the
   filter both have to hold.
5. **Protein numbers are display-only.** Clamped to a sane range, never fed
   into any other calculation, never a health claim.

## 7. Integration with what already exists

- **Calendar.** Tonight's dinner appears on the family calendar via the same
  synthetic-event merge Trips uses: `GET /api/calendar/events` appends
  read-only entries (`id: "meal_ev_<id>"`, `source: "menu"`,
  `category: "other"`, `canEdit: false`) at `prefs.dinnerTime`. **The native
  iOS calendar gets this with zero app changes** — same trick, already proven.
- **Chat.** "What's for dinner?" is the most-asked question in any family
  chat. Planning a week posts one card message to family chat (the existing
  event-card pattern); `POST /api/meals/menu/:id/cooked` optionally posts
  "Dinner tonight: …". Low-noise: one card per plan, not per meal.
- **Push.** `lib/fam-notifications.js` gains `notifyMealPrep` (soak/thaw
  reminders, to parents only) and reuses the shopping-list nudge path for
  "assigned you: milk". Prep reminders are a user-requested utility: capped at
  3/day, and a quiet-hours conflict shifts the reminder **earlier**, never
  later.
- **Today.** A "Tonight" card (dinner title + any prep due today) and, for
  kids, a read-only version — one of the few Today items a kid actually cares
  about.
- **iOS.** Web surface at `/meals` in `HybridWebView` (second webview after
  Trips). The native document scanner (`ScannerService`, Vision OCR) is the
  natural shelf-photo path but is **currently unwired** — see the iOS note in
  CLAUDE.md; until the bridge is re-wired into `HybridWebView`, iOS uses the
  ordinary file-picker path like the web.

## 8. Milestones (each independently shippable)

- **M1 — Pantry + shopping list.** Store, routes, `/meals` page with the
  ladder, the one family shopping list with kid tick-off, restock→pantry, undo
  from `PantryEvent`. No AI, no calendar. Useful alone: it replaces the fridge
  whiteboard.
- **M2 — Menu + calendar + Today.** Manual menu entries, `cooked` stepping the
  pantry down, calendar merge, Today "Tonight" card. Still no AI.
- **M3 — AI planning + shelf scan.** `/menu/plan`, `kind: "pantry"` on the
  parse route, confirm sheets, allergen filter + copy.
- **M4 — Prep reminders + chat cards.** `notifyMealPrep`, quiet-hours
  back-shift, chat card on plan.

Portions/allergies (§2) land in M1 as plain profile fields.

## 8b. Recipe library — Indian + Thai first (owner decision 2026-08-01)

The library is deliberately **over-indexed on Indian and Thai food** (this is
a Bangkok household with an Indian kitchen). Target mix: roughly half North/
South Indian, a third Thai, the remainder everything-else so a week doesn't
get monotonous. It ships as seed data in `lib/recipes.js` — no database, no
network, no user editing in v1 — which is what makes M1/M2 useful with the AI
switched off entirely.

It also makes the prep-reminder feature earn its place: dal and rajma soak
overnight, chole wants 8 hours, idli/dosa batter ferments for 12, moong
sprouts over 2 days, tandoori marinates for 4. Those lead times are the whole
reason `prep[].leadHours` exists.

```js
recipe = {
  id: "rc_dal_tadka",                 // stable, hand-written
  title: "Dal Tadka",
  cuisine: "indian"|"thai"|"other",
  region,                             // "north-indian"|"south-indian"|"thai"|…
  slots: ["dinner","lunch"],
  veg: true,
  spice: 0..3,                        // 0 none … 3 hot
  kidFriendly: true,                  // drives the kid-safe filter
  timeMins: 35,                       // active cooking time
  prep: [{ label: "Soak toor dal", leadHours: 2 }],
  ingredients: [{ name, category, core: true|false, qtyHint }],
                                      // `core` = the dish is not itself without it
  steps: [String],                    // 3–8 short lines, not prose
  proteinGPerPortion: 14,             // display-only estimate (§6.5)
  allergens: ["dairy","peanut",…],    // feeds the deterministic filter
  tags: ["one-pot","weeknight",…],
}
```

Exported helpers (pure, no db/network — the deterministic engine behind M2 and
the fallback when AI is unconfigured):

- `all()` / `byId(id)` / `search({cuisine, veg, slot, kidFriendly, maxTimeMins, query})`
- `coverage(recipe, pantryItems)` → `{ have, missing, coreMissing, ratio }`
  where a pantry item matches by normalised name/synonym and `level !== "out"`
- `suggest(pantryItems, { count, slots, avoid, allergens, kidSafe, cuisineBias })`
  → recipes ranked by core-coverage, then by how many `low`/near-expiry items
  they consume, then variety (no cuisine three days running). Allergen and
  avoid terms are hard filters, never ranking penalties.

`cuisineBias` defaults to Indian+Thai weighting; the AI planner (§6) gets the
same bias in its prompt, and its output is still filtered through the same
allergen rules.

## 9. Open questions

1. **§2 — portion scaling vs. per-kid protein targets.** My recommendation is
   portions; per-kid nutrition targets need an explicit APP-BRIEF decision.
2. **One shopping list or many?** Assumed one family list (a household has one
   fridge). Trips-style multiple named lists are possible but probably
   over-modelled for groceries.
3. **Does the menu need lunch/breakfast at launch, or dinner-only?** Slots are
   in the model; the UI could ship dinner-only and stay simpler.
4. **Recipe bodies.** Currently `title` + free-text `note`. Full structured
   recipes (ingredients, steps, times) are a much bigger feature — worth
   deciding before M3 whether AI output should populate structure or prose.
5. **Kid visibility of the menu** — assumed yes, read-only. Confirm that's
   wanted (some families treat the menu as a parent tool).

# Fam ETC — Trips (fametc.com/trips) implementation plan

> Decided 2026-07-31 with the owner. Trips lets a parent plan a vacation with
> OTHER ADULTS (outside the family): shared itinerary with voting + comments,
> flights, lodging, a per-trip chat room, invite links, and trip events merged
> into the family calendar. UX reference: the "Waypoint" mock (same Horizon
> tokens as this app — port 1:1). This extends APP-BRIEF.md; it does not change
> any Identity/Design row.

## Owner decisions (2026-07-31)
| Question | Decision |
|---|---|
| Guest access | Invite link → **free passkey "trip guest" accounts** (no family, no billing). They see only trips they're a member of. |
| Kids | **Read-only**: kids see itinerary/flights/lodging of trips their family is on. No votes, edits, or trip chat. |
| Chat | **Per-trip chat room** on the existing chat engine (encrypted at rest, push). Family chat untouched. |
| Platform | **Trip chat + trip calendar events work in the NATIVE iOS app**; the rest of the trips UI is a webview surface at /trips. |
| Billing | No paywall on trips in v1 (consistent with the rest of the app — no gate is enforced anywhere yet). |

## Why the architecture falls out this way (from the code audit)
- The family model hard-caps `MAX_PARENTS = 2` (lib/family.js:27) and
  `requireFamily` assumes one family per user (server.js:342) → **a trip is its
  own scope object with its own member list**, resolved by a `requireTrip`
  middleware, never via `req.family`.
- User records are family-agnostic (family membership lives only in
  `fam.parentIds` / `user.data.kid`) → a **guest is just a normal passkey
  signup with zero families**. No auth changes needed.
- There is no email infrastructure → invites are a **shareable high-entropy
  link**, like the family invite code but link-grade (24+ chars, revocable).
- The chat store treats `family_id` as an opaque scope key (lib/chat-store.js);
  the only family coupling is two permission checks in lib/chat.js → trip
  rooms use scope id **`trip:<tripId>`** through the same store, emitter
  registry, and long-poll pattern.
- iOS native calendar renders whatever `GET /api/calendar/events` returns
  (`FamilyEvent` model, multi-day + `canEdit` already supported) → **the server
  merges read-only trip-derived events into that response** and the native
  calendar needs zero app changes.
- iOS native chat is single-room today (one loop, one cursor, one unread key)
  → the app gains a **room list** (Family + one per trip) and a parameterized
  `ChatScreen(roomId:title:)`; the wire model gains optional `roomId` +
  `senderName` fields (optional = old builds keep decoding).

## Data model (db.json — whole-file encrypted at rest already)
Top-level `root.trips[tripId]`:

```js
trip = {
  id: "trip_" + hex9,            // fam_ prefix rule applies to STORAGE KEYS, ids follow goals/events style
  name,                          // ≤80
  destination,                   // ≤120, free text ("Lisbon, PT")
  startDate, endDate,            // "YYYY-MM-DD"
  ownerUserId,
  familyId,                      // owner's family at creation (may be null for guests-turned-owners)
  members: [{ userId, role: "owner"|"editor", joinedAt }],   // MAX_TRIP_MEMBERS = 12
  inviteCode,                    // 24-char high-entropy (CODE_ALPHABET), regenerable; null = link disabled
  itinerary: [{                  // flat list; day grouping is derived from `date`
    id: "ti_" + hex9,
    date: "YYYY-MM-DD", time: "HH:MM" | "",
    title,                       // ≤200
    category: "food"|"sight"|"activity"|"transit"|"stay",
    note,                        // ≤1000
    order,                       // integer; per-day ordering for drag-reorder
    votes: [userId],
    comments: [{ id: "tc_"+hex9, userId, text ≤1000, createdAt, flagged, flagReason, flaggedBy }],
    createdBy, createdAt,
  }],
  flights: [{ id: "tf_"+hex9, airline, flightNo, confirmation, from, to,   // from/to ≤8 upper
              departs, arrives,  // free text ("Jun 3, 21:50") — v1 keeps Waypoint's paste-from-email grain
              travelerUserIds: [userId], createdBy, createdAt }],
  lodging: [{ id: "tl_"+hex9, name, address, confirmation, checkIn, checkOut, note, createdBy, createdAt }],
  activity: [{ at, userId, text }],  // "Latest from the crew" feed, capped at last 50
  createdAt,
}
```

Trip chat messages live in the existing chat store under scope id
`"trip:" + tripId` (SQLite `family_id` column holds the scope key; body/card
stay field-encrypted as today).

## Permission matrix
| Action | Owner | Editor | Kid (family read-only) | Non-member |
|---|---|---|---|---|
| View trip (all tabs except chat) | ✓ | ✓ | ✓ (GET only) | — |
| Edit itinerary/flights/lodging, vote, comment | ✓ | ✓ | — | — |
| Trip chat (read/send) | ✓ | ✓ | — | — |
| Invite link view/copy | ✓ | ✓ | — | — |
| Regenerate/disable invite link | ✓ | — | — | — |
| Remove member / delete any comment or chat message / delete trip | ✓ | own only | — | — |
| Rename trip / change dates | ✓ | ✓ | — | — |

Kid access rule: `user.data.kid.familyId` matches `trip.familyId` OR any trip
member is a parent in the kid's family. Enforced in `lib/trips.js
accessFor(user, trip) -> "member"|"kid-read"|null`; the route layer checks it
(goals.canAccess precedent). Apple UGC (1.2) obligations: comments and trip
chat get flag/report + owner-delete-any + member removal (all in v1).

## API surface (contract — build exactly this)
All under `requireAuth`; `requireTrip` resolves `:tripId` → 404 unknown, 403
non-member (kid-read passes GETs only). Kid sessions are rejected from all
mutating routes and from chat. `Cache-Control: no-store` on GETs.

```
POST   /api/trips                          {name, destination, startDate, endDate} → {trip}
GET    /api/trips                          → {trips:[summary]}   // member OR kid-read; summary = id,name,destination,dates,role,counts,memberFaces
GET    /api/trips/:tripId                  → {trip: publicTrip}  // full, with per-member {userId,name,initial,color,role}; votes as userIds; myRole
PATCH  /api/trips/:tripId                  {name?,destination?,startDate?,endDate?} → {trip}
DELETE /api/trips/:tripId                  owner only → {ok}

POST   /api/trips/:tripId/invite/regenerate   owner → {inviteCode}
POST   /api/trips/:tripId/invite/disable      owner → {ok}
GET    /api/trips/join/:code               → {trip:{id,name,destination,dates,memberCount}}  // preview, requireAuth
POST   /api/trips/join/:code               → {trip}              // adds session user as editor; idempotent if already member
DELETE /api/trips/:tripId/members/:userId  owner (or self-leave) → {ok}

POST   /api/trips/:tripId/itinerary        {date,time,title,category,note} → {item}
PATCH  /api/trips/:tripId/itinerary/:id    {date?,time?,title?,category?,note?} → {item}
POST   /api/trips/:tripId/itinerary/:id/move  {date, beforeId|null} → {trip}   // drag: move + reorder
DELETE /api/trips/:tripId/itinerary/:id    → {ok}
POST   /api/trips/:tripId/itinerary/:id/vote     toggle for session user → {item}
POST   /api/trips/:tripId/itinerary/:id/comments {text} → {comment}
DELETE /api/trips/:tripId/itinerary/:id/comments/:cid   owner or author → {ok}
POST   /api/trips/:tripId/itinerary/:id/comments/:cid/flag {reason?} → {ok}

POST   /api/trips/:tripId/flights          {airline,flightNo,confirmation,from,to,departs,arrives,travelerUserIds?} → {flight}
PATCH  /api/trips/:tripId/flights/:id      → {flight}
DELETE /api/trips/:tripId/flights/:id      → {ok}
POST   /api/trips/:tripId/lodging          {name,address,confirmation,checkIn,checkOut,note} → {lodging}
PATCH  /api/trips/:tripId/lodging/:id      → {lodging}
DELETE /api/trips/:tripId/lodging/:id      → {ok}

GET    /api/trips/:tripId/chat/messages    ?afterId&wait=1 | ?since&limit   → {messages}   // long-poll, same semantics as family chat
POST   /api/trips/:tripId/chat/messages    {text, media?} → {message}      // members only (no kids); message gains senderName
DELETE /api/trips/:tripId/chat/messages/:id   owner or author → {ok}
POST   /api/trips/:tripId/chat/messages/:id/flag {reason?} → {ok}
```

Chat wire additions (backward compatible): trip messages carry
`roomId: "trip:<tripId>"` and `senderName` (resolved from trip member names —
guests aren't family members, so the client can't resolve them). Family chat
responses also gain `senderName` (harmless for old clients; optional decode).

`GET /api/chat/rooms` (new, requireAuth): `[{roomId:"family", title, unreadHint?},
{roomId:"trip:<id>", tripId, title: trip.name, memberCount}]` — drives the iOS
room list; family entry omitted for guests with no family.

### Calendar merge (native iOS + web calendar for free)
`GET /api/calendar/events` additionally returns, for every trip where a family
parent is a member (and for kid sessions via the kid-read rule), read-only
synthetic events (`canEdit:false`, `source:"trip"`, `category:"trip"` —
categories are display-only strings on both clients):
- one spanning event per trip (`date=startDate, endDate=endDate`, title
  `✈ <trip name>`), id `trip_ev_<tripId>`
- one event per flight (parsed date when parseable, else trip startDate) and
  per lodging check-in/check-out, ids `trip_ev_<tripId>_<itemId>`
Synthetic ids never collide with `ev_` ids; PATCH/DELETE on them 404 (client
hides controls via `canEdit:false`). Itinerary items do NOT flood the family
calendar in v1 — the trip page is their home.

### Notifications (lib/fam-notifications.js additions)
`notifyTripChatMessage(trip, senderUserId, text)` and
`notifyTripEvent(trip, actorUserId, text)` — fan out APNs + web push to
`trip.members[].userId` minus actor (registries are userId-keyed already, so
guests get push with zero changes). `thread-id: "trip-<tripId>"`,
`famType: "trip_chat_message" | "trip_update"`, `data.url: "/trips/<tripId>"`.
Triggers: chat message; member joined; itinerary add; flight/lodging add.
Push never blocks the response (existing try/catch convention).
Every mutation also appends to `trip.activity` ("Latest from the crew").

## Web UI (standalone page — the billing.html precedent)
New files (Horizon tokens, dark mode, responsive; no bundler, house style):
- `public/trips.html` — shell for BOTH the trips list and the trip hub;
  `location.pathname` decides (`/trips` vs `/trips/<id>`; history.pushState
  between them). Loads `horizon.css + styles.css + trips.css`, `auth.js +
  util.js + trips.js`.
- `public/js/trips.js` — state + render, ports the Waypoint mock: header
  (trip name, dates, member avatar stack, Invite button), tab nav
  **Overview / Itinerary / Flights / Lodging / Chat / People**; Overview =
  stat cards, next flight, home base, crowd favorites, activity feed;
  Itinerary = day sections, HTML5 drag-reorder/move calling `/move`,
  ♥ vote toggles, comment threads, add/edit form with category select;
  Flights + Lodging = card lists + add forms per the mock; People = invite
  link copy + member list with roles + remove (owner); Chat = trip room using
  the same long-poll pattern as app.js chat. Kid sessions render read-only
  (no forms/votes/chat tab). Fetch via new `window.auth.trips*` wrappers.
- `public/css/trips.css` — feature-scoped (app.css precedent).
- `public/trip-join.html` + small inline script — public landing for
  `/trips/join/<code>`: shows trip preview; signed-in → one-tap join;
  signed-out → passkey signup/sign-in (reuses auth.js) with
  `next=/trips/join/<code>`, then auto-join → redirect to `/trips/<id>`.

Server page routes (server.js): `/trips`, `/trips/:id` → `requireAuth` →
trips.html (parents, kids, guests all pass; page scopes itself);
`/trips/join/:code` → public → trip-join.html (login/signup pages already
honor `?next=`). Add `/trips` to the sitemap? No — private. Sidebar: add a
"Trips" nav item to index.html that links to `/trips` (plain href, separate
page — no switchNavTab work). Guests with zero families who land on `/` get
redirected client-side to `/trips` instead of the create-family first-run
panel when they belong to ≥1 trip.

## iOS (ships via TestFlight later; server is backward compatible either way)
1. **Calendar: no changes required** — trip events arrive through the
   existing `GET /api/calendar/events` (`FamilyEvent` decode unchanged;
   `canEdit:false` hides editing). Optional polish: color/icon branch for
   `category == "trip"` in AgendaRow/MonthCalendarView; raise the 62-day
   expand cap in Agenda.swift:93 for long trips.
2. **Chat multi-room**: `ChatMessage` gains optional `roomId`/`senderName`;
   `APIClient.chatMessages/sendChatMessage` gain a room parameter (family room
   keeps the legacy endpoints; trip rooms call `/api/trips/:id/chat/messages`);
   `AppStore` keys messages/cursor/lastSeen per room (`[String: …]`,
   UserDefaults `fam_last_seen_chat_<roomId>`, migrating the legacy key to the
   family room); Chat tab becomes a room list (`GET /api/chat/rooms`) →
   `ChatScreen(roomId:title:)`; iPad docked column keeps the family room with
   a room switcher menu; badge = sum of per-room unread. `senderName` from the
   wire wins over family-member resolution. Keep dedupe/mergeIncoming as the
   single upsert path (ChatMergeTests must stay green); `CachedAppData` gains
   an optional per-room field (back-compat rule).
3. **Trips webview**: `TripsScreen { HybridWebView(path: "/trips") }` as a new
   `Tab.trips` case in all three layouts, inset by `Layout.tabBarClearance`;
   revisit FloatingTabBar spacing at 6 icons. (Bridge re-wiring stays out of
   scope per docs/ARCHITECTURE-PLAN.md.)
4. **Push routing**: handle `famType: trip_chat_message/trip_update` in
   NotificationHandler; minimal v1 = select Chat tab/room on tap (deep-link
   infra is otherwise absent — full routing is a follow-up).

Note: this session cannot compile Swift; iOS changes are code-reviewed only
and must be built + TestFlighted from a Mac.

## Security
- Invite codes: 24 chars from the unambiguous alphabet (~118 bits), constant
  no-existence-leak errors on join, owner regenerate/disable, member cap 12.
- Trip routes never consult `req.family`; every handler re-derives access via
  `trips.accessFor` (ownership never trusted from the body — homework.js rule).
- Rate limits: existing global `/api` limiter covers trips; join endpoint
  additionally behind `authLimiter`-grade limiter to slow code scanning.
- All trip data encrypted at rest via db.json whole-file encryption; chat via
  chat-store field encryption. No new secrets, no third-party APIs (CSP stays).

## Tests (node --test, house patterns)
- `tests/trips.test.js` — lib-level: create/join/roles/caps, invite regenerate
  + disable, itinerary CRUD/move/vote/comment, flights/lodging, accessFor
  matrix (owner/editor/kid/none), activity feed cap.
- `tests/trips-routes.test.js` — route-harness style (calendar-routes
  precedent): permission enforcement per route, kid read-only, join flow,
  chat routes with stubbed chat lib, calendar merge output shape.
- `tests/client-bundle.test.js` — must stay green (trips.js is a separate
  page bundle; add an equivalent concat check for trips.html's script set).
- Existing chat tests must stay green (scope-key generalization is additive).

## Phases → session tasks
| Phase | Contents | Task |
|---|---|---|
| A | lib/trips.js + lib/routes/trips.js + server.js wiring + page routes + tests | #2 |
| B (after A) | chat scope generalization + trip chat routes + /api/chat/rooms + fam-notifications triggers + calendar merge | #3 |
| C (parallel) | trips.html/js/css + trip-join.html + auth.js wrappers + sidebar link + guest redirect | #4 |
| D (parallel) | iOS multi-room chat, Trips webview tab, push routing, calendar polish | #5 |
| E | integration, full test run, APP-BRIEF.md addendum, commit + push | #6 |

Out of scope for v1 (recorded, not forgotten): flight-status lookups or any
third-party travel API; itinerary→calendar per-item sync; expense splitting
(owner decision 2026-08-01: handled by retireodds.com/split, never built here);
trip photos; email invites; iOS native trips UI; billing gate on trips.

---

# v1.1 — Wanderlog-gap features (decided 2026-08-01)

Three additions; iOS untouched (webview picks them up). Maps deferred (CSP).

## 1. Ideas bucket
Itinerary items may have `date: null` — an unscheduled "idea". Vote/comment/
edit/delete work unchanged (same item shape). `addItineraryItem`: date now
optional (empty → null). `moveItineraryItem` accepts `date: null` (back to
ideas); ordering within the ideas group uses the same `order` ints (null date
group). Calendar merge ignores itinerary items already — no change. UI: an
"Ideas" dashed panel atop the Itinerary tab; drag ideas onto days and back;
vote first, schedule later.

## 2. Packing lists / shared checklists
`trip.checklists = [{ id:"tk_"+hex, title≤80, kind:"shared"|"personal",
ownerUserId (personal only), items:[{ id:"tki_"+hex, text≤200, done,
doneBy|null, assigneeUserId|null, createdBy, createdAt }], createdBy,
createdAt }]` (default-init `trip.checklists || []` everywhere — existing
trips predate the field; publicTrip includes it).

Permissions — the ONE kid-write carve-out in trips: a kid may fully manage
items on their OWN personal list; everything else stays read-only for kids.
- shared lists: members create/rename/add/toggle/assign/delete items; delete
  list = trip owner or list creator.
- personal lists: one per user, get-or-create ("<Name>'s packing"); ONLY the
  owner touches its items (owner may be a kid-read user); visible to all.

Routes (all under requireAuth; view-level gate passes kid-read for ALL
methods here — per-handler checks enforce the matrix above):
```
POST   /api/trips/:tripId/checklists            {title} → {checklist}        // shared, members only
POST   /api/trips/:tripId/checklists/personal   → {checklist}                // get-or-create own, any access
PATCH  /api/trips/:tripId/checklists/:lid       {title} → {checklist}
DELETE /api/trips/:tripId/checklists/:lid       → {ok}
POST   /api/trips/:tripId/checklists/:lid/items {text, assigneeUserId?} → {item}
PATCH  /api/trips/:tripId/checklists/:lid/items/:iid {text?, done?, assigneeUserId?} → {item}  // done sets doneBy
DELETE /api/trips/:tripId/checklists/:lid/items/:iid → {ok}
```
Activity log on shared-list create only; no push (noise). UI: "Packing" tab —
shared lists with assignee chips + doneBy avatars + per-list progress, a "My
packing" card with quick-add preset chips (Passport, Chargers, Meds, Swimwear,
Snacks, Headphones). Kid sessions: everything read-only EXCEPT their own card.

## 3. Paste-to-import bookings (no email infra needed)
`POST /api/ai/parse-booking` in lib/routes/ai.js (requireAuth only — parsing
is stateless; the ADD endpoints enforce trip permissions): `{text ≤ 20k
chars}` → `{flights:[{airline,flightNo,confirmation,from,to,departs,arrives}],
lodging:[{name,address,confirmation,checkIn,checkOut,note}]}`. Same env-gated
ANTHROPIC_API_KEY + shared daily quota + fenced-JSON handling as /api/ai/parse;
text-only Claude message; dates output in the "Jun 3, 21:50" shape the
calendar merge already parses. 422 when nothing found; 503 unconfigured. UI:
"✨ Paste confirmation" on Flights + Lodging tabs → textarea → parsed preview
cards with checkboxes → "Add selected" via the existing add endpoints.

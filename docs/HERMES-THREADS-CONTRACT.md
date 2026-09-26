# Hermes private threads and nudges: client/server contract

**Status:** v1, 2026-09-26. This is the source of truth for the web, iOS and Mac-plugin work.
**Plan:** [HERMES-PROACTIVE-PLAN.md](HERMES-PROACTIVE-PLAN.md).

**Owner decisions**
- The proactive loop and the nudges run on the always-on Mac inside the Hermes plugin.
- Every family member (parents *and* kids) gets a private Hermes thread.
- Pickup is plain status ("Ryshi's school ended now. Arya finishes in 30 min."), with no time settings.

## 1. Rooms

| Where | Room id | Scope key (server storage) | Who can read or write |
|---|---|---|---|
| User clients (web, iOS) | `"hermes"` | `hermes:<userId>` | Only that signed-in user, plus Hermes |
| Mac bridge | `"hermes:<userId>"` | `hermes:<userId>` | The family's Hermes connection |

`GET /api/chat/rooms` adds `{ "roomId": "hermes", "title": "Hermes", "kind": "assistant" }` for every signed-in user who has a family, whether parent or kid.
- Existing rooms are unchanged. They gain `kind: "family"` or `kind: "trip"`.
- Clients must ignore unknown keys.

## 2. User endpoints (session cookie)

The request/response shapes mirror the family chat routes.

**`GET /api/hermes/thread/messages?since=&limit=&afterId=&wait=1`**
- Returns `{ "messages": ChatMessage[] }`.
- With `afterId` and `wait=1`, it long-polls for up to 25 s, like `/api/chat/messages`.

**`POST /api/hermes/thread/messages`**
- Body: `{ "text": string, "clientMessageId"?: string }`.
- Returns `{ "message": ChatMessage }`.
- It is text only. A `card`, `media` or `buzz` field returns 400.
- It sends no push. Hermes replies from the Mac.

**`POST /api/hermes/thread/messages/:messageId/actions`**
- Body: `{ "action": string }`.
- Returns `{ "message": ChatMessage, "messages": ChatMessage[] }`.
  - `message` is the same card, updated.
  - `messages` are any new Hermes follow-ups in the thread, in order. Append the ones you don't already have.
- Errors:
  - 404: the message isn't in your thread.
  - 400: unknown action.
  - 403: role not allowed.
- It is idempotent: repeating a finished action returns 200 with the current state.

`ChatMessage` is the existing shape. Hermes messages have `senderType: "agent"`, `senderId: "hermes"` and `senderName: "Hermes"`; show the HELPER tag.

## 3. Card `type: "hermes-nudge"`

```json
{
  "type": "hermes-nudge",
  "id": "<nudgeKey>",
  "kind": "day-end | home-kid | home-kid-later | home-kid-followup | kid-reminder | home-parent | dinner-tonight | dinner-ideas | dinner-week | dinner-week-draft | approval",
  "title": null,
  "lines": ["Paneer wraps · 20 min · you have 7 of 9"],
  "actions": [
    { "id": "open-homework", "label": "Open homework", "style": "primary", "open": "homework" },
    { "id": "later", "label": "In 30 min", "style": "secondary", "done": false, "doneLabel": null }
  ],
  "state": { "status": "open", "label": null, "at": null, "by": null, "until": null },
  "data": {}
}
```

**How to render**
1. Show the message `text` as a Hermes bubble.
2. If `title` is set, show it as a small bold line.
3. Show `lines` as a compact list: at most 7 rows (a week draft has seven), each one line with tail truncation.
4. If `state.status === "open"`, show the buttons in order:
   - `style: "primary"` is a violet filled capsule.
   - `style: "secondary"` is an outline capsule.
   - An action with `done: true` is disabled and shows `doneLabel` (or `label + " ✓"`).
5. If `state.status` is `done`, `dismissed` or `snoozed`, hide the buttons and show `state.label` as a quiet resolved chip.

**Tapping a button**
- An action with `open` set is **client navigation only**, with no server call:

  | `open` | Web | iOS |
  |---|---|---|
  | `homework` | Homework tab | Homework tab |
  | `meals` | `/meals` | Planning → Meals |
  | `goals` | Goals tab | Goals web view |
  | `today` | Today | Today |

- Any other action: `POST …/actions` with `{ action: id }`. Disable the button while the request is in flight. Then replace the message by id and append `messages`.
- Unknown `kind` or `open` values: render the text and buttons anyway, and treat an unknown `open` as plain text.

Style follows Family Rings:
- Violet `--fr-you` / `Palette.frYou` for primary actions only.
- Buttons at least 44 pt tall on touch.
- No emoji in chrome.

## 4. Push

| Field | Value |
|---|---|
| `famType` | `"hermes_thread"` |
| Other fields | `familyId`, `messageId`, `roomId: "hermes"` |
| APNs | `thread-id: "hermes-<userId>"`, title "Hermes" |
| Web push | `data.url = "/app?chat=hermes"` |

Routing on tap:
- **iOS:** open Chat on room `"hermes"`.
- **Web:** open the chat dock (or the phone slide-over) on the Hermes tab.

Only the thread owner is notified.

## 5. Mac bridge endpoints (Hermes bearer token)

**`GET /api/hermes/rooms`**
- Adds `{ roomId: "hermes:<userId>", title: "Hermes · <name>", kind: "assistant" }` for each parent and each kid user.

**`GET /api/hermes/rooms/hermes:<userId>/messages`**
- Returns every human message, with no `@Hermes` needed.
- Each message carries `actor` and `actorToken` for the thread owner.
- Each message also carries `recentHermes`: the last five Hermes messages in the thread (including nudges), so a reply is read against the nudge it answers.

**`GET /api/hermes/rooms/hermes:<userId>/context`**
- Returns a family snapshot scoped to the **thread owner**. Kids get the kid ceiling.

**`POST /api/hermes/rooms/hermes:<userId>/messages`**
- Hermes replies into the owner's thread and pushes to the owner only.

**`GET /api/hermes/proactive/state`**
- Returns the facts for the planner (§6).

**`POST /api/hermes/proactive/nudges`**
- Body: `{ nudges: [{ userId, nudgeKey, text, card }] }`.
- Returns `{ results: [{ userId, nudgeKey, messageId, created }] }`.
- It is idempotent per `(userId, nudgeKey)`.
- The server validates:
  - that the recipient belongs to the family;
  - that the `kind` is in the allowlist;
  - that each action id is allowed for that kind;
  - role (dinner and parent kinds go to parents only; kid kinds go to kids only);
  - lengths: text ≤ 600, lines ≤ 7 × 120, labels ≤ 40, buttons ≤ 5.

## 6. Facts: `GET /api/hermes/proactive/state`

```json
{
  "generatedAt": "2026-09-26T08:05:00.000Z",
  "timezone": "Asia/Bangkok",
  "today": "2026-09-26",
  "weekday": "sat",
  "people": [{ "userId": "u1", "role": "parent", "name": "Mayur" },
             { "userId": "u9", "role": "kid", "name": "Ryshi", "kidId": "k1" }],
  "kids": [{
    "kidId": "k1", "name": "Ryshi", "userIds": ["u9"],
    "dayEnd": { "at": "2026-09-26T08:10:00.000Z", "local": "15:10", "title": "School",
                "kind": "school", "location": null },
    "homeAt": null,
    "tonight": { "dueTomorrow": [{ "id": "h1", "title": "Maths worksheet", "status": "todo" }],
                 "overdue": 0, "habitsLeft": 1, "habitsTotal": 2, "daily3Left": 3 }
  }],
  "dinner": { "time": "18:30", "at": "2026-09-26T11:30:00.000Z",
              "tonight": { "planned": false, "title": null },
              "nextWeek": { "start": "2026-09-28", "planned": 2, "days": 7 } },
  "sent": [{ "userId": "u1", "nudgeKey": "dinner-tonight:2026-09-26", "kind": "dinner-tonight",
             "messageId": "m_…", "postedAt": "…", "status": "open", "until": null,
             "covers": [] }]
}
```

**`dayEnd`** is the end of the kid's **latest timed commitment today**.
- Sources:
  - school timetable (`kind: "school"`);
  - the kid's own school-calendar events;
  - manual events with that `kidId`;
  - weekly activities (`kind: "activity"`).
- Family-wide events never count.
- A home-plan `schoolEnd` for today replaces the timetable's school finish (half days).
- It is null when the kid has no timed commitments today.

**`sent`** covers the last 3 days, for every recipient.

## 7. Approvals

When Hermes requests an Operator approval (MCP `fametc_approvals_request`), the server posts an `approval` card into the approving parent's thread, or into every parent's thread when no approver is named, and pushes it.
- The card's `lines` show the exact proposed action.
- Its buttons are `approve` (primary) and `reject`.
- Both run the same `decideApproval` → `continueApproved` path as the web Today case card, with the tapping parent as the actor and the stored action hash.
- Whichever surface decides first wins. A later tap on a stale card resolves it with the current state, for example "Already approved".
- `approval` is server-only: the Mac cannot post it.

## 8. Today strip (web and iOS)

A slim "Hermes" strip at the top of Today, above the Needs-you hero, for both parent and kid Today.

**What it shows.** Candidates are messages in the signed-in person's Hermes thread that have all of:
- `senderType: "agent"`;
- a `card.type` of `"hermes-nudge"`;
- a `card.state.status` of `"open"`;
- not deleted.

A candidate is shown when either:
- it has at least one action without `open` that isn't `done` (it is **actionable**), and it was posted within the last **18 hours**; or
- it has no such action, and it was posted within the last **2 hours** (a status like "school ended now").

Show at most **2**, newest first. Hide the strip entirely when there are none: no empty state, no placeholder.

**How each row works**
- A small "Hermes" label with the sparkles mark in violet.
- The message text, at most 2 lines.
- The card's buttons, behaving exactly as in chat (§3).
- Tapping the text opens the Hermes chat room.
- Buttons share state with the chat thread. A tap in the strip updates the same message in the chat, and a resolved row leaves the strip.

**Where the data comes from**
- **Web:** the already-loaded Hermes thread state.
- **iOS:** load the `"hermes"` room when Today appears and on pull-to-refresh, unless it's already loaded.

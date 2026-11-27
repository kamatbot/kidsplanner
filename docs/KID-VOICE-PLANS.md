# Kids add plans by voice

Kids add their own events and reminders, several at once, by speaking.

## Where it works

| Where | How |
| --- | --- |
| Watch app | Coral **+🎙** capsule (top left of chat) or **Add plans** in My list. Tap **Talk**, tap the mic in the input sheet, say everything, tap Done. |
| Siri on the watch | "Hey Siri, add plans in Fam ETC" → Siri asks "What should I add?" → the kid says the plans → Siri reads back what was added. |
| iPad (kid account) | Calendar **+** opens *Add plans* with three tabs: **Say it** (type or use the keyboard mic for several plans), **Event**, **Reminder**. Also in Family actions. |

watchOS has no on-watch speech framework, so the watch uses system dictation
(the mic in the text input sheet) and Siri; both hand the server text. Voice
notes in chat (Talk) are unchanged.

## Server

`POST /api/kid-plans` `{ text, requestId, via }` (kid session or kid watch
token only) makes one Claude call (`FAM_KID_PLANS_MODEL`, default
`claude-haiku-5-5`) with three tools: `add_event`, `add_reminder`,
`nothing_to_add`. The server then writes:

- events on the kid's own calendar (`kidId` = that kid, `createdBy` = the kid's
  user, no driver, no repeat), so the kid can edit or delete them;
- reminders as to-dos assigned to that kid with `createdByKidId`, so they buzz
  on the watch as strong chore reminders and the kid may edit or delete them.

Dates in the past or over a year ahead, and reminders without a time, are
skipped and named in the reply. At most 8 items per note, 30 notes per kid
per hour. `requestId` makes retries safe: the same id returns the first result.
`POST /api/kid-plans/:requestId/undo` removes that note's items (same kid, 24 h).

`FAM_KID_PLANS=off` turns it off. Without `ANTHROPIC_API_KEY` the endpoint
answers 503 with that reason, and the watch shows it.

Kids may also `POST /api/family/actions` from iPad (forced to themselves) and
`PATCH`/`DELETE` reminders they created. Watch tokens still cannot create
actions directly; they go through `/api/kid-plans`.

## Reaching the watch

- A watch that adds plans refreshes straight away, which re-plans its local
  reminders.
- When a kid adds from iPad, the server pushes to that kid's own watch
  (`includeActor`), and a silent background push follows deletes and edits, so
  removed reminders stop buzzing.
- A parent adding an event for one kid also pushes that kid's watch.

Reminders buzz only if the kid turned reminders on (the result screen offers
the button). Quiet hours 21:00–07:00 still apply. Timed events give a single
"Starts in 10 minutes" buzz; reminders are the strong, repeating kind.

## Parents (2026-11-27)

Parents use the same flow: the watch mic capsule and My list "Add plans",
watch Siri ("Add plans in Fam ETC"), and on iPad/iPhone "Say several plans at
once" in Add event plus "Say plans and reminders" on Today. The same
`POST /api/kid-plans` call accepts a parent session or a parent's own watch.
A parent's events go on the family calendar (no kid) and their reminders are
assigned to them, so they buzz on their watch. If the parent names a kid
("Maya has soccer Saturday at 10", "remind Leo to pack his kit"), that item is
for the kid and the kid's watch is told. Undo works the same way, for the
person who made the request only.

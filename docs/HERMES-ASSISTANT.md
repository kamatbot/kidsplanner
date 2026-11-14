# Hermes, the built-in family assistant

Hermes runs inside the FamETC server. There is no separate worker, queue
service or always-on Mac. It is built from the five parts of an always-on
agent, each kept as small as a family app needs.

| Part | Where | What it does |
| --- | --- | --- |
| Inbox | `assistantInbox` in db, `family-assistant.handleAsync` | A parent message is saved first, then answered after a 2.5 s pause. Messages that arrive while Hermes is thinking are answered together in one reply. `recover()` runs at boot and answers anything a restart interrupted (if it is less than 15 minutes old). |
| Timers | `proactive-loop.js` (once a minute) | Reminders a parent asked for, chat follow-ups, the Sunday "usual week" check and the opt-in morning summary, alongside the existing school-day, homework and dinner nudges. |
| Memory | `assistant-memory.js` → `assistantMemory[familyId]` | Family notes (from parents, plus facts learned from parents' chat messages), reminders, chat follow-ups, the undo log and writes waiting for Confirm. Routines are not stored: they are re-learned from the calendar's history each time. |
| Permissions | `operatorExecution.runDirectParentAction` | A parent's request is the approval for small writes. Repeating events, and four or more writes in one go, wait for a Confirm tap. Every write is logged with its prior values, so Undo can reverse it. Kids never instruct Hermes. |
| Outbox | `hermesThreads.postNudge` | One short reply. In a parent's private thread it carries an Undo button when something changed. Loop nudges respect quiet hours (except reminders the parent timed), daily caps and the family's topic switches. |

## Learning the family's week

`learnRoutines` counts one-off calendar entries by kid, title and weekday.
An entry that shows up in 3 of the last 6 weeks, and in 2 of the last 3, is a
routine ("Swimming, Ryshi, Tue 16:00"). Repeating events are skipped,
because the calendar already knows them. Routines are used in three places:

- In every reply's snapshot, so "move the usual swim to 5" just works.
- On Sunday evening (17:00–20:00): routines missing from next week's
  calendar get one card with an Add button for each (topic `routines`, on by default).
- In the morning summary ("Usually Swimming at 16:00, but it's not on
  today's calendar").

A routine fades out on its own when it stops happening, and a parent never
has to maintain it.

## Chat follow-ups

`chat-followups.js` reads family chat when there are new messages that have
been quiet for 10 minutes (at most every 20 minutes, 07:00–21:30). It sends
only the new messages, plus a little earlier context, and asks Claude to
report, via one forced tool call:

- New requests or promises still to be done, with the owner and any due date.
- Open items the new messages show are done.
- Lasting facts a parent stated. These become learned notes, and a learned
  note that a newer message contradicts is removed.

Detection sends nothing. The loop follows up later:

- No due date: 3 hours after the message.
- Due date only: 09:00 that day.
- Due date and time: 2 hours before.

It fires only if no open to-do or upcoming event already covers the item.
The card offers Add to-do, It's done, Later (3 hours, at most twice) and
Ignore. Items expire after 3 days, or the day after their due date.

Kid-owned items never become a parent alert. A parent is never told that a
kid ignored something (kamat's rule). An item nobody owns goes to every
parent, and a named parent's item goes only to that parent.

Switches: the `followUps`, `routines` and `summaries` topics in Settings →
Connections (web), next to the existing ones. `FAM_FOLLOWUPS=off` stops
chat scanning, `FAM_ASSISTANT=off` stops Hermes, and `FAM_PROACTIVE=off`
stops the loop.

## Cost and speed

Tools and instructions are cached together with prompt caching. The family
snapshot is a second cache breakpoint, reused by each tool round within one
reply. A busy or failed API call (429, 5xx, 529 or a network error) is
retried once after 1.5 s, or after the `retry-after` time (at most 5 s).

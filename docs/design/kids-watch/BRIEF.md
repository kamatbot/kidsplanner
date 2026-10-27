# Kids' watch redesign (approved 2026-10-27)

Approved by the owner on 2026-10-27 from the mockup canvas
https://claude.ai/artifact/4Byau1iYKsSJSTzgfNyDpi (10 screens drawn at true
40mm Apple Watch SE size, 162 × 197 pt). The owner declined the "tell a parent
after the 3rd ignored buzz" idea: reminders never escalate to a parent.

Primary wearer: a child on a standalone 40mm Apple Watch SE with no iPhone.
Priorities: 1) family chat with fast emoji and voice replies, 2) homework and
chore reminders that buzz hard and keep buzzing until acknowledged.

## Visual system

- Black canvas, SF Rounded (`.fontDesign(.rounded)`), heavy weights (bold to
  black) for anything a kid must read at a glance.
- Violet `#B98CFF` = interactive voice (Talk button, my messages, progress).
- Homework orange `#FF9F45`; chore teal `#2FD3B5`; Fams gold `#F5C542`.
- Neutral control fill `#2C2C31`; incoming bubble `#26262B`; secondary text
  `#8E8E96` / `#B5B5BD`.
- Person colours for avatars come from profile colour when available
  (fallbacks: parent pink `#FF7AB6`, parent blue `#5AA9FF`).
- Touch targets ≥ 38 pt tall, primary actions 44 pt. Capsule buttons.
- Emoji are content (chat replies); icons are SF Symbols.

## Screens

1. **Chat (root).** Inline title "Family" in violet, top-right an orange
   capsule with a checkmark and the count of open to-dos (homework + chores
   due today) that opens My list. Messages fill the middle, newest at the
   bottom, 16 pt initial avatars for others, emoji-only messages rendered
   large without a bubble. Voice messages render as a bubble with a round
   play button (sender colour), 8-bar waveform, duration and an unplayed dot.
   Bottom: two equal 44 pt capsules always visible: **Emoji** (smiley symbol,
   yellow on dark) and **Talk** (mic + "Talk", violet fill, dark text).
2. **Quick reply sheet** (from Emoji). Close button + "Tap to send". 3 × 2
   grid of big emoji (👍 ❤️ 😂 👌 😋 🥺), then two phrase capsules
   ("On my way 🏃", "Can you call me? 📞"). One tap sends and dismisses, with
   a click haptic. Below the fold: the system text field (dictation/Scribble)
   and the remaining quick phrases.
3. **Recording.** Red dot + "To Family", live level bars, big timer, a 62 pt
   violet send button inside a 30 s progress ring, a 38 pt cancel (×) button.
   Tap Talk = start recording immediately; tap send = stop + send; auto-send
   at 30 s. "Tap to send · max 0:30".
4. **Playing a voice message.** Sender header, a blue card with pause/play,
   progress waveform and `0:03 / 0:06`, a React row of 👍 ❤️ 😂 (uses the
   existing reactions API where the watch is allowed, otherwise sends the
   emoji as a reply), and a "Talk back" violet capsule.
5. **Message notification.** Sender + message, inline 👍 🏃 ❤️ buttons, a
   Talk button (opens the app straight into Recording) and Open.
6. **Homework alarm.** Full-screen takeover on a dark orange ground
   (`#1F1200`): ringed book symbol, "HOMEWORK TIME", title, "Due 5:00 PM".
   Buttons: **Start** (orange, primary) and **5 min** (snooze).
7. **Chore alarm.** Same layout on dark teal (`#00201B`), "CHORE TIME · 3rd
   buzz", title, "+5 Fams" gold chip when the chore pays Fams. Buttons:
   **Done** and **Later (n left)**. Snoozes are limited (2 per reminder).
8. **My list.** "My list" + small progress ring "1 of 4". Rows (38 pt) with a
   coloured ring checkbox: homework orange, chores teal, done items struck
   through with a filled teal check. Tapping the ring completes it.
9. **Done.** Big teal check inside a progress ring, "Nice one!", item +
   "2 of 4", "+5 Fams when Mom OKs" for chores, and a "Next: …" capsule.
10. **Complications.** Chat with unread badge, a Talk shortcut, and a
    rectangular "next to-do" with a progress ring and "in 8 min".

## Strong buzz behaviour

- Reminder notifications use `interruptionLevel = .timeSensitive` (needs the
  Time Sensitive Notifications entitlement) and a dedicated category with
  Start/Done and Snooze actions.
- Each reminder schedules follow-up re-alerts (every 2 minutes, up to 5)
  that are all cancelled the moment the kid acknowledges (Start/Done/Snooze)
  in the notification or the app.
- When the app is in front or wakes for a reminder, it shows the full-screen
  alarm and repeats a strong haptic (`.notification` + `.retry` pattern) every
  few seconds until a button is tapped.
- The next due reminder is also armed as a `WKExtendedRuntimeSession`
  smart-alarm session (`WKBackgroundModes: alarm`) so that at fire time the
  app can call `notifyUser(hapticType:repeatHandler:)`, which keeps buzzing
  until the kid responds. Only one alarm session can be scheduled at a time,
  so it always tracks the soonest pending reminder.
- Critical Alerts are not used (Apple restricts that entitlement).
- Quiet hours 21:00–07:00 still apply.

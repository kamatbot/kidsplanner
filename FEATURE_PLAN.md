# KidsPlanner — Feature Plan & Design

**Vision:** A full-fledged planner for parents at our kids' school (Moodle-based), unifying the school calendar, extracurricular activities, homework, and personal goals in one kid-friendly app.

**Audience:** Parents (primary organizers) and kids (daily users). The existing kid/parent role split stays and becomes the backbone of the family model.

---

## 1. Where we are today

Built by Opus (initial commit): a client-side vanilla JS SPA with localStorage persistence.

**Already working:** login/signup with kid & parent roles · week/month calendar with 5 event categories · add/delete events · AI schedule parsing from PDF/image uploads (Claude API) with repeat-for-N-weeks · daily learning widgets (quotes, SAT words, facts, news, brain-teaser quiz with streaks) · responsive, kid-friendly design system (Nunito, purple/pink/teal palette).

**Key gaps this plan closes:** no Moodle integration, no homework tracking, no extracurricular management beyond generic events, no goals, one-kid-per-account, no event editing/recurrence, plaintext passwords, no sync across devices.

---

## 2. Guiding architecture decision

Stay **client-first** and phase in a backend only when sync demands it:

- **Phase 1–2:** remain a static SPA. Moodle integration uses the **iCal export URL** every Moodle user can self-serve (Calendar → Export calendar → copy URL). No school-admin cooperation required. CORS is handled via a tiny serverless proxy function (the only server piece).
- **Phase 3+:** optional lightweight backend (e.g. Supabase or a small Node service) for family sync across devices, push notifications, and Moodle Web Services API (assignments with due dates, grades) where the school enables tokens.

This keeps every phase shippable and useful on its own.

---

## 3. Feature plan by phase

### Phase 1 — Family model + planner fundamentals
*Make the existing app genuinely usable for a family before integrating anything.*

1. **Multi-kid family accounts**
   - A parent account owns a **Family**; kids are profiles under it (with optional own logins).
   - Kid switcher in the header (avatar chips, one color per kid); "All kids" combined view for parents.
   - Every event/homework/goal is tagged with a `kidId`; calendar renders per-kid color coding.
2. **Event editing & recurrence**
   - Edit modal (reuse add-event modal in edit mode).
   - Recurrence rules: weekly / biweekly / monthly, until-date — needed for classes and activities. Store as an RRULE-lite object, expand at render time.
3. **Drag-to-reschedule** on week view; keyboard Esc to close modals.
4. **Security hygiene:** hash passwords (SHA-256 + salt via WebCrypto — still demo-grade, honest about limits), complete the `esc()` sanitization everywhere user text is rendered, move the Anthropic key behind the serverless proxy from Phase 2.

### Phase 2 — Moodle & school calendar integration
*The headline feature: the school's Moodle feeds the planner automatically.*

1. **Moodle iCal subscription (baseline — works for every parent)**
   - Settings screen: paste the Moodle calendar export URL (with a step-by-step illustrated guide, since parents will need hand-holding).
   - Serverless proxy fetches the .ics on demand (CORS + hides nothing sensitive; URL contains the user's auth token so it is stored locally only).
   - Parser maps VEVENTs → KidsPlanner events, category `school`, marked **read-only & source-tagged** (`source: "moodle"`) so re-syncs update rather than duplicate (keyed by iCal UID).
   - Manual "Sync now" + auto-refresh on app open (throttled to ~1/hour).
   - Assignment-type Moodle events (due dates) are detected by keyword/CATEGORIES and become **homework items**, not just calendar blocks.
2. **Moodle Web Services API (enhanced tier — if the school enables it)**
   - Token-based: `core_calendar_get_calendar_events`, `mod_assign_get_assignments`, `core_enrol_get_users_courses`.
   - Gives structured homework (course, description, attachments, due datetime) instead of inferred iCal entries.
   - Feature-detected: settings shows "Connect with Moodle token" only as an advanced option; graceful fallback to iCal.
3. **Generic iCal import** as a bonus: the same pipeline accepts any calendar URL (sports club feeds, Google Calendar), giving extracurricular auto-sync for free.

### Phase 3 — Homework hub
1. **Homework list view** (new nav tab alongside Calendar): grouped by due date — Overdue / Today / This week / Later; filter by kid and subject.
2. **Homework item model:** title, subject, kid, due date, est. effort, status (todo → in-progress → done), source (moodle | manual), notes, checklist sub-steps.
3. **Sources:** auto-created from Moodle assignments (Phase 2), manual add, and AI-parse from a photo of the homework diary (reuse the existing Claude parsing pipeline — it's the same trick as timetable parsing).
4. **Calendar fusion:** homework due dates appear on the calendar as chips; optional "plan work session" creates a linked calendar block before the due date.
5. **Parent oversight:** parents see completion status per kid; kids get satisfying check-off animations (confetti — the app's personality allows it).

### Phase 4 — Extracurricular activities
1. **Activity registry:** first-class objects (not just events): name, kid, category (sports/arts/music/clubs), schedule (recurrence), location, coach/teacher contact, gear checklist, season start/end.
2. Activities generate their recurring calendar events automatically; edit the activity → all future events update.
3. **Logistics helpers:** per-activity gear checklist surfaced on the day-of ("Soccer today — shin guards, water bottle 🧦⚽"), carpool/notes field, term-fee reminder date.
4. **iCal subscribe** per club feed (from Phase 2 pipeline) with per-activity mapping.

### Phase 5 — Personal goals & streak expansion
1. **Goal model:** title, kid, type (habit — "read 20 min daily" | milestone — "learn 50 SAT words by June"), cadence, target, progress log.
2. **Goals widget** on the dashboard: today's habits as tap-to-check rings; milestone progress bars.
3. **Unify with the existing streak system:** the quiz streak becomes one instance of a general streak engine; each habit gets its own streak + a weekly family recap card ("Maya: 5/7 reading days 📚").
4. Parent-set vs. kid-set goals, both visible to both; gentle, non-punitive language throughout (missed day = "fresh start", not failure).

### Phase 6 — Sync, notifications & polish
1. **Backend sync** (Supabase or similar): family data across devices, real auth, parent+kid live on their own phones. localStorage becomes the offline cache.
2. **Notifications:** service-worker push (with permission) — homework due tomorrow, activity in 1 hour, goal nudge at a chosen time. Email digest fallback for parents.
3. **PWA:** installable, offline-capable, home-screen icon.
4. **Week-ahead Sunday digest** for parents: everything coming up per kid on one screen/email.

---

## 4. Design

### Information architecture
```
Header: logo · kid-switcher chips · sync status dot · avatar menu
Nav tabs: 📅 Calendar · 📚 Homework · 🎯 Goals · ⚽ Activities · ⚙️ Settings
Sidebar (desktop): mini calendar · today's checklist (homework+habits) ·
                   streaks card · upload/sync shortcuts
Dashboard widgets: keep the learning widgets (quotes/SAT/quiz) — they're the
                   app's charm — below the functional area, collapsible
```

### Visual language
Keep the existing system (Nunito, `#6C63FF` purple primary, pastel category colors, rounded cards, playful emoji). Additions:
- **Per-kid accent colors** (assigned at profile creation) used consistently on avatar chips, calendar events, homework rows.
- **Source badges:** small 🎓 tag on Moodle-synced items; lock icon on read-only synced events.
- **Status colors:** homework overdue = existing red, due today = yellow, done = green with strikethrough.

### Data model (new/changed)
```js
Family    { id, name, parentIds[], kidIds[] }
Kid       { id, familyId, name, grade, color, avatar, moodleIcalUrl?, moodleToken? }
Event     { ...existing, kidId, recurrence?, source: "manual"|"moodle"|"ical",
            sourceUid?, readOnly? }
Homework  { id, kidId, title, subject, dueDate, dueTime?, status, effortMin?,
            source, sourceId?, checklist[], notes }
Activity  { id, kidId, name, category, schedule{days[], start, end, from, to},
            location?, contact?, gearChecklist[], feeReminder? }
Goal      { id, kidId, title, type: "habit"|"milestone", cadence?, target?,
            progress[], createdBy, streak }
```
Storage keys stay `kp_*`; add a schema `version` field with a migration function so existing demo data upgrades cleanly.

### Moodle sync flow (Phase 2)
```
Settings → paste iCal URL → validate & preview 5 events → confirm
        ↳ proxy fetch .ics → parse VEVENTs → diff by UID →
          upsert events / create homework for due-date items →
          toast "Synced 14 school events, 3 assignments 🎓"
```

---

## 5. Risks & mitigations
| Risk | Mitigation |
|---|---|
| School blocks/never enables Web Services API | iCal export is user-self-serve and the default path; API is a bonus tier |
| Moodle iCal URL contains the user's token | Store locally only, never log at proxy, warn user not to share |
| localStorage quota (base64 uploads already stored there) | Phase 6 backend; meanwhile cap upload size & offer delete |
| Two parents, no sync until Phase 6 | Add export/import family JSON in Phase 1 as a stopgap |
| Anthropic API key currently client-exposed | Move behind the same serverless proxy in Phase 2 |

## 6. Suggested sequencing & effort (rough)
| Phase | Scope | Effort |
|---|---|---|
| 1 | Family model, edit/recurrence, security | ~1–2 weeks |
| 2 | Moodle iCal + proxy + generic iCal | ~1–2 weeks |
| 3 | Homework hub | ~1 week |
| 4 | Activities | ~1 week |
| 5 | Goals & streak engine | ~1 week |
| 6 | Backend sync, PWA, notifications | ~2–3 weeks |

Each phase ships independently; after Phase 2 the app already delivers Mona's core promise (school calendar auto-synced), with 3–5 layering on the daily-life value.

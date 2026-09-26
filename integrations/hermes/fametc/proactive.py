"""Hermes proactive loop for FamETC (docs/HERMES-THREADS-CONTRACT.md).

This runs inside the always-on Mac's Hermes gateway. About once a minute it
reads FamETC's facts (GET /proactive/state), decides who should hear what
right now, and posts short nudges into each person's private Hermes thread
(POST /proactive/nudges).

The loop keeps no state of its own. FamETC makes every post idempotent per
(person, nudge key) and records button presses, and `sent` in the facts says
what already went out. A Mac restart re-reads the same facts and never
repeats a message; a late tick skips moments that have passed.

`plan()` is pure: facts + a clock in, nudges out. It is the whole of Hermes'
initiative, so it is deliberately plain and table-tested.
"""
from __future__ import annotations

import logging
import math
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

# Nothing is sent inside quiet hours (family-local HH:MM, wrapping midnight).
QUIET = {"parent": ("21:30", "07:00"), "kid": ("20:30", "07:00")}
# Hermes' own initiative per person per day. Day-end status updates and
# reminders a parent asked for don't count.
DAILY_CAP = {"parent": 8, "kid": 4}
UNCAPPED_KINDS = {"day-end", "kid-reminder"}

SOON = timedelta(minutes=30)            # "Arya finishes Chess in 30 min."
NOW_GRACE = timedelta(minutes=20)       # "...ended now" is only true briefly
HOME_AFTER_DAY_END = timedelta(minutes=60)
HOME_WINDOW = timedelta(minutes=90)
LATER_WINDOW = timedelta(minutes=60)
QUIET_GAP = timedelta(minutes=60)       # no evening follow-up right after a reminder
PARENT_EVENING = ("17:30", "19:30")
KID_FOLLOWUP = ("19:30", "20:30")
DINNER_OFFER_LEAD = timedelta(hours=3)
DINNER_OFFER_WINDOW = timedelta(minutes=90)
BUSY_BEFORE_DINNER = timedelta(minutes=90)
WEEK_PLAN = ("sun", "17:00", "20:00")
WEEK_PLAN_MIN_PLANNED = 4
MAX_NUDGES_PER_TICK = 20


def _parse(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _in_span(hhmm: str, span: Tuple[str, str]) -> bool:
    start, end = span
    return start <= hhmm < end if start <= end else (hhmm >= start or hhmm < end)


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def _action(action_id: str, label: str, style: str = "secondary") -> Dict[str, str]:
    return {"id": action_id, "label": label, "style": style}


class _Facts:
    """Read-only view over the /proactive/state payload."""

    def __init__(self, state: Dict[str, Any], now: datetime):
        self.state = state
        self.now = now.astimezone(timezone.utc)
        self.tz = ZoneInfo(state.get("timezone") or "Asia/Bangkok")
        local = self.now.astimezone(self.tz)
        self.today = state.get("today") or local.strftime("%Y-%m-%d")
        self.weekday = state.get("weekday") or local.strftime("%a").lower()[:3]
        self.clock = local.strftime("%H:%M")
        people = [p for p in state.get("people") or [] if isinstance(p, dict) and p.get("userId")]
        self.role_of = {p["userId"]: p.get("role") for p in people}
        self.parents = [p for p in people if p.get("role") == "parent"]
        self.kids = [k for k in state.get("kids") or [] if isinstance(k, dict) and k.get("kidId")]
        self.dinner = state.get("dinner") or {}
        self.sent = [s for s in state.get("sent") or [] if isinstance(s, dict)]
        self.sent_keys = {(s.get("userId"), s.get("nudgeKey")) for s in self.sent}

    def local_date(self, when: datetime) -> str:
        return when.astimezone(self.tz).strftime("%Y-%m-%d")

    def sent_today(self, user_id: str) -> List[Dict[str, Any]]:
        out = []
        for entry in self.sent:
            posted = _parse(entry.get("postedAt"))
            if entry.get("userId") == user_id and posted and self.local_date(posted) == self.today:
                out.append(entry)
        return out

    def quiet(self, user_id: str) -> bool:
        return _in_span(self.clock, QUIET.get(self.role_of.get(user_id) or "parent", QUIET["parent"]))

    def recent(self, user_id: str, kinds: set, within: timedelta) -> bool:
        for entry in self.sent:
            posted = _parse(entry.get("postedAt"))
            if entry.get("userId") == user_id and entry.get("kind") in kinds and posted and self.now - posted < within:
                return True
        return False


# ---------------------------------------------------------------- moments
def _day_end(f: _Facts) -> List[Dict[str, Any]]:
    """Plain status for parents: "Ryshi's school ended now. Arya finishes Chess in 30 min." """
    moments = []
    for kid in f.kids:
        end = kid.get("dayEnd") or {}
        at = _parse(end.get("at"))
        if not at:
            continue
        if at - SOON <= f.now < at:
            moments.append({"kid": kid, "end": end, "at": at, "stage": "soon"})
        elif at <= f.now <= at + NOW_GRACE:
            moments.append({"kid": kid, "end": end, "at": at, "stage": "now"})
    if not moments:
        return []

    def what(end: Dict[str, Any]) -> str:
        return "school" if end.get("kind") == "school" else (end.get("title") or "the day")

    def where(end: Dict[str, Any]) -> str:
        loc = end.get("location")
        return f" ({loc})" if loc and end.get("kind") != "school" else ""

    def sentence(m: Dict[str, Any]) -> str:
        name = m["kid"].get("name") or "Your child"
        if m["stage"] == "now":
            return f"{name}'s {what(m['end'])} ended now{where(m['end'])}."
        minutes = max(1, math.ceil((m["at"] - f.now).total_seconds() / 60))
        return f"{name} finishes {what(m['end'])} in {minutes} min{where(m['end'])}."

    nudges = []
    for parent in f.parents:
        uid = parent["userId"]
        covered = set()
        for entry in f.sent_today(uid):
            if entry.get("kind") == "day-end":
                covered.update(entry.get("covers") or [])
        fresh = [m for m in moments if f"{m['kid']['kidId']}:{m['stage']}" not in covered]
        if not fresh or f.quiet(uid):
            continue
        # A "now" message also mentions any other kid about to finish, even if
        # that heads-up already went out: the two pickups belong together.
        fresh_ids = {m["kid"]["kidId"] for m in fresh}
        context = [m for m in moments if m["stage"] == "soon" and m["kid"]["kidId"] not in fresh_ids] \
            if any(m["stage"] == "now" for m in fresh) else []
        ordered = sorted(fresh + context, key=lambda m: (m["stage"] != "now", m["at"]))
        covers = sorted(f"{m['kid']['kidId']}:{m['stage']}" for m in fresh)
        nudges.append({
            "userId": uid,
            "nudgeKey": f"day-end:{f.today}:{'+'.join(covers)}",
            "text": " ".join(sentence(m) for m in ordered),
            "card": {"kind": "day-end", "data": {"covers": covers}},
        })
    return nudges


def _tonight_summary(kid: Dict[str, Any]) -> Tuple[str, List[str], bool]:
    """(sentence, lines, has_homework) for a kid's own evening message."""
    t = kid.get("tonight") or {}
    due = [d for d in t.get("dueTomorrow") or [] if isinstance(d, dict)]
    overdue = int(t.get("overdue") or 0)
    habits = int(t.get("habitsLeft") or 0)
    daily3 = int(t.get("daily3Left") or 0)
    bits = []
    if due:
        first = due[0].get("title") or "Homework"
        bits.append(f"{first} (due tomorrow)" + (f" and {len(due) - 1} more" if len(due) > 1 else ""))
    elif overdue:
        bits.append(f"{_plural(overdue, 'overdue piece')} of homework to catch up on")
    if habits:
        bits.append(f"{_plural(habits, 'habit')} to check off")
    if daily3:
        bits.append("Daily 3 is ready" if daily3 >= 3 else f"{daily3} left in Daily 3")
    lines = [d.get("title") or "Homework" for d in due[:4]] if len(due) > 1 else []
    return (" · ".join(bits), lines, bool(due or overdue))


def _home_kid(f: _Facts) -> List[Dict[str, Any]]:
    nudges = []
    for kid in f.kids:
        user_ids = [u for u in kid.get("userIds") or [] if isinstance(u, str)]
        if not user_ids:
            continue
        end = _parse((kid.get("dayEnd") or {}).get("at"))
        fire = _parse(kid.get("homeAt")) or (end + HOME_AFTER_DAY_END if end else None)
        if not fire or not (fire <= f.now <= fire + HOME_WINDOW):
            continue
        summary, lines, homework = _tonight_summary(kid)
        if not summary:
            continue
        name = kid.get("name") or "there"
        actions = [_action("open-homework", "Open homework", "primary")] if homework else [_action("open-today", "Open Today", "primary")]
        actions.append(_action("later", "In 30 min"))
        for uid in user_ids:
            nudges.append({
                "userId": uid,
                "nudgeKey": f"home-kid:{f.today}:{kid['kidId']}",
                "text": f"Welcome home, {name}! Tonight: {summary}.",
                "card": {"kind": "home-kid", "lines": lines, "actions": actions},
            })
    return nudges


def _snoozed_reminders(f: _Facts) -> List[Dict[str, Any]]:
    """A "later" tap comes back once, 30 minutes on, if it still matters."""
    kid_by_user = {u: k for k in f.kids for u in k.get("userIds") or []}
    nudges = []
    for entry in f.sent:
        if entry.get("status") != "snoozed" or entry.get("kind") not in {"home-kid", "home-kid-followup"}:
            continue
        until = _parse(entry.get("until"))
        kid = kid_by_user.get(entry.get("userId"))
        if not until or not kid or not (until <= f.now <= until + LATER_WINDOW):
            continue
        t = kid.get("tonight") or {}
        due = [d for d in t.get("dueTomorrow") or [] if isinstance(d, dict)]
        if due:
            text = f"Reminder: {due[0].get('title') or 'your homework'} is due tomorrow."
        elif int(t.get("overdue") or 0) or int(t.get("habitsLeft") or 0) or int(t.get("daily3Left") or 0):
            text = "Reminder: tonight's list is still waiting."
        else:
            continue
        nudges.append({
            "userId": entry["userId"],
            "nudgeKey": f"{entry.get('nudgeKey')}~later",
            "text": text,
            "card": {"kind": "home-kid-later", "actions": [_action("open-homework", "Open homework", "primary")]},
        })
    return nudges


def _kid_followup(f: _Facts) -> List[Dict[str, Any]]:
    if not _in_span(f.clock, KID_FOLLOWUP):
        return []
    nudges = []
    for kid in f.kids:
        due = [d for d in (kid.get("tonight") or {}).get("dueTomorrow") or [] if isinstance(d, dict)]
        if not due:
            continue
        first = due[0].get("title") or "Your homework"
        more = f" ({len(due)} things are due tomorrow.)" if len(due) > 1 else ""
        for uid in kid.get("userIds") or []:
            if f.recent(uid, {"home-kid-later", "kid-reminder"}, QUIET_GAP):
                continue
            nudges.append({
                "userId": uid,
                "nudgeKey": f"home-kid-followup:{f.today}:{kid['kidId']}",
                "text": f"{first} is due tomorrow. Want to finish it now?{more}",
                "card": {"kind": "home-kid-followup",
                         "actions": [_action("open-homework", "Open homework", "primary"), _action("later", "In 30 min")]},
            })
    return nudges


def _dinner_planned(f: _Facts) -> bool:
    return bool((f.dinner.get("tonight") or {}).get("planned"))


def _home_parent(f: _Facts) -> List[Dict[str, Any]]:
    if not _in_span(f.clock, PARENT_EVENING):
        return []
    sentences, nudge_kids = [], []
    busy = [k for k in f.kids if (k.get("tonight") or {}).get("dueTomorrow") or int((k.get("tonight") or {}).get("overdue") or 0)]
    for kid in f.kids:
        t = kid.get("tonight") or {}
        due = [d for d in t.get("dueTomorrow") or [] if isinstance(d, dict)]
        overdue = int(t.get("overdue") or 0)
        name = kid.get("name") or "Your child"
        if due:
            started = any(d.get("status") == "in_progress" for d in due)
            sentences.append(f"{name} has {len(due)} due tomorrow ({'in progress' if started else 'not started'}).")
        elif overdue:
            sentences.append(f"{name} has {overdue} overdue.")
        elif busy:
            sentences.append(f"{name} is all set.")
        if (due or overdue) and kid.get("userIds"):
            nudge_kids.append(kid)
    dinner_open = not _dinner_planned(f)
    if dinner_open:
        sentences.append("Dinner isn't planned yet.")
    if not busy and not dinner_open:
        return []
    actions = [_action(f"nudge-kid:{k['kidId']}", f"Nudge {k.get('name') or 'them'}") for k in nudge_kids[:2]]
    if dinner_open:
        actions.insert(0, _action("dinner-ideas", "Dinner ideas", "primary"))
    return [{
        "userId": p["userId"],
        "nudgeKey": f"home-parent:{f.today}",
        "text": "Tonight: " + " ".join(sentences),
        "card": {"kind": "home-parent", "actions": actions},
    } for p in f.parents]


def _busy_title(f: _Facts, dinner_at: datetime) -> Optional[str]:
    for kid in f.kids:
        end = kid.get("dayEnd") or {}
        at = _parse(end.get("at"))
        if at and end.get("kind") != "school" and timedelta(0) <= dinner_at - at <= BUSY_BEFORE_DINNER:
            return end.get("title")
    return None


def _dinner_tonight(f: _Facts) -> List[Dict[str, Any]]:
    dinner_at = _parse(f.dinner.get("at"))
    if not dinner_at or _dinner_planned(f):
        return []
    offer = dinner_at - DINNER_OFFER_LEAD
    if not (offer <= f.now <= offer + DINNER_OFFER_WINDOW):
        return []
    busy = _busy_title(f, dinner_at)
    text = "Dinner tonight isn't planned yet. Want 3 ideas from your pantry?"
    if busy:
        text += f" It's a {busy.lower()} night, so I'll keep them quick."
    return [{
        "userId": p["userId"],
        "nudgeKey": f"dinner-tonight:{f.today}",
        "text": text,
        "card": {"kind": "dinner-tonight",
                 "actions": [_action("dinner-ideas", "Show 3 ideas", "primary"), _action("dismiss", "I've got it")]},
    } for p in f.parents]


def _dinner_week(f: _Facts) -> List[Dict[str, Any]]:
    day, start, end = WEEK_PLAN
    week = f.dinner.get("nextWeek") or {}
    planned = int(week.get("planned") or 0)
    if f.weekday != day or not _in_span(f.clock, (start, end)) or not week.get("start") or planned >= WEEK_PLAN_MIN_PLANNED:
        return []
    days = int(week.get("days") or 7)
    return [{
        "userId": p["userId"],
        "nudgeKey": f"dinner-week:{week['start']}",
        "text": f"Next week has {planned} of {days} dinners planned. Want me to draft the rest?",
        "card": {"kind": "dinner-week",
                 "actions": [_action("dinner-draft-week", "Draft the week", "primary"), _action("dismiss", "Not this week")]},
    } for p in f.parents]


# Most time-critical first, so a daily cap drops the least urgent.
_MOMENTS: List[Callable[[_Facts], List[Dict[str, Any]]]] = [
    _day_end, _snoozed_reminders, _home_kid, _kid_followup, _dinner_tonight, _home_parent, _dinner_week,
]


def plan(state: Dict[str, Any], now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """Every nudge that should go out at `now`, given FamETC's facts."""
    f = _Facts(state or {}, now or datetime.now(timezone.utc))
    used = {uid: sum(1 for e in f.sent_today(uid) if e.get("kind") not in UNCAPPED_KINDS) for uid in f.role_of}
    out: List[Dict[str, Any]] = []
    for moment in _MOMENTS:
        for nudge in moment(f):
            uid = nudge["userId"]
            kind = nudge["card"]["kind"]
            if (uid, nudge["nudgeKey"]) in f.sent_keys or uid not in f.role_of:
                continue
            if kind != "day-end" and f.quiet(uid):
                continue
            if kind not in UNCAPPED_KINDS:
                if used.get(uid, 0) >= DAILY_CAP.get(f.role_of[uid] or "parent", 4):
                    continue
                used[uid] = used.get(uid, 0) + 1
            out.append(nudge)
    return out[:MAX_NUDGES_PER_TICK]


# ---------------------------------------------------------------- the loop
def proactive_enabled() -> bool:
    return os.getenv("FAMETC_HERMES_PROACTIVE", "on").strip().lower() not in {"0", "off", "false", "no"}


class ProactiveLoop:
    """Drives plan() about once a minute from the adapter's supervisor."""

    def __init__(self, request: Callable[..., Any], *, interval: float = 60.0,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
                 monotonic: Callable[[], float] = time.monotonic):
        self._request = request
        self._interval = interval
        self._clock = clock
        self._monotonic = monotonic
        self._last: Optional[float] = None

    async def maybe_tick(self) -> Optional[Dict[str, Any]]:
        now = self._monotonic()
        if self._last is not None and now - self._last < self._interval:
            return None
        self._last = now
        return await self.tick()

    async def tick(self) -> Dict[str, Any]:
        state = await self._request("GET", "/proactive/state")
        nudges = plan(state, self._clock())
        if not nudges:
            return {"sent": 0}
        response = await self._request("POST", "/proactive/nudges", payload={"nudges": nudges})
        results = response.get("results") if isinstance(response, dict) else None
        created = sum(1 for r in results or [] if isinstance(r, dict) and r.get("created"))
        rejected = [r for r in results or [] if isinstance(r, dict) and r.get("error")]
        if rejected:
            logger.warning("FamETC declined %d proactive nudge(s)", len(rejected))
        return {"sent": created, "rejected": len(rejected)}


__all__ = ["plan", "ProactiveLoop", "proactive_enabled"]


if __name__ == "__main__":  # pragma: no cover - manual smoke: python3 proactive.py < state.json
    import json
    import sys

    print(json.dumps(plan(json.load(sys.stdin)), indent=2))

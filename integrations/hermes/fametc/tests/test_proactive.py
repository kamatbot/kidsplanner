"""Table tests for Hermes' proactive planner (run: python3 -m unittest discover -s integrations/hermes/fametc/tests)."""
import asyncio
import copy
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import proactive  # noqa: E402

BKK = timedelta(hours=7)


def at(hhmm, day="2026-09-25"):
    """Bangkok wall time → aware UTC datetime."""
    local = datetime.fromisoformat(f"{day}T{hhmm}:00")
    return (local - BKK).replace(tzinfo=timezone.utc)


def iso(hhmm, day="2026-09-25"):
    return at(hhmm, day).isoformat().replace("+00:00", "Z")


def kid(kid_id, name, end=None, kind="school", title="School", location=None, users=None, due=(), overdue=0, habits=0, daily3=0, home=None):
    return {
        "kidId": kid_id, "name": name, "userIds": list(users or []),
        "dayEnd": {"at": iso(end), "local": end, "title": title, "kind": kind, "location": location} if end else None,
        "homeAt": iso(home) if home else None,
        "tonight": {"dueTomorrow": [{"id": f"h{i}", "title": t, "status": s} for i, (t, s) in enumerate(due)],
                    "overdue": overdue, "habitsLeft": habits, "habitsTotal": habits, "daily3Left": daily3},
    }


def base_state(**overrides):
    state = {
        "timezone": "Asia/Bangkok", "today": "2026-09-25", "weekday": "fri",
        "people": [
            {"userId": "p1", "role": "parent", "name": "Mayur"},
            {"userId": "p2", "role": "parent", "name": "Priya"},
            {"userId": "u-ryshi", "role": "kid", "name": "Ryshi", "kidId": "k-ryshi"},
        ],
        "kids": [
            kid("k-ryshi", "Ryshi", "15:10", users=["u-ryshi"], due=[("Maths worksheet", "todo")], habits=1, daily3=3),
            kid("k-arya", "Arya", "15:40", kind="activity", title="Chess", location="Room 3"),
        ],
        "dinner": {"time": "18:30", "at": iso("18:30"), "tonight": {"planned": False, "title": None},
                   "nextWeek": {"start": "2026-09-28", "planned": 2, "days": 7}},
        "sent": [],
    }
    state.update(overrides)
    return state


def sent_from(nudges, posted_at, **extra):
    return [dict({"userId": n["userId"], "nudgeKey": n["nudgeKey"], "kind": n["card"]["kind"], "postedAt": iso(posted_at),
                  "status": "open", "until": None, "covers": (n["card"].get("data") or {}).get("covers", [])}, **extra)
            for n in nudges]


def of_kind(nudges, kind):
    return [n for n in nudges if n["card"]["kind"] == kind]


class DayEnd(unittest.TestCase):
    def test_heads_up_then_combined_status_then_last_kid(self):
        state = base_state()
        first = of_kind(proactive.plan(state, at("14:40")), "day-end")
        self.assertEqual({n["userId"] for n in first}, {"p1", "p2"})
        self.assertEqual(first[0]["text"], "Ryshi finishes school in 30 min.")

        state["sent"] = sent_from(first, "14:40")
        self.assertEqual(of_kind(proactive.plan(state, at("14:50")), "day-end"), [])

        combined = of_kind(proactive.plan(state, at("15:10")), "day-end")
        self.assertEqual(combined[0]["text"], "Ryshi's school ended now. Arya finishes Chess in 30 min (Room 3).")
        self.assertEqual(combined[0]["card"]["data"]["covers"], ["k-arya:soon", "k-ryshi:now"])

        state["sent"] += sent_from(combined, "15:10")
        last = of_kind(proactive.plan(state, at("15:40")), "day-end")
        self.assertEqual(last[0]["text"], "Arya's Chess ended now (Room 3).")

    def test_now_mentions_a_sibling_whose_heads_up_already_went(self):
        state = base_state()
        state["kids"][1] = kid("k-arya", "Arya", "15:25", kind="activity", title="Chess")
        early = of_kind(proactive.plan(state, at("14:55")), "day-end")  # both heads-ups together
        self.assertEqual(early[0]["text"], "Ryshi finishes school in 15 min. Arya finishes Chess in 30 min.")
        state["sent"] = sent_from(early, "14:55")
        now = of_kind(proactive.plan(state, at("15:10")), "day-end")
        self.assertEqual(now[0]["text"], "Ryshi's school ended now. Arya finishes Chess in 15 min.")
        self.assertEqual(now[0]["card"]["data"]["covers"], ["k-ryshi:now"])

    def test_late_tick_skips_moments_that_passed(self):
        self.assertEqual(of_kind(proactive.plan(base_state(), at("16:05")), "day-end"), [])
        late = of_kind(proactive.plan(base_state(), at("15:29")), "day-end")
        self.assertEqual(late[0]["text"], "Ryshi's school ended now. Arya finishes Chess in 11 min (Room 3).")

    def test_no_commitments_no_status(self):
        state = base_state(kids=[kid("k-ryshi", "Ryshi", None, users=["u-ryshi"])])
        self.assertEqual(of_kind(proactive.plan(state, at("15:10")), "day-end"), [])


class HomeKid(unittest.TestCase):
    def test_welcome_home_an_hour_after_the_day_ends(self):
        state = base_state()
        self.assertEqual(of_kind(proactive.plan(state, at("16:05")), "home-kid"), [])
        [nudge] = of_kind(proactive.plan(state, at("16:10")), "home-kid")
        self.assertEqual(nudge["userId"], "u-ryshi")
        self.assertEqual(nudge["text"], "Welcome home, Ryshi! Tonight: Maths worksheet (due tomorrow) · 1 habit to check off · Daily 3 is ready.")
        self.assertEqual([a["id"] for a in nudge["card"]["actions"]], ["open-homework", "later"])
        self.assertEqual(nudge["nudgeKey"], "home-kid:2026-09-25:k-ryshi")

    def test_home_time_from_the_plan_wins(self):
        state = base_state()
        state["kids"][0]["homeAt"] = iso("17:00")
        self.assertEqual(of_kind(proactive.plan(state, at("16:10")), "home-kid"), [])
        self.assertEqual(len(of_kind(proactive.plan(state, at("17:00")), "home-kid")), 1)

    def test_nothing_waiting_means_no_message(self):
        state = base_state(kids=[kid("k-ryshi", "Ryshi", "15:10", users=["u-ryshi"])])
        self.assertEqual(of_kind(proactive.plan(state, at("16:10")), "home-kid"), [])

    def test_later_comes_back_once(self):
        state = base_state()
        [nudge] = of_kind(proactive.plan(state, at("16:10")), "home-kid")
        state["sent"] = sent_from([nudge], "16:10", status="snoozed", until=iso("16:40"))
        self.assertEqual(of_kind(proactive.plan(state, at("16:30")), "home-kid-later"), [])
        [later] = of_kind(proactive.plan(state, at("16:41")), "home-kid-later")
        self.assertEqual(later["text"], "Reminder: Maths worksheet is due tomorrow.")
        self.assertEqual(later["nudgeKey"], "home-kid:2026-09-25:k-ryshi~later")
        state["sent"] += sent_from([later], "16:41")
        self.assertEqual(of_kind(proactive.plan(state, at("16:45")), "home-kid-later"), [])

    def test_evening_follow_up_only_while_still_due_and_before_quiet(self):
        state = base_state()
        [follow] = of_kind(proactive.plan(state, at("19:30")), "home-kid-followup")
        self.assertEqual(follow["text"], "Maths worksheet is due tomorrow. Want to finish it now?")
        self.assertEqual(of_kind(proactive.plan(state, at("20:31")), "home-kid-followup"), [])
        state["sent"] = [{"userId": "u-ryshi", "nudgeKey": "kid-reminder:x", "kind": "kid-reminder", "postedAt": iso("19:10"), "status": "open"}]
        self.assertEqual(of_kind(proactive.plan(state, at("19:35")), "home-kid-followup"), [])
        done = base_state()
        done["kids"][0]["tonight"]["dueTomorrow"] = []
        self.assertEqual(of_kind(proactive.plan(done, at("19:30")), "home-kid-followup"), [])


class Parents(unittest.TestCase):
    def test_evening_check_in(self):
        [p1, p2] = of_kind(proactive.plan(base_state(), at("17:30")), "home-parent")
        self.assertEqual(p1["text"], "Tonight: Ryshi has 1 due tomorrow (not started). Arya is all set. Dinner isn't planned yet.")
        self.assertEqual([a["id"] for a in p1["card"]["actions"]], ["dinner-ideas", "nudge-kid:k-ryshi"])
        self.assertEqual(p1["card"]["actions"][0]["style"], "primary")
        self.assertEqual(p2["userId"], "p2")

    def test_nothing_to_say_stays_quiet(self):
        state = base_state(kids=[kid("k-ryshi", "Ryshi", "15:10", users=["u-ryshi"])])
        state["dinner"]["tonight"] = {"planned": True, "title": "Curry"}
        self.assertEqual(of_kind(proactive.plan(state, at("17:30")), "home-parent"), [])
        self.assertEqual(proactive.plan(base_state(), at("21:45")), [])

    def test_dinner_offer_three_hours_ahead_and_busy_night(self):
        state = base_state()
        state["kids"][1] = kid("k-arya", "Arya", "17:30", kind="activity", title="Swimming")
        [offer, _] = of_kind(proactive.plan(state, at("15:30")), "dinner-tonight")
        self.assertEqual(offer["text"], "Dinner tonight isn't planned yet. Want 3 ideas from your pantry? It's a swimming night, so I'll keep them quick.")
        self.assertEqual([a["id"] for a in offer["card"]["actions"]], ["dinner-ideas", "dismiss"])
        self.assertEqual(of_kind(proactive.plan(state, at("15:00")), "dinner-tonight"), [])
        state["dinner"]["tonight"]["planned"] = True
        self.assertEqual(of_kind(proactive.plan(state, at("15:30")), "dinner-tonight"), [])

    def test_week_plan_on_sunday_afternoon(self):
        sunday = base_state(today="2026-09-27", weekday="sun", kids=[])
        [offer, _] = of_kind(proactive.plan(sunday, at("17:05", "2026-09-27")), "dinner-week")
        self.assertEqual(offer["text"], "Next week has 2 of 7 dinners planned. Want me to draft the rest?")
        self.assertEqual(offer["nudgeKey"], "dinner-week:2026-09-28")
        self.assertEqual(of_kind(proactive.plan(sunday, at("16:55", "2026-09-27")), "dinner-week"), [])
        planned = copy.deepcopy(sunday)
        planned["dinner"]["nextWeek"]["planned"] = 4
        self.assertEqual(of_kind(proactive.plan(planned, at("17:05", "2026-09-27")), "dinner-week"), [])


class Guards(unittest.TestCase):
    def test_already_sent_is_never_repeated(self):
        state = base_state()
        first = proactive.plan(state, at("16:10"))
        state["sent"] = sent_from(first, "16:10")
        self.assertEqual(proactive.plan(state, at("16:11")), [])

    def test_daily_cap_for_kids(self):
        state = base_state()
        state["sent"] = [{"userId": "u-ryshi", "nudgeKey": f"x{i}", "kind": "home-kid", "postedAt": iso("12:00"), "status": "open"} for i in range(4)]
        self.assertEqual([n for n in proactive.plan(state, at("16:10")) if n["userId"] == "u-ryshi"], [])

    def test_unknown_people_are_ignored(self):
        state = base_state(people=[{"userId": "p1", "role": "parent", "name": "Mayur"}])
        self.assertTrue(all(n["userId"] == "p1" for n in proactive.plan(state, at("16:10"))))


class Loop(unittest.TestCase):
    def test_tick_reads_facts_and_posts_nudges_once_a_minute(self):
        calls = []
        clock = [0.0]

        async def request(method, path, payload=None, wait=False):
            calls.append((method, path, payload))
            if method == "GET":
                return base_state()
            return {"results": [{"created": True} for _ in payload["nudges"]]}

        loop = proactive.ProactiveLoop(request, clock=lambda: at("16:10"), monotonic=lambda: clock[0])
        result = asyncio.run(loop.maybe_tick())
        self.assertEqual(calls[0][:2], ("GET", "/proactive/state"))
        self.assertEqual(calls[1][:2], ("POST", "/proactive/nudges"))
        self.assertEqual(result["sent"], len(calls[1][2]["nudges"]))
        clock[0] = 30.0
        self.assertIsNone(asyncio.run(loop.maybe_tick()))
        clock[0] = 61.0
        asyncio.run(loop.maybe_tick())
        self.assertEqual(len([c for c in calls if c[0] == "GET"]), 2)

    def test_off_switch(self):
        os.environ["FAMETC_HERMES_PROACTIVE"] = "off"
        try:
            self.assertFalse(proactive.proactive_enabled())
        finally:
            del os.environ["FAMETC_HERMES_PROACTIVE"]
        self.assertTrue(proactive.proactive_enabled())


if __name__ == "__main__":
    unittest.main()

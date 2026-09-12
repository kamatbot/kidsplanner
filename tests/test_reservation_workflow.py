"""Focused contract tests for the reviewed reservation lookup workflow."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from datetime import datetime, timedelta, timezone


SCRIPT = (Path(__file__).resolve().parents[1] / "integrations" / "hermes" / "fametc"
          / "skills" / "action-capability"
          / "scripts" / "reservation_workflow.py")
SPEC = importlib.util.spec_from_file_location("reservation_workflow_under_test", SCRIPT)
workflow = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(workflow)

RAW_COOKIE = "sentinel-cookie-never-persist"
RAW_TOKEN = "sentinel-parent-token-never-persist"


def recipe(**overrides):
    value = {
        "service": "airline",
        "origin": "https://reservations.example.test",
        "path": "/reservations/{booking}",
        "query": ["surname"],
        "headers": ["cookie"],
        "segments": "/segments",
        "fields": {"origin": "/from", "destination": "/to", "departure": "/at"},
        "method": "GET",
        "effect": "read-only",
    }
    value.update(overrides)
    return value


def response():
    return {"segments": [{"from": "BKK", "to": "SIN", "at": "2026-10-21T09:30:00Z",
                          "passenger": "private passenger name", "ticket": "private ticket"}]}


def runtime(**overrides):
    value = {"actorToken": RAW_TOKEN, "caseId": "case-1",
             "inputs": {"booking": "AB/CD 42", "surname": "DOE"},
             "headers": {"cookie": RAW_COOKIE}}
    value.update(overrides)
    return value


_DEFAULT_CASE = object()


class FakeMcp:
    def __init__(self, *, role="parent", room="family", case=_DEFAULT_CASE, approvals=None):
        self.role, self.room = role, room
        self.case = {"roomId": "family", "state": "draft"} if case is _DEFAULT_CASE else case
        self.approvals = approvals
        self.calls = []

    def __call__(self, name, args):
        self.calls.append((name, args))
        if name == "fametc_context_get":
            return {"actor": {"role": self.role}, "sections": {"room": {"id": self.room}}}
        if name == "fametc_cases_get":
            if self.case is None:
                return None
            result = dict(self.case)
            if args.get("includeChildren") and self.approvals is not None:
                result["approvals"] = self.approvals
            return result
        return {"ok": True}

    @property
    def events(self):
        return [args for name, args in self.calls if name == "fametc_cases_add_step"]


class ReservationWorkflowTests(unittest.TestCase):
    def write_har(self, entries):
        handle = tempfile.NamedTemporaryFile("w", suffix=".har", delete=False)
        with handle:
            json.dump({"log": {"entries": entries}}, handle)
        path = Path(handle.name)
        path.chmod(0o600)
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        return path

    def entry(self, *, method="GET", origin="https://reservations.example.test",
              payload=None, status=200, extra_query=""):
        return {"request": {"method": method,
                "url": origin + "/reservations/AB%2FCD%2042?surname=DOE" + extra_query,
                "headers": [{"name": "Cookie", "value": RAW_COOKIE}]},
                "response": {"status": status, "content": {"mimeType": "application/json",
                "text": json.dumps(payload if payload is not None else response())}}}

    def test_learn_then_reuse_uses_current_credentials_and_never_retains_secrets(self):
        captured = self.write_har([self.entry()])
        first_mcp, persisted = FakeMcp(), []
        expected_url = "https://reservations.example.test/reservations/AB%2FCD%2042?surname=DOE"

        def fetch(url, headers):
            self.assertEqual(expected_url, url)
            self.assertEqual({"cookie": RAW_COOKIE, "accept": "application/json"}, headers)
            return response()

        def persist(saved):
            persisted.append(saved)
            return "fametc-action-airline-reservation-lookup"

        learned = workflow.run(recipe(), runtime(), har_path=captured, fetch=fetch, mcp=first_mcp, persist=persist)
        self.assertFalse(captured.exists())
        self.assertEqual("completed", learned["caseState"])
        self.assertEqual([{"origin": "BKK", "destination": "SIN", "departure": "2026-10-21T09:30:00Z"}], learned["itinerary"])
        self.assertNotIn("passenger", json.dumps(learned))
        self.assertEqual("capability.workflow.learned", first_mcp.events[-1]["kind"])
        self.assertEqual("completed", [args["state"] for name, args in first_mcp.calls
                                       if name == "fametc_cases_transition"][-1])
        persisted_text = json.dumps(persisted[0])
        self.assertNotIn(RAW_COOKIE, persisted_text)
        self.assertNotIn(RAW_TOKEN, persisted_text)

        reused_mcp = FakeMcp(case={"roomId": "family", "state": "researching"})
        new_runtime = runtime(actorToken="new-sentinel-token", headers={"cookie": "new-sentinel-cookie"})
        reused = workflow.run(persisted[0], new_runtime, fetch=lambda url, headers: (
            self.assertEqual("new-sentinel-cookie", headers["cookie"]) or response()), mcp=reused_mcp)
        self.assertTrue(reused["ok"])
        self.assertEqual("capability.workflow.reused", reused_mcp.events[-1]["kind"])
        audit = json.dumps([event["output"] for event in reused_mcp.events])
        self.assertNotIn("new-sentinel-cookie", audit)
        self.assertNotIn("new-sentinel-token", audit)

    def test_refuses_untrusted_context_before_fetch_and_keeps_provider_unreached(self):
        for mcp in (FakeMcp(role="kid"), FakeMcp(room="other"), FakeMcp(case=None),
                    FakeMcp(case={"roomId": "family", "state": "proposal_ready"}),
                    FakeMcp(approvals=[{"id": "already-approved"}])):
            with self.subTest(mcp=mcp.role, room=mcp.room, case=mcp.case):
                fetched = []
                with self.assertRaises(workflow.WorkflowError):
                    workflow.run(recipe(verifiedAt=datetime.now(timezone.utc).isoformat()), runtime(),
                                 fetch=lambda *_: fetched.append(True), mcp=mcp)
                self.assertEqual([], fetched)

    def test_existing_approval_denies_learn_before_fetch_or_persist(self):
        har = self.write_har([self.entry()])
        fetched, persisted = [], []
        with self.assertRaisesRegex(workflow.WorkflowError, "CASE_NOT_READY"):
            workflow.run(recipe(), runtime(), har_path=har,
                         fetch=lambda *_: fetched.append(True),
                         persist=lambda saved: persisted.append(saved),
                         mcp=FakeMcp(approvals=[{"id": "approval-1"}]))
        self.assertEqual([], fetched)
        self.assertEqual([], persisted)
        self.assertFalse(har.exists())

    def test_replay_refuses_expired_recipe_and_auth_failure_moves_case_to_waiting(self):
        expired = recipe(verifiedAt=(datetime.now(timezone.utc) - timedelta(days=8)).isoformat())
        mcp = FakeMcp()
        with self.assertRaisesRegex(workflow.WorkflowError, "RELEARN_REQUIRED"):
            workflow.run(expired, runtime(), fetch=lambda *_: self.fail("fetch"), mcp=mcp)
        self.assertEqual("capability.workflow.blocked", mcp.events[-1]["kind"])

        har = self.write_har([self.entry()])
        auth_mcp = FakeMcp()
        with self.assertRaisesRegex(workflow.WorkflowError, "AUTH_REQUIRED"):
            workflow.run(recipe(), runtime(), har_path=har,
                         fetch=lambda *_: (_ for _ in ()).throw(workflow.WorkflowError("AUTH_REQUIRED")),
                         mcp=auth_mcp, persist=lambda _: self.fail("persist"))
        self.assertFalse(har.exists())
        self.assertEqual("waiting_for_input", [args["state"] for name, args in auth_mcp.calls
                                                 if name == "fametc_cases_transition"][-1])

    def test_capture_validation_and_cleanup_rejects_ambiguous_wrong_or_unverified_requests(self):
        cases = [
            ("ambiguous", [self.entry(), self.entry()], "AMBIGUOUS_CAPTURE"),
            ("post", [self.entry(method="POST")], "AMBIGUOUS_CAPTURE"),
            ("origin", [self.entry(origin="https://evil.example.test")], "AMBIGUOUS_CAPTURE"),
            ("query", [self.entry(extra_query="&extra=x")], "AMBIGUOUS_CAPTURE"),
            ("schema", [self.entry(payload={"segments": [{"from": "BKK"}]})], "SCHEMA_DRIFT"),
        ]
        for label, entries, code in cases:
            with self.subTest(label=label):
                har = self.write_har(entries)
                with self.assertRaisesRegex(workflow.WorkflowError, code):
                    workflow.from_har(recipe(), har)
                self.assertFalse(har.exists())

    def test_recipe_request_and_capture_replay_boundaries(self):
        with self.assertRaisesRegex(workflow.WorkflowError, "UNSUPPORTED_WORKFLOW"):
            workflow.validate_recipe(recipe(method="POST"))
        with self.assertRaisesRegex(workflow.WorkflowError, "INVALID_ORIGIN"):
            workflow.validate_recipe(recipe(origin="http://reservations.example.test"))
        with self.assertRaisesRegex(workflow.WorkflowError, "RUNTIME_INPUT_REQUIRED"):
            workflow.request_for(recipe(), runtime(headers={}))
        with self.assertRaisesRegex(workflow.WorkflowError, "INVALID_RUNTIME"):
            workflow.run(recipe(), [], mcp=FakeMcp())
        with self.assertRaisesRegex(workflow.WorkflowError, "UNREVIEWED_PATH_LITERAL"):
            workflow.run(recipe(path="/reservations/ABC123/SMITH"), runtime(),
                         fetch=lambda *_: self.fail("fetch"), mcp=FakeMcp(), persist=lambda _: self.fail("persist"))

        har = self.write_har([self.entry()])
        with self.assertRaisesRegex(workflow.WorkflowError, "CAPTURE_REPLAY_MISMATCH"):
            workflow.run(recipe(), runtime(), har_path=har,
                         fetch=lambda *_: {"segments": [{"from": "BKK", "to": "SIN", "at": "2026-10-22T09:30:00Z"}]},
                         mcp=FakeMcp(), persist=lambda _: self.fail("persist"))
        self.assertFalse(har.exists())

    def test_save_refusal_does_not_report_learned_success(self):
        har = self.write_har([self.entry()])
        mcp = FakeMcp()
        with self.assertRaisesRegex(workflow.WorkflowError, "SKILL_SAVE_PENDING_OR_REFUSED"):
            workflow.run(recipe(), runtime(), har_path=har, fetch=lambda *_: response(), mcp=mcp,
                         persist=lambda _: (_ for _ in ()).throw(workflow.WorkflowError("SKILL_SAVE_PENDING_OR_REFUSED")))
        self.assertFalse(har.exists())
        self.assertNotIn("capability.workflow.learned", [event["kind"] for event in mcp.events])

    def test_native_skill_manager_save_receives_only_serialized_recipe(self):
        calls = []
        tools_module = types.ModuleType("tools")
        manager_module = types.ModuleType("tools.skill_manager_tool")
        skills_module = types.ModuleType("tools.skills_tool")

        def skill_manage(**kwargs):
            calls.append(kwargs)
            return json.dumps({"success": True})

        manager_module.skill_manage = skill_manage
        skills_module.skill_view = lambda *_args, **_kwargs: json.dumps({"success": False})
        previous = {name: sys.modules.get(name) for name in ("tools", "tools.skill_manager_tool", "tools.skills_tool")}
        sys.modules["tools"] = tools_module
        sys.modules["tools.skill_manager_tool"] = manager_module
        sys.modules["tools.skills_tool"] = skills_module
        try:
            name = workflow.save_skill(recipe(verifiedAt="2026-10-20T00:00:00+00:00"))
        finally:
            for module_name, module in previous.items():
                if module is None:
                    sys.modules.pop(module_name, None)
                else:
                    sys.modules[module_name] = module
        self.assertEqual("fametc-action-airline-reservation-lookup", name)
        self.assertEqual("create", calls[0]["action"])
        self.assertNotIn(RAW_COOKIE, calls[0]["content"])
        self.assertNotIn(RAW_TOKEN, calls[0]["content"])

    def test_native_skill_manager_staged_save_is_refused(self):
        tools_module = types.ModuleType("tools")
        manager_module = types.ModuleType("tools.skill_manager_tool")
        skills_module = types.ModuleType("tools.skills_tool")
        calls = []
        manager_module.skill_manage = lambda **kwargs: calls.append(kwargs) or json.dumps({"success": True, "staged": True})
        skills_module.skill_view = lambda *_args, **_kwargs: json.dumps({
            "success": True, "content": workflow.skill_content(recipe()) + "\nCustom text.\n"})
        previous = {name: sys.modules.get(name) for name in ("tools", "tools.skill_manager_tool", "tools.skills_tool")}
        sys.modules["tools"] = tools_module
        sys.modules["tools.skill_manager_tool"] = manager_module
        sys.modules["tools.skills_tool"] = skills_module
        try:
            with self.assertRaisesRegex(workflow.WorkflowError, "SKILL_SAVE_PENDING_OR_REFUSED"):
                workflow.save_skill(recipe())
        finally:
            for module_name, module in previous.items():
                if module is None:
                    sys.modules.pop(module_name, None)
                else:
                    sys.modules[module_name] = module
        self.assertEqual("patch", calls[0]["action"])

    def test_expired_recipe_relearns_by_patching_only_recipe_and_preserving_custom_skill_text(self):
        prior = recipe(verifiedAt=(datetime.now(timezone.utc) - timedelta(days=8)).isoformat())
        stored = {"content": workflow.skill_content(prior) + "\nCustom operator instruction stays intact.\n"}
        calls = []
        tools_module = types.ModuleType("tools")
        manager_module = types.ModuleType("tools.skill_manager_tool")
        skills_module = types.ModuleType("tools.skills_tool")

        def skill_view(name, preprocess=False):
            self.assertEqual("fametc-action-airline-reservation-lookup", name)
            self.assertFalse(preprocess)
            return json.dumps({"success": True, "content": stored["content"]})

        def skill_manage(**kwargs):
            calls.append(kwargs)
            self.assertEqual("patch", kwargs["action"])
            stored["content"] = stored["content"].replace(kwargs["old_string"], kwargs["new_string"])
            return json.dumps({"success": True})

        manager_module.skill_manage = skill_manage
        skills_module.skill_view = skill_view
        previous = {name: sys.modules.get(name) for name in ("tools", "tools.skill_manager_tool", "tools.skills_tool")}
        sys.modules.update({"tools": tools_module, "tools.skill_manager_tool": manager_module,
                            "tools.skills_tool": skills_module})
        try:
            with self.assertRaisesRegex(workflow.WorkflowError, "RELEARN_REQUIRED"):
                workflow.run(prior, runtime(), fetch=lambda *_: self.fail("fetch"), mcp=FakeMcp())
            har = self.write_har([self.entry()])
            learned = workflow.run(recipe(), runtime(), har_path=har, fetch=lambda *_: response(), mcp=FakeMcp())
        finally:
            for module_name, module in previous.items():
                if module is None:
                    sys.modules.pop(module_name, None)
                else:
                    sys.modules[module_name] = module
        self.assertTrue(learned["ok"])
        self.assertFalse(har.exists())
        self.assertEqual("patch", calls[0]["action"])
        self.assertIn("Custom operator instruction stays intact.", stored["content"])
        updated = json.loads(calls[0]["new_string"].split("```json\n", 1)[1].rsplit("\n```", 1)[0])
        self.assertGreater(datetime.fromisoformat(updated["verifiedAt"]), datetime.fromisoformat(prior["verifiedAt"]))

    def test_cli_invalid_recipe_deletes_private_har_before_emitting_error(self):
        har = self.write_har([self.entry()])
        recipe_file = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        with recipe_file:
            json.dump(recipe(unexpected=True), recipe_file)
        recipe_path = Path(recipe_file.name)
        self.addCleanup(lambda: recipe_path.unlink(missing_ok=True))
        completed = subprocess.run(
            [sys.executable, str(SCRIPT), "learn", "--recipe", str(recipe_path), "--har", str(har)],
            input=json.dumps(runtime()), text=True, capture_output=True, check=False,
        )
        self.assertEqual(1, completed.returncode)
        self.assertEqual("INVALID_RECIPE", json.loads(completed.stdout)["code"])
        self.assertFalse(har.exists())


if __name__ == "__main__":
    unittest.main()

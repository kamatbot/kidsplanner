#!/usr/bin/env python3
"""Verify and reuse one reviewed GET reservation request through Hermes skills.

Sensitive runtime input is JSON on stdin; neither argv nor saved skills hold it.
HAR capture uses Hermes's existing har-derived-api-client skill. The supplied
private HAR is consumed (deleted) on success AND failure, before any output.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import ssl
import sys
from urllib.parse import parse_qsl, quote, urlencode, urlsplit
import uuid

MAX_BYTES = 2 * 1024 * 1024
NAME = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
FIELDS = {"origin", "destination", "departure", "arrival", "flight"}
# ponytail: only reviewed generic route literals; other provider routes need a
# separately reviewed vocabulary extension, never literal account identifiers.
PATH_LITERALS = {"api", "v1", "v2", "v3", "reservation", "reservations", "booking", "bookings", "lookup", "itinerary", "trip", "trips", "retrieve", "details"}


class WorkflowError(Exception):
    """Only static error codes may cross the secret-bearing runtime boundary."""


def validate_recipe(recipe):
    required = {"service", "origin", "path", "query", "headers", "segments", "fields", "method", "effect"}
    if not isinstance(recipe, dict) or not required <= recipe.keys() or recipe.keys() - required - {"verifiedAt"}:
        raise WorkflowError("INVALID_RECIPE")
    origin = urlsplit(recipe["origin"])
    if (origin.scheme != "https" or not origin.hostname or origin.username or origin.password
            or origin.port not in (None, 443) or origin.path or origin.query or origin.fragment):
        raise WorkflowError("INVALID_ORIGIN")
    if recipe["method"] != "GET" or recipe["effect"] != "read-only" or not NAME.fullmatch(recipe["service"]):
        raise WorkflowError("UNSUPPORTED_WORKFLOW")
    if not re.fullmatch(r"/(?:[A-Za-z0-9_./~-]|\{[a-z][a-z0-9_]*\})*", recipe["path"]) or ".." in recipe["path"] or recipe["path"].startswith("//"):
        raise WorkflowError("INVALID_PATH")
    if any(part and part not in PATH_LITERALS and not re.fullmatch(r"\{[a-z][a-z0-9_]*\}", part) for part in recipe["path"].split("/")):
        raise WorkflowError("UNREVIEWED_PATH_LITERAL")
    for collection in (recipe["query"], recipe["headers"]):
        if not isinstance(collection, list) or len(collection) > 12 or len(set(collection)) != len(collection) or not all(isinstance(name, str) and NAME.fullmatch(name) for name in collection):
            raise WorkflowError("INVALID_INPUT_NAMES")
    if any(name not in {"authorization", "cookie", "user-agent", "x-csrf-token", "x-xsrf-token"} for name in recipe["headers"]):
        raise WorkflowError("UNSUPPORTED_HEADER")
    fields = recipe["fields"]
    if not isinstance(fields, dict) or not {"origin", "destination", "departure"} <= fields.keys() or fields.keys() - FIELDS:
        raise WorkflowError("INVALID_FIELDS")
    for pointer in [recipe["segments"], *fields.values()]:
        if not isinstance(pointer, str) or not re.fullmatch(r"(?:/[A-Za-z_][A-Za-z0-9_]*|/[0-9]+)*", pointer):
            raise WorkflowError("INVALID_POINTER")
    return recipe


def pointer_value(data, pointer):
    try:
        for part in pointer.split("/")[1:]:
            data = data[int(part)] if isinstance(data, list) else data[part]
        return data
    except (KeyError, IndexError, TypeError, ValueError):
        raise WorkflowError("SCHEMA_DRIFT") from None


def project(recipe, data):
    segments = pointer_value(data, recipe["segments"])
    if not isinstance(segments, list) or not 1 <= len(segments) <= 12:
        raise WorkflowError("SCHEMA_DRIFT")
    result = []
    for segment in segments:
        item = {}
        for field, pointer in recipe["fields"].items():
            value = pointer_value(segment, pointer)
            if not isinstance(value, str):
                raise WorkflowError("SCHEMA_DRIFT")
            if field in {"origin", "destination"}:
                valid = re.fullmatch(r"[A-Z]{3}", value)
            elif field == "flight":
                valid = re.fullmatch(r"[A-Z0-9]{2,3}\s?[0-9]{1,4}[A-Z]?", value)
            else:
                valid = re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})", value)
                if valid:
                    try:
                        datetime.fromisoformat(value.replace("Z", "+00:00"))
                    except ValueError:
                        valid = False
            if not valid:
                raise WorkflowError("SCHEMA_DRIFT")
            item[field] = value
        result.append(item)
    return result


def fetch_json(url, headers, body=None):
    """Public HTTPS only; pin the validated DNS address, keep TLS SNI, no redirects."""
    target = urlsplit(url)
    if target.scheme != "https" or not target.hostname or target.username or target.password or target.port not in (None, 443) or target.fragment:
        raise WorkflowError("INVALID_ORIGIN")
    try:
        addresses = socket.getaddrinfo(target.hostname, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(entry[4][0]).is_global for entry in addresses):
            raise WorkflowError("NON_PUBLIC_ORIGIN")
        conn = http.client.HTTPSConnection(target.hostname, 443, timeout=20)
        sock = socket.create_connection((addresses[0][4][0], 443), timeout=20)
        try:
            conn.sock = ssl.create_default_context().wrap_socket(sock, server_hostname=target.hostname)
            conn.request("POST" if body is not None else "GET", target.path + ("?" + target.query if target.query else ""), body=body, headers=headers)
            response = conn.getresponse()
            if response.status in (401, 403):
                raise WorkflowError("AUTH_REQUIRED")
            if response.status != 200 or response.getheader("Content-Type", "").split(";")[0].strip().lower() != "application/json":
                raise WorkflowError("UNVERIFIED_RESPONSE")
            raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise WorkflowError("RESPONSE_TOO_LARGE")
            return json.loads(raw)
        finally:
            conn.close()
            sock.close()
    except WorkflowError:
        raise
    except Exception:
        raise WorkflowError("REQUEST_FAILED") from None


def request_for(recipe, runtime):
    inputs = runtime.get("inputs", {})
    supplied_headers = runtime.get("headers", {})
    if not isinstance(inputs, dict) or not isinstance(supplied_headers, dict):
        raise WorkflowError("RUNTIME_INPUT_REQUIRED")
    needed = set(re.findall(r"\{([a-z][a-z0-9_]*)\}", recipe["path"])) | set(recipe["query"])
    if any(not isinstance(inputs.get(name), str) or not inputs[name] or len(inputs[name]) > 1024 or inputs[name] in {".", ".."} for name in needed):
        raise WorkflowError("RUNTIME_INPUT_REQUIRED")
    try:
        path = re.sub(r"\{([a-z][a-z0-9_]*)\}", lambda match: quote(str(inputs[match[1]]), safe=""), recipe["path"])
        query = urlencode([(name, inputs[name]) for name in recipe["query"]])
        headers = {name: supplied_headers[name] for name in recipe["headers"]}
    except (KeyError, TypeError):
        raise WorkflowError("RUNTIME_INPUT_REQUIRED") from None
    if any(not isinstance(value, str) or not value or len(value) > 16384 or "\r" in value or "\n" in value for value in headers.values()):
        raise WorkflowError("INVALID_RUNTIME_HEADER")
    headers["accept"] = "application/json"
    return recipe["origin"] + path + ("?" + query if query else ""), headers


def from_har(recipe, har_path):
    path = Path(har_path)
    # Captures are task-owned private temporary files, never an arbitrary symlink.
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise WorkflowError("PRIVATE_HAR_REQUIRED")
    try:
        if path.stat().st_size > 16 * MAX_BYTES:
            raise WorkflowError("HAR_TOO_LARGE")
        data = json.loads(path.read_text())
        pattern = re.escape(recipe["path"])
        names = re.findall(r"\{([a-z][a-z0-9_]*)\}", recipe["path"])
        for name in names:
            pattern = pattern.replace(re.escape("{" + name + "}"), "([^/?]+)", 1)
        matches = []
        for entry in data["log"]["entries"]:
            request = entry["request"]
            url = urlsplit(request["url"])
            match = re.fullmatch(pattern, url.path)
            if request["method"] != "GET" or f"{url.scheme}://{url.netloc}" != recipe["origin"] or not match:
                continue
            query = parse_qsl(url.query, keep_blank_values=True)
            if sorted(name for name, _ in query) != sorted(recipe["query"]):
                continue
            from urllib.parse import unquote
            runtime = {"inputs": {**dict(query), **dict(zip(names, map(unquote, match.groups())))}, "headers": {h["name"].lower(): h["value"] for h in request.get("headers", [])}}
            response = entry["response"]
            content = response.get("content", {})
            if response.get("status") != 200 or "application/json" not in content.get("mimeType", "") or content.get("encoding"):
                raise WorkflowError("UNVERIFIED_CAPTURE")
            matches.append((runtime, project(recipe, json.loads(content["text"]))))
        if len(matches) != 1:
            raise WorkflowError("AMBIGUOUS_CAPTURE")
        return matches[0]
    except WorkflowError:
        raise
    except Exception:
        raise WorkflowError("INVALID_CAPTURE") from None
    finally:
        path.unlink()


def bridge_call(name, args):
    # Fixed FamETC origin: provider credentials are never sent to the bridge.
    base = os.environ.get("FAMETC_HERMES_API_URL", "").rstrip("/")
    if base != "https://www.fametc.com/api/hermes":
        raise WorkflowError("BRIDGE_CONFIG_REQUIRED")
    token = os.environ.get("FAMETC_HERMES_TOKEN", "")
    if not token:
        raise WorkflowError("BRIDGE_CONFIG_REQUIRED")
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}}
    response = fetch_json(base + "/mcp", {"Authorization": "Bearer " + token, "Content-Type": "application/json"}, json.dumps(payload).encode())
    result = response.get("result", {})
    if response.get("error") or result.get("isError") or "structuredContent" not in result:
        raise WorkflowError("BRIDGE_REFUSED")
    return result["structuredContent"]


def skill_content(recipe):
    return ("---\nname: fametc-action-" + recipe["service"] + "-reservation-lookup\n"
            "description: When a FamETC parent needs a verified reservation lookup.\n---\n\n"
            "Use only after the official/API/MCP paths in fametc-platform:action-capability.\n"
            "Requires a current parent actorToken, a family-room Operator case, and runtime\n"
            "session headers/lookup inputs. Never save those values. Run the bundled\n"
            "~/.hermes/plugins/fametc/skills/action-capability/scripts/reservation_workflow.py\n"
            "using ~/.hermes/hermes-agent/venv/bin/python with PYTHONPATH set to\n"
            "~/.hermes/hermes-agent, and `replay --skill <this SKILL.md>`. Substitute\n"
            "the verified installation directory if different. Supply sensitive JSON\n"
            "through stdin, never in a logged command or persistent file.\n"
            "Returns only itinerary segment facts. AUTH_REQUIRED, SCHEMA_DRIFT or expired\n"
            "verification means stop replay and use the supervised browser to reauthenticate\n"
            "or relearn. Never retry with guessed endpoints or headers. No external writes.\n\n"
            "```json\n" + json.dumps(recipe, indent=2, sort_keys=True) + "\n```\n")


def save_skill(recipe):
    from tools.skill_manager_tool import skill_manage
    from tools.skills_tool import skill_view
    name = "fametc-action-" + recipe["service"] + "-reservation-lookup"
    validate_recipe(recipe)
    existing = json.loads(skill_view(name, preprocess=False))
    if existing.get("success"):
        content = existing.get("content", "")
        matches = re.findall(r"```json\n.*?\n```", content, re.DOTALL)
        if len(matches) != 1:
            raise WorkflowError("SKILL_UPDATE_REVIEW_REQUIRED")
        prior = validate_recipe(json.loads(matches[0][8:-4]))
        if prior["service"] != recipe["service"] or prior["origin"] != recipe["origin"]:
            raise WorkflowError("SKILL_UPDATE_REVIEW_REQUIRED")
        replacement = "```json\n" + json.dumps(recipe, indent=2, sort_keys=True) + "\n```"
        result = json.loads(skill_manage(action="patch", name=name, old_string=matches[0], new_string=replacement))
    else:
        result = json.loads(skill_manage(action="create", name=name, content=skill_content(recipe)))
    if result.get("success") is not True or result.get("staged"):
        raise WorkflowError("SKILL_SAVE_PENDING_OR_REFUSED")
    return name


def run(recipe, runtime, *, har_path=None, fetch=fetch_json, mcp=bridge_call, persist=save_skill):
    run_id = uuid.uuid4().hex
    if not isinstance(runtime, dict):
        discard_capture(har_path)
        raise WorkflowError("INVALID_RUNTIME")
    case_id = runtime.get("caseId")
    token = runtime.get("actorToken")
    def call(name, **args):
        return mcp(name, {"actorToken": token, **args})
    def step(kind, state, output):
        return call("fametc_cases_add_step", caseId=case_id, kind=kind, state=state, output=output, idempotencyKey=run_id + ":" + kind)
    authorized = False
    try:
        validate_recipe(recipe)
        context = call("fametc_context_get", purpose="operator-case", sections=["identities", "room"])
        if context.get("actor", {}).get("role") != "parent" or context.get("sections", {}).get("room", {}).get("id") != "family":
            raise WorkflowError("PARENT_FAMILY_ROOM_REQUIRED")
        current = call("fametc_cases_get", caseId=case_id, includeChildren=True)
        if not current or current.get("roomId") != "family" or current.get("approvals") or current.get("state") not in {"draft", "planning", "researching", "waiting_for_input"}:
            raise WorkflowError("CASE_NOT_READY")
        authorized = True
        if current["state"] == "draft":
            call("fametc_cases_transition", caseId=case_id, state="planning")
        if current["state"] != "researching":
            call("fametc_cases_transition", caseId=case_id, state="researching")
        step("capability.route.selected", "completed", {"selectedPath": "browser" if har_path else "learned", "service": recipe["service"], "intent": "reservation-lookup"})
        if har_path:
            session, expected = from_har(recipe, har_path)
        else:
            try:
                verified = datetime.fromisoformat(recipe["verifiedAt"])
                if verified.tzinfo is None or not timedelta(0) <= datetime.now(timezone.utc) - verified <= timedelta(days=7):
                    raise ValueError()
            except (KeyError, ValueError, TypeError):
                raise WorkflowError("RELEARN_REQUIRED") from None
            session, expected = runtime, None
        url, headers = request_for(recipe, session)
        itinerary = project(recipe, fetch(url, headers))
        if expected is not None and itinerary != expected:
            raise WorkflowError("CAPTURE_REPLAY_MISMATCH")
        if har_path:
            recipe = {**recipe, "verifiedAt": datetime.now(timezone.utc).isoformat()}
            name = persist(recipe)
            kind = "capability.workflow.learned"
        else:
            name = "fametc-action-" + recipe["service"] + "-reservation-lookup"
            kind = "capability.workflow.reused"
        step(kind, "completed", {"skill": name, "verified": True, "effect": "read-only", "intent": "reservation-lookup", "segmentCount": len(itinerary)})
        call("fametc_cases_transition", caseId=case_id, state="completed")
        return {"ok": True, "skill": name, "itinerary": itinerary, "caseState": "completed"}
    except Exception as error:
        code = str(error) if isinstance(error, WorkflowError) else "WORKFLOW_FAILED"
        if authorized:
            try:
                step("capability.workflow.blocked", "blocked", {"code": code})
                call("fametc_cases_transition", caseId=case_id, state="waiting_for_input")
            except Exception:
                pass
        raise WorkflowError(code) from None
    finally:
        discard_capture(har_path)


def discard_capture(har_path):
    if har_path:
        capture = Path(har_path)
        if capture.is_file() and not capture.is_symlink() and not capture.stat().st_mode & 0o077:
            capture.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["learn", "replay"])
    parser.add_argument("--recipe", type=Path)
    parser.add_argument("--skill", type=Path)
    parser.add_argument("--har", type=Path)
    args = parser.parse_args()
    try:
        if args.mode == "learn" and (not args.har or not args.recipe) or args.mode == "replay" and args.har:
            raise WorkflowError("INVALID_ARGUMENTS")
        if args.skill:
            recipe = json.loads(args.skill.read_text().split("```json\n", 1)[1].split("```", 1)[0])
        else:
            recipe = json.loads(args.recipe.read_text())
        raw = sys.stdin.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise WorkflowError("INPUT_TOO_LARGE")
        print(json.dumps(run(recipe, json.loads(raw), har_path=args.har)))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "code": str(error) if isinstance(error, WorkflowError) else "WORKFLOW_FAILED", "fallback": "browser"}))
        return 1
    finally:
        discard_capture(args.har)


if __name__ == "__main__":
    sys.exit(main())

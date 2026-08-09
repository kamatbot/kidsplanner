"""Hermes platform adapter for a FamETC family connection.

The FamETC server owns room authorization and mention filtering. This adapter
only keeps the per-room cursors, turns bridge messages into Hermes events, and
sends the generated reply back to the originating room. It uses urllib from
the Python standard library so a local Hermes installation needs no extra
package.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import (
    BasePlatformAdapter,
    MessageEvent,
    MessageType,
    SendResult,
)

logger = logging.getLogger(__name__)

_API_URL_ENV = "FAMETC_HERMES_API_URL"
_TOKEN_ENV = "FAMETC_HERMES_TOKEN"
_POLL_ENV = "FAMETC_HERMES_POLL_SECONDS"
_MAX_RESPONSE_BYTES = 4 * 1024 * 1024
_MAX_MESSAGE_LENGTH = 4000
_MAX_BACKOFF_SECONDS = 60.0
_EMPTY_CURSOR = "__hermes_empty__"


class _BridgeError(Exception):
    """An HTTP/transport failure without carrying response bodies or secrets."""


def _poll_seconds(extra: Dict[str, Any]) -> float:
    raw = os.getenv(_POLL_ENV, "").strip() or str(extra.get("poll_seconds", "") or "").strip()
    try:
        return min(300.0, max(1.0, float(raw))) if raw else 10.0
    except (TypeError, ValueError):
        return 10.0


def _valid_api_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
    except ValueError:
        return False
    if not parsed.netloc or parsed.username or parsed.password or not hostname:
        return False
    if parsed.scheme == "https":
        return True
    # Permit loopback HTTP for a local FamETC development server only; bearer
    # tokens must never be sent to a non-local clear-text endpoint.
    return parsed.scheme == "http" and hostname.lower().rstrip(".") in {"localhost", "127.0.0.1", "::1"}


def check_requirements() -> bool:
    """The adapter has no optional SDK dependencies."""
    return True


def validate_config(config: PlatformConfig) -> bool:
    extra = getattr(config, "extra", {}) or {}
    api_url = os.getenv(_API_URL_ENV, "").strip() or str(extra.get("api_url", "") or "").strip()
    token = os.getenv(_TOKEN_ENV, "").strip() or str(extra.get("token", "") or "").strip()
    return bool(api_url and token and _valid_api_url(api_url))


def is_connected(config: PlatformConfig) -> bool:
    return validate_config(config)


def _env_enablement() -> Optional[dict]:
    api_url = os.getenv(_API_URL_ENV, "").strip()
    token = os.getenv(_TOKEN_ENV, "").strip()
    if not (api_url and token and _valid_api_url(api_url)):
        return None
    seed: Dict[str, Any] = {"api_url": api_url, "token": token}
    poll = os.getenv(_POLL_ENV, "").strip()
    if poll:
        try:
            seed["poll_seconds"] = float(poll)
        except ValueError:
            pass
    return seed


class FamETCAdapter(BasePlatformAdapter):
    """Outbound HTTPS + long-poll adapter for one FamETC family token."""

    def __init__(self, config: PlatformConfig):
        super().__init__(config, Platform("fametc"))
        extra = getattr(config, "extra", {}) or {}
        self.api_url = os.getenv(_API_URL_ENV, "").strip() or str(extra.get("api_url", "") or "").strip()
        self.token = os.getenv(_TOKEN_ENV, "").strip() or str(extra.get("token", "") or "").strip()
        self.poll_seconds = _poll_seconds(extra)
        self._running = False
        self._supervisor_task: Optional[asyncio.Task] = None
        self._room_tasks: Dict[str, asyncio.Task] = {}
        self._rooms: Dict[str, Dict[str, str]] = {}
        self._cursors: Dict[str, str] = {}

    def _url(self, path: str) -> str:
        return f"{self.api_url.rstrip('/')}/{path.lstrip('/')}"

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        payload: Optional[dict] = None,
        wait: bool = False,
    ) -> dict:
        data = None
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.token}",
        }
        if payload is not None:
            data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(self._url(path), data=data, headers=headers, method=method)
        timeout = max(35.0, self.poll_seconds + 30.0) if wait else 15.0
        try:
            with urlopen(request, timeout=timeout) as response:
                raw = response.read(_MAX_RESPONSE_BYTES + 1)
        except HTTPError as exc:
            try:
                exc.close()
            except Exception:
                pass
            raise _BridgeError("FamETC HTTP request failed") from None
        except (URLError, TimeoutError, OSError):
            raise _BridgeError("FamETC network request failed") from None
        if len(raw) > _MAX_RESPONSE_BYTES:
            raise _BridgeError("FamETC response was too large")
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise _BridgeError("FamETC returned an invalid response") from None
        if not isinstance(value, dict):
            raise _BridgeError("FamETC returned an invalid response")
        return value

    async def _request(self, method: str, path: str, *, payload: Optional[dict] = None, wait: bool = False) -> dict:
        return await asyncio.to_thread(self._request_json, method, path, payload=payload, wait=wait)

    @staticmethod
    def _room_path(room_id: str) -> str:
        return quote(str(room_id), safe="")

    async def _list_rooms(self) -> list:
        response = await self._request("GET", "/rooms")
        rooms = response.get("rooms")
        if not isinstance(rooms, list):
            raise _BridgeError("FamETC returned an invalid room list")
        valid = []
        for room in rooms:
            if not isinstance(room, dict):
                continue
            room_id = room.get("roomId")
            if not isinstance(room_id, str) or not room_id:
                continue
            valid.append({
                "roomId": room_id,
                "title": str(room.get("title") or room_id),
                "kind": str(room.get("kind") or "group"),
            })
        return valid

    async def _poll_room(self, room_id: str, cursor: Optional[str]) -> dict:
        query = {"wait": "1"}
        if cursor:
            query["afterId"] = cursor
        path = f"/rooms/{self._room_path(room_id)}/messages?{urlencode(query)}"
        return await self._request("GET", path, wait=bool(cursor))

    async def _send_room(self, room_id: str, content: str) -> dict:
        path = f"/rooms/{self._room_path(room_id)}/messages"
        return await self._request("POST", path, payload={"text": content})

    async def _reconcile_rooms(self, rooms: list) -> None:
        next_rooms = {room["roomId"]: room for room in rooms}
        removed = set(self._rooms) - set(next_rooms)
        for room_id in removed:
            task = self._room_tasks.pop(room_id, None)
            if task and not task.done():
                task.cancel()
            self._cursors.pop(room_id, None)
        self._rooms = next_rooms
        for room_id in next_rooms:
            task = self._room_tasks.get(room_id)
            if task is None or task.done():
                self._room_tasks[room_id] = asyncio.create_task(self._room_loop(room_id))

    async def _room_loop(self, room_id: str) -> None:
        backoff = self.poll_seconds
        while self._running and room_id in self._rooms:
            try:
                result = await self._poll_room(room_id, self._cursors.get(room_id))
                if "cursor" not in result:
                    raise _BridgeError("FamETC returned an invalid message cursor")
                cursor = result.get("cursor")
                if cursor == "" or (cursor is not None and not isinstance(cursor, str)):
                    raise _BridgeError("FamETC returned an invalid message cursor")
                if isinstance(cursor, str) and cursor:
                    self._cursors[room_id] = cursor
                elif cursor is None and room_id not in self._cursors:
                    # The bridge returns null for an empty room. Preserve a
                    # continuation marker so a first message arriving after
                    # discovery is not mistaken for initial history.
                    self._cursors[room_id] = _EMPTY_CURSOR
                messages = result.get("messages")
                if not isinstance(messages, list):
                    raise _BridgeError("FamETC returned an invalid message list")
                room = self._rooms.get(room_id, {})
                for message in messages:
                    await self._handle_message(room, message)
                backoff = self.poll_seconds
            except asyncio.CancelledError:
                raise
            except _BridgeError:
                logger.warning("FamETC room polling failed; retrying in %.1fs", backoff)
                await asyncio.sleep(backoff)
                backoff = min(_MAX_BACKOFF_SECONDS, max(self.poll_seconds, backoff * 2))
            except Exception:
                logger.warning("FamETC room polling failed; retrying in %.1fs", backoff)
                await asyncio.sleep(backoff)
                backoff = min(_MAX_BACKOFF_SECONDS, max(self.poll_seconds, backoff * 2))

    @staticmethod
    def _message_timestamp(value: Any) -> datetime:
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                pass
        return datetime.now()

    async def _handle_message(self, room: Dict[str, str], message: Any) -> None:
        if not isinstance(message, dict):
            return
        text = message.get("text")
        if not isinstance(text, str) or not text:
            return
        room_id = room.get("roomId", "")
        sender_id = message.get("senderId")
        sender_name = message.get("senderName") or "FamETC member"
        source = self.build_source(
            chat_id=room_id,
            chat_name=room.get("title") or room_id,
            chat_type="group",
            # The bridge token authenticates the whole family. A stable
            # adapter identity keeps Hermes on one session per room even when
            # different family members trigger it.
            user_id="fametc",
            user_name=str(sender_name),
            message_id=str(message.get("id") or ""),
            role_authorized=True,
        )
        event = MessageEvent(
            text=text,
            message_type=MessageType.TEXT,
            user_id=str(sender_id) if sender_id else None,
            user_name=str(sender_name),
            source=source,
            message_id=str(message.get("id") or ""),
            # Keep raw_message metadata small so accidental debug output never
            # includes a full FamETC message body.
            raw_message={"id": message.get("id"), "roomId": room_id},
            timestamp=self._message_timestamp(message.get("createdAt")),
        )
        await self.handle_message(event)

    async def _supervise(self) -> None:
        backoff = self.poll_seconds
        while self._running:
            try:
                await self._reconcile_rooms(await self._list_rooms())
                backoff = self.poll_seconds
                await asyncio.sleep(self.poll_seconds)
            except asyncio.CancelledError:
                raise
            except _BridgeError:
                logger.warning("FamETC room discovery failed; retrying in %.1fs", backoff)
                await asyncio.sleep(backoff)
                backoff = min(_MAX_BACKOFF_SECONDS, max(self.poll_seconds, backoff * 2))
            except Exception:
                logger.warning("FamETC room discovery failed; retrying in %.1fs", backoff)
                await asyncio.sleep(backoff)
                backoff = min(_MAX_BACKOFF_SECONDS, max(self.poll_seconds, backoff * 2))

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        if not validate_config(self.config):
            logger.error("FamETC adapter is missing its API URL or token")
            return False
        if self._running:
            return True
        self._running = True
        self._mark_connected()
        self._supervisor_task = asyncio.create_task(self._supervise())
        return True

    async def disconnect(self) -> None:
        self._running = False
        tasks = list(self._room_tasks.values())
        self._room_tasks.clear()
        if self._supervisor_task is not None:
            tasks.append(self._supervisor_task)
            self._supervisor_task = None
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._rooms.clear()
        self._mark_disconnected()

    async def send(self, chat_id, content, reply_to=None, metadata=None):
        text = str(content or "")[:_MAX_MESSAGE_LENGTH]
        if not text:
            return SendResult(success=False, error="FamETC message is empty")
        try:
            response = await self._send_room(str(chat_id), text)
        except _BridgeError:
            # A POST may have reached the server before a client-side timeout;
            # do not retry automatically and risk duplicate replies.
            logger.warning("FamETC reply delivery failed")
            return SendResult(success=False, error="FamETC reply delivery failed", retryable=False)
        except Exception:
            logger.warning("FamETC reply delivery failed")
            return SendResult(success=False, error="FamETC reply delivery failed", retryable=False)
        message = response.get("message")
        message_id = message.get("id") if isinstance(message, dict) else None
        return SendResult(success=True, message_id=str(message_id) if message_id else None)

    async def get_chat_info(self, chat_id):
        room = self._rooms.get(str(chat_id))
        return {
            "name": (room or {}).get("title") or str(chat_id),
            "type": "group",
        }


def register(ctx):
    """Plugin entry point called by the Hermes plugin system."""
    ctx.register_platform(
        name="fametc",
        label="FamETC",
        adapter_factory=lambda cfg: FamETCAdapter(cfg),
        check_fn=check_requirements,
        validate_config=validate_config,
        is_connected=is_connected,
        required_env=[_API_URL_ENV, _TOKEN_ENV],
        install_hint="No extra packages needed (Python standard library only)",
        env_enablement_fn=_env_enablement,
        max_message_length=_MAX_MESSAGE_LENGTH,
        pii_safe=True,
        platform_hint=(
            "You are chatting with a FamETC family assistant. The bridge only "
            "forwards messages that explicitly mention @Hermes and routes your "
            "reply back to the current family or trip room."
        ),
        emoji="🏠",
    )


__all__ = [
    "FamETCAdapter",
    "check_requirements",
    "validate_config",
    "register",
]

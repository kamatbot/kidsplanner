"""FamETC Hermes adapter with per-message Family Operator authorization.

The base adapter intentionally keeps one stable Hermes session per FamETC room.
This subclass preserves that behavior while threading the initiating human's
short-lived actor capability into Hermes' *ephemeral* channel prompt. Hermes can
therefore call FamETC MCP tools as the correct parent/kid without putting the
capability in the user-visible message or long-term conversation transcript.
"""
from __future__ import annotations

from typing import Any, Dict

from gateway.platforms.base import MessageEvent, MessageType

from .adapter import (
    FamETCAdapter,
    _API_URL_ENV,
    _MAX_MESSAGE_LENGTH,
    _TOKEN_ENV,
    _env_enablement,
    check_requirements,
    is_connected,
    validate_config,
)


def _operator_channel_prompt(message: Dict[str, Any]) -> str | None:
    """Build trusted, ephemeral execution context from bridge-issued metadata.

    Only the opaque server-signed actor token is interpolated. Display names or
    other family-authored strings are deliberately excluded from the system
    prompt so a profile name can never become a prompt-injection surface.
    """
    actor_token = message.get("actorToken")
    if not isinstance(actor_token, str) or not actor_token.startswith("opact1."):
        return None
    if len(actor_token) > 5000:
        return None
    return (
        "FamETC Family Operator authorization for this single incoming request:\n"
        f"- actorToken: {actor_token}\n"
        "- This opaque token was signed by FamETC for the human who initiated the request. "
        "For FamETC MCP tools that require actorToken, pass it exactly as received; never "
        "replace it with a guessed user, kid, or family id.\n"
        "- Treat the actorToken as a short-lived secret. Do not quote it to the user, place "
        "it in normal assistant prose, or save it to memory.\n"
        "- The token permits only the scoped context/case operations enforced by FamETC. "
        "It is not approval for purchases, bookings, messages, cancellations, payments, "
        "medical/legal attestations, or any other irreversible external action."
    )


class OperatorFamETCAdapter(FamETCAdapter):
    """FamETC platform adapter that preserves actor authority per message."""

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
            # Keep one Hermes session per FamETC room. Human authority is carried
            # separately by the actor capability below; it must not fragment the
            # conversation/session key when different family members participate.
            user_id="fametc",
            user_name=str(sender_name),
            message_id=str(message.get("id") or ""),
            role_authorized=True,
        )

        actor = message.get("actor") if isinstance(message.get("actor"), dict) else {}
        actor_type = actor.get("type") if isinstance(actor.get("type"), str) else None
        event = MessageEvent(
            text=text,
            message_type=MessageType.TEXT,
            user_id=str(sender_id) if sender_id else None,
            user_name=str(sender_name),
            source=source,
            message_id=str(message.get("id") or ""),
            # Keep raw metadata deliberately small and capability-free: raw
            # messages can appear in diagnostics, while channel_prompt is the
            # established Hermes path for ephemeral model-only instructions.
            raw_message={
                "id": message.get("id"),
                "roomId": room_id,
                "actorType": actor_type,
            },
            timestamp=self._message_timestamp(message.get("createdAt")),
            channel_prompt=_operator_channel_prompt(message),
        )
        await self.handle_message(event)


def register(ctx):
    """Plugin entry point called by the Hermes plugin system."""
    ctx.register_platform(
        name="fametc",
        label="FamETC",
        adapter_factory=lambda cfg: OperatorFamETCAdapter(cfg),
        check_fn=check_requirements,
        validate_config=validate_config,
        is_connected=is_connected,
        required_env=[_API_URL_ENV, _TOKEN_ENV],
        install_hint="No extra platform packages needed; install Hermes MCP support for Family Operator tools",
        env_enablement_fn=_env_enablement,
        max_message_length=_MAX_MESSAGE_LENGTH,
        pii_safe=True,
        platform_hint=(
            "You are the FamETC family assistant. The bridge only forwards messages "
            "explicitly addressed to @Hermes. For multi-step family work, use the "
            "FamETC Operator MCP tools and create a durable case. Actor authority is "
            "provided per request by an ephemeral signed token; never infer or widen it."
        ),
        emoji="🏠",
    )


__all__ = ["OperatorFamETCAdapter", "register"]

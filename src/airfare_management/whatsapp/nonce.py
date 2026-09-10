"""Nonce store for WhatsApp button payloads (48h action / 72h anti-replay)."""

from __future__ import annotations

import hashlib
import logging
import secrets
import time
from dataclasses import dataclass
from typing import Any

from redis import Redis
from redis.exceptions import RedisError

LOGGER = logging.getLogger("airfare.whatsapp.nonce")

ALLOWED_ACTIONS = frozenset(
    {
        "APPROVE",
        "REJECT",
        "ESCALATE",
        "SNOOZE",
        "EXT_REQ",
        "CANCEL",
        "DELEG_ACCEPT",
        "DELEG_REJECT",
    }
)


@dataclass(frozen=True)
class ButtonPayload:
    action: str
    external_id: str
    nonce: str
    sent_ts: int


def parse_button_payload(raw: str) -> ButtonPayload:
    parts = (raw or "").split("|")
    if len(parts) != 4:
        raise ValueError("invalid_button_payload")
    action, external_id, nonce, ts_s = parts
    action = action.strip().upper()
    if action not in ALLOWED_ACTIONS:
        raise ValueError("invalid_action")
    if len(external_id) != 36 or external_id.count("-") != 4:
        raise ValueError("external_id_must_be_uuid")
    try:
        sent_ts = int(ts_s)
    except ValueError as exc:
        raise ValueError("invalid_timestamp") from exc
    return ButtonPayload(action=action, external_id=external_id, nonce=nonce.strip(), sent_ts=sent_ts)


def build_button_id(action: str, external_id: str, nonce: str, sent_ts: int | None = None) -> str:
    ts = sent_ts if sent_ts is not None else int(time.time())
    return f"{action.upper()}|{external_id}|{nonce}|{ts}"


def new_nonce() -> str:
    return secrets.token_hex(8)


class NonceStore:
    """Single-use nonce with 48h user TTL and ≤72h anti-replay retention."""

    def __init__(
        self,
        redis_url: str,
        *,
        action_hours: int = 48,
        replay_hours: int = 72,
    ) -> None:
        self.action_seconds = action_hours * 3600
        self.replay_seconds = replay_hours * 3600
        self._memory: dict[str, dict[str, Any]] = {}
        self._redis: Redis | None = None
        try:
            client: Redis = Redis.from_url(
                redis_url, socket_connect_timeout=1, socket_timeout=1, decode_responses=True
            )
            client.ping()
            self._redis = client
        except (RedisError, OSError):
            LOGGER.warning("whatsapp_nonce_store_memory_fallback")

    @staticmethod
    def _key(nonce: str, external_id: str, action: str) -> str:
        raw = f"{nonce}|{external_id}|{action}".encode()
        return "wa:nonce:" + hashlib.sha256(raw).hexdigest()

    def issue(self, *, external_id: str, action: str, recipient_jid: str) -> str:
        nonce = new_nonce()
        key = self._key(nonce, external_id, action.upper())
        record = {
            "nonce": nonce,
            "external_id": external_id,
            "action": action.upper(),
            "jid": recipient_jid,
            "issued_at": int(time.time()),
            "consumed": False,
        }
        self._set(key, record, self.replay_seconds)
        return nonce

    def validate_and_consume(self, payload: ButtonPayload, sender_jid: str) -> str:
        """Return 'ok' or raise ValueError with stable reason codes."""
        now = int(time.time())
        if now - payload.sent_ts > self.action_seconds:
            raise ValueError("expired")
        key = self._key(payload.nonce, payload.external_id, payload.action)
        record = self._get(key)
        if record is None:
            raise ValueError("nonce_unknown")
        if record.get("consumed"):
            raise ValueError("replay")
        if record.get("jid") != sender_jid:
            raise ValueError("jid_mismatch")
        if record.get("external_id") != payload.external_id:
            raise ValueError("id_mismatch")
        if record.get("action") != payload.action:
            raise ValueError("action_mismatch")
        issued = int(record.get("issued_at") or payload.sent_ts)
        if now - issued > self.action_seconds:
            raise ValueError("expired")
        record["consumed"] = True
        record["consumed_at"] = now
        self._set(key, record, self.replay_seconds)
        return "ok"

    def _set(self, key: str, value: dict[str, Any], ttl: int) -> None:
        import json

        if self._redis is not None:
            try:
                self._redis.setex(key, ttl, json.dumps(value))
                return
            except RedisError:
                LOGGER.warning("nonce_redis_set_failed", exc_info=True)
        self._memory[key] = value

    def _get(self, key: str) -> dict[str, Any] | None:
        import json

        if self._redis is not None:
            try:
                raw = self._redis.get(key)
                if raw:
                    loaded = json.loads(str(raw))
                    return loaded if isinstance(loaded, dict) else None
            except RedisError:
                LOGGER.warning("nonce_redis_get_failed", exc_info=True)
        return self._memory.get(key)

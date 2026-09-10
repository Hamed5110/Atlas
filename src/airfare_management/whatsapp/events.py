"""In-process ring buffer for WhatsApp webhook / connection events (admin monitor)."""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any

_LOCK = threading.Lock()
_EVENTS: deque[dict[str, Any]] = deque(maxlen=50)
_INSTANCE_META: dict[str, dict[str, Any]] = {}


def push_event(
    *,
    event_type: str,
    instance: str,
    summary: str,
    detail: dict[str, Any] | None = None,
) -> None:
    row = {
        "ts": time.time(),
        "event_type": event_type,
        "instance": instance,
        "summary": summary,
        "detail": detail or {},
    }
    with _LOCK:
        _EVENTS.appendleft(row)


def list_events(limit: int = 50) -> list[dict[str, Any]]:
    with _LOCK:
        return list(_EVENTS)[: max(1, min(limit, 50))]


def set_instance_meta(instance_name: str, **fields: Any) -> None:
    # Callers often pass **{"name": ...}; param must not be named "name" or Python raises
    # TypeError before we can pop it.
    fields.pop("name", None)
    with _LOCK:
        cur = _INSTANCE_META.get(instance_name, {})
        cur.update(fields)
        cur["name"] = instance_name
        _INSTANCE_META[instance_name] = cur


def get_instance_meta(name: str) -> dict[str, Any] | None:
    with _LOCK:
        return dict(_INSTANCE_META[name]) if name in _INSTANCE_META else None


def list_instance_meta() -> list[dict[str, Any]]:
    with _LOCK:
        return [dict(v) for v in _INSTANCE_META.values()]


# Disconnect recovery outbox (E2E-08) — queue outbound payloads while session closed.
_OUTBOX: deque[dict[str, Any]] = deque(maxlen=200)


def enqueue_outbox(
    *,
    instance: str,
    kind: str,
    payload: dict[str, Any],
    reason: str = "disconnected",
) -> dict[str, Any]:
    row = {
        "id": f"ob-{int(time.time() * 1000)}-{len(_OUTBOX)}",
        "ts": time.time(),
        "instance": instance,
        "kind": kind,
        "payload": payload,
        "reason": reason,
        "status": "queued",
    }
    with _LOCK:
        _OUTBOX.appendleft(row)
    push_event(
        event_type="OUTBOX_QUEUED",
        instance=instance,
        summary=f"{kind} queued ({reason})",
        detail={"id": row["id"]},
    )
    return row


def list_outbox(limit: int = 50) -> list[dict[str, Any]]:
    with _LOCK:
        return [dict(x) for x in list(_OUTBOX)[: max(1, min(limit, 200))]]


def drain_outbox(instance: str) -> list[dict[str, Any]]:
    """Mark queued items for an instance as ready after reconnect (caller re-sends)."""
    ready: list[dict[str, Any]] = []
    with _LOCK:
        for row in _OUTBOX:
            if row.get("instance") == instance and row.get("status") == "queued":
                row["status"] = "ready"
                ready.append(dict(row))
    if ready:
        push_event(
            event_type="OUTBOX_DRAIN",
            instance=instance,
            summary=f"{len(ready)} queued message(s) ready after reconnect",
        )
    return ready

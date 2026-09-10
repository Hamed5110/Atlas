"""True-mode: Evolution byEvents path suffixes must hit the webhook handler (not SPA 405)."""

from __future__ import annotations

from collections.abc import Generator
from typing import Callable
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from airfare_management.api.dependencies import Claims
from airfare_management.api.routers.whatsapp import create_whatsapp_router


def _database() -> Generator[Session, None, None]:
    yield None  # type: ignore[misc]


def _authorized(*_roles: str) -> Callable[[], Claims]:
    def _dep() -> Claims:
        return Claims(subject=uuid4(), roles={"SYSTEM_ADMIN"}, username="test")

    return _dep


def test_webhook_event_suffix_routes_registered() -> None:
    app = FastAPI()
    app.include_router(create_whatsapp_router(_database, _authorized))
    client = TestClient(app)

    # Missing auth → 401 proves route is registered (SPA catch-all would be 405).
    for path in (
        "/v1/webhook/evolution",
        "/v1/webhook/evolution/connection-update",
        "/v1/webhook/evolution/messages-update",
        "/v1/webhook/evolution/messages-upsert",
        "/v1/webhook/evolution/qrcode-updated",
    ):
        resp = client.post(path, json={"event": "probe", "instance": "t", "data": {}})
        assert resp.status_code == 401, f"{path} expected 401 got {resp.status_code}"

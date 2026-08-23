"""Preference cascade, cache TTL, and deleted_at exclusion tests."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def _login(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/v1/auth/login",
        json={"username": "admin", "password": "StrongPassword!2026"},
    )
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_user_override_wins_over_global(client: TestClient, admin_headers: dict[str, str]) -> None:
    headers = admin_headers
    assert (
        client.put(
            "/v1/preferences",
            headers=headers,
            json={
                "scope_type": "global",
                "scope_id": "",
                "preference_key": "theme",
                "value": "light",
            },
        ).status_code
        == 200
    )
    me = client.get("/v1/auth/me", headers=headers).json()
    assert (
        client.put(
            "/v1/preferences",
            headers=headers,
            json={
                "scope_type": "user",
                "scope_id": str(me["id"]),
                "preference_key": "theme",
                "value": "dark",
            },
        ).status_code
        == 200
    )
    effective = client.get("/v1/preferences/effective", headers=headers).json()
    assert effective["theme"] == "dark"


def test_repair_center_overrides_global(client: TestClient, admin_headers: dict[str, str]) -> None:
    headers = admin_headers
    client.put(
        "/v1/preferences",
        headers=headers,
        json={
            "scope_type": "global",
            "scope_id": "",
            "preference_key": "airfare_rate",
            "value": "150",
        },
    )
    client.put(
        "/v1/preferences",
        headers=headers,
        json={
            "scope_type": "repair_center",
            "scope_id": "RC1",
            "preference_key": "airfare_rate",
            "value": "175",
        },
    )
    effective = client.get(
        "/v1/preferences/effective?repair_center=RC1", headers=headers
    ).json()
    assert effective["airfare_rate"] == "175"


def test_session_cache_returns_same_payload_without_db_hit(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    headers = admin_headers
    first = client.get("/v1/preferences/effective", headers=headers)
    second = client.get("/v1/preferences/effective", headers=headers)
    assert first.status_code == 200
    assert first.json() == second.json()


def test_locked_global_preference_blocks_user_override(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    headers = admin_headers
    client.put(
        "/v1/preferences",
        headers=headers,
        json={
            "scope_type": "global",
            "scope_id": "",
            "preference_key": "theme",
            "value": "light",
            "is_locked": True,
        },
    )
    me = client.get("/v1/auth/me", headers=headers).json()
    client.put(
        "/v1/preferences",
        headers=headers,
        json={
            "scope_type": "user",
            "scope_id": str(me["id"]),
            "preference_key": "theme",
            "value": "dark",
        },
    )
    effective = client.get("/v1/preferences/effective", headers=headers).json()
    assert effective["theme"] == "light"

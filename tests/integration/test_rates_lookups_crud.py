"""Regression tests for lookup and entitlement-rate edit APIs."""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_lookup_create_update_delete(client: TestClient, admin_headers: dict[str, str]) -> None:
    code = f"D{uuid4().hex[:5].upper()}"
    created = client.post(
        "/v1/lookups/departments",
        headers=admin_headers,
        json={"code": code, "name": "Finance Desk", "active": True},
    )
    assert created.status_code == 201, created.text
    item = created.json()
    updated = client.put(
        f"/v1/lookups/departments/{item['id']}",
        headers={**admin_headers, "If-Match": str(item["version"])},
        json={"code": code, "name": "Finance HQ", "active": True},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Finance HQ"
    assert updated.json()["version"] == item["version"] + 1
    deleted = client.delete(
        f"/v1/lookups/departments/{item['id']}",
        headers={**admin_headers, "If-Match": str(updated.json()["version"])},
    )
    assert deleted.status_code == 204


def test_entitlement_rate_create_update_delete(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    created = client.post(
        "/v1/entitlement-rates",
        headers=admin_headers,
        json={
            "scope_type": "global",
            "scope_id": "",
            "amount": "125.00",
            "effective_from": "2026-01-01",
            "effective_to": None,
            "cap_amount": "200",
        },
    )
    assert created.status_code == 201, created.text
    item = created.json()
    updated = client.put(
        f"/v1/entitlement-rates/{item['id']}",
        headers={**admin_headers, "If-Match": str(item["version"])},
        json={
            "amount": "140.00",
            "effective_from": "2026-01-01",
            "effective_to": "2026-12-31",
            "cap_amount": "220",
        },
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert float(body["amount"]) == 140.0
    assert body["effective_to"] == "2026-12-31"
    deleted = client.delete(
        f"/v1/entitlement-rates/{item['id']}",
        headers={**admin_headers, "If-Match": str(body["version"])},
    )
    assert deleted.status_code == 204

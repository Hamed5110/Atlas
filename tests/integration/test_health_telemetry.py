"""Health, readiness, and metrics endpoint tests."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_health_live(client: TestClient) -> None:
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json()["status"] == "alive"


def test_health_ready_in_test_skips_external_deps(client: TestClient) -> None:
    response = client.get("/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["checks"]["database"] == "ok"
    assert body["checks"]["redis"] == "skipped"


def test_metrics_prometheus_payload(client: TestClient, admin_headers: dict[str, str]) -> None:
    client.get("/v1/dashboard", headers=admin_headers)
    response = client.get("/metrics")
    assert response.status_code == 200
    assert b"http_requests_total" in response.content

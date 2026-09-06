"""Integration tests for the FastAPI transport."""

from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient

from airfare_management.api.main import create_app
from airfare_management.config import Settings
from airfare_management.infrastructure.security import issue_access_token


def _client() -> tuple[TestClient, str]:
    settings = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="y" * 32,
        jwt_issuer="airfare-tests",
    )
    app = create_app(settings)
    token = issue_access_token(uuid4(), {"admin", "hr"}, settings)
    return TestClient(app), token


def test_health_endpoint() -> None:
    """Health responds without authentication."""
    client, _ = _client()
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert "X-Correlation-ID" in response.headers


def test_entitlement_preview_requires_auth_and_calculates() -> None:
    """Protected entitlement preview returns Decimal-safe numbers."""
    client, token = _client()
    denied = client.post(
        "/v1/entitlements/preview",
        json={
            "opening_days": "0",
            "current_working_days": 360,
            "paid_days": "0",
            "maximum_payout": "150",
        },
    )
    assert denied.status_code == 401
    allowed = client.post(
        "/v1/entitlements/preview",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "opening_days": "0",
            "current_working_days": 360,
            "paid_days": "0",
            "maximum_payout": "150",
        },
    )
    assert allowed.status_code == 200
    body = allowed.json()
    assert Decimal(body["payable"]) == Decimal("75.00")
    assert Decimal(body["remaining_days"]) == Decimal("30.0000")


def test_employee_create_validates_payload() -> None:
    """Employee creation rejects invalid codes before persistence."""
    client, token = _client()
    response = client.post(
        "/v1/employees",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "code": "bad code",
            "full_name": "Example Person",
            "company_id": str(uuid4()),
            "join_date": date(2026, 1, 1).isoformat(),
        },
    )
    assert response.status_code == 422

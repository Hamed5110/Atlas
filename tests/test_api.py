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


def test_template_catalog_and_download() -> None:
    """Workbook templates are listed and downloadable for every screen."""
    client, token = _client()
    headers = {"Authorization": f"Bearer {token}"}
    catalog = client.get("/v1/templates", headers=headers)
    assert catalog.status_code == 200
    templates = catalog.json()["templates"]
    assert "employees" in templates
    assert "report-excess-recovery" in templates
    assert "report-loan-statement" in templates
    workbook = client.get("/v1/templates/employees.xlsx", headers=headers)
    assert workbook.status_code == 200
    assert workbook.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert workbook.content[:2] == b"PK"


def test_list_screens_show_employee_code_not_only_uuid() -> None:
    """HCM lists expose ERPNext-style employee numbers alongside internal UUIDs."""
    client, token = _client()
    headers = {"Authorization": f"Bearer {token}"}
    created = client.post(
        "/v1/employees",
        headers=headers,
        json={
            "code": "0042",
            "full_name": "Label Check",
            "company_id": "11111111-1111-1111-1111-111111111111",
            "join_date": "2024-01-15",
        },
    )
    assert created.status_code == 201, created.text
    employee_id = created.json()["id"]
    balance = client.post(
        "/v1/opening-balances",
        headers=headers,
        json={
            "employee_id": employee_id,
            "balance_year": 2026,
            "opening_days": "10",
            "paid_days": "0",
            "opening_amount": "25",
            "maximum_payout": "150",
        },
    )
    assert balance.status_code == 201, balance.text
    rows = client.get("/v1/opening-balances?limit=500", headers=headers)
    assert rows.status_code == 200
    match = next(item for item in rows.json() if item["employee_id"] == employee_id)
    assert match["employee_code"] == "0042"
    assert match["employee_label"] == "0042 — Label Check"


def test_report_detail_opens_without_sql_error() -> None:
    """Operational reports return tabular data instead of crashing."""
    client, token = _client()
    headers = {"Authorization": f"Bearer {token}"}
    for name in (
        "employee-master",
        "opening-balances",
        "entitlements",
        "ticket-register",
        "loan-outstanding",
        "loan-statement",
        "excess-recovery",
    ):
        response = client.get(f"/v1/reports/detail/{name}", headers=headers)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["report"] == name
        assert isinstance(body["columns"], list)
        assert isinstance(body["rows"], list)

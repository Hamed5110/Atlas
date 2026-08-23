"""Regression tests for Phase 2 audit remediations."""

from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from pydantic import ValidationError

from airfare_management.api.main import (
    ALLOWED_ATTACHMENT_TYPES,
    _first_of_next_month,
    create_app,
)
from airfare_management.config import Settings
from airfare_management.infrastructure.backup import SAFE_DB_IDENT, _quote_mssql_database
from airfare_management.domain.models import DomainError


def test_production_settings_reject_default_secrets() -> None:
    """Config validator blocks insecure defaults in production."""
    with pytest.raises(ValidationError):
        Settings(
            environment="production",
            jwt_secret="development-only-secret-change-me-32",
            bootstrap_admin_password="ChangeMeNow!2026",
        )


def test_first_of_next_month() -> None:
    """Loan first due is the 1st of the following month."""
    assert _first_of_next_month(date(2026, 1, 15)) == date(2026, 2, 1)
    assert _first_of_next_month(date(2026, 1, 31)) == date(2026, 2, 1)
    assert _first_of_next_month(date(2026, 12, 5)) == date(2027, 1, 1)


def test_quote_mssql_database_rejects_unsafe_names() -> None:
    """Backup T-SQL rejects bracket injection in database names."""
    with pytest.raises(DomainError):
        _quote_mssql_database("foo];DROP DATABASE bar--")
    assert SAFE_DB_IDENT.fullmatch("HCM_Airfare_Management")
    assert _quote_mssql_database("HCM_Airfare_Management") == "[HCM_Airfare_Management]"


def test_delete_loan_does_not_force_settled(client_and_headers) -> None:
    """Soft-deleted unpaid loans must not appear as settled."""
    client, headers = client_and_headers
    employee_id = _create_employee(client, headers)
    loan = client.post(
        "/v1/loans",
        headers=headers,
        json={
            "employee_id": employee_id,
            "principal": "500",
            "annual_rate": "0",
            "installments": 6,
            "first_due_date": date.today().isoformat(),
        },
    )
    assert loan.status_code == 201
    loan_id = loan.json()["id"]
    version = loan.json()["version"]
    deleted = client.delete(
        f"/v1/loans/{loan_id}",
        headers={**headers, "If-Match": str(version)},
    )
    assert deleted.status_code == 204
    settled = client.get("/v1/loans?status=settled", headers=headers)
    rows = settled.json() if isinstance(settled.json(), list) else settled.json().get("items", [])
    assert all(row["id"] != loan_id for row in rows)


def test_loan_payment_rebuilds_schedule_from_outstanding(client_and_headers) -> None:
    """After partial payment schedule opening balance uses outstanding."""
    client, headers = client_and_headers
    employee_id = _create_employee(client, headers)
    created = client.post(
        "/v1/loans",
        headers=headers,
        json={
            "employee_id": employee_id,
            "principal": "1200",
            "annual_rate": "0",
            "installments": 12,
            "first_due_date": date.today().isoformat(),
        },
    )
    loan_id = created.json()["id"]
    client.post(
        f"/v1/loans/{loan_id}/payments",
        headers=headers,
        json={"amount": "100", "paid_on": date.today().isoformat(), "reference": "TEST"},
    )
    schedule = client.get(f"/v1/loans/{loan_id}/schedule", headers=headers)
    assert schedule.status_code == 200
    parts = schedule.json()
    assert parts
    assert Decimal(str(parts[0]["opening_balance"])) == Decimal("1100")


def test_ess_dashboard_last_ticket_uses_valid_status(client_and_headers) -> None:
    """Approved tickets populate ESS last_ticket_date."""
    client, headers = client_and_headers
    employee_id = _create_employee(client, headers)
    ticket = client.post(
        "/v1/tickets",
        headers=headers,
        json={
            "employee_id": employee_id,
            "travel_date": "2026-03-01",
            "origin_code": "BAH",
            "destination_code": "DEL",
            "ticket_cost": "200",
            "entitlement": "150",
            "company_paid": "150",
            "excess_handling": "SELF_PAID",
        },
    )
    assert ticket.status_code == 201
    ticket_id = ticket.json()["id"]
    version = ticket.json()["version"]
    submitted = client.patch(
        f"/v1/tickets/{ticket_id}/status",
        headers={**headers, "If-Match": str(version)},
        json={"status": "submitted"},
    )
    assert submitted.status_code == 200
    version = submitted.json()["version"]
    approved = client.patch(
        f"/v1/tickets/{ticket_id}/status",
        headers={**headers, "If-Match": str(version)},
        json={"status": "approved"},
    )
    assert approved.status_code == 200
    dash = client.get(f"/v1/ess/dashboard?employee_id={employee_id}", headers=headers)
    assert dash.status_code == 200
    assert dash.json()["last_ticket_date"] == "2026-03-01"


def test_attachment_mime_whitelist_constant() -> None:
    """Attachment whitelist excludes executables."""
    assert "application/x-msdownload" not in ALLOWED_ATTACHMENT_TYPES
    assert "application/pdf" in ALLOWED_ATTACHMENT_TYPES


@pytest.fixture
def client_and_headers():
    from fastapi.testclient import TestClient

    from airfare_management.infrastructure.security import issue_access_token

    settings = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="a" * 32,
        bootstrap_admin_password="StrongPassword!2026",
    )
    app = create_app(settings)
    client = TestClient(app)
    token = issue_access_token(uuid4(), {"admin", "hr", "manager", "finance"}, settings)
    return client, {"Authorization": f"Bearer {token}"}


def _create_employee(client, headers: dict[str, str]) -> str:
    companies = client.get("/v1/companies", headers=headers).json()
    company_id = companies[0]["id"] if companies else None
    if company_id is None:
        company_id = client.post(
            "/v1/companies",
            headers=headers,
            json={"code": f"C{uuid4().hex[:6]}", "name": "Test Co", "currency": "USD"},
        ).json()["id"]
    code = f"E{uuid4().hex[:6]}"
    created = client.post(
        "/v1/employees",
        headers=headers,
        json={
            "code": code,
            "full_name": "Remediation Test",
            "company_id": company_id,
            "join_date": "2025-01-01",
        },
    )
    assert created.status_code == 201
    return created.json()["id"]

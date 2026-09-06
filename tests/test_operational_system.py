"""End-to-end tests for operational Airfare modules."""

from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient

from airfare_management.api.main import DEFAULT_COMPANY_ID, create_app
from airfare_management.config import Settings
from airfare_management.domain.services import (
    EntitlementScenario,
    build_amortization_schedule,
    calculate_entitlement_scenario,
)
from airfare_management.infrastructure.documents import (
    EMPLOYEE_COLUMNS,
    build_pdf_report,
    export_workbook,
    parse_employee_workbook,
)


def _authenticated_client() -> tuple[TestClient, dict[str, str]]:
    settings = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="z" * 32,
        bootstrap_admin_password="StrongPassword!2026",
        attachment_root="./var/test-attachments",
    )
    client = TestClient(create_app(settings))
    login = client.post(
        "/v1/auth/login",
        json={"username": "admin", "password": "StrongPassword!2026"},
    )
    assert login.status_code == 200
    return client, {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_web_application_is_served_from_root() -> None:
    """Serve the built web shell (Vite SPA or Next static export) without replacing API routes."""
    client, headers = _authenticated_client()
    landing = client.get("/")
    assert landing.status_code == 200
    assert landing.headers["content-type"].startswith("text/html")
    # Vite build mounts at id="root"; the Next static export streams via __next_f.
    assert 'id="root"' in landing.text or "__next_f" in landing.text
    # Client-side routes fall back to the shell.
    spa_route = client.get("/allocation")
    assert spa_route.status_code == 200
    assert 'id="root"' in spa_route.text or "__next_f" in spa_route.text
    # Unknown API paths still return JSON 404s, not HTML.
    missing_api = client.get("/v1/no-such-endpoint", headers=headers)
    assert missing_api.status_code == 404
    assert missing_api.headers["content-type"].startswith("application/json")
    assert client.get("/health").status_code == 200
    assert client.get("/v1/employees", headers=headers).status_code == 200


def test_employee_ticket_and_loan_workflow() -> None:
    """Create linked records and enforce a ticket workflow transition."""
    client, headers = _authenticated_client()
    employee = client.post(
        "/v1/employees",
        headers=headers,
        json={
            "code": "E100",
            "full_name": "Operations User",
            "company_id": DEFAULT_COMPANY_ID,
            "join_date": "2025-01-01",
        },
    )
    assert employee.status_code == 201
    employee_id = employee.json()["id"]
    ticket = client.post(
        "/v1/tickets",
        headers=headers,
        json={
            "employee_id": employee_id,
            "travel_date": "2026-09-01",
            "origin_code": "KHI",
            "destination_code": "DXB",
            "ticket_cost": "900",
            "entitlement": "600",
            "company_paid": "900",
        },
    )
    assert ticket.status_code == 201
    submitted = client.patch(
        f"/v1/tickets/{ticket.json()['id']}/status",
        headers={**headers, "If-Match": "1"},
        json={"status": "submitted"},
    )
    assert submitted.status_code == 200
    loan = client.post(
        "/v1/loans",
        headers=headers,
        json={
            "employee_id": employee_id,
            "principal": "300",
            "annual_rate": "0",
            "installments": 3,
            "first_due_date": "2026-10-01",
        },
    )
    assert loan.status_code == 201
    schedule = client.get(f"/v1/loans/{loan.json()['id']}/schedule", headers=headers)
    assert schedule.status_code == 200
    assert len(schedule.json()) == 3
    assert Decimal(schedule.json()[-1]["closing_balance"]) == Decimal("0")


def test_scenario_and_schedule_calculations() -> None:
    """Cover new-joiner accrual and final EMI rounding."""
    entitlement = calculate_entitlement_scenario(
        EntitlementScenario.NEW_JOINER,
        date(2026, 12, 30),
        2026,
        Decimal("0"),
        Decimal("0"),
        Decimal("1200"),
        join_date=date(2026, 7, 1),
    )
    assert entitlement.remaining_days == Decimal("15.0411")
    schedule = build_amortization_schedule(Decimal("1000"), Decimal("5"), 12, date(2026, 9, 30))
    assert len(schedule) == 12
    assert schedule[-1].closing_balance == Decimal("0.00")


def test_rejects_unknown_employee_company_reference() -> None:
    """Reject invalid relational references when foreign keys are enforced."""
    client, headers = _authenticated_client()
    response = client.post(
        "/v1/employees",
        headers=headers,
        json={
            "code": "BAD-COMPANY",
            "full_name": "Invalid Company",
            "company_id": str(uuid4()),
            "join_date": "2026-01-01",
        },
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_company"


def test_excel_round_trip_and_pdf_report() -> None:
    """Generate production document formats and parse an employee workbook."""
    record = {
        "code": "E200",
        "full_name": "Document User",
        "company_id": DEFAULT_COMPANY_ID,
        "join_date": "2026-01-01",
        "department": "Finance",
        "branch": "HQ",
        "email": "documents@example.com",
    }
    workbook = export_workbook("Employees", EMPLOYEE_COLUMNS, [record])
    imported = parse_employee_workbook(workbook)
    assert imported[0]["code"] == "E200"
    assert imported[0]["_row"] == 2
    pdf = build_pdf_report(
        "Recovery Report",
        ("Employee", "Amount"),
        (("E200", Decimal("125.50")),),
    )
    assert pdf.startswith(b"%PDF")

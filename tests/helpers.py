"""Test helpers for API integration scenarios."""

from __future__ import annotations

from datetime import date
from uuid import uuid4

from fastapi.testclient import TestClient

from airfare_management.api.main import DEFAULT_COMPANY_ID


def ensure_company(client: TestClient, headers: dict[str, str]) -> str:
    """Return an existing company id or create one."""
    companies = client.get("/v1/companies", headers=headers).json()
    if companies:
        return str(companies[0]["id"])
    created = client.post(
        "/v1/companies",
        headers=headers,
        json={"code": f"C{uuid4().hex[:6].upper()}", "name": "Test Co", "currency": "USD"},
    )
    assert created.status_code == 201, created.text
    return str(created.json()["id"])


def create_employee(
    client: TestClient,
    headers: dict[str, str],
    *,
    code: str | None = None,
    company_id: str | None = None,
    join_date: str = "2025-01-01",
    **extra: object,
) -> dict[str, object]:
    """Create and return an employee payload."""
    payload: dict[str, object] = {
        "code": code or f"E{uuid4().hex[:6].upper()}",
        "full_name": "Pyramid Test Employee",
        "company_id": company_id or DEFAULT_COMPANY_ID or ensure_company(client, headers),
        "join_date": join_date,
    }
    payload.update(extra)
    response = client.post("/v1/employees", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def create_ticket(
    client: TestClient,
    headers: dict[str, str],
    employee_id: str,
    *,
    travel_date: str = "2026-06-15",
    ticket_cost: str = "500",
    entitlement: str = "400",
    company_paid: str = "400",
    excess_handling: str = "SELF_PAID",
    **extra: object,
) -> dict[str, object]:
    """Create a draft ticket."""
    payload: dict[str, object] = {
        "employee_id": employee_id,
        "travel_date": travel_date,
        "origin_code": "BAH",
        "destination_code": "DXB",
        "ticket_cost": ticket_cost,
        "entitlement": entitlement,
        "company_paid": company_paid,
        "excess_handling": excess_handling,
    }
    payload.update(extra)
    response = client.post("/v1/tickets", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def advance_ticket(
    client: TestClient,
    headers: dict[str, str],
    ticket: dict[str, object],
    *statuses: str,
) -> dict[str, object]:
    """Apply a sequence of ticket status transitions."""
    current = ticket
    for status in statuses:
        response = client.patch(
            f"/v1/tickets/{current['id']}/status",
            headers={**headers, "If-Match": str(current["version"])},
            json={"status": status},
        )
        assert response.status_code == 200, response.text
        current = response.json()
    return current


def create_loan(
    client: TestClient,
    headers: dict[str, str],
    employee_id: str,
    *,
    principal: str = "1200",
    annual_rate: str = "0",
    installments: int = 12,
    first_due_date: str | None = None,
) -> dict[str, object]:
    """Create a loan with amortization schedule."""
    response = client.post(
        "/v1/loans",
        headers=headers,
        json={
            "employee_id": employee_id,
            "principal": principal,
            "annual_rate": annual_rate,
            "installments": installments,
            "first_due_date": first_due_date or date.today().replace(day=1).isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()

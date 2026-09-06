"""Employee CRUD, search, import, and soft-delete cascade tests."""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from tests.helpers import create_employee, create_loan, create_ticket, ensure_company

pytestmark = pytest.mark.integration


def test_hcm_fields_round_trip(client: TestClient, admin_headers: dict[str, str]) -> None:
    company_id = ensure_company(client, admin_headers)
    created = client.post(
        "/v1/employees",
        headers=admin_headers,
        json={
            "code": f"HCM-{uuid4().hex[:5]}",
            "full_name": "HCM Fields Employee",
            "company_id": company_id,
            "join_date": "2024-02-29",
            "designation": "Engineer",
            "nationality": "BH",
            "sub_section": "Wing A",
            "pay_group": "OPS",
            "arabic_name": "موظف تجريبي",
            "cpr_no": "900012345",
            "passport_no": "P1234567",
            "gender": "Male",
            "grade": "G5",
            "contract_type": "unlimited",
            "origin_country": "India",
            "airline_sector": "Asia",
            "travel_class": "Economy",
            "monthly_salary": "450.000",
            "visa_no": "V-99",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["designation"] == "Engineer"
    assert body["nationality"] == "BH"
    assert body["arabic_name"] == "موظف تجريبي"
    assert body["cpr_no"] == "900012345"
    assert body["airline_sector"] == "Asia"
    assert body["monthly_salary"] in ("450.0000", "450.000", "450")
    detail = client.get(f"/v1/employees/{body['id']}", headers=admin_headers)
    assert detail.json()["sub_section"] == "Wing A"
    assert detail.json()["passport_no"] == "P1234567"

    updated = client.put(
        f"/v1/employees/{body['id']}",
        headers={**admin_headers, "If-Match": str(body["version"])},
        json={
            "full_name": body["full_name"],
            "join_date": body["join_date"],
            "designation": "Senior Engineer",
            "nationality": "BH",
            "cpr_no": "900012345",
            "arabic_name": "موظف تجريبي",
            "airline_sector": "GCC",
            "travel_class": "Business",
            "active": True,
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["designation"] == "Senior Engineer"
    assert updated.json()["airline_sector"] == "GCC"


def test_update_optimistic_locking(client: TestClient, admin_headers: dict[str, str]) -> None:
    employee = create_employee(client, admin_headers)
    updated = client.put(
        f"/v1/employees/{employee['id']}",
        headers={**admin_headers, "If-Match": str(employee["version"])},
        json={
            "full_name": "Updated Name",
            "join_date": employee["join_date"],
            "active": True,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["version"] == int(employee["version"]) + 1
    stale = client.put(
        f"/v1/employees/{employee['id']}",
        headers={**admin_headers, "If-Match": str(employee["version"])},
        json={"full_name": "Stale", "join_date": employee["join_date"], "active": True},
    )
    assert stale.status_code == 409


def test_soft_delete_cascades_related_rows(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    employee = create_employee(client, admin_headers)
    employee_id = str(employee["id"])
    ticket = create_ticket(client, admin_headers, employee_id)
    loan = create_loan(client, admin_headers, employee_id, principal="400")
    balance = client.post(
        "/v1/opening-balances",
        headers=admin_headers,
        json={
            "employee_id": employee_id,
            "balance_year": 2026,
            "opening_days": "5",
            "paid_days": "0",
            "opening_amount": "100",
            "maximum_payout": "150",
        },
    )
    assert balance.status_code == 201
    deleted = client.delete(
        f"/v1/employees/{employee_id}",
        headers={**admin_headers, "If-Match": str(employee["version"])},
    )
    assert deleted.status_code == 204
    assert client.get("/v1/employees", headers=admin_headers).json() == []
    assert all(row["id"] != loan["id"] for row in client.get("/v1/loans", headers=admin_headers).json())
    tickets = client.get("/v1/tickets", headers=admin_headers).json()
    assert all(row["id"] != ticket["id"] for row in tickets)


def test_search_employees_by_name(client: TestClient, admin_headers: dict[str, str]) -> None:
    create_employee(client, admin_headers, full_name="Unique Searchable Name")
    create_employee(client, admin_headers, code=f"OTHER-{uuid4().hex[:4]}")
    results = client.get("/v1/employees?search=Unique+Searchable", headers=admin_headers)
    assert results.status_code == 200
    assert any("Unique Searchable" in row["full_name"] for row in results.json())


def test_import_dry_run_vs_commit(client: TestClient, admin_headers: dict[str, str]) -> None:
    from airfare_management.api.main import DEFAULT_COMPANY_ID
    from airfare_management.infrastructure.documents import EMPLOYEE_COLUMNS, export_workbook

    code = f"IMP-{uuid4().hex[:4].upper()}"
    workbook = export_workbook(
        "Employees",
        EMPLOYEE_COLUMNS,
        [
            {
                "code": code,
                "full_name": "Import Ready",
                "company_id": DEFAULT_COMPANY_ID,
                "join_date": "2026-01-01",
                "department": "HR",
                "branch": "HQ",
                "email": "import@example.com",
            }
        ],
    )
    dry = client.post(
        "/v1/employees/import?dry_run=true",
        headers=admin_headers,
        files={
            "file": (
                "employees.xlsx",
                workbook,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert dry.status_code == 200
    assert dry.json()["committed"] is False
    listed = client.get(f"/v1/employees?search={code}", headers=admin_headers).json()
    assert all(row["code"] != code for row in listed)

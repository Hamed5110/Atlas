"""Verify modern continuous (joining-date) entitlement via TestClient."""

from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient

from airfare_management.api.main import DEFAULT_COMPANY_ID, create_app
from airfare_management.config import Settings
from airfare_management.infrastructure.security import issue_access_token


def main() -> None:
    settings = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="a" * 32,
        jwt_issuer="airfare-tests",
        bootstrap_admin_password="StrongPassword!2026",
    )
    app = create_app(settings)
    token = issue_access_token(
        uuid4(), {"admin", "hr", "manager", "finance"}, settings
    )
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {token}"}

    seeded = client.put(
        "/v1/settings",
        headers=headers,
        json={"settings": {"cycle_reset_basis": "joining_date"}},
    )
    assert seeded.status_code == 200, seeded.text

    rate = client.post(
        "/v1/entitlement-rates",
        headers=headers,
        json={
            "scope_type": "global",
            "scope_id": "",
            "amount": "150.00",
            "effective_from": "2020-01-01",
            "effective_to": None,
            "cap_amount": "150.00",
        },
    )
    assert rate.status_code in {200, 201}, rate.text

    emp = client.post(
        "/v1/employees",
        headers=headers,
        json={
            "code": "VERIFY-CONT",
            "full_name": "Continuous Verify",
            "company_id": DEFAULT_COMPANY_ID,
            "join_date": "2020-04-16",
            "max_entitlement_cap_rate": "150",
        },
    )
    assert emp.status_code == 201, emp.text
    employee_id = emp.json()["id"]

    joining = client.post(
        "/v1/allocations/preview",
        headers=headers,
        json={"employee_id": employee_id, "as_of_date": "2026-09-06"},
    )
    assert joining.status_code == 200, joining.text
    jbody = joining.json()

    client.put(
        "/v1/settings",
        headers=headers,
        json={"settings": {"cycle_reset_basis": "calendar"}},
    )
    calendar = client.post(
        "/v1/allocations/preview",
        headers=headers,
        json={"employee_id": employee_id, "as_of_date": "2026-09-06"},
    ).json()

    print("=== Modern continuous entitlement verification ===")
    print(f"joining.accrual_start = {jbody.get('accrual_start')}")
    print(f"joining.accrued_days  = {jbody.get('accrued_days')}")
    print(f"joining.final_bhd     = {jbody.get('final_entitlement_amount')}")
    print(f"joining.notes         = {jbody.get('policy_notes')}")
    print(f"calendar.accrual_start= {calendar.get('accrual_start')}")
    print(f"calendar.accrued_days = {calendar.get('accrued_days')}")
    print(f"calendar.final_bhd    = {calendar.get('final_entitlement_amount')}")

    assert jbody["accrual_start"] == "2026-04-16"
    assert Decimal(jbody["final_entitlement_amount"]) > 0
    assert Decimal(jbody["accrued_days"]) < Decimal(calendar["accrued_days"])
    notes = " ".join(jbody.get("policy_notes") or [])
    assert "anniversary" in notes.lower() or "Rolling cycle" in notes
    print("RESULT: PASS — continuous joining-date engine working")


if __name__ == "__main__":
    main()

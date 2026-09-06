"""MSSQL-backed modern continuous entitlement (joining-date cycle).

Requires AIRFARE_DATABASE_URL pointing at HCM_Airfare_Management.
Creates an isolated employee, sets joining_date cycle, previews allocation,
asserts anniversary accrual, then soft-deletes the employee.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from airfare_management.api.main import DEFAULT_COMPANY_ID, create_app
from airfare_management.config import Settings
from airfare_management.infrastructure.database import create_session_factory
from airfare_management.infrastructure.schema import CompanyRow
from airfare_management.infrastructure.security import issue_access_token

pytestmark = pytest.mark.integration


def _mssql_ready() -> Settings:
    settings = Settings()
    if "mssql" not in settings.database_url.lower():
        pytest.skip("AIRFARE_DATABASE_URL is not MSSQL.")
    try:
        sessions = create_session_factory(settings)
        with sessions() as probe:
            if probe.scalar(select(CompanyRow.id).limit(1)) is None:
                pytest.skip("No company rows in MSSQL.")
        sessions.kw["bind"].dispose()
    except Exception as exc:  # pragma: no cover - environment specific
        pytest.skip(f"Local MSSQL is not reachable: {exc}")
    return settings


def test_mssql_continuous_joining_date_preview_and_period_end_gone() -> None:
    settings = _mssql_ready()
    client = TestClient(create_app(settings))
    token = issue_access_token(
        uuid4(),
        {"admin", "SYSTEM_ADMIN", "hr", "HR_MANAGER", "manager", "finance"},
        settings,
    )
    headers = {"Authorization": f"Bearer {token}"}
    employee_id: UUID | None = None
    code = f"CONT{uuid4().hex[:8]}"

    try:
        seeded = client.put(
            "/v1/settings",
            headers=headers,
            json={"settings": {"cycle_reset_basis": "joining_date"}},
        )
        assert seeded.status_code == 200, seeded.text

        gone = client.post(
            "/v1/entitlement/period-end",
            headers=headers,
            json={"fiscal_year": 2026},
        )
        assert gone.status_code == 410, gone.text
        assert "joining_date" in gone.json()["detail"]

        gone_ye = client.post(
            "/v1/entitlement/year-end-close",
            headers=headers,
            json={"fiscal_year": 2026},
        )
        assert gone_ye.status_code == 410, gone_ye.text

        created = client.post(
            "/v1/employees",
            headers=headers,
            json={
                "code": code,
                "full_name": "MSSQL Continuous Entitlement",
                "company_id": DEFAULT_COMPANY_ID,
                "join_date": "2020-04-16",
                "custom_airfare_rate": "150",
                "max_entitlement_cap_rate": "150",
            },
        )
        assert created.status_code == 201, created.text
        employee_id = UUID(str(created.json()["id"]))

        preview = client.post(
            "/v1/allocations/preview",
            headers=headers,
            json={
                "employee_id": str(employee_id),
                "as_of_date": "2026-09-06",
            },
        )
        assert preview.status_code == 200, preview.text
        body = preview.json()
        assert body["accrual_start"] == "2026-04-16"
        notes = " ".join(body.get("policy_notes") or [])
        assert "anniversary" in notes.lower() or "Rolling cycle" in notes
        assert Decimal(body["final_entitlement_amount"]) > 0
        assert Decimal(body["final_entitlement_amount"]) < Decimal("150")
        assert Decimal(body["accrued_days"]) == Decimal("11.7500")
        assert Decimal(body["final_entitlement_amount"]) == Decimal("29.38")

        rates = client.get("/v1/entitlement-rates", headers=headers)
        assert rates.status_code == 200, rates.text
    finally:
        if employee_id is not None:
            current = client.get(f"/v1/employees/{employee_id}", headers=headers)
            if current.status_code == 200:
                deleted = client.delete(
                    f"/v1/employees/{employee_id}",
                    headers={
                        **headers,
                        "If-Match": str(current.json().get("version") or 1),
                    },
                )
                assert deleted.status_code in {200, 204}, deleted.text

"""API verification: ENTITLEMENT_AMOUNT blocked when entitlement is zero.

Postman-style contract checks via httpx against live :3389 (MSSQL).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from sqlalchemy import create_engine, text

from airfare_management.config import get_settings
from airfare_management.domain.models import ValidationError
from airfare_management.domain.services import ExcessSettlementOption, settle_excess_ticket


BASE = "http://127.0.0.1:3389"


def _env() -> dict[str, str]:
    env: dict[str, str] = {}
    path = Path(r"C:\HCM Airfare\.env")
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def _token() -> str:
    env = _env()
    with httpx.Client(base_url=BASE, timeout=30) as client:
        response = client.post(
            "/v1/auth/login",
            json={
                "username": env["AIRFARE_BOOTSTRAP_ADMIN_USERNAME"],
                "password": env["AIRFARE_BOOTSTRAP_ADMIN_PASSWORD"],
            },
        )
        assert response.status_code == 200, response.text
        return response.json()["access_token"]


def test_domain_rejects_entitlement_amount_at_zero() -> None:
    with pytest.raises(ValidationError, match="positive entitlement"):
        settle_excess_ticket(
            Decimal("200"),
            Decimal("0"),
            ExcessSettlementOption.ENTITLEMENT_AMOUNT,
        )


def test_live_api_rejects_entitlement_amount_when_preview_entitlement_zero() -> None:
    """Issue must fail when ENTITLEMENT_AMOUNT is chosen with a zero entitlement."""
    token = _token()
    headers = {"Authorization": f"Bearer {token}"}
    engine = create_engine(get_settings().database_url)

    with engine.connect() as conn:
        employee_id = conn.execute(
            text(
                """
                SELECT TOP 1 CAST(id AS varchar(36))
                FROM employees
                WHERE deleted_at IS NULL AND code = '0008'
                """
            )
        ).scalar()
    assert employee_id, "employee 0008 must exist in MSSQL"

    with httpx.Client(base_url=BASE, timeout=60) as client:
        preview = client.post(
            "/v1/allocations/preview",
            headers=headers,
            json={
                "employee_id": employee_id,
                "as_of_date": str(date.today()),
                "requested_ticket_amount": 200,
                "excess_option": "ENTITLEMENT_AMOUNT",
            },
        )
        assert preview.status_code == 200, preview.text
        body = preview.json()
        entitlement = Decimal(str(body.get("final_entitlement_amount") or 0))
        # When entitlement is already > 0 for this as-of date, force the gate via domain
        # by issuing with ENTITLEMENT_AMOUNT only if preview shows zero.
        if entitlement > 0:
            pytest.skip(
                f"employee 0008 currently has entitlement {entitlement}; "
                "domain zero-gate still covered by unit test"
            )

        issue = client.post(
            "/v1/allocations/issue",
            headers=headers,
            json={
                "employee_id": employee_id,
                "as_of_date": str(date.today()),
                "requested_ticket_amount": 200,
                "excess_option": "ENTITLEMENT_AMOUNT",
                "origin_code": "BOM",
                "destination_code": "BLR",
                "notes": "qa entitlement-amount gate",
            },
        )
        assert issue.status_code in {400, 409, 422}, issue.text
        detail = str(issue.json()).lower()
        assert "entitlement" in detail

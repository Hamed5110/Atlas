"""Opening balance entitlement and soft-delete unique index tests."""

from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from airfare_management.domain.services import (
    EntitlementScenario,
    calculate_entitlement_scenario,
    calendar_days_in_year,
)
from tests.helpers import create_employee

pytestmark = pytest.mark.integration


def test_leap_year_has_366_days() -> None:
    assert calendar_days_in_year(2024) == 366
    assert calendar_days_in_year(2025) == 365


def test_new_joiner_mid_year_proration() -> None:
    from datetime import date

    result = calculate_entitlement_scenario(
        EntitlementScenario.NEW_JOINER,
        date(2024, 6, 30),
        2024,
        Decimal("0"),
        Decimal("0"),
        Decimal("150"),
        join_date=date(2024, 6, 1),
    )
    assert result.payable > Decimal("0")
    assert result.remaining_days <= Decimal("30")


def test_soft_deleted_balance_can_be_recreated(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    employee = create_employee(client, admin_headers)
    employee_id = str(employee["id"])
    payload = {
        "employee_id": employee_id,
        "balance_year": 2026,
        "opening_days": "10",
        "paid_days": "0",
        "opening_amount": "100",
        "maximum_payout": "150",
    }
    created = client.post("/v1/opening-balances", headers=admin_headers, json=payload)
    assert created.status_code == 201
    balance_id = created.json()["id"]
    deleted = client.delete(
        f"/v1/opening-balances/{balance_id}",
        headers={**admin_headers, "If-Match": "1"},
    )
    assert deleted.status_code == 204
    recreated = client.post("/v1/opening-balances", headers=admin_headers, json=payload)
    assert recreated.status_code == 201
    assert recreated.json()["id"] != balance_id


def test_cap_enforcement_on_balance(client: TestClient, admin_headers: dict[str, str]) -> None:
    employee = create_employee(client, admin_headers)
    response = client.post(
        "/v1/opening-balances",
        headers=admin_headers,
        json={
            "employee_id": employee["id"],
            "balance_year": 2027,
            "opening_days": "60",
            "paid_days": "0",
            "opening_amount": "500",
            "maximum_payout": "150",
        },
    )
    assert response.status_code == 201
    assert Decimal(str(response.json()["maximum_payout"])) == Decimal("150")

"""Integration tests for Airfare Payable Statement (R01 / 3355 parity)."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from tests.helpers import create_employee, ensure_company

pytestmark = pytest.mark.integration


def _ensure_global_rate(client: TestClient, headers: dict[str, str]) -> None:
    rates = client.get("/v1/entitlement-rates", headers=headers)
    assert rates.status_code == 200, rates.text
    if rates.json():
        return
    response = client.post(
        "/v1/entitlement-rates",
        headers=headers,
        json={
            "scope_type": "global",
            "scope_id": "",
            "amount": "150",
            "effective_from": "2020-01-01",
            "cap_amount": "150",
        },
    )
    assert response.status_code == 201, response.text


def test_airfare_payable_detail_and_filters(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    ensure_company(client, admin_headers)
    create_employee(
        client,
        admin_headers,
        code="PAYR01",
        full_name="Payable R01 Employee",
        department="Finance",
        join_date="2024-01-15",
    )
    _ensure_global_rate(client, admin_headers)

    year = date.today().year
    as_of = date.today().isoformat()
    response = client.get(
        f"/v1/reports/detail/airfare-payable?year={year}&as_of_date={as_of}",
        headers=admin_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["report"] == "airfare-payable"
    assert "Payable Amount" in body["columns"]
    assert "Airfare Entitlement Amount" in body["columns"]
    assert body["count"] == len(body["rows"])
    assert body.get("filters", {}).get("year") == year

    summary = client.get(
        f"/v1/reports/detail/airfare-payable-summary?year={year}&as_of_date={as_of}",
        headers=admin_headers,
    )
    assert summary.status_code == 200, summary.text
    assert "Entitlement" in summary.json()["columns"]

    exceptions = client.get(
        f"/v1/reports/detail/airfare-payable-exceptions?year={year}&as_of_date={as_of}",
        headers=admin_headers,
    )
    assert exceptions.status_code == 200, exceptions.text

    kpi = client.get(
        f"/v1/reports/data/airfare-payable?year={year}&as_of_date={as_of}",
        headers=admin_headers,
    )
    assert kpi.status_code == 200, kpi.text
    assert "value" in kpi.json()

    xlsx = client.get(
        f"/v1/reports/export/airfare-payable.xlsx?year={year}&as_of_date={as_of}",
        headers=admin_headers,
    )
    assert xlsx.status_code == 200, xlsx.text
    assert xlsx.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument"
    )

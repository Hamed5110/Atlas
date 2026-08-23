"""
Integration-style tests for the Airfare Allocation Engine.

These tests validate the ATLAS 30/360 + cycle-60 allocation engine end-to-end through the
FastAPI routes (allocation preview + issue + loan deferment) and also
exercise DB-backed scenario detection via employee_id.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from airfare_management.api.main import DEFAULT_COMPANY_ID, create_app
from airfare_management.application.contracts import ExcessSettlementOption
from airfare_management.config import Settings
from airfare_management.domain.services import AllocationScenario, RateSource
from airfare_management.infrastructure.database import Base, EmployeeRow, create_session_factory
from airfare_management.infrastructure.schema import (
    CompanyRow,
    OpeningBalanceRow,
    TicketRow,
    LoanRow,
    LoanPaymentRow,
    LoanInstallmentRow,
    EntitlementRateRow,
)
from airfare_management.infrastructure.security import issue_access_token


POLICY_150 = Decimal("150")
DAILY_150 = POLICY_150 / Decimal("60")


def _client():
    settings = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="a" * 32,
        jwt_issuer="airfare-tests",
        bootstrap_admin_password="StrongPassword!2026",
    )
    app = create_app(settings)
    token = issue_access_token(
        uuid4(),
        {"admin", "hr", "manager", "finance"},
        settings,
    )
    return TestClient(app), {"Authorization": f"Bearer {token}"}


def _create_employee_with_opening(
    client: TestClient,
    headers: dict[str, str],
    *,
    code: str,
    join_date: str,
    custom_rate: Decimal | None,
    max_cap: Decimal,
    opening_days: Decimal,
    opening_amount: Decimal,
    pay_group: str = "",
) -> UUID:
    payload = {
        "code": code,
        "full_name": f"Employee {code}",
        "company_id": DEFAULT_COMPANY_ID,
        "join_date": join_date,
        "pay_group": pay_group,
        "max_entitlement_cap_rate": str(max_cap),
    }
    if custom_rate is not None:
        payload["custom_airfare_rate"] = str(custom_rate)
    created = client.post("/v1/employees", headers=headers, json=payload)
    assert created.status_code == 201, created.text
    employee_id = UUID(str(created.json()["id"]))

    opening = client.post(
        "/v1/opening-balances",
        headers=headers,
        json={
            "employee_id": str(employee_id),
            "balance_year": 2026,
            "opening_days": str(opening_days),
            "opening_amount": str(opening_amount),
            "maximum_payout": str(max_cap),
        },
    )
    assert opening.status_code == 201, opening.text
    return employee_id


def test_scenario_1_previous_ticket_ignores_opening_balance() -> None:
    client, headers = _client()
    employee_id = _create_employee_with_opening(
        client,
        headers,
        code="SCN1-01",
        join_date="2020-01-01",
        custom_rate=POLICY_150,
        max_cap=Decimal("150"),
        opening_days=Decimal("20"),
        opening_amount=Decimal("50"),
    )

    # Create a previously approved ticket on 2026-01-01.
    issued = client.post(
        "/v1/allocations/issue",
        headers=headers,
        json={
            "employee_id": str(employee_id),
            "as_of_date": "2026-01-01",
            "requested_ticket_amount": "20",
            "excess_option": "SELF_PAID",
            "origin_code": "KHI",
            "destination_code": "DXB",
        },
    )
    assert issued.status_code == 201, issued.text

    preview = client.post(
        "/v1/allocations/preview",
        headers=headers,
        json={
            "employee_id": str(employee_id),
            "as_of_date": "2026-01-11",
            "requested_ticket_amount": "100",
            "excess_option": "LOAN",
            "tenure_months": 6,
        },
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["scenario"] == AllocationScenario.PREVIOUS_TICKET.value
    assert Decimal(body["opening_balance_days"]) == Decimal("20")
    assert Decimal(body["final_entitlement_amount"]) == Decimal("1.87")


def test_scenario_2_new_joiner_ignores_opening_balance() -> None:
    client, headers = _client()
    employee_id = _create_employee_with_opening(
        client,
        headers,
        code="SCN2-01",
        join_date="2026-03-01",
        custom_rate=POLICY_150,
        max_cap=Decimal("150"),
        opening_days=Decimal("20"),
        opening_amount=Decimal("50"),
    )

    preview = client.post(
        "/v1/allocations/preview",
        headers=headers,
        json={
            "employee_id": str(employee_id),
            "as_of_date": "2026-03-21",
            "requested_ticket_amount": "100",
            "excess_option": "LOAN",
            "tenure_months": 6,
        },
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["scenario"] == AllocationScenario.NEW_JOINEE.value
    assert Decimal(body["opening_balance_days"]) == Decimal("20")
    assert Decimal(body["final_entitlement_amount"]) == Decimal("54.38")


def test_scenario_3_opening_balance_plus_accrual_includes_opening_amount() -> None:
    client, headers = _client()
    employee_id = _create_employee_with_opening(
        client,
        headers,
        code="SCN3-01",
        join_date="2025-06-01",
        custom_rate=POLICY_150,
        max_cap=Decimal("150"),
        opening_days=Decimal("20"),
        opening_amount=Decimal("40"),
    )

    preview = client.post(
        "/v1/allocations/preview",
        headers=headers,
        json={
            "employee_id": str(employee_id),
            "as_of_date": "2026-01-11",
            "requested_ticket_amount": "100",
            "excess_option": "LOAN",
            "tenure_months": 6,
        },
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["scenario"] == AllocationScenario.OPENING_BALANCE_ACCRUAL.value
    assert Decimal(body["opening_balance_days"]) == Decimal("20")
    assert Decimal(body["final_entitlement_amount"]) == Decimal("42.29")


def test_rate_hierarchy_pay_group_used_when_employee_custom_is_null() -> None:
    client, headers = _client()
    employee_payload = {
        "code": "RATE-01",
        "full_name": "Rate Hierarchy",
        "company_id": DEFAULT_COMPANY_ID,
        "join_date": "2025-01-01",
        "pay_group": "OPS",
        "max_entitlement_cap_rate": "150",
    }
    created = client.post("/v1/employees", headers=headers, json=employee_payload)
    assert created.status_code == 201, created.text
    employee_id = UUID(str(created.json()["id"]))

    opening = client.post(
        "/v1/opening-balances",
        headers=headers,
        json={
            "employee_id": str(employee_id),
            "balance_year": 2026,
            "opening_days": "0",
            "opening_amount": "0",
            "maximum_payout": "150",
        },
    )
    assert opening.status_code == 201, opening.text

    rate = client.post(
        "/v1/entitlement-rates",
        headers=headers,
        json={
            "scope_type": "pay_group",
            "scope_id": "OPS",
            "amount": "200",
            "effective_from": "2026-01-01",
            "cap_amount": None,
        },
    )
    assert rate.status_code == 201, rate.text

    preview = client.post(
        "/v1/allocations/preview",
        headers=headers,
        json={
            "employee_id": str(employee_id),
            "as_of_date": "2026-01-11",
            "requested_ticket_amount": "10",
            "excess_option": "SELF_PAID",
        },
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["rate_source"] == RateSource.PAY_GROUP.value
    assert Decimal(body["final_entitlement_amount"]) == Decimal("3.06")


def test_employee_policy_rate_beats_imported_current_airfare_rate() -> None:
    """ATLAS policy MaxPayout wins over Employees.CurrentAirfareRate leftovers."""
    client, headers = _client()
    created = client.post(
        "/v1/employees",
        headers=headers,
        json={
            "code": "POL-01",
            "full_name": "Policy Employee",
            "company_id": DEFAULT_COMPANY_ID,
            "join_date": "2025-01-01",
            "custom_airfare_rate": "30",
            "max_entitlement_cap_rate": "150",
        },
    )
    assert created.status_code == 201, created.text
    employee_id = UUID(str(created.json()["id"]))
    rate = client.post(
        "/v1/entitlement-rates",
        headers=headers,
        json={
            "scope_type": "employee",
            "scope_id": str(employee_id),
            "amount": "300",
            "effective_from": "2026-06-19",
            "cap_amount": "300",
        },
    )
    assert rate.status_code == 201, rate.text
    preview = client.post(
        "/v1/allocations/preview",
        headers=headers,
        json={"employee_id": str(employee_id), "as_of_date": "2026-08-18"},
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["rate_source"] == RateSource.EMPLOYEE.value
    assert Decimal(body["airfare_rate"]) == Decimal("300")
    assert Decimal(body["daily_rate"]) == Decimal("5")
    assert Decimal(body["accrued_days"]) == Decimal("19.0000")
    assert Decimal(body["final_entitlement_amount"]) == Decimal("95.00")


def test_capping_applied_to_final_entitlement() -> None:
    client, headers = _client()
    employee_id = _create_employee_with_opening(
        client,
        headers,
        code="CAP-01",
        join_date="2025-06-01",
        custom_rate=POLICY_150,
        max_cap=Decimal("12"),
        opening_days=Decimal("20"),
        opening_amount=Decimal("40"),
    )
    preview = client.post(
        "/v1/allocations/preview",
        headers=headers,
        json={
            "employee_id": str(employee_id),
            "as_of_date": "2026-01-11",
            "requested_ticket_amount": "100",
            "excess_option": "LOAN",
            "tenure_months": 6,
        },
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert Decimal(body["final_entitlement_amount"]) == Decimal("12.00")


def test_employee_preview_autofills_and_excess_choice() -> None:
    """Selecting an employee loads master fields; excess choice is only required above entitlement."""
    client, headers = _client()
    employee_id = _create_employee_with_opening(
        client,
        headers,
        code="AUTO-01",
        join_date="2025-06-01",
        custom_rate=POLICY_150,
        max_cap=Decimal("150"),
        opening_days=Decimal("20"),
        opening_amount=Decimal("40"),
    )
    auto = client.post(
        "/v1/allocations/preview",
        headers=headers,
        json={"employee_id": str(employee_id), "as_of_date": "2026-01-11"},
    )
    assert auto.status_code == 200, auto.text
    body = auto.json()
    assert body["join_date"] == "2025-06-01"
    assert Decimal(body["opening_balance_days"]) == Decimal("20")
    assert Decimal(body["opening_balance_amount"]) == Decimal("40")
    assert Decimal(body["days_left"]) == Decimal(body["total_entitlement_days"])
    assert Decimal(body["final_entitlement_amount"]) == Decimal("42.29")
    assert Decimal(body["airfare_entitlement_amount"]) == Decimal("42.29")
    assert Decimal(body["eligible_balance_days"]) == Decimal(body["days_left"])
    assert Decimal(body["already_paid_amount"]) == Decimal("0")
    assert body["current_year_remaining"] is not None
    assert body["total_available_funds"] is not None
    assert body["per_day_rate"]
    assert Decimal(body["maximum_payout"]) == POLICY_150
    assert Decimal(body["max_payout"]) == POLICY_150
    assert body["daily_rate"]
    assert body["rate_source"]
    assert body["current_year_earned_days"]
    assert body.get("excess_requires_choice") is not True

    over = client.post(
        "/v1/allocations/preview",
        headers=headers,
        json={
            "employee_id": str(employee_id),
            "as_of_date": "2026-01-11",
            "requested_ticket_amount": "100",
        },
    )
    assert over.status_code == 200, over.text
    over_body = over.json()
    assert over_body["excess_requires_choice"] is True
    assert Decimal(over_body["excess_cost"]) == Decimal("57.71")

    within = client.post(
        "/v1/allocations/preview",
        headers=headers,
        json={
            "employee_id": str(employee_id),
            "as_of_date": "2026-01-11",
            "requested_ticket_amount": "10",
        },
    )
    assert within.status_code == 200, within.text
    assert within.json()["excess_requires_choice"] is False
    assert Decimal(within.json()["excess_cost"]) == Decimal("0")

    issued = client.post(
        "/v1/allocations/issue",
        headers=headers,
        json={
            "employee_id": str(employee_id),
            "as_of_date": "2026-01-11",
            "requested_ticket_amount": "10",
            "origin_code": "BAH",
            "destination_code": "DXB",
        },
    )
    assert issued.status_code == 201, issued.text
    assert issued.json()["loan_id"] is None


def test_run_emi_and_loan_statement_report() -> None:
    """Run EMI for an employee and open the loan statement report."""
    client, headers = _client()
    employee_id = _create_employee_with_opening(
        client,
        headers,
        code="EMI-01",
        join_date="2025-01-01",
        custom_rate=POLICY_150,
        max_cap=Decimal("150"),
        opening_days=Decimal("20"),
        opening_amount=Decimal("40"),
    )
    empty = client.post(
        "/v1/loans/run-emi",
        headers=headers,
        json={"employee_id": str(employee_id)},
    )
    assert empty.status_code == 200, empty.text
    assert empty.json()["loans"] == []
    assert "Make loan" in empty.json()["message"]

    issued = client.post(
        "/v1/allocations/issue",
        headers=headers,
        json={
            "employee_id": str(employee_id),
            "as_of_date": "2026-01-11",
            "requested_ticket_amount": "100",
            "excess_option": "LOAN",
            "tenure_months": 6,
            "origin_code": "BAH",
            "destination_code": "DXB",
        },
    )
    assert issued.status_code == 201, issued.text
    loan_id = issued.json()["loan_id"]
    assert loan_id

    emi = client.post(
        "/v1/loans/run-emi",
        headers=headers,
        json={"employee_id": str(employee_id)},
    )
    assert emi.status_code == 200, emi.text
    assert len(emi.json()["loans"]) == 1
    schedule = emi.json()["loans"][0]["schedule"]
    assert len(schedule) == 6
    assert Decimal(str(schedule[-1]["closing_balance"])) == Decimal("0")
    assert "opening_balance" in schedule[0]

    stored = client.get(f"/v1/loans/{loan_id}/schedule", headers=headers)
    assert stored.status_code == 200, stored.text
    assert len(stored.json()) == 6

    report = client.get("/v1/reports/detail/loan-statement", headers=headers)
    assert report.status_code == 200, report.text
    columns = report.json()["columns"]
    assert "Employee" in columns
    assert "Loan ID" in columns
    assert "Principal" in columns
    assert "Outstanding" in columns
    assert any(str(loan_id) in [str(cell) for cell in row] for row in report.json()["rows"])

    pdf = client.get("/v1/reports/export/loan-statement.pdf", headers=headers)
    assert pdf.status_code == 200, pdf.text
    xlsx = client.get("/v1/reports/export/loan-statement.xlsx", headers=headers)
    assert xlsx.status_code == 200
    assert xlsx.content[:2] == b"PK"


def test_issue_creates_multiple_loans_and_emis() -> None:
    client, headers = _client()
    employees = [
        _create_employee_with_opening(
            client,
            headers,
            code="ML-01",
            join_date="2025-01-01",
            custom_rate=POLICY_150,
            max_cap=Decimal("150"),
            opening_days=Decimal("20"),
            opening_amount=Decimal("40"),
        ),
        _create_employee_with_opening(
            client,
            headers,
            code="ML-02",
            join_date="2025-01-01",
            custom_rate=POLICY_150,
            max_cap=Decimal("150"),
            opening_days=Decimal("20"),
            opening_amount=Decimal("40"),
        ),
    ]

    ticket_ids: list[str] = []
    loan_principals: list[Decimal] = []
    for eid in employees:
        issued = client.post(
            "/v1/allocations/issue",
            headers=headers,
            json={
                "employee_id": str(eid),
                "as_of_date": "2026-01-11",
                "requested_ticket_amount": "100",
                "excess_option": "LOAN",
                "tenure_months": 6,
                "origin_code": "KHI",
                "destination_code": "DXB",
            },
        )
        assert issued.status_code == 201, issued.text
        body = issued.json()
        ticket_ids.append(body["ticket_id"])
        loan_principals.append(Decimal(body["excess_cost"]))

    loans = client.get("/v1/loans", headers=headers).json()
    assert len(loans) >= 2
    # ATLAS: opening 40 + Jan 1–11 earned 2.29 = 42.29; excess 57.71; EMI 9.62
    assert all(Decimal(loan["monthly_installment"]) == Decimal("9.6200") for loan in loans[:2])


def test_defer_loan_sets_deferred_status() -> None:
    client, headers = _client()
    employee_id = _create_employee_with_opening(
        client,
        headers,
        code="DEF-01",
        join_date="2025-01-01",
        custom_rate=POLICY_150,
        max_cap=Decimal("150"),
        opening_days=Decimal("20"),
        opening_amount=Decimal("40"),
    )
    issued = client.post(
        "/v1/allocations/issue",
        headers=headers,
        json={
            "employee_id": str(employee_id),
            "as_of_date": "2026-01-11",
            "requested_ticket_amount": "100",
            "excess_option": "LOAN",
            "tenure_months": 6,
            "origin_code": "KHI",
            "destination_code": "DXB",
        },
    )
    assert issued.status_code == 201, issued.text
    loan_id = issued.json()["loan_id"]
    loans = client.get("/v1/loans", headers=headers).json()
    loan = next(l for l in loans if str(l["id"]) == str(loan_id))
    if_match = loan["version"]

    defer = client.post(
        f"/v1/loans/{loan_id}/defer",
        headers={**headers, "If-Match": str(if_match)},
        json={"deferred_until": "2026-12-01"},
    )
    assert defer.status_code == 200, defer.text
    assert defer.json()["status"] == "deferred"


def test_mssql_scenario_3_preview_persists_and_cleanup() -> None:
    """Optional MSSQL-backed test. Skips when AIRFARE_DATABASE_URL is not MSSQL."""
    settings = Settings()
    if "mssql" not in settings.database_url:
        pytest.skip("AIRFARE_DATABASE_URL is not MSSQL.")

    sessions = create_session_factory(settings)
    client = TestClient(create_app(settings))
    token = issue_access_token(
        uuid4(),
        {"admin", "SYSTEM_ADMIN", "hr", "HR_MANAGER", "manager"},
        settings,
    )
    headers = {"Authorization": f"Bearer {token}"}

    employee_id: UUID | None = None
    try:
        created = client.post(
            "/v1/employees",
            headers=headers,
            json={
                "code": f"MS-SEQ-{uuid4().hex[:8]}",
                "full_name": "MSSQL Scenario3 Preview",
                "company_id": DEFAULT_COMPANY_ID,
                "join_date": "2025-06-01",
                "custom_airfare_rate": "150",
                "max_entitlement_cap_rate": "150",
            },
        )
        assert created.status_code == 201, created.text
        employee_id = UUID(str(created.json()["id"]))

        opening = client.post(
            "/v1/opening-balances",
            headers=headers,
            json={
                "employee_id": str(employee_id),
                "balance_year": 2026,
                "opening_days": "20",
                "opening_amount": "40",
                "maximum_payout": "150",
            },
        )
        assert opening.status_code == 201, opening.text

        preview = client.post(
            "/v1/allocations/preview",
            headers=headers,
            json={
                "employee_id": str(employee_id),
                "as_of_date": "2026-01-11",
                "requested_ticket_amount": "100",
                "excess_option": "SELF_PAID",
            },
        )
        assert preview.status_code == 200, preview.text
        body = preview.json()
        assert body["scenario"] == AllocationScenario.OPENING_BALANCE_ACCRUAL.value
        assert Decimal(body["final_entitlement_amount"]) == Decimal("42.29")
    finally:
        if employee_id is not None:
            current = client.get(f"/v1/employees/{employee_id}", headers=headers)
            if current.status_code == 200:
                deleted = client.delete(
                    f"/v1/employees/{employee_id}",
                    headers={**headers, "If-Match": str(current.json()["version"])},
                )
                assert deleted.status_code == 204, deleted.text
        sessions.kw["bind"].dispose()


def test_issue_returns_sequential_ticket_and_loan_codes() -> None:
    """Issued tickets and loans expose short display codes, not only UUIDs."""
    client, headers = _client()
    first = _create_employee_with_opening(
        client,
        headers,
        code="NUM-01",
        join_date="2025-01-01",
        custom_rate=POLICY_150,
        max_cap=Decimal("150"),
        opening_days=Decimal("20"),
        opening_amount=Decimal("40"),
    )
    second = _create_employee_with_opening(
        client,
        headers,
        code="NUM-02",
        join_date="2025-01-01",
        custom_rate=POLICY_150,
        max_cap=Decimal("150"),
        opening_days=Decimal("20"),
        opening_amount=Decimal("40"),
    )
    issued = client.post(
        "/v1/allocations/issue",
        headers=headers,
        json={
            "employee_id": str(first),
            "as_of_date": "2026-01-11",
            "requested_ticket_amount": "100",
            "excess_option": "LOAN",
            "tenure_months": 6,
            "origin_code": "KHI",
            "destination_code": "DXB",
        },
    )
    assert issued.status_code == 201, issued.text
    body = issued.json()
    assert body["ticket_number"] == 1
    assert body["ticket_code"] == "T-000001"
    assert body["loan_number"] == 1
    assert body["loan_code"] == "L-000001"
    assert "Allocation saved." in body["message"]
    assert "Ticket T-000001 created." in body["message"]
    assert "Loan L-000001 created." in body["message"]
    listed = client.get("/v1/tickets", headers=headers).json()
    assert listed[0]["ticket_code"] == "T-000001"
    next_ticket = client.post(
        "/v1/allocations/issue",
        headers=headers,
        json={
            "employee_id": str(second),
            "as_of_date": "2026-01-11",
            "requested_ticket_amount": "10",
            "excess_option": "SELF_PAID",
            "origin_code": "KHI",
            "destination_code": "DXB",
        },
    )
    assert next_ticket.status_code == 201, next_ticket.text
    follow = next_ticket.json()
    assert follow["ticket_code"] == "T-000002"
    assert follow["loan_code"] is None
    assert "Loan" not in follow["message"]


def test_preview_daily_rate_is_limited_to_four_decimals() -> None:
    """Allocation previews do not return repeating daily-rate fractions."""
    client, headers = _client()
    employee_id = _create_employee_with_opening(
        client,
        headers,
        code="RATE-4D",
        join_date="2009-07-30",
        custom_rate=Decimal("200"),
        max_cap=Decimal("200"),
        opening_days=Decimal("0"),
        opening_amount=Decimal("0"),
    )
    preview = client.post(
        "/v1/allocations/preview",
        headers=headers,
        json={"employee_id": str(employee_id), "as_of_date": "2026-08-18"},
    )
    assert preview.status_code == 200, preview.text
    daily = preview.json()["daily_rate"]
    assert daily == "3.3333"
    assert "3.333333" not in daily


def test_company_policy_rate_beats_global_preference() -> None:
    """Company dated MaxPayout wins over global preference when no employee/group rate exists."""
    client, headers = _client()
    created = client.post(
        "/v1/employees",
        headers=headers,
        json={
            "code": "CO-01",
            "full_name": "Company Policy Emp",
            "company_id": DEFAULT_COMPANY_ID,
            "join_date": "2025-01-01",
            "pay_group": "PG1",
        },
    )
    assert created.status_code == 201, created.text
    employee_id = UUID(str(created.json()["id"]))
    rate = client.post(
        "/v1/entitlement-rates",
        headers=headers,
        json={
            "scope_type": "company",
            "scope_id": DEFAULT_COMPANY_ID,
            "amount": "240",
            "effective_from": "2026-01-01",
            "cap_amount": "240",
        },
    )
    assert rate.status_code == 201, rate.text
    preview = client.post(
        "/v1/allocations/preview",
        headers=headers,
        json={"employee_id": str(employee_id), "as_of_date": "2026-08-18"},
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["rate_source"] == RateSource.COMPANY.value
    assert Decimal(body["airfare_rate"]) == Decimal("240")


def test_new_policy_closes_previous_open_ended_rate() -> None:
    """Saving a newer rate closes the prior open-ended row for the same scope."""
    client, headers = _client()
    first = client.post(
        "/v1/entitlement-rates",
        headers=headers,
        json={
            "scope_type": "global",
            "scope_id": "",
            "amount": "150",
            "effective_from": "2026-01-01",
        },
    )
    assert first.status_code == 201, first.text
    second = client.post(
        "/v1/entitlement-rates",
        headers=headers,
        json={
            "scope_type": "global",
            "scope_id": "",
            "amount": "180",
            "effective_from": "2026-06-01",
        },
    )
    assert second.status_code == 201, second.text
    rows = client.get("/v1/entitlement-rates", headers=headers).json()
    globals_rows = [row for row in rows if row["scope_type"] == "global"]
    assert len(globals_rows) == 2
    older = next(row for row in globals_rows if row["amount"].startswith("150"))
    assert older["effective_to"] == "2026-05-31"


def test_erase_all_data_removes_employees_and_restores_defaults() -> None:
    """ERASE_ALL_DATA hard-deletes operational rows and restores global preference defaults."""
    client, headers = _client()
    created = client.post(
        "/v1/employees",
        headers=headers,
        json={
            "code": "ERASE-01",
            "full_name": "Erase Me",
            "company_id": DEFAULT_COMPANY_ID,
            "join_date": "2025-01-01",
        },
    )
    assert created.status_code == 201, created.text
    erased = client.post(
        "/v1/admin/erase-data",
        headers=headers,
        json={"confirm": "ERASE_ALL_DATA"},
    )
    assert erased.status_code == 200, erased.text
    body = erased.json()
    assert body["status"] == "erased"
    assert body["cleared"]["employees"] >= 1
    assert body["defaults_restored"] >= 1
    assert client.get("/v1/employees", headers=headers).json() == []
    effective = client.get("/v1/preferences/effective", headers=headers).json()
    assert effective["global_company_preference_rate"] == "150"
    assert effective["airfare_rate_days"] == "60"


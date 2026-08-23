"""Unit tests for MSSQL entitlement wrapper (Python fallback + row mapping)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from airfare_management.domain.services import (
    AllocationScenario,
    RateSource,
    calculate_allocation_entitlement,
)
from airfare_management.infrastructure.mssql_entitlement import (
    calculate_entitlement,
    row_to_entitlement,
)

POLICY = Decimal("150")


def _python_result(**overrides: object):
    kwargs = {
        "as_of_date": date(2026, 1, 11),
        "date_of_joining": date(2025, 6, 1),
        "last_ticket_date": None,
        "opening_balance_days": Decimal("20"),
        "opening_balance_amount": Decimal("40"),
        "airfare_rate": POLICY,
        "rate_source": RateSource.GLOBAL,
        "max_entitlement_cap_rate": None,
    }
    kwargs.update(overrides)
    return calculate_allocation_entitlement(**kwargs)  # type: ignore[arg-type]


def test_row_to_entitlement_round_trips_python_result() -> None:
    expected = _python_result()
    row = {
        "scenario": expected.scenario.value,
        "accrual_start": expected.accrual_start,
        "accrued_days": expected.accrued_days,
        "daily_rate": expected.daily_rate,
        "airfare_rate": expected.airfare_rate,
        "rate_source": expected.rate_source.value,
        "rate_days": expected.rate_days,
        "calculated_entitlement_amount": expected.calculated_entitlement_amount,
        "current_year_amount": expected.current_year_amount,
        "total_entitlement_days": expected.total_entitlement_days,
        "opening_balance_days": expected.opening_balance_days,
        "opening_balance_amount": expected.opening_balance_amount,
        "final_entitlement_amount": expected.final_entitlement_amount,
        "max_entitlement_cap_rate": expected.max_entitlement_cap_rate,
        "last_ticket_date": expected.last_ticket_date,
        "already_paid_days": expected.already_paid_days,
        "already_paid_amount": expected.already_paid_amount,
        "current_year_remaining": expected.current_year_remaining,
        "total_available_funds": expected.total_available_funds,
    }
    assert row_to_entitlement(row) == expected


def test_calculate_entitlement_falls_back_to_python() -> None:
    expected = _python_result()
    actual = calculate_entitlement(
        as_of_date=date(2026, 1, 11),
        date_of_joining=date(2025, 6, 1),
        last_ticket_date=None,
        opening_balance_days=Decimal("20"),
        opening_balance_amount=Decimal("40"),
        airfare_rate=POLICY,
        rate_source=RateSource.GLOBAL,
        max_entitlement_cap_rate=None,
        prefer_mssql=False,
    )
    assert actual == expected
    assert actual.scenario is AllocationScenario.OPENING_BALANCE_ACCRUAL
    assert actual.final_entitlement_amount == Decimal("42.29")


def test_previous_ticket_scenario_via_wrapper() -> None:
    result = calculate_entitlement(
        as_of_date=date(2026, 1, 15),
        date_of_joining=date(2020, 1, 1),
        last_ticket_date=date(2026, 1, 10),
        opening_balance_days=Decimal("20"),
        opening_balance_amount=Decimal("50"),
        airfare_rate=POLICY,
        rate_source=RateSource.EMPLOYEE,
        max_entitlement_cap_rate=POLICY,
        prefer_mssql=False,
    )
    assert result.scenario is AllocationScenario.PREVIOUS_TICKET

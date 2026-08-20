"""Unit tests for deterministic business rules."""

from datetime import date
from decimal import Decimal

import pytest

from airfare_management.domain.models import ConflictError, Employee, ValidationError
from airfare_management.domain.services import (
    allocation_working_days,
    calculate_emi,
    calculate_entitlement,
    resolve_preferences,
)


def test_full_year_entitlement_matches_legacy_rule() -> None:
    """A full 360-day year accrues 30 days and half of the policy cap."""
    result = calculate_entitlement(Decimal("0"), 360, Decimal("0"), Decimal("150.00"))
    assert result.current_days == Decimal("30.0000")
    assert result.remaining_days == Decimal("30.0000")
    assert result.payable == Decimal("75.00")


def test_entitlement_caps_days_and_money() -> None:
    """Carry-forward cannot exceed the configured cycle or payout cap."""
    result = calculate_entitlement(Decimal("60"), 360, Decimal("0"), Decimal("150.00"))
    assert result.remaining_days == Decimal("60.0000")
    assert result.payable == Decimal("150.00")


@pytest.mark.parametrize("working_days", [-1, 361])
def test_entitlement_rejects_invalid_working_days(working_days: int) -> None:
    """Out-of-contract working-day values are rejected."""
    with pytest.raises(ValidationError, match="between 0 and 360"):
        calculate_entitlement(Decimal("0"), working_days, Decimal("0"), Decimal("150"))


def test_30_360_allocation_handles_join_and_previous_dates() -> None:
    """The latest eligible start date controls accrual."""
    assert (
        allocation_working_days(
            date(2026, 3, 30),
            2026,
            join_date=date(2026, 1, 15),
            previous_allocation_date=date(2026, 2, 28),
        )
        == 30
    )


def test_allocation_outside_year_is_bounded() -> None:
    """Dates before and after the allocation year map to zero and 360."""
    assert allocation_working_days(date(2025, 12, 31), 2026) == 0
    assert allocation_working_days(date(2027, 1, 1), 2026) == 360


def test_zero_interest_emi_rounds_commercially() -> None:
    """Zero-rate loans divide principal across installments."""
    assert calculate_emi(Decimal("100"), Decimal("0"), 3) == Decimal("33.33")


def test_interest_emi_is_deterministic() -> None:
    """Reducing-balance EMI uses Decimal arithmetic."""
    assert calculate_emi(Decimal("1000"), Decimal("12"), 12) == Decimal("88.85")


def test_preferences_deep_merge_and_replace_lists() -> None:
    """Specific objects merge while lists and scalars replace."""
    effective = resolve_preferences(
        (
            {"appearance": {"theme": "system", "columns": ["code"]}, "locked": True},
            {"appearance": {"theme": "dark", "columns": ["name"]}},
            {"appearance": {"theme": None}, "locked": None},
        )
    )
    assert effective == {
        "appearance": {"theme": "dark", "columns": ["name"]},
        "locked": True,
    }


def test_optimistic_version_detects_stale_writer() -> None:
    """An entity rejects a stale expected version."""
    employee = Employee(
        code="E1",
        full_name="Example Employee",
        company_id=__import__("uuid").uuid4(),
        join_date=date(2026, 1, 1),
    )
    employee.touch(1)
    with pytest.raises(ConflictError):
        employee.touch(1)

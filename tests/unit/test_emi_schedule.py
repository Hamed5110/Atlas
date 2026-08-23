"""Unit tests for EMI amortization schedule generation."""

from datetime import date
from decimal import Decimal

import pytest

from airfare_management.api.main import _first_of_next_month
from airfare_management.domain.models import ValidationError
from airfare_management.domain.services import build_amortization_schedule, calculate_emi


class TestFirstOfNextMonth:
    """Loan first-due date must land on the 1st of the following month."""

    @pytest.mark.parametrize(
        ("anchor", "expected"),
        [
            (date(2026, 1, 15), date(2026, 2, 1)),
            (date(2026, 1, 31), date(2026, 2, 1)),
            (date(2026, 12, 5), date(2027, 1, 1)),
        ],
    )
    def test_first_of_next_month(self, anchor: date, expected: date) -> None:
        assert _first_of_next_month(anchor) == expected


class TestEmiCalculation:
    """Monthly installment formula."""

    def test_zero_rate_equal_principal(self) -> None:
        emi = calculate_emi(Decimal("1200"), Decimal("0"), 12)
        assert emi == Decimal("100.00")

    def test_positive_rate_exceeds_equal_principal(self) -> None:
        emi = calculate_emi(Decimal("1200"), Decimal("12"), 12)
        assert emi > Decimal("100.00")

    def test_invalid_terms_raise(self) -> None:
        with pytest.raises(ValidationError):
            calculate_emi(Decimal("0"), Decimal("0"), 12)
        with pytest.raises(ValidationError):
            calculate_emi(Decimal("100"), Decimal("0"), 0)


class TestAmortizationSchedule:
    """Schedule integrity and month-end drift prevention."""

    def test_principal_portions_sum_to_original(self) -> None:
        principal = Decimal("1200")
        schedule = build_amortization_schedule(
            principal, Decimal("0"), 12, date(2026, 2, 1)
        )
        total_principal = sum(part.principal for part in schedule)
        assert total_principal == principal
        assert schedule[-1].closing_balance == Decimal("0.00")

    def test_all_due_dates_on_first_when_anchor_is_first(self) -> None:
        schedule = build_amortization_schedule(
            Decimal("600"), Decimal("0"), 6, date(2026, 2, 1)
        )
        for part in schedule:
            assert part.due_date.day == 1

    def test_no_negative_balances(self) -> None:
        schedule = build_amortization_schedule(
            Decimal("999.99"), Decimal("8.5"), 18, date(2026, 3, 1)
        )
        for part in schedule:
            assert part.opening_balance >= Decimal("0")
            assert part.closing_balance >= Decimal("0")
            assert part.payment >= Decimal("0")

    def test_month_end_anchor_preserves_month_end_drift_rule(self) -> None:
        """Jan 31 anchor uses month-end day for subsequent months."""
        schedule = build_amortization_schedule(
            Decimal("300"), Decimal("0"), 3, date(2026, 1, 31)
        )
        assert schedule[0].due_date == date(2026, 1, 31)
        # February uses last day (28 in 2026)
        assert schedule[1].due_date == date(2026, 2, 28)

    def test_schedule_length_matches_installments(self) -> None:
        for n in (1, 3, 6, 12, 24):
            schedule = build_amortization_schedule(
                Decimal("1000"), Decimal("0"), n, date(2026, 2, 1)
            )
            assert len(schedule) == n

    def test_opening_balance_starts_at_outstanding(self) -> None:
        outstanding = Decimal("850")
        schedule = build_amortization_schedule(
            outstanding, Decimal("0"), 10, date(2026, 4, 1)
        )
        assert schedule[0].opening_balance == outstanding

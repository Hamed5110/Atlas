"""Property-based tests for loan amortization invariants."""

from datetime import date
from decimal import Decimal

from hypothesis import given, settings
from hypothesis import strategies as st

from airfare_management.domain.services import build_amortization_schedule

PRINCIPAL = st.decimals(
    min_value=Decimal("1"),
    max_value=Decimal("50000"),
    places=2,
    allow_nan=False,
    allow_infinity=False,
)
RATE = st.decimals(
    min_value=Decimal("0"),
    max_value=Decimal("24"),
    places=2,
    allow_nan=False,
    allow_infinity=False,
)
INSTALLMENTS = st.integers(min_value=1, max_value=36)


class TestLoanProperties:
    """Amortization schedule must always balance."""

    @given(principal=PRINCIPAL, rate=RATE, installments=INSTALLMENTS)
    @settings(max_examples=120, deadline=None)
    def test_principal_portions_sum_to_original(
        self, principal: Decimal, rate: Decimal, installments: int
    ) -> None:
        schedule = build_amortization_schedule(
            principal, rate, installments, date(2026, 2, 1)
        )
        assert len(schedule) == installments
        total = sum(part.principal for part in schedule)
        assert total == principal
        assert schedule[-1].closing_balance == Decimal("0.00")

    @given(principal=PRINCIPAL, rate=RATE, installments=INSTALLMENTS)
    @settings(max_examples=80, deadline=None)
    def test_no_negative_balances(
        self, principal: Decimal, rate: Decimal, installments: int
    ) -> None:
        schedule = build_amortization_schedule(
            principal, rate, installments, date(2026, 2, 1)
        )
        for part in schedule:
            assert part.opening_balance >= Decimal("0")
            assert part.closing_balance >= Decimal("0")

    @given(principal=PRINCIPAL, installments=INSTALLMENTS)
    @settings(max_examples=80, deadline=None)
    def test_zero_rate_emi_times_installments_covers_principal(
        self, principal: Decimal, installments: int
    ) -> None:
        schedule = build_amortization_schedule(
            principal, Decimal("0"), installments, date(2026, 2, 1)
        )
        total_paid = sum(part.payment for part in schedule)
        assert total_paid >= principal - Decimal("0.01")

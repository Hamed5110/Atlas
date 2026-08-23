"""Property-based tests for allocation invariants."""

from datetime import date
from decimal import Decimal

from hypothesis import given, settings
from hypothesis import strategies as st

from airfare_management.domain.services import (
    ExcessSettlementOption,
    allocation_working_days,
    settle_excess_ticket,
)

MONEY = st.decimals(
    min_value=Decimal("0"),
    max_value=Decimal("10000"),
    places=2,
    allow_nan=False,
    allow_infinity=False,
)
DAYS = st.integers(min_value=0, max_value=360)
YEAR = st.integers(min_value=2020, max_value=2030)
MONTH = st.integers(min_value=1, max_value=12)
DAY = st.integers(min_value=1, max_value=28)


@st.composite
def calendar_dates(draw: st.DrawFn) -> date:
    return date(draw(YEAR), draw(MONTH), draw(DAY))


class TestAllocationProperties:
    """Financial invariants under random inputs."""

    @given(
        ticket=MONEY,
        entitlement=MONEY,
    )
    @settings(max_examples=200, deadline=None)
    def test_self_paid_excess_non_negative_payable(
        self, ticket: Decimal, entitlement: Decimal
    ) -> None:
        result = settle_excess_ticket(
            ticket, entitlement, ExcessSettlementOption.SELF_PAID
        )
        assert result.employee_payable >= Decimal("0")
        assert result.company_payout >= Decimal("0")
        if ticket <= entitlement:
            assert result.excess_cost == Decimal("0")
        else:
            assert result.excess_cost == ticket - entitlement

    @given(
        ticket=MONEY,
        entitlement=MONEY,
    )
    @settings(max_examples=200, deadline=None)
    def test_no_excess_parts_sum_to_ticket(
        self, ticket: Decimal, entitlement: Decimal
    ) -> None:
        if ticket > entitlement:
            return
        result = settle_excess_ticket(
            ticket, entitlement, ExcessSettlementOption.SELF_PAID
        )
        assert result.company_payout + result.employee_payable == ticket

    @given(
        target=calendar_dates(),
        year=YEAR,
    )
    @settings(max_examples=150, deadline=None)
    def test_working_days_bounded(self, target: date, year: int) -> None:
        days = allocation_working_days(target, year)
        assert 0 <= days <= 360

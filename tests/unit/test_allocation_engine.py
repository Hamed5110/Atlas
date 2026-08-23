"""Unit tests for the ATLAS 30/360 allocation engine (domain layer)."""

from datetime import date
from decimal import Decimal

import pytest

from airfare_management.domain.models import ValidationError
from airfare_management.domain.services import (
    AIRFARE_CYCLE_DAYS,
    AllocationScenario,
    ExcessSettlementOption,
    RateSource,
    allocation_working_days,
    calculate_allocation_entitlement,
    daily_airfare_rate,
    fn_atlas_airfare_amount,
    resolve_airfare_rate_hierarchy,
    resolve_entitlement_cap,
    settle_excess_ticket,
)

POLICY_150 = Decimal("150")


class TestWorkingDays30_360:
    """30/360 day-count conventions and boundaries."""

    def test_full_year_from_january_first(self) -> None:
        days = allocation_working_days(date(2026, 12, 31), 2026)
        assert days == 360

    def test_join_date_mid_year_truncates_start(self) -> None:
        days = allocation_working_days(
            date(2026, 6, 30), 2026, join_date=date(2026, 4, 1)
        )
        # Apr 1 → Jun 30: (6-1)*30 + 30 - ((4-1)*30 + 1) + 1 = 90
        assert days == 90

    def test_previous_ticket_resets_accrual_window(self) -> None:
        days = allocation_working_days(
            date(2026, 1, 15),
            2026,
            join_date=date(2020, 1, 1),
            previous_allocation_date=date(2026, 1, 10),
        )
        # Jan 11–15 inclusive in 30/360
        assert days == 5

    def test_before_join_date_returns_zero(self) -> None:
        assert (
            allocation_working_days(
                date(2026, 1, 5), 2026, join_date=date(2026, 2, 1)
            )
            == 0
        )

    def test_prior_year_target_returns_zero(self) -> None:
        assert allocation_working_days(date(2025, 12, 31), 2026) == 0

    def test_future_year_target_returns_full_cycle(self) -> None:
        assert allocation_working_days(date(2027, 1, 1), 2026) == 360


class TestDailyRateAndCaps:
    """Rate hierarchy and cap enforcement."""

    def test_daily_rate_uses_cycle_divisor_60(self) -> None:
        assert daily_airfare_rate(POLICY_150) == POLICY_150 / AIRFARE_CYCLE_DAYS

    def test_rate_hierarchy_precedence(self) -> None:
        rate, source = resolve_airfare_rate_hierarchy(
            Decimal("100"), Decimal("200"), Decimal("300"), Decimal("250")
        )
        assert rate == Decimal("100")
        assert source is RateSource.EMPLOYEE

        rate, source = resolve_airfare_rate_hierarchy(
            None, Decimal("200"), Decimal("300"), Decimal("250")
        )
        assert rate == Decimal("200")
        assert source is RateSource.PAY_GROUP

        rate, source = resolve_airfare_rate_hierarchy(
            None, None, Decimal("300"), Decimal("250")
        )
        assert rate == Decimal("250")
        assert source is RateSource.COMPANY

    def test_cap_hierarchy(self) -> None:
        assert resolve_entitlement_cap(Decimal("80"), Decimal("90"), Decimal("100")) == Decimal(
            "80"
        )
        assert resolve_entitlement_cap(None, Decimal("90"), Decimal("100")) == Decimal("90")


class TestAllocationScenarios:
    """Scenario detection and entitlement math."""

    def test_new_joinee_scenario(self) -> None:
        result = calculate_allocation_entitlement(
            as_of_date=date(2026, 3, 21),
            date_of_joining=date(2026, 3, 1),
            last_ticket_date=None,
            opening_balance_days=Decimal("0"),
            opening_balance_amount=Decimal("0"),
            airfare_rate=POLICY_150,
            rate_source=RateSource.PAY_GROUP,
            max_entitlement_cap_rate=None,
        )
        assert result.scenario is AllocationScenario.NEW_JOINEE
        assert result.accrual_start == date(2026, 3, 1)
        assert result.final_entitlement_amount >= Decimal("0")

    def test_previous_ticket_scenario(self) -> None:
        result = calculate_allocation_entitlement(
            as_of_date=date(2026, 1, 11),
            date_of_joining=date(2020, 1, 1),
            last_ticket_date=date(2026, 1, 1),
            opening_balance_days=Decimal("20"),
            opening_balance_amount=Decimal("50"),
            airfare_rate=POLICY_150,
            rate_source=RateSource.EMPLOYEE,
            max_entitlement_cap_rate=None,
        )
        assert result.scenario is AllocationScenario.PREVIOUS_TICKET
        assert result.accrual_start == date(2026, 1, 2)

    def test_opening_balance_accrual_scenario(self) -> None:
        result = calculate_allocation_entitlement(
            as_of_date=date(2026, 1, 11),
            date_of_joining=date(2025, 6, 1),
            last_ticket_date=None,
            opening_balance_days=Decimal("20"),
            opening_balance_amount=Decimal("40"),
            airfare_rate=POLICY_150,
            rate_source=RateSource.GLOBAL,
            max_entitlement_cap_rate=None,
        )
        assert result.scenario is AllocationScenario.OPENING_BALANCE_ACCRUAL

    def test_max_payout_cap_enforced(self) -> None:
        result = calculate_allocation_entitlement(
            as_of_date=date(2026, 12, 31),
            date_of_joining=date(2020, 1, 1),
            last_ticket_date=None,
            opening_balance_days=Decimal("60"),
            opening_balance_amount=Decimal("200"),
            airfare_rate=POLICY_150,
            rate_source=RateSource.GLOBAL,
            max_entitlement_cap_rate=None,
        )
        assert result.final_entitlement_amount <= POLICY_150

    def test_employee_cap_limits_final_entitlement(self) -> None:
        result = calculate_allocation_entitlement(
            as_of_date=date(2026, 6, 30),
            date_of_joining=date(2020, 1, 1),
            last_ticket_date=None,
            opening_balance_days=Decimal("0"),
            opening_balance_amount=Decimal("0"),
            airfare_rate=POLICY_150,
            rate_source=RateSource.GLOBAL,
            max_entitlement_cap_rate=Decimal("25"),
        )
        assert result.final_entitlement_amount <= Decimal("25")

    def test_fn_atlas_airfare_amount_matches_formula(self) -> None:
        assert fn_atlas_airfare_amount(Decimal("30"), POLICY_150) == Decimal("75.00")
        assert fn_atlas_airfare_amount(Decimal("60"), POLICY_150) == Decimal("150.00")


class TestExcessSettlement:
    """Excess ticket handling invariants."""

    def test_no_excess_company_pays_full_ticket(self) -> None:
        result = settle_excess_ticket(
            Decimal("100"), Decimal("150"), ExcessSettlementOption.COMPANY_PAID
        )
        assert result.excess_cost == Decimal("0")
        assert result.company_payout == Decimal("100")
        assert result.employee_payable == Decimal("0")

    def test_self_paid_excess(self) -> None:
        result = settle_excess_ticket(
            Decimal("200"), Decimal("150"), ExcessSettlementOption.SELF_PAID
        )
        assert result.excess_cost == Decimal("50")
        assert result.company_payout == Decimal("150")
        assert result.employee_payable == Decimal("50")

    def test_loan_excess_requires_tenure(self) -> None:
        with pytest.raises(ValidationError, match="tenure"):
            settle_excess_ticket(
                Decimal("200"), Decimal("150"), ExcessSettlementOption.LOAN
            )

    def test_entitlement_amount_caps_company_payout(self) -> None:
        result = settle_excess_ticket(
            Decimal("300"), Decimal("48.54"), ExcessSettlementOption.ENTITLEMENT_AMOUNT
        )
        assert result.excess_cost == Decimal("251.46")
        assert result.company_payout == Decimal("48.54")
        assert result.employee_payable == Decimal("0")
        assert result.option is ExcessSettlementOption.ENTITLEMENT_AMOUNT
        assert result.loan_principal is None

    def test_loan_excess_computes_emi(self) -> None:
        result = settle_excess_ticket(
            Decimal("200"), Decimal("150"), ExcessSettlementOption.LOAN, tenure_months=12
        )
        assert result.excess_cost == Decimal("50")
        assert result.loan_principal == Decimal("50")
        assert result.emi == Decimal("4.17")
        assert result.loan_status == "Active"

    def test_company_paid_plus_employee_equals_ticket_when_excess(self) -> None:
        ticket = Decimal("500")
        entitlement = Decimal("350")
        result = settle_excess_ticket(
            ticket, entitlement, ExcessSettlementOption.SELF_PAID
        )
        assert result.company_payout + result.employee_payable == ticket

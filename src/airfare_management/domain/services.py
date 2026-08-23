"""Pure domain calculations for entitlement, preferences, and loans."""

from calendar import isleap, monthrange
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal
from enum import StrEnum
from typing import Any

from airfare_management.domain.models import ValidationError

MONEY = Decimal("0.01")
DAYS = Decimal("0.0001")


def quantize_money(value: Decimal) -> Decimal:
    """Round a monetary value using banker's rounding.

    Args:
        value: Decimal amount.

    Returns:
        Amount rounded to two decimal places.
    """
    return value.quantize(MONEY, rounding=ROUND_HALF_EVEN)


@dataclass(frozen=True, slots=True)
class EntitlementResult:
    """Calculated leave-travel entitlement."""

    current_days: Decimal
    remaining_days: Decimal
    payable: Decimal


class EntitlementScenario(StrEnum):
    """Supported employee entitlement scenarios."""

    EXISTING = "existing"
    NEW_JOINER = "new_joiner"
    MID_YEAR_ALLOCATION = "mid_year_allocation"
    CARRY_FORWARD = "carry_forward"


@dataclass(frozen=True, slots=True)
class EntitlementRate:
    """One effective rate candidate ordered by business scope."""

    scope_type: str
    scope_id: str
    amount: Decimal
    cap_amount: Decimal | None = None


def resolve_entitlement_rate(
    rates: Sequence[EntitlementRate],
    *,
    employee_id: str,
    pay_group: str,
    preference_cap: Decimal | None = None,
    company_id: str = "",
) -> Decimal:
    """Resolve employee, pay-group, company, then global rate and enforce every applicable cap."""
    priorities = (
        ("employee", employee_id),
        ("pay_group", pay_group),
        ("company", company_id),
        ("global", ""),
    )
    selected: EntitlementRate | None = None
    for scope_type, scope_id in priorities:
        selected = next(
            (rate for rate in rates if rate.scope_type == scope_type and rate.scope_id == scope_id),
            None,
        )
        if selected is not None:
            break
    if selected is None:
        raise ValidationError("rate_not_found", "No effective airfare rate is configured.")
    caps = [cap for cap in (selected.cap_amount, preference_cap) if cap is not None]
    return quantize_money(min((selected.amount, *caps)))


@dataclass(frozen=True, slots=True)
class LoanInstallment:
    """One deterministic reducing-balance loan installment."""

    number: int
    due_date: date
    opening_balance: Decimal
    principal: Decimal
    interest: Decimal
    payment: Decimal
    closing_balance: Decimal


def allocation_working_days(
    target_date: date,
    allocation_year: int,
    join_date: date | None = None,
    previous_allocation_date: date | None = None,
) -> int:
    """Calculate 30/360 working days, preserving the legacy ATLAS rule.

    Args:
        target_date: Calculation cut-off.
        allocation_year: Entitlement year.
        join_date: Employee joining date.
        previous_allocation_date: Last allocation date, if any.

    Returns:
        Inclusive working-day count capped at 360.
    """
    if target_date.year != allocation_year:
        return 0 if target_date.year < allocation_year else 360
    start = date(allocation_year, 1, 1)
    if join_date is not None:
        start = max(start, join_date)
    if previous_allocation_date is not None:
        ordinal = previous_allocation_date.toordinal() + 1
        start = max(start, date.fromordinal(ordinal))
    if start > target_date:
        return 0
    start_serial = (start.month - 1) * 30 + start.day
    end_serial = (target_date.month - 1) * 30 + target_date.day
    return min(360, max(0, end_serial - start_serial + 1))


def calculate_entitlement(
    opening_days: Decimal,
    current_working_days: int,
    paid_days: Decimal,
    maximum_payout: Decimal,
    *,
    cycle_days: Decimal = Decimal("60"),
) -> EntitlementResult:
    """Calculate accrued days and capped payable amount.

    Args:
        opening_days: Carried entitlement days.
        current_working_days: Current-year 30/360 service days.
        paid_days: Days already consumed.
        maximum_payout: Policy cap.
        cycle_days: Full entitlement cycle length.

    Returns:
        Deterministic entitlement result.

    Raises:
        ValidationError: If an input is outside its valid range.
    """
    if not 0 <= current_working_days <= 360:
        raise ValidationError("working_days_range", "Working days must be between 0 and 360.")
    if min(opening_days, paid_days, maximum_payout, cycle_days) < 0 or cycle_days == 0:
        raise ValidationError("negative_value", "Entitlement values cannot be negative.")
    current = (Decimal(current_working_days) / Decimal("30") * Decimal("2.5")).quantize(
        DAYS, rounding=ROUND_HALF_UP
    )
    remaining = min(cycle_days, max(Decimal("0"), opening_days + current - paid_days))
    remaining = remaining.quantize(DAYS, rounding=ROUND_HALF_UP)
    payable = min(
        maximum_payout,
        (maximum_payout / cycle_days * remaining).quantize(MONEY, rounding=ROUND_HALF_UP),
    )
    return EntitlementResult(current, remaining, payable)


def calculate_entitlement_scenario(
    scenario: EntitlementScenario,
    target_date: date,
    allocation_year: int,
    opening_days: Decimal,
    paid_days: Decimal,
    maximum_payout: Decimal,
    *,
    join_date: date | None = None,
    previous_allocation_date: date | None = None,
    carry_forward_cap: Decimal = Decimal("30"),
) -> EntitlementResult:
    """Calculate an entitlement using an explicit enterprise scenario."""
    if scenario is EntitlementScenario.NEW_JOINER and join_date is None:
        raise ValidationError("join_date_required", "New joiners require a joining date.")
    if scenario is EntitlementScenario.MID_YEAR_ALLOCATION and previous_allocation_date is None:
        raise ValidationError(
            "allocation_date_required", "Mid-year allocations require a previous allocation date."
        )
    adjusted_opening = opening_days
    if scenario is EntitlementScenario.CARRY_FORWARD:
        if carry_forward_cap < 0:
            raise ValidationError("negative_cap", "Carry-forward cap cannot be negative.")
        adjusted_opening = min(opening_days, carry_forward_cap)
    if scenario is EntitlementScenario.NEW_JOINER:
        assert join_date is not None
        start = max(join_date, date(allocation_year, 1, 1))
        end = min(target_date, date(allocation_year, 12, 31))
        service_days = max(0, (end - start).days + 1)
        denominator = Decimal(366 if isleap(allocation_year) else 365)
        current = (Decimal(service_days) / denominator * Decimal("30")).quantize(
            DAYS, rounding=ROUND_HALF_EVEN
        )
        remaining = min(Decimal("60"), max(Decimal("0"), current - paid_days)).quantize(
            DAYS, rounding=ROUND_HALF_EVEN
        )
        payable = min(
            maximum_payout,
            quantize_money(maximum_payout / Decimal("30") * remaining),
        )
        return EntitlementResult(current, remaining, payable)
    working_days = allocation_working_days(
        target_date,
        allocation_year,
        previous_allocation_date=(
            previous_allocation_date
            if scenario is EntitlementScenario.MID_YEAR_ALLOCATION
            else None
        ),
    )
    if scenario is EntitlementScenario.MID_YEAR_ALLOCATION:
        adjusted_opening = Decimal("0")
    return calculate_entitlement(adjusted_opening, working_days, paid_days, maximum_payout)


def calculate_emi(principal: Decimal, annual_rate: Decimal, installments: int) -> Decimal:
    """Calculate a reducing-balance monthly installment (Excel PMT).

    EMI = P × r × (1+r)^n / ((1+r)^n − 1) where r is the monthly rate
    (annual percentage / 1200). A zero annual rate uses equal principal
    instalments, matching dbo.fn_ATLAS_LoanEMI.

    Args:
        principal: Positive amount financed.
        annual_rate: Non-negative percentage rate.
        installments: Positive payment count.

    Returns:
        Monthly installment rounded to currency precision.

    Raises:
        ValidationError: If terms are invalid.
    """
    if principal <= 0 or annual_rate < 0 or installments <= 0:
        raise ValidationError("invalid_loan_terms", "Loan terms must be positive.")
    if annual_rate == 0:
        return quantize_money(principal / installments)
    monthly = annual_rate / Decimal("1200")
    factor = (Decimal("1") + monthly) ** installments
    return quantize_money(principal * monthly * factor / (factor - Decimal("1")))


def build_amortization_schedule(
    principal: Decimal,
    annual_rate: Decimal,
    installments: int,
    first_due_date: date,
) -> tuple[LoanInstallment, ...]:
    """Build a complete EMI schedule with a final rounding adjustment."""
    payment = calculate_emi(principal, annual_rate, installments)
    monthly_rate = annual_rate / Decimal("1200")
    balance = quantize_money(principal)
    result: list[LoanInstallment] = []
    due = first_due_date
    preferred_day = first_due_date.day
    month_end = preferred_day == monthrange(first_due_date.year, first_due_date.month)[1]
    for number in range(1, installments + 1):
        interest = quantize_money(balance * monthly_rate)
        principal_part = (
            balance if number == installments else min(balance, quantize_money(payment - interest))
        )
        actual_payment = quantize_money(principal_part + interest)
        closing = quantize_money(balance - principal_part)
        result.append(
            LoanInstallment(number, due, balance, principal_part, interest, actual_payment, closing)
        )
        balance = closing
        month = due.month + 1
        year = due.year + (month - 1) // 12
        month = (month - 1) % 12 + 1
        last_day = monthrange(year, month)[1]
        day = last_day if month_end else min(preferred_day, last_day)
        due = date(year, month, day)
    return tuple(result)


def conditional_format(
    *,
    status: str,
    amount: Decimal = Decimal("0"),
    threshold: Decimal = Decimal("0"),
) -> str:
    """Return a semantic UI style token for a business record."""
    normalized = status.strip().lower()
    if normalized in {"rejected", "overdue", "failed"}:
        return "danger"
    if normalized in {"deferred", "submitted", "pending"} or amount > threshold:
        return "warning"
    if normalized in {"approved", "paid", "settled", "active"}:
        return "success"
    return "neutral"


def calendar_days_in_year(year: int) -> int:
    """Return 366 in a leap year and 365 otherwise."""
    return 366 if isleap(year) else 365


class RateSource(StrEnum):
    """Airfare rate hierarchy source."""

    EMPLOYEE = "employee"
    PAY_GROUP = "pay_group"
    COMPANY = "company"
    GLOBAL = "global"


class AllocationScenario(StrEnum):
    """Mandated entitlement accrual scenarios."""

    PREVIOUS_TICKET = "previous_ticket"
    NEW_JOINEE = "new_joinee"
    OPENING_BALANCE_ACCRUAL = "opening_balance_accrual"


class ExcessSettlementOption(StrEnum):
    """User-selected excess ticket settlement route."""

    LOAN = "LOAN"
    COMPANY_PAID = "COMPANY_PAID"
    SELF_PAID = "SELF_PAID"
    ENTITLEMENT_AMOUNT = "ENTITLEMENT_AMOUNT"


@dataclass(frozen=True, slots=True)
class AllocationEntitlementResult:
    """Exact airfare allocation entitlement calculation."""

    scenario: AllocationScenario
    accrual_start: date
    accrued_days: Decimal
    daily_rate: Decimal
    airfare_rate: Decimal
    rate_source: RateSource
    rate_days: Decimal
    calculated_entitlement_amount: Decimal
    current_year_amount: Decimal
    total_entitlement_days: Decimal
    opening_balance_days: Decimal
    opening_balance_amount: Decimal
    final_entitlement_amount: Decimal
    max_entitlement_cap_rate: Decimal | None
    last_ticket_date: date | None
    already_paid_days: Decimal
    already_paid_amount: Decimal
    current_year_remaining: Decimal
    total_available_funds: Decimal


@dataclass(frozen=True, slots=True)
class ExcessSettlementResult:
    """Excess ticket settlement according to the selected option."""

    requested_ticket_amount: Decimal
    final_entitlement_amount: Decimal
    excess_cost: Decimal
    option: ExcessSettlementOption
    employee_payable: Decimal
    company_payout: Decimal
    loan_principal: Decimal | None
    emi: Decimal | None
    tenure_months: int | None
    loan_status: str | None


AIRFARE_CYCLE_DAYS = Decimal("60")
DEFAULT_AIRFARE_POLICY_AMOUNT = Decimal("150")
WORKING_DAYS_PER_AIRFARE_DAY = Decimal("30")
AIRFARE_DAYS_PER_MONTH = Decimal("2.5")


def atlas_round(value: Decimal, digits: int) -> Decimal:
    """Match SQL Server ROUND() half-up for positive airfare amounts."""
    quant = Decimal(10) ** -digits
    return value.quantize(quant, rounding=ROUND_HALF_UP)


def fn_atlas_airfare_amount(
    closing_days: Decimal,
    maximum_payout: Decimal = DEFAULT_AIRFARE_POLICY_AMOUNT,
) -> Decimal:
    """Port of dbo.fn_ATLAS_AirfareAmount: (MaxPayout / 60) * capped days."""
    payout = DEFAULT_AIRFARE_POLICY_AMOUNT if maximum_payout <= 0 else maximum_payout
    days = min(AIRFARE_CYCLE_DAYS, max(Decimal("0"), closing_days))
    return atlas_round((payout / AIRFARE_CYCLE_DAYS) * days, 2)


def fn_atlas_loan_emi(amount: Decimal, tenure: int) -> Decimal:
    """Port of dbo.fn_ATLAS_LoanEMI: ROUND(amount / tenure, 2)."""
    if amount <= 0 or tenure <= 0:
        return Decimal("0.00")
    return atlas_round(amount / Decimal(tenure), 2)


def daily_airfare_rate(airfare_rate: Decimal, year: int | None = None) -> Decimal:
    """Return ATLAS per-day rate: MaxPayoutAmount / CycleDays (60)."""
    if airfare_rate < 0:
        raise ValidationError("negative_rate", "Airfare rate cannot be negative.")
    _ = year
    return airfare_rate / AIRFARE_CYCLE_DAYS


def daily_airfare_rate_with_days(airfare_rate: Decimal, rate_days: Decimal) -> Decimal:
    """Return per-day rate using ATLAS cycle days (default 60)."""
    if airfare_rate < 0:
        raise ValidationError("negative_rate", "Airfare rate cannot be negative.")
    if rate_days <= 0:
        raise ValidationError("invalid_rate_days", "Airfare rate days must be greater than zero.")
    return airfare_rate / rate_days


def _accrual_start(
    as_of_date: date,
    date_of_joining: date,
    last_ticket_date: date | None,
) -> date:
    """ATLAS start date: max(1 Jan of year, join date, last ticket + 1)."""
    start = date(as_of_date.year, 1, 1)
    if date_of_joining > start:
        start = date_of_joining
    if last_ticket_date is not None:
        nxt = date.fromordinal(last_ticket_date.toordinal() + 1)
        if nxt > start:
            start = nxt
    return start


def calculate_allocation_entitlement(
    *,
    as_of_date: date,
    date_of_joining: date,
    last_ticket_date: date | None,
    opening_balance_days: Decimal,
    opening_balance_amount: Decimal,
    airfare_rate: Decimal,
    rate_source: RateSource,
    max_entitlement_cap_rate: Decimal | None,
    rate_days: Decimal = AIRFARE_CYCLE_DAYS,
    paid_days: Decimal = Decimal("0"),
    current_year_spending: Decimal = Decimal("0"),
) -> AllocationEntitlementResult:
    """Port of dbo.sp_ATLAS_CalcPolicyEntitlement (30/360 + cycle 60)."""
    if min(opening_balance_days, opening_balance_amount, paid_days, current_year_spending) < 0:
        raise ValidationError("negative_value", "Opening balance values cannot be negative.")
    if airfare_rate < 0:
        raise ValidationError("negative_rate", "Airfare rate cannot be negative.")
    if max_entitlement_cap_rate is not None and max_entitlement_cap_rate < 0:
        raise ValidationError("negative_cap", "Entitlement cap cannot be negative.")
    max_payout = DEFAULT_AIRFARE_POLICY_AMOUNT if airfare_rate <= 0 else airfare_rate
    # dbo.sp_ATLAS_CalcPolicyEntitlement hard-codes MaxPayout / 60.0.
    cycle_days = AIRFARE_CYCLE_DAYS
    _ = rate_days
    previous_ticket = last_ticket_date
    if previous_ticket is not None and previous_ticket.year != as_of_date.year:
        previous_ticket = None
    cap_rate = max_payout if max_entitlement_cap_rate is None else max_entitlement_cap_rate
    per_day = max_payout / cycle_days
    working_days = allocation_working_days(
        as_of_date, as_of_date.year, date_of_joining, previous_ticket
    )
    accrued_days = atlas_round(
        (Decimal(working_days) / WORKING_DAYS_PER_AIRFARE_DAY) * AIRFARE_DAYS_PER_MONTH, 4
    )
    opening_amount_used = opening_balance_amount
    if opening_amount_used == 0 and opening_balance_days > 0:
        opening_amount_used = fn_atlas_airfare_amount(opening_balance_days, max_payout)
    current_year_amount = atlas_round(per_day * accrued_days, 2)
    total = atlas_round(opening_amount_used + current_year_amount, 2)
    if total > max_payout:
        total = atlas_round(max_payout, 2)
    paid_amount = atlas_round(paid_days * per_day, 2) + atlas_round(current_year_spending, 2)
    policy = atlas_round(total - paid_amount, 2)
    if policy < 0:
        policy = Decimal("0.00")
    remaining_days = (
        atlas_round(policy / per_day, 4) if per_day > 0 else Decimal("0")
    )
    remaining_days = min(cycle_days, max(Decimal("0"), remaining_days))
    final = atlas_round(min(policy, cap_rate), 2)
    already_paid_amount = paid_amount
    already_paid_days = (
        atlas_round(already_paid_amount / per_day, 4) if per_day > 0 else Decimal("0")
    )
    current_year_remaining = atlas_round(max_payout - atlas_round(current_year_spending, 2), 2)
    if current_year_remaining < 0:
        current_year_remaining = Decimal("0.00")
    total_available_funds = atlas_round(
        atlas_round(opening_balance_amount, 2) + current_year_remaining, 2
    )
    if previous_ticket is not None:
        scenario = AllocationScenario.PREVIOUS_TICKET
    elif date_of_joining.year == as_of_date.year:
        scenario = AllocationScenario.NEW_JOINEE
    else:
        scenario = AllocationScenario.OPENING_BALANCE_ACCRUAL
    accrual_start = _accrual_start(as_of_date, date_of_joining, previous_ticket)
    return AllocationEntitlementResult(
        scenario=scenario,
        accrual_start=accrual_start,
        accrued_days=accrued_days,
        daily_rate=per_day,
        airfare_rate=max_payout,
        rate_source=rate_source,
        rate_days=cycle_days,
        calculated_entitlement_amount=policy,
        current_year_amount=current_year_amount,
        total_entitlement_days=remaining_days,
        opening_balance_days=opening_balance_days,
        opening_balance_amount=opening_amount_used,
        final_entitlement_amount=final,
        max_entitlement_cap_rate=max_entitlement_cap_rate,
        last_ticket_date=previous_ticket,
        already_paid_days=already_paid_days,
        already_paid_amount=already_paid_amount,
        current_year_remaining=current_year_remaining,
        total_available_funds=total_available_funds,
    )


def resolve_airfare_rate_hierarchy(
    employee_custom_rate: Decimal | None,
    pay_group_rate: Decimal | None,
    global_company_preference_rate: Decimal | None,
    company_rate: Decimal | None = None,
) -> tuple[Decimal, RateSource]:
    """Resolve Employee -> Pay Group -> Company -> Global company preference.

    Args:
        employee_custom_rate: Employee Master custom rate, or None.
        pay_group_rate: Pay-group rate, or None.
        global_company_preference_rate: Global company preference rate, or None.
        company_rate: Company-level dated policy amount, or None.

    Returns:
        The first non-null rate and its source.

    Raises:
        ValidationError: If no rate is configured at any level.
    """
    if employee_custom_rate is not None:
        return employee_custom_rate, RateSource.EMPLOYEE
    if pay_group_rate is not None:
        return pay_group_rate, RateSource.PAY_GROUP
    if company_rate is not None:
        return company_rate, RateSource.COMPANY
    if global_company_preference_rate is not None:
        return global_company_preference_rate, RateSource.GLOBAL
    raise ValidationError("rate_not_found", "No effective airfare rate is configured.")


def resolve_entitlement_cap(
    employee_cap: Decimal | None,
    pay_group_cap: Decimal | None,
    global_cap: Decimal | None,
    company_cap: Decimal | None = None,
) -> Decimal | None:
    """Resolve Max_Entitlement_Cap_Rate using the same hierarchy as rates.

    Args:
        employee_cap: Employee-level cap.
        pay_group_cap: Pay-group cap.
        global_cap: Global company preference cap.
        company_cap: Company-level cap.

    Returns:
        The first non-null cap, or None when uncapped.
    """
    if employee_cap is not None:
        return employee_cap
    if pay_group_cap is not None:
        return pay_group_cap
    if company_cap is not None:
        return company_cap
    return global_cap


def settle_excess_ticket(
    requested_ticket_amount: Decimal,
    final_entitlement_amount: Decimal,
    option: ExcessSettlementOption,
    tenure_months: int | None = None,
) -> ExcessSettlementResult:
    """Settle Requested_Ticket_Amount minus Final_Entitlement_Amount.

    Args:
        requested_ticket_amount: Ticket price requested for issue.
        final_entitlement_amount: Capped entitlement.
        option: LOAN, COMPANY_PAID, SELF_PAID, or ENTITLEMENT_AMOUNT.
        tenure_months: Required when option is LOAN.

    Returns:
        Excess cost and payout / loan posting values.

    Raises:
        ValidationError: If amounts are negative or loan tenure is missing.
    """
    if requested_ticket_amount < 0 or final_entitlement_amount < 0:
        raise ValidationError(
            "negative_value", "Ticket and entitlement amounts cannot be negative."
        )
    excess = max(Decimal("0"), requested_ticket_amount - final_entitlement_amount)
    if excess == 0:
        payout = min(requested_ticket_amount, final_entitlement_amount)
        return ExcessSettlementResult(
            requested_ticket_amount=requested_ticket_amount,
            final_entitlement_amount=final_entitlement_amount,
            excess_cost=Decimal("0"),
            option=option,
            employee_payable=Decimal("0"),
            company_payout=payout,
            loan_principal=None,
            emi=None,
            tenure_months=None,
            loan_status=None,
        )
    if option is ExcessSettlementOption.LOAN:
        if tenure_months is None or tenure_months <= 0:
            raise ValidationError(
                "invalid_loan_terms", "LOAN settlement requires a positive tenure in months."
            )
        emi = fn_atlas_loan_emi(excess, tenure_months)
        return ExcessSettlementResult(
            requested_ticket_amount=requested_ticket_amount,
            final_entitlement_amount=final_entitlement_amount,
            excess_cost=excess,
            option=option,
            employee_payable=excess,
            company_payout=final_entitlement_amount,
            loan_principal=excess,
            emi=emi,
            tenure_months=tenure_months,
            loan_status="Active",
        )
    if option is ExcessSettlementOption.COMPANY_PAID:
        return ExcessSettlementResult(
            requested_ticket_amount=requested_ticket_amount,
            final_entitlement_amount=final_entitlement_amount,
            excess_cost=excess,
            option=option,
            employee_payable=Decimal("0"),
            company_payout=requested_ticket_amount,
            loan_principal=None,
            emi=None,
            tenure_months=None,
            loan_status=None,
        )
    if option is ExcessSettlementOption.ENTITLEMENT_AMOUNT:
        # Cap issue to entitlement: company pays entitlement only; excess is not recovered.
        return ExcessSettlementResult(
            requested_ticket_amount=requested_ticket_amount,
            final_entitlement_amount=final_entitlement_amount,
            excess_cost=excess,
            option=option,
            employee_payable=Decimal("0"),
            company_payout=final_entitlement_amount,
            loan_principal=None,
            emi=None,
            tenure_months=None,
            loan_status=None,
        )
    return ExcessSettlementResult(
        requested_ticket_amount=requested_ticket_amount,
        final_entitlement_amount=final_entitlement_amount,
        excess_cost=excess,
        option=option,
        employee_payable=excess,
        company_payout=final_entitlement_amount,
        loan_principal=None,
        emi=None,
        tenure_months=None,
        loan_status=None,
    )


def resolve_preferences(layers: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Deep-merge preference layers from least to most specific.

    Lists and primitive values replace inherited values. A mapping merges recursively.
    `None` means unspecified and therefore does not erase the inherited value.

    Args:
        layers: Ordered default, company, branch, department, and user layers.

    Returns:
        Effective preference dictionary.
    """
    result: dict[str, Any] = {}
    for layer in layers:
        for key, value in layer.items():
            if value is None:
                continue
            if isinstance(value, Mapping) and isinstance(result.get(key), dict):
                result[key] = resolve_preferences((result[key], value))
            elif isinstance(value, Mapping):
                result[key] = resolve_preferences((value,))
            else:
                result[key] = value
    return result

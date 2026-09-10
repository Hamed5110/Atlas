"""Pure domain calculations for entitlement, preferences, and loans."""

from calendar import isleap, monthrange
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import (
    ROUND_DOWN,
    ROUND_HALF_EVEN,
    ROUND_HALF_UP,
    ROUND_UP,
    Decimal,
    InvalidOperation,
)
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
    """User-selected excess ticket settlement route.

    ``LOAN`` and ``CONVERT_TO_LOAN`` are accepted interchangeably — the UI and
    ticket register use ``CONVERT_TO_LOAN``; the desktop client historically
    sent ``LOAN``.
    """

    LOAN = "LOAN"
    CONVERT_TO_LOAN = "CONVERT_TO_LOAN"
    COMPANY_PAID = "COMPANY_PAID"
    SELF_PAID = "SELF_PAID"
    ENTITLEMENT_AMOUNT = "ENTITLEMENT_AMOUNT"


def is_loan_settlement(option: ExcessSettlementOption) -> bool:
    """Return True when excess is recovered via installment loan."""
    return option in {
        ExcessSettlementOption.LOAN,
        ExcessSettlementOption.CONVERT_TO_LOAN,
    }


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
    loan_offset: Decimal = Decimal("0")
    outstanding_loan: Decimal = Decimal("0")
    vesting_factor: Decimal = Decimal("1")
    carry_forward_forfeited: Decimal = Decimal("0")
    policy_notes: tuple[str, ...] = ()


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


def policy_round(value: Decimal, digits: int, rule: str = "nearest") -> Decimal:
    """Round according to the configured rounding preference."""
    quant = Decimal(10) ** -digits
    if rule == "up":
        return value.quantize(quant, rounding=ROUND_UP)
    if rule == "down":
        return value.quantize(quant, rounding=ROUND_DOWN)
    return value.quantize(quant, rounding=ROUND_HALF_UP)


@dataclass(frozen=True, slots=True)
class PolicySettings:
    """Global preference rule engine for airfare entitlement behavior.

    Defaults deliberately reproduce the legacy ATLAS calculation so existing
    datasets behave identically until an administrator changes a preference.
    """

    accrual_frequency: str = "daily"  # daily | monthly | immediate
    accrual_cap_multiplier: Decimal | None = None  # e.g. Decimal("2") = 2x rate
    negative_balance_allowed: bool = True
    advance_booking_allowed: bool = True
    partial_claim_allowed: bool = True
    vesting_type: str = "pro_rata"  # pro_rata | cliff | graded
    vesting_cliff_days: int | None = None  # default: rate_days
    graded_vesting_steps: tuple[tuple[int, Decimal], ...] = ()  # (days, percent)
    probation_days: int = 0
    carry_forward_limit_type: str = "unlimited"  # unlimited | fixed | percentage
    carry_forward_limit: Decimal = Decimal("0")
    carry_forward_expiry_months: int | None = None
    carry_forward_grace_days: int = 0
    dependent_coverage: str = "self"  # self | self_plus_one | family
    cycle_reset_basis: str = "calendar"  # calendar (ATLAS airfare year) | joining_date | promotion_date
    rate_change_handling: str = "prorate"  # prorate | restart | ignore
    rounding_rule: str = "nearest"  # nearest | up | down
    loan_recovery_method: str = "manual"  # auto_deduct | manual | salary
    loan_recovery_priority: str = "before_accrual"  # before_accrual | after_accrual
    loan_interest_rate: Decimal = Decimal("0")  # annual percent
    transaction_lock_days: int = 0  # 0 = no lock
    recredit_on_cancel: bool = True
    currency_conversion: str = "static"  # static | daily
    static_conversion_rate: Decimal = Decimal("1")


def _pref_bool(raw: Any, default: bool) -> bool:
    """Coerce a stored preference value to bool."""
    if raw is None:
        return default
    if isinstance(raw, bool):
        return raw
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _pref_decimal(raw: Any, default: Decimal) -> Decimal:
    """Coerce a stored preference value to Decimal."""
    if raw is None or raw == "":
        return default
    try:
        return Decimal(str(raw))
    except (InvalidOperation, ValueError):
        return default


def _pref_int(raw: Any, default: int) -> int:
    """Coerce a stored preference value to int."""
    if raw is None or raw == "":
        return default
    try:
        return int(float(str(raw)))
    except (TypeError, ValueError):
        return default


def policy_from_preferences(preferences: Mapping[str, Any]) -> PolicySettings:
    """Build a typed PolicySettings from the resolved preference dictionary."""
    def text(key: str, default: str) -> str:
        raw = preferences.get(key)
        value = str(raw).strip().lower() if raw is not None and str(raw).strip() else default
        return value

    steps: list[tuple[int, Decimal]] = []
    raw_steps = preferences.get("graded_vesting_steps")
    if isinstance(raw_steps, str) and raw_steps.strip():
        for part in raw_steps.split(","):
            if ":" not in part:
                continue
            days_raw, pct_raw = part.split(":", 1)
            try:
                steps.append((int(days_raw.strip()), Decimal(pct_raw.strip())))
            except (InvalidOperation, ValueError):
                continue
    elif isinstance(raw_steps, Sequence) and not isinstance(raw_steps, str):
        for entry in raw_steps:
            if isinstance(entry, Mapping):
                days_raw = entry.get("days", 0)
                pct_raw = entry.get("percent", 0)
                try:
                    steps.append((int(days_raw), Decimal(str(pct_raw))))
                except (InvalidOperation, ValueError, TypeError):
                    continue
    steps.sort(key=lambda item: item[0])

    cap_raw = preferences.get("accrual_cap_multiplier")
    cap_multiplier = None
    if cap_raw not in (None, "", "0", 0):
        cap_multiplier = _pref_decimal(cap_raw, Decimal("1"))
        if cap_multiplier <= 0:
            cap_multiplier = None

    expiry_raw = preferences.get("carry_forward_expiry_months")
    expiry_months = None if expiry_raw in (None, "", 0, "0") else _pref_int(expiry_raw, 0)
    if expiry_months is not None and expiry_months <= 0:
        expiry_months = None

    cliff_raw = preferences.get("vesting_cliff_days")
    cliff_days = None if cliff_raw in (None, "") else _pref_int(cliff_raw, 0)

    return PolicySettings(
        accrual_frequency=text("accrual_frequency", "daily"),
        accrual_cap_multiplier=cap_multiplier,
        negative_balance_allowed=_pref_bool(preferences.get("negative_balance_allowed"), True),
        advance_booking_allowed=_pref_bool(preferences.get("advance_booking_allowed"), True),
        partial_claim_allowed=_pref_bool(preferences.get("partial_claim_allowed"), True),
        vesting_type=text("vesting_type", "pro_rata"),
        vesting_cliff_days=cliff_days,
        graded_vesting_steps=tuple(steps),
        probation_days=_pref_int(preferences.get("probation_days"), 0),
        carry_forward_limit_type=text("carry_forward_limit_type", "unlimited"),
        carry_forward_limit=_pref_decimal(
            preferences.get("carry_forward_limit"), Decimal("0")
        ),
        carry_forward_expiry_months=expiry_months,
        carry_forward_grace_days=_pref_int(preferences.get("carry_forward_grace_days"), 0),
        dependent_coverage=text("dependent_coverage", "self"),
        cycle_reset_basis=text("cycle_reset_basis", "calendar"),
        rate_change_handling=text("rate_change_handling", "prorate"),
        rounding_rule=text("rounding_rule", "nearest"),
        loan_recovery_method=text("loan_recovery_method", "manual"),
        loan_recovery_priority=text("loan_recovery_priority", "before_accrual"),
        loan_interest_rate=_pref_decimal(preferences.get("loan_interest_rate"), Decimal("0")),
        transaction_lock_days=_pref_int(preferences.get("transaction_lock_days"), 0),
        recredit_on_cancel=_pref_bool(preferences.get("recredit_on_cancel"), True),
        currency_conversion=text("currency_conversion", "static"),
        static_conversion_rate=_pref_decimal(
            preferences.get("static_conversion_rate"), Decimal("1")
        ),
    )


_ROUNDING_MODES = {
    "nearest": ROUND_HALF_UP,
    "up": ROUND_UP,
    "down": ROUND_DOWN,
}


@dataclass(frozen=True, slots=True)
class AllocationPolicy:
    """Global rule-engine switches applied around the ATLAS calculation.

    Every default reproduces the proven ATLAS behavior exactly; admins opt into
    enterprise rules from the Settings console.
    """

    accrual_frequency: str = "daily"  # daily | monthly | immediate
    accrual_cap_multiple: Decimal = Decimal("0")  # 0 = uncapped
    vesting_type: str = "prorata"  # prorata | cliff | graded
    vesting_cliff_days: int = 360
    probation_days: int = 0
    carry_forward_limit_type: str = "unlimited"  # unlimited | fixed | percent
    carry_forward_limit_value: Decimal = Decimal("0")
    cycle_reset_basis: str = "calendar"  # calendar (ATLAS airfare year) | joining_date
    rate_change_handling: str = "prorate"  # prorate | restart | ignore
    rounding_rule: str = "nearest"  # nearest | up | down

    def round_money(self, value: Decimal, digits: int = 2) -> Decimal:
        """Round money according to the configured rounding rule."""
        quant = Decimal(10) ** -digits
        return value.quantize(quant, rounding=_ROUNDING_MODES.get(self.rounding_rule, ROUND_HALF_UP))


def _working_days_window(start: date, end: date) -> int:
    """30/360 day count between two dates that may span a year boundary."""
    if start > end:
        return 0
    start_serial = (start.year * 360) + (start.month - 1) * 30 + start.day
    end_serial = (end.year * 360) + (end.month - 1) * 30 + end.day
    return min(360, max(0, end_serial - start_serial + 1))


def _anniversary_window(effective_join: date, as_of: date) -> date:
    """Latest joining-anniversary cycle start on or before the as-of date."""
    try:
        candidate = date(as_of.year, effective_join.month, effective_join.day)
    except ValueError:  # 29 Feb join on a non-leap year
        candidate = date(as_of.year, effective_join.month, effective_join.day - 1)
    if candidate > as_of:
        try:
            candidate = date(as_of.year - 1, effective_join.month, effective_join.day)
        except ValueError:
            candidate = date(as_of.year - 1, effective_join.month, effective_join.day - 1)
    return candidate


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
    policy: AllocationPolicy | None = None,
    rate_effective_from: date | None = None,
    ytd_paid_days: Decimal | None = None,
    ytd_spending: Decimal | None = None,
) -> AllocationEntitlementResult:
    """Port of dbo.sp_ATLAS_CalcPolicyEntitlement (30/360 + cycle 60).

    When ``policy`` is supplied, the global rule engine (accrual frequency,
    vesting, carry-forward, cycle basis, rate-change handling, caps, rounding)
    is applied around the proven ATLAS math.

    After a same-year previous ticket, opening is treated as settled. Entitlement
    uses post-ticket accrual/spend so Current-year remaining and Total available
    funds follow accrued days (not stuck at 0 after the annual pot was used).
    """
    if min(opening_balance_days, opening_balance_amount, paid_days, current_year_spending) < 0:
        raise ValidationError("negative_value", "Opening balance values cannot be negative.")
    if airfare_rate < 0:
        raise ValidationError("negative_rate", "Airfare rate cannot be negative.")
    if max_entitlement_cap_rate is not None and max_entitlement_cap_rate < 0:
        raise ValidationError("negative_cap", "Entitlement cap cannot be negative.")
    rules = policy or AllocationPolicy()
    notes: list[str] = []
    round2 = rules.round_money
    max_payout = DEFAULT_AIRFARE_POLICY_AMOUNT if airfare_rate <= 0 else airfare_rate
    # dbo.sp_ATLAS_CalcPolicyEntitlement hard-codes MaxPayout / 60.0.
    cycle_days = AIRFARE_CYCLE_DAYS
    _ = rate_days

    # Probation shifts the first-year eligibility start.
    effective_join = date_of_joining
    if rules.probation_days > 0:
        effective_join = date.fromordinal(date_of_joining.toordinal() + rules.probation_days)
        notes.append(f"Probation: accrual starts {rules.probation_days} days after joining")

    previous_ticket = last_ticket_date
    if rules.cycle_reset_basis == "joining_date":
        cycle_start = _anniversary_window(effective_join, as_of_date)
        if previous_ticket is not None and previous_ticket < cycle_start:
            previous_ticket = None
        notes.append("Rolling cycle anchored on joining anniversary")
    else:
        cycle_start = date(as_of_date.year, 1, 1)
        if previous_ticket is not None and previous_ticket.year != as_of_date.year:
            previous_ticket = None

    if rules.rate_change_handling == "restart" and rate_effective_from is not None:
        if rate_effective_from > cycle_start:
            cycle_start = rate_effective_from
            previous_ticket = None
            opening_balance_days = Decimal("0")
            opening_balance_amount = Decimal("0")
            notes.append("Cycle restarted at mid-cycle rate change")

    cap_rate = max_payout if max_entitlement_cap_rate is None else max_entitlement_cap_rate
    per_day = max_payout / cycle_days

    if rules.cycle_reset_basis == "joining_date":
        start = max(cycle_start, effective_join)
        if previous_ticket is not None:
            start = max(start, date.fromordinal(previous_ticket.toordinal() + 1))
        working_days = _working_days_window(start, as_of_date)
    else:
        working_days = allocation_working_days(
            as_of_date, as_of_date.year, effective_join, previous_ticket
        )

    if rules.accrual_frequency == "immediate":
        accrued_days = cycle_days
        notes.append("Immediate accrual: full cycle granted up front")
    elif rules.accrual_frequency == "monthly":
        completed_months = working_days // 30
        accrued_days = atlas_round(Decimal(completed_months) * AIRFARE_DAYS_PER_MONTH, 4)
    else:
        accrued_days = atlas_round(
            (Decimal(working_days) / WORKING_DAYS_PER_AIRFARE_DAY) * AIRFARE_DAYS_PER_MONTH, 4
        )

    if rules.vesting_type != "prorata":
        service_days = max(0, (as_of_date - effective_join).days + 1)
        if rules.vesting_type == "cliff" and service_days < rules.vesting_cliff_days:
            accrued_days = Decimal("0")
            notes.append(
                f"Cliff vesting: 0 accrual until {rules.vesting_cliff_days} service days"
            )
        elif rules.vesting_type == "graded":
            if service_days < rules.vesting_cliff_days:
                accrued_days = Decimal("0")
                notes.append(
                    f"Graded vesting: 0% until {rules.vesting_cliff_days} service days"
                )
            elif service_days < rules.vesting_cliff_days * 2:
                accrued_days = atlas_round(accrued_days * Decimal("0.5"), 4)
                notes.append("Graded vesting: 50% tier")

    opening_amount_used = opening_balance_amount
    if opening_amount_used == 0 and opening_balance_days > 0:
        opening_amount_used = fn_atlas_airfare_amount(opening_balance_days, max_payout)
    if rules.carry_forward_limit_type != "unlimited" and opening_amount_used > 0:
        if rules.carry_forward_limit_type == "fixed":
            limited = min(opening_amount_used, rules.carry_forward_limit_value)
        else:
            limited = round2(opening_amount_used * rules.carry_forward_limit_value / 100)
        if limited < opening_amount_used:
            forfeited = round2(opening_amount_used - limited)
            notes.append(f"Carry-forward capped at {limited} (forfeited {forfeited})")
            opening_amount_used = limited

    display_opening_days = opening_balance_days
    display_opening_amount = opening_amount_used
    paid_days_for_calc = paid_days
    opening_for_total = opening_amount_used
    if previous_ticket is not None:
        # Prior ticket settled the opening / pre-ticket pot. New claimable funds are
        # only what accrued after that ticket (caller passes post-ticket spending).
        opening_for_total = Decimal("0.00")
        paid_days_for_calc = Decimal("0")
        notes.append("Post-ticket window: opening excluded from entitlement total")

    current_year_amount = round2(per_day * accrued_days)
    total = round2(opening_for_total + current_year_amount)
    if rules.accrual_cap_multiple > 0:
        liability_cap = round2(max_payout * rules.accrual_cap_multiple)
        if total > liability_cap:
            total = liability_cap
            notes.append(f"Accrual cap applied at {rules.accrual_cap_multiple}x rate")
    if total > max_payout and rules.accrual_cap_multiple <= 0:
        total = round2(max_payout)
    paid_amount = round2(paid_days_for_calc * per_day) + round2(current_year_spending)
    entitlement_amount = round2(total - paid_amount)
    if entitlement_amount < 0:
        entitlement_amount = Decimal("0.00")
    remaining_days = (
        atlas_round(entitlement_amount / per_day, 4) if per_day > 0 else Decimal("0")
    )
    remaining_days = min(cycle_days, max(Decimal("0"), remaining_days))
    final = round2(min(entitlement_amount, cap_rate))

    display_paid_days = paid_days if ytd_paid_days is None else ytd_paid_days
    display_spending = current_year_spending if ytd_spending is None else ytd_spending
    already_paid_amount = round2(display_paid_days * per_day) + round2(display_spending)
    already_paid_days = (
        atlas_round(already_paid_amount / per_day, 4) if per_day > 0 else Decimal("0")
    )
    if previous_ticket is not None:
        # Money that matches Accrued Days in the post-ticket window.
        current_year_remaining = round2(current_year_amount - round2(current_year_spending))
        if current_year_remaining < 0:
            current_year_remaining = Decimal("0.00")
        total_available_funds = current_year_remaining
    else:
        current_year_remaining = round2(max_payout - round2(display_spending))
        if current_year_remaining < 0:
            current_year_remaining = Decimal("0.00")
        # Use derived opening BHD (days→amount), not raw zero opening rows.
        total_available_funds = round2(display_opening_amount + current_year_remaining)
    if previous_ticket is not None:
        scenario = AllocationScenario.PREVIOUS_TICKET
    elif date_of_joining.year == as_of_date.year:
        scenario = AllocationScenario.NEW_JOINEE
    else:
        scenario = AllocationScenario.OPENING_BALANCE_ACCRUAL
    accrual_start = max(cycle_start, effective_join)
    if previous_ticket is not None:
        accrual_start = max(
            accrual_start, date.fromordinal(previous_ticket.toordinal() + 1)
        )
    return AllocationEntitlementResult(
        scenario=scenario,
        accrual_start=accrual_start,
        accrued_days=accrued_days,
        daily_rate=per_day,
        airfare_rate=max_payout,
        rate_source=rate_source,
        rate_days=cycle_days,
        calculated_entitlement_amount=entitlement_amount,
        current_year_amount=current_year_amount,
        total_entitlement_days=remaining_days,
        opening_balance_days=display_opening_days,
        opening_balance_amount=display_opening_amount,
        final_entitlement_amount=final,
        max_entitlement_cap_rate=max_entitlement_cap_rate,
        last_ticket_date=previous_ticket,
        already_paid_days=already_paid_days,
        already_paid_amount=already_paid_amount,
        current_year_remaining=current_year_remaining,
        total_available_funds=total_available_funds,
        policy_notes=tuple(notes),
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
    if is_loan_settlement(option):
        if tenure_months is None or tenure_months <= 0:
            raise ValidationError(
                "invalid_loan_terms", "LOAN settlement requires a positive tenure in months."
            )
        emi = fn_atlas_loan_emi(excess, tenure_months)
        return ExcessSettlementResult(
            requested_ticket_amount=requested_ticket_amount,
            final_entitlement_amount=final_entitlement_amount,
            excess_cost=excess,
            option=ExcessSettlementOption.CONVERT_TO_LOAN,
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
        if final_entitlement_amount <= 0:
            raise ValidationError(
                "entitlement_amount_unavailable",
                "Entitlement amount settlement requires a positive entitlement balance. "
                "Choose Self paid, Fully company paid, or Make loan.",
            )
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

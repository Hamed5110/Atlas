"""Pure domain calculations for entitlement, preferences, and loans."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from airfare_management.domain.models import ValidationError

MONEY = Decimal("0.01")
DAYS = Decimal("0.0001")


def quantize_money(value: Decimal) -> Decimal:
    """Round a monetary value using commercial half-up semantics.

    Args:
        value: Decimal amount.

    Returns:
        Amount rounded to two decimal places.
    """
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


@dataclass(frozen=True, slots=True)
class EntitlementResult:
    """Calculated leave-travel entitlement."""

    current_days: Decimal
    remaining_days: Decimal
    payable: Decimal


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
    start_serial = (start.month - 1) * 30 + min(start.day, 30)
    end_serial = (target_date.month - 1) * 30 + min(target_date.day, 30)
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
    payable = min(maximum_payout, quantize_money(maximum_payout / cycle_days * remaining))
    return EntitlementResult(current, remaining, payable)


def calculate_emi(principal: Decimal, annual_rate: Decimal, installments: int) -> Decimal:
    """Calculate a reducing-balance monthly installment.

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

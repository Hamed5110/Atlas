"""Thin wrapper around airfare.sp_HCM_CalculateEntitlement with Python fallback."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Mapping
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session

from airfare_management.domain.services import (
    AIRFARE_CYCLE_DAYS,
    AllocationEntitlementResult,
    AllocationScenario,
    RateSource,
    calculate_allocation_entitlement,
)


def _as_decimal(value: Any) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _as_optional_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    return _as_decimal(value)


def _as_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def row_to_entitlement(row: Mapping[str, Any]) -> AllocationEntitlementResult:
    """Map an SP result row onto AllocationEntitlementResult."""
    return AllocationEntitlementResult(
        scenario=AllocationScenario(str(row["scenario"])),
        accrual_start=_as_date(row["accrual_start"]) or date.min,
        accrued_days=_as_decimal(row["accrued_days"]),
        daily_rate=_as_decimal(row["daily_rate"]),
        airfare_rate=_as_decimal(row["airfare_rate"]),
        rate_source=RateSource(str(row["rate_source"])),
        rate_days=_as_decimal(row.get("rate_days", AIRFARE_CYCLE_DAYS)),
        calculated_entitlement_amount=_as_decimal(row["calculated_entitlement_amount"]),
        current_year_amount=_as_decimal(row["current_year_amount"]),
        total_entitlement_days=_as_decimal(row["total_entitlement_days"]),
        opening_balance_days=_as_decimal(row["opening_balance_days"]),
        opening_balance_amount=_as_decimal(row["opening_balance_amount"]),
        final_entitlement_amount=_as_decimal(row["final_entitlement_amount"]),
        max_entitlement_cap_rate=_as_optional_decimal(row.get("max_entitlement_cap_rate")),
        last_ticket_date=_as_date(row.get("last_ticket_date")),
        already_paid_days=_as_decimal(row.get("already_paid_days", 0)),
        already_paid_amount=_as_decimal(row.get("already_paid_amount", 0)),
        current_year_remaining=_as_decimal(row.get("current_year_remaining", 0)),
        total_available_funds=_as_decimal(row.get("total_available_funds", 0)),
    )


def _is_mssql(bind: Engine | Connection | Session) -> bool:
    if isinstance(bind, Session):
        engine = bind.get_bind()
        return bool(engine is not None and engine.dialect.name == "mssql")
    return bind.dialect.name == "mssql"


def calculate_entitlement(
    *,
    as_of_date: date,
    date_of_joining: date,
    last_ticket_date: date | None,
    opening_balance_days: Decimal,
    opening_balance_amount: Decimal,
    airfare_rate: Decimal,
    rate_source: RateSource,
    max_entitlement_cap_rate: Decimal | None,
    paid_days: Decimal = Decimal("0"),
    current_year_spending: Decimal = Decimal("0"),
    session: Session | None = None,
    prefer_mssql: bool = True,
) -> AllocationEntitlementResult:
    """Call MSSQL SP when available; otherwise use the Python domain engine."""
    if prefer_mssql and session is not None and _is_mssql(session):
        try:
            return _call_sp_calculate_entitlement(
                session,
                as_of_date=as_of_date,
                date_of_joining=date_of_joining,
                last_ticket_date=last_ticket_date,
                opening_balance_days=opening_balance_days,
                opening_balance_amount=opening_balance_amount,
                airfare_rate=airfare_rate,
                rate_source=rate_source,
                max_entitlement_cap_rate=max_entitlement_cap_rate,
                paid_days=paid_days,
                current_year_spending=current_year_spending,
            )
        except Exception:
            # Soft fallback keeps SQLite / partial MSSQL environments working.
            pass
    return calculate_allocation_entitlement(
        as_of_date=as_of_date,
        date_of_joining=date_of_joining,
        last_ticket_date=last_ticket_date,
        opening_balance_days=opening_balance_days,
        opening_balance_amount=opening_balance_amount,
        airfare_rate=airfare_rate,
        rate_source=rate_source,
        max_entitlement_cap_rate=max_entitlement_cap_rate,
        rate_days=AIRFARE_CYCLE_DAYS,
        paid_days=paid_days,
        current_year_spending=current_year_spending,
    )


def calculate_entitlement_for_employee(
    session: Session,
    employee_id: UUID,
    *,
    as_of_date: date | None = None,
    prefer_mssql: bool = True,
) -> AllocationEntitlementResult | None:
    """Prefer airfare.sp_HCM_CalculateEntitlementForEmployee on MSSQL."""
    if prefer_mssql and _is_mssql(session):
        try:
            result = session.execute(
                text(
                    "EXEC airfare.sp_HCM_CalculateEntitlementForEmployee "
                    "@EmployeeId = :employee_id, @AsOfDate = :as_of_date"
                ),
                {
                    "employee_id": str(employee_id),
                    "as_of_date": as_of_date,
                },
            )
            row = result.mappings().first()
            if row is not None:
                return row_to_entitlement(row)
        except Exception:
            return None
    return None


def _call_sp_calculate_entitlement(
    session: Session,
    *,
    as_of_date: date,
    date_of_joining: date,
    last_ticket_date: date | None,
    opening_balance_days: Decimal,
    opening_balance_amount: Decimal,
    airfare_rate: Decimal,
    rate_source: RateSource,
    max_entitlement_cap_rate: Decimal | None,
    paid_days: Decimal,
    current_year_spending: Decimal,
) -> AllocationEntitlementResult:
    result = session.execute(
        text(
            """
            EXEC airfare.sp_HCM_CalculateEntitlement
                @AsOfDate = :as_of_date,
                @DateOfJoining = :date_of_joining,
                @LastTicketDate = :last_ticket_date,
                @OpeningBalanceDays = :opening_balance_days,
                @OpeningBalanceAmount = :opening_balance_amount,
                @AirfareRate = :airfare_rate,
                @RateSource = :rate_source,
                @MaxEntitlementCapRate = :max_entitlement_cap_rate,
                @PaidDays = :paid_days,
                @CurrentYearSpending = :current_year_spending
            """
        ),
        {
            "as_of_date": as_of_date,
            "date_of_joining": date_of_joining,
            "last_ticket_date": last_ticket_date,
            "opening_balance_days": opening_balance_days,
            "opening_balance_amount": opening_balance_amount,
            "airfare_rate": airfare_rate,
            "rate_source": rate_source.value,
            "max_entitlement_cap_rate": max_entitlement_cap_rate,
            "paid_days": paid_days,
            "current_year_spending": current_year_spending,
        },
    )
    row = result.mappings().first()
    if row is None:
        raise RuntimeError("sp_HCM_CalculateEntitlement returned no rows")
    return row_to_entitlement(row)

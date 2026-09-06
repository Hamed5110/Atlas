"""Airfare Payable Statement — ATLAS 3355 / sp_ATLAS_GetAirfareReport parity.

Builds a per-employee entitlement balance sheet for a fiscal year as-of a cut-off
date, using the same allocation entitlement engine as voucher preview.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from airfare_management.application.contracts import AllocationQueryHandler, PreviewAllocation
from airfare_management.domain.models import ValidationError
from airfare_management.domain.services import _anniversary_window
from airfare_management.infrastructure.database import EmployeeRow
from airfare_management.infrastructure.policy import load_policy, to_allocation_policy
from airfare_management.infrastructure.schema import (
    CompanyRow,
    EntitlementRateRow,
    OpeningBalanceRow,
    PreferenceRow,
    TicketRow,
)

PayableVariant = Literal["full", "summary", "exceptions"]

FULL_COLUMNS = (
    "Employee Code",
    "Employee Name",
    "Department",
    "Designation",
    "Year",
    "As of",
    "Annual Days",
    "Annual Amount",
    "Per Day Rate",
    "Max Cap",
    "Opening Days",
    "Opening Amount",
    "Current Earned Days",
    "Current Earned Amount",
    "Ticket Amount",
    "Company Paid",
    "Employee Paid",
    "Loan Amount",
    "Paid Days",
    "Balance Days",
    "Airfare Entitlement Amount",
    "Payable Amount",
    "Current Year Remaining",
    "Status",
)

SUMMARY_COLUMNS = (
    "Employee Code",
    "Employee Name",
    "Department",
    "Entitlement",
    "Payable Amount",
    "Status",
)


@dataclass(frozen=True, slots=True)
class AirfarePayableFilters:
    """Dimensions for the payable control sheet."""

    year: int | None = None
    as_of_date: date | None = None
    company_id: str | None = None
    department: str | None = None
    variant: PayableVariant = "full"


def _as_decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    return Decimal(str(value))


def _clamp_as_of(work: date, year: int) -> date:
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)
    if work < year_start:
        return year_start
    if work > year_end:
        return year_end
    return work


def _effective_rate_row(
    session: Session, scope_type: str, scope_id: str, as_of: date
) -> EntitlementRateRow | None:
    rows = session.scalars(
        select(EntitlementRateRow)
        .where(
            EntitlementRateRow.deleted_at.is_(None),
            EntitlementRateRow.scope_type == scope_type,
            EntitlementRateRow.scope_id == scope_id,
            EntitlementRateRow.effective_from <= as_of,
        )
        .order_by(EntitlementRateRow.effective_from.desc())
    )
    for row in rows:
        if row.effective_to is None or row.effective_to >= as_of:
            return row
    return None


def _global_preference_decimal(session: Session, key: str) -> Decimal | None:
    item = session.scalar(
        select(PreferenceRow).where(
            PreferenceRow.scope_type == "global",
            PreferenceRow.scope_id == "",
            PreferenceRow.preference_key == key,
            PreferenceRow.deleted_at.is_(None),
        )
    )
    return _as_decimal(None if item is None else item.value)


def _money(value: Decimal | None) -> Decimal:
    if value is None:
        return Decimal("0.00")
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _verification_note(
    *,
    join_date: date | None,
    as_of: date,
    ticket_count: int,
    entitlement: Decimal,
    payable: Decimal,
    capped: bool,
) -> str:
    if join_date is not None and join_date > as_of:
        return "Not joined as of report date"
    if ticket_count > 0 and entitlement <= 0:
        return "Ticket processed - no entitlement remaining"
    if ticket_count > 0 and capped:
        return "Ticket processed - capped at max payout"
    if ticket_count > 0:
        return "Ticket processed - entitlement adjusted"
    if capped:
        return "Eligible - capped at max payout"
    if payable <= 0 and entitlement <= 0:
        return "No payable balance"
    return "Eligible for review"


def collect_airfare_payable(
    session: Session, filters: AirfarePayableFilters | None = None
) -> tuple[list[str], list[tuple[Any, ...]]]:
    """Return headers and rows for Airfare Payable (full / summary / exceptions)."""
    filters = filters or AirfarePayableFilters()
    today = date.today()
    as_of_raw = filters.as_of_date or today
    year = filters.year or as_of_raw.year
    as_of = _clamp_as_of(as_of_raw, year)
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)
    variant = filters.variant

    employee_query = select(EmployeeRow).where(
        EmployeeRow.deleted_at.is_(None),
        EmployeeRow.active == True,  # noqa: E712 — MSSQL rejects `IS 1` from .is_(True)
    )
    if filters.company_id:
        employee_query = employee_query.where(EmployeeRow.company_id == filters.company_id)
    if filters.department:
        employee_query = employee_query.where(
            func.lower(EmployeeRow.department) == filters.department.strip().lower()
        )
    employees = list(session.scalars(employee_query.order_by(EmployeeRow.code)))

    handler = AllocationQueryHandler()
    policy = to_allocation_policy(load_policy(session))
    rows: list[tuple[Any, ...]] = []

    for employee in employees:
        opening_days = Decimal("0")
        opening_amount = Decimal("0")
        paid_days_manual = Decimal("0")
        max_payout_ob: Decimal | None = None
        join = employee.join_date or year_start
        if policy.cycle_reset_basis == "joining_date":
            cycle_start = _anniversary_window(join, as_of)
        else:
            cycle_start = year_start
        cycle_end = as_of
        balance = session.scalar(
            select(OpeningBalanceRow).where(
                OpeningBalanceRow.employee_id == employee.id,
                OpeningBalanceRow.balance_year == cycle_start.year,
                OpeningBalanceRow.deleted_at.is_(None),
            )
        )
        if balance is None and cycle_start.year != year:
            balance = session.scalar(
                select(OpeningBalanceRow).where(
                    OpeningBalanceRow.employee_id == employee.id,
                    OpeningBalanceRow.balance_year == year,
                    OpeningBalanceRow.deleted_at.is_(None),
                )
            )
        if balance is not None:
            opening_days = balance.opening_days or Decimal("0")
            opening_amount = balance.opening_amount or Decimal("0")
            paid_days_manual = balance.paid_days or Decimal("0")
            max_payout_ob = balance.maximum_payout

        ticket_stats = session.execute(
            select(
                func.count(TicketRow.id),
                func.coalesce(func.sum(TicketRow.ticket_cost), 0),
                func.coalesce(func.sum(TicketRow.company_paid), 0),
                func.coalesce(func.sum(TicketRow.employee_payable), 0),
                func.coalesce(func.sum(TicketRow.excess_cost), 0),
            ).where(
                TicketRow.employee_id == employee.id,
                TicketRow.deleted_at.is_(None),
                TicketRow.travel_date >= cycle_start,
                TicketRow.travel_date <= cycle_end,
                TicketRow.status.in_(("approved", "paid")),
            )
        ).one()
        ticket_count = int(ticket_stats[0] or 0)
        ticket_amount = _money(Decimal(str(ticket_stats[1] or 0)))
        company_paid = _money(Decimal(str(ticket_stats[2] or 0)))
        employee_paid = _money(Decimal(str(ticket_stats[3] or 0)))
        loan_amount = _money(Decimal(str(ticket_stats[4] or 0)))

        last_ticket = session.scalar(
            select(func.max(TicketRow.travel_date)).where(
                TicketRow.employee_id == employee.id,
                TicketRow.deleted_at.is_(None),
                TicketRow.status.in_(("approved", "paid")),
                TicketRow.travel_date >= cycle_start,
                TicketRow.travel_date <= cycle_end,
                TicketRow.entitlement > 0,
            )
        )

        # Entitlement engine spending uses company entitlement consumed (ATLAS company paid path).
        ytd_spending = session.scalar(
            select(func.coalesce(func.sum(TicketRow.entitlement), 0)).where(
                TicketRow.employee_id == employee.id,
                TicketRow.deleted_at.is_(None),
                TicketRow.status.in_(("approved", "paid")),
                TicketRow.travel_date >= cycle_start,
                TicketRow.travel_date <= cycle_end,
                TicketRow.excess_handling != "employee_full",
            )
        ) or Decimal("0")
        current_year_spending = ytd_spending
        if last_ticket is not None:
            current_year_spending = session.scalar(
                select(func.coalesce(func.sum(TicketRow.entitlement), 0)).where(
                    TicketRow.employee_id == employee.id,
                    TicketRow.deleted_at.is_(None),
                    TicketRow.status.in_(("approved", "paid")),
                    TicketRow.travel_date > last_ticket,
                    TicketRow.travel_date <= cycle_end,
                    TicketRow.excess_handling != "employee_full",
                )
            ) or Decimal("0")

        custom_rate: Decimal | None = None
        group_rate: Decimal | None = None
        company_rate: Decimal | None = None
        global_rate: Decimal | None = None
        employee_cap: Decimal | None = employee.max_entitlement_cap_rate
        group_cap: Decimal | None = None
        company_cap: Decimal | None = None
        global_cap: Decimal | None = None

        employee_policy = _effective_rate_row(
            session, "employee", str(employee.id), as_of
        ) or _effective_rate_row(session, "employee", employee.code, as_of)
        group_row = (
            _effective_rate_row(session, "pay_group", employee.pay_group, as_of)
            if employee.pay_group
            else None
        )
        company_row = None
        if employee.company_id:
            company_row = _effective_rate_row(
                session, "company", str(employee.company_id), as_of
            )
            company = session.get(CompanyRow, str(employee.company_id))
            if company_row is None and company is not None:
                company_row = _effective_rate_row(session, "company", company.code, as_of)
        global_row = _effective_rate_row(session, "global", "", as_of)

        if employee_policy is not None:
            custom_rate = employee_policy.amount
            if employee_cap is None:
                employee_cap = employee_policy.cap_amount
        else:
            custom_rate = employee.custom_airfare_rate
        if group_row is not None:
            group_rate = group_row.amount
            group_cap = group_row.cap_amount
        if company_row is not None:
            company_rate = company_row.amount
            company_cap = company_row.cap_amount
        if global_row is not None:
            global_rate = global_row.amount
            global_cap = global_row.cap_amount
        if global_rate is None:
            global_rate = _global_preference_decimal(
                session, "airfare_rate"
            ) or _global_preference_decimal(session, "global_company_preference_rate")
        if global_cap is None:
            global_cap = _global_preference_decimal(session, "max_entitlement_cap_rate")
        if employee_cap is None and max_payout_ob is not None:
            employee_cap = max_payout_ob

        try:
            preview = handler.handle(
                PreviewAllocation(
                    as_of_date=as_of,
                    date_of_joining=employee.join_date,
                    last_ticket_date=last_ticket,
                    opening_balance_days=opening_days,
                    opening_balance_amount=opening_amount,
                    employee_custom_rate=custom_rate,
                    pay_group_rate=group_rate,
                    global_company_preference_rate=global_rate,
                    company_rate=company_rate,
                    employee_cap=employee_cap,
                    pay_group_cap=group_cap,
                    company_cap=company_cap,
                    global_cap=global_cap,
                    paid_days=paid_days_manual,
                    current_year_spending=Decimal(str(current_year_spending)),
                    ytd_paid_days=paid_days_manual,
                    ytd_spending=Decimal(str(ytd_spending)),
                    policy=policy,
                )
            )
        except ValidationError:
            continue

        ent = preview.entitlement
        payable = _money(ent.calculated_entitlement_amount)
        entitlement_amt = _money(ent.final_entitlement_amount)
        capped = payable > entitlement_amt and entitlement_amt > 0 or (
            ent.max_entitlement_cap_rate is not None
            and entitlement_amt >= _money(ent.max_entitlement_cap_rate)
            and payable >= entitlement_amt
        )
        # Prefer ATLAS-style: payable uncapped >= capped entitlement
        if payable < entitlement_amt:
            payable = entitlement_amt
        note = _verification_note(
            join_date=employee.join_date,
            as_of=as_of,
            ticket_count=ticket_count,
            entitlement=entitlement_amt,
            payable=payable,
            capped=bool(capped),
        )
        if variant == "exceptions" and note == "Eligible for review":
            continue

        annual_amount = _money(ent.airfare_rate)
        annual_days = _money(ent.rate_days)
        per_day = _money(ent.daily_rate)
        max_cap = _money(ent.max_entitlement_cap_rate or ent.airfare_rate)
        paid_days = _money(ent.already_paid_days)
        balance_days = _money(
            (opening_days + ent.accrued_days) - paid_days
            if (opening_days + ent.accrued_days) >= paid_days
            else Decimal("0")
        )

        if variant == "summary":
            rows.append(
                (
                    employee.code,
                    employee.full_name,
                    employee.department or "",
                    entitlement_amt,
                    payable,
                    note,
                )
            )
            continue

        rows.append(
            (
                employee.code,
                employee.full_name,
                employee.department or "",
                employee.designation or "",
                year,
                as_of.isoformat(),
                annual_days,
                annual_amount,
                per_day,
                max_cap,
                _money(opening_days),
                _money(ent.opening_balance_amount),
                _money(ent.accrued_days),
                _money(ent.current_year_amount),
                ticket_amount,
                company_paid,
                employee_paid,
                loan_amount,
                paid_days,
                balance_days,
                entitlement_amt,
                payable,
                _money(ent.current_year_remaining),
                note,
            )
        )

    if variant == "summary":
        return list(SUMMARY_COLUMNS), rows
    return list(FULL_COLUMNS), rows


def airfare_payable_kpi(session: Session, filters: AirfarePayableFilters | None = None) -> Decimal:
    """Sum of Payable Amount for dashboard tiles."""
    filters = filters or AirfarePayableFilters()
    columns, rows = collect_airfare_payable(session, filters)
    try:
        idx = columns.index("Payable Amount")
    except ValueError:
        return Decimal("0.00")
    total = Decimal("0.00")
    for row in rows:
        total += _money(Decimal(str(row[idx])))
    return total

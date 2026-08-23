"""Operational report row collectors for Excel/PDF export."""

from __future__ import annotations

from collections.abc import Sequence
from decimal import ROUND_CEILING, Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from airfare_management.api.schemas.report import ReportName
from airfare_management.domain.services import LoanInstallment, build_amortization_schedule
from airfare_management.infrastructure.database import EmployeeRow
from airfare_management.infrastructure.repositories import LoanRepository
from airfare_management.infrastructure.schema import (
    EntitlementRateRow,
    LoanInstallmentRow,
    LoanPaymentRow,
    LoanRow,
    OpeningBalanceRow,
    TicketRow,
)


def collect_report_rows(
    session: Session, report_name: ReportName
) -> tuple[list[str], list[tuple[Any, ...]]]:
    """Return report column headers and row tuples."""
    canonical: ReportName = {
        "entitlement-balance-summary": "opening-balances",
        "booking-register": "ticket-register",
        "loan-recovery-ledger": "loan-statement",
    }.get(report_name, report_name)  # type: ignore[arg-type]
    if report_name == "liability-projections":
        columns = (
            "Employee",
            "Loan",
            "Status",
            "Outstanding",
            "Monthly EMI",
            "Remaining installments",
            "Projected recovery",
            "First due",
        )
        query = (
            select(LoanRow, EmployeeRow)
            .join(EmployeeRow, EmployeeRow.id == LoanRow.employee_id)
            .where(
                LoanRow.deleted_at.is_(None),
                LoanRow.status.in_(("active", "deferred")),
            )
            .order_by(LoanRow.outstanding.desc())
        )
        rows = []
        for loan, employee in session.execute(query):
            emi = loan.monthly_installment or Decimal("0")
            outstanding = loan.outstanding or Decimal("0")
            remaining = int(loan.installments or 0)
            if emi > 0 and outstanding > 0:
                remaining = min(
                    remaining,
                    int((outstanding / emi).to_integral_value(rounding=ROUND_CEILING)),
                )
            rows.append(
                (
                    employee.code,
                    getattr(loan, "loan_number", None) or loan.id,
                    loan.status,
                    outstanding,
                    emi,
                    remaining,
                    outstanding,
                    loan.first_due_date.isoformat() if loan.first_due_date else "",
                )
            )
        return list(columns), rows
    report_name = canonical
    if report_name == "employee-master":
        columns = ("Code", "Employee", "Department", "Branch", "Join date", "Email", "Status")
        rows = [
            (
                item.code,
                item.full_name,
                item.department,
                item.branch,
                item.join_date.isoformat(),
                item.email or "",
                "Active" if item.active else "Inactive",
            )
            for item in session.scalars(
                select(EmployeeRow)
                .where(EmployeeRow.deleted_at.is_(None))
                .order_by(EmployeeRow.code)
            )
        ]
        return list(columns), rows
    if report_name == "opening-balances":
        columns = (
            "Employee",
            "Name",
            "Year",
            "Opening days",
            "Paid days",
            "Opening amount",
            "Maximum payout",
        )
        query = (
            select(OpeningBalanceRow, EmployeeRow)
            .join(EmployeeRow, EmployeeRow.id == OpeningBalanceRow.employee_id)
            .where(OpeningBalanceRow.deleted_at.is_(None))
            .order_by(EmployeeRow.code, OpeningBalanceRow.balance_year)
        )
        rows = [
            (
                employee.code,
                employee.full_name,
                balance.balance_year,
                balance.opening_days,
                balance.paid_days,
                balance.opening_amount,
                balance.maximum_payout,
            )
            for balance, employee in session.execute(query)
        ]
        return list(columns), rows
    if report_name == "entitlements":
        columns = ("Scope", "Scope ID", "Amount", "Effective from", "Effective to", "Cap")
        rows = [
            (
                item.scope_type,
                item.scope_id,
                item.amount,
                item.effective_from.isoformat(),
                item.effective_to.isoformat() if item.effective_to else "",
                item.cap_amount or "",
            )
            for item in session.scalars(
                select(EntitlementRateRow)
                .where(EntitlementRateRow.deleted_at.is_(None))
                .order_by(EntitlementRateRow.effective_from.desc())
            )
        ]
        return list(columns), rows
    if report_name == "ticket-register":
        columns = (
            "Travel date",
            "Employee",
            "Route",
            "Ticket cost",
            "Entitlement",
            "Company paid",
            "Excess",
            "Status",
        )
        query = (
            select(TicketRow, EmployeeRow)
            .join(EmployeeRow, EmployeeRow.id == TicketRow.employee_id)
            .where(TicketRow.deleted_at.is_(None))
            .order_by(TicketRow.travel_date.desc())
        )
        rows = [
            (
                ticket.travel_date.isoformat(),
                employee.code,
                f"{ticket.origin_code}-{ticket.destination_code}",
                ticket.ticket_cost,
                ticket.entitlement,
                ticket.company_paid,
                ticket.excess_amount,
                ticket.status,
            )
            for ticket, employee in session.execute(query)
        ]
        return list(columns), rows
    if report_name == "loan-outstanding":
        columns = (
            "Employee",
            "Principal",
            "Outstanding",
            "Monthly installment",
            "Installments",
            "Status",
        )
        query = (
            select(LoanRow, EmployeeRow)
            .join(EmployeeRow, EmployeeRow.id == LoanRow.employee_id)
            .where(LoanRow.deleted_at.is_(None))
            .order_by(LoanRow.outstanding.desc())
        )
        rows = [
            (
                employee.code,
                loan.principal,
                loan.outstanding,
                loan.monthly_installment,
                loan.installments,
                loan.status,
            )
            for loan, employee in session.execute(query)
        ]
        return list(columns), rows
    if report_name == "loan-statement":
        columns = (
            "Employee",
            "Loan ID",
            "Date",
            "Description",
            "Debit",
            "Credit",
            "Installment #",
            "Due date",
            "Principal",
            "Interest",
            "Payment",
            "Outstanding",
        )
        query = (
            select(LoanRow, EmployeeRow)
            .join(EmployeeRow, EmployeeRow.id == LoanRow.employee_id)
            .where(LoanRow.deleted_at.is_(None))
            .order_by(EmployeeRow.code, LoanRow.created_at, LoanRow.id)
        )
        repo = LoanRepository(session)
        rows: list[tuple[Any, ...]] = []
        for loan, employee in session.execute(query):
            persisted = repo.schedule(loan.id)
            schedule: Sequence[LoanInstallment | LoanInstallmentRow] = persisted or build_amortization_schedule(
                loan.outstanding, loan.annual_rate, loan.installments, loan.first_due_date
            )
            opened = loan.first_due_date.isoformat()
            rows.append(
                (
                    employee.code,
                    loan.id,
                    opened,
                    "Loan opened",
                    loan.principal,
                    Decimal("0"),
                    "",
                    opened,
                    loan.principal,
                    Decimal("0"),
                    Decimal("0"),
                    loan.principal,
                )
            )
            for part in schedule:
                due = part.due_date.isoformat() if hasattr(part.due_date, "isoformat") else str(part.due_date)
                rows.append(
                    (
                        employee.code,
                        loan.id,
                        due,
                        f"EMI {part.number}",
                        part.payment,
                        Decimal("0"),
                        part.number,
                        due,
                        part.principal,
                        part.interest,
                        part.payment,
                        part.closing_balance,
                    )
                )
            payments = session.scalars(
                select(LoanPaymentRow)
                .where(
                    LoanPaymentRow.loan_id == loan.id,
                    LoanPaymentRow.deleted_at.is_(None),
                )
                .order_by(LoanPaymentRow.paid_on, LoanPaymentRow.id)
            )
            remaining = loan.principal
            for payment in payments:
                remaining = max(Decimal("0"), remaining - payment.amount)
                paid_on = payment.paid_on.isoformat()
                rows.append(
                    (
                        employee.code,
                        loan.id,
                        paid_on,
                        f"Payment {payment.reference or payment.id}",
                        Decimal("0"),
                        payment.amount,
                        "",
                        paid_on,
                        payment.amount,
                        Decimal("0"),
                        payment.amount,
                        remaining,
                    )
                )
        return list(columns), rows
    columns = (
        "Travel date",
        "Employee",
        "Route",
        "Ticket cost",
        "Entitlement",
        "Excess",
        "Status",
    )
    query = (
        select(TicketRow, EmployeeRow)
        .join(EmployeeRow, EmployeeRow.id == TicketRow.employee_id)
        .where(
            TicketRow.deleted_at.is_(None),
            TicketRow.company_paid > TicketRow.entitlement,
        )
        .order_by(TicketRow.travel_date.desc())
    )
    rows = [
        (
            ticket.travel_date.isoformat(),
            employee.code,
            f"{ticket.origin_code}-{ticket.destination_code}",
            ticket.ticket_cost,
            ticket.entitlement,
            ticket.excess_amount,
            ticket.status,
        )
        for ticket, employee in session.execute(query)
    ]
    return list(columns), rows


def report_aggregate_value(session: Session, report_name: ReportName) -> int | Decimal:
    """Return the scalar KPI shown on report dashboard tiles."""
    if report_name == "employee-master":
        return session.scalar(
            select(func.count()).select_from(EmployeeRow).where(EmployeeRow.deleted_at.is_(None))
        ) or 0
    if report_name in {"opening-balances", "entitlement-balance-summary"}:
        return session.scalar(
            select(func.count())
            .select_from(OpeningBalanceRow)
            .where(OpeningBalanceRow.deleted_at.is_(None))
        ) or 0
    if report_name == "entitlements":
        return session.scalar(
            select(func.count())
            .select_from(EntitlementRateRow)
            .where(EntitlementRateRow.deleted_at.is_(None))
        ) or 0
    if report_name in {"ticket-register", "booking-register"}:
        return session.scalar(
            select(func.count()).select_from(TicketRow).where(TicketRow.deleted_at.is_(None))
        ) or 0
    if report_name == "loan-outstanding":
        return session.scalar(
            select(func.coalesce(func.sum(LoanRow.outstanding), 0)).where(
                LoanRow.deleted_at.is_(None)
            )
        ) or Decimal("0")
    if report_name in {"loan-statement", "loan-recovery-ledger"}:
        return session.scalar(
            select(func.count()).select_from(LoanRow).where(LoanRow.deleted_at.is_(None))
        ) or 0
    if report_name == "liability-projections":
        return session.scalar(
            select(func.coalesce(func.sum(LoanRow.outstanding), 0)).where(
                LoanRow.deleted_at.is_(None),
                LoanRow.status.in_(("active", "deferred")),
            )
        ) or Decimal("0")
    return session.scalar(
        select(func.coalesce(func.sum(TicketRow.company_paid - TicketRow.entitlement), 0))
        .where(TicketRow.company_paid > TicketRow.entitlement)
        .where(TicketRow.deleted_at.is_(None))
    ) or Decimal("0")

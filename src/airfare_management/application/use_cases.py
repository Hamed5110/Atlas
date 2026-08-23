"""Orchestrate multi-step business workflows."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.orm import Session

from airfare_management.domain.services import build_amortization_schedule
from airfare_management.infrastructure.database import EmployeeRow
from airfare_management.infrastructure.repositories import LoanRepository
from airfare_management.infrastructure.schema import (
    EssRequestRow,
    LoanPaymentRow,
    LoanRow,
    OpeningBalanceRow,
    TicketRow,
)


def soft_delete_employee_cascade(
    session: Session,
    employee: EmployeeRow,
    *,
    deleted_at: datetime | None = None,
) -> None:
    """Soft-delete an employee and all active related operational rows."""
    now = deleted_at or datetime.now(UTC)
    employee.deleted_at = now
    employee.active = False
    employee.version += 1
    for model in (TicketRow, LoanRow, OpeningBalanceRow, EssRequestRow):
        session.execute(
            update(model)
            .where(model.employee_id == employee.id, model.deleted_at.is_(None))
            .values(deleted_at=now, version=model.version + 1)
        )


def post_loan_payment_with_schedule(
    session: Session,
    loan: LoanRow,
    *,
    amount: Decimal,
    paid_on: date,
    reference: str,
) -> LoanPaymentRow:
    """Record a payment, update outstanding, and rebuild the EMI schedule."""
    payment = LoanPaymentRow(
        loan_id=loan.id,
        amount=amount,
        paid_on=paid_on,
        reference=reference,
    )
    session.add(payment)
    loan.outstanding -= amount
    loan.version += 1
    if loan.outstanding == 0:
        loan.status = "settled"
    session.flush()
    if loan.status != "settled" and loan.outstanding > 0:
        LoanRepository(session).replace_schedule(
            loan.id,
            build_amortization_schedule(
                loan.outstanding,
                loan.annual_rate,
                loan.installments,
                loan.first_due_date,
            ),
        )
    return payment


def recalculate_loan_schedule(session: Session, loan_id: str | UUID) -> int:
    """Replace persisted installments from the loan's current outstanding balance."""
    loan = session.get(LoanRow, str(loan_id))
    if loan is None or loan.deleted_at is not None:
        return 0
    schedule = build_amortization_schedule(
        loan.outstanding,
        loan.annual_rate,
        loan.installments,
        loan.first_due_date,
    )
    LoanRepository(session).replace_schedule(loan.id, schedule)
    return len(schedule)

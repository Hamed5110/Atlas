"""Operational repositories and the SQLAlchemy unit of work."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any, TypeVar, cast
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from airfare_management.application.contracts import UnitOfWork
from airfare_management.domain.models import Employee
from airfare_management.domain.services import LoanInstallment
from airfare_management.infrastructure.database import EmployeeRepository, EmployeeRow
from airfare_management.infrastructure.schema import (
    AttachmentRow,
    CompanyRow,
    EntitlementRateRow,
    EssRequestRow,
    LoanInstallmentRow,
    LoanPaymentRow,
    LoanRow,
    LookupRow,
    OpeningBalanceRow,
    PreferenceRow,
    TicketRow,
    UserRow,
)

TRow = TypeVar("TRow")


class RowRepository:
    """Generic active-row repository used by application handlers."""

    def __init__(self, session: Session, model: type[TRow]) -> None:
        """Bind a mapped class to the current unit-of-work session."""
        self._session = session
        self._model = model

    def get(self, entity_id: str) -> TRow | None:
        """Return an active row by identifier."""
        row = self._session.get(self._model, entity_id)
        if row is None or getattr(row, "deleted_at", None) is not None:
            return None
        return cast(TRow, row)

    def add(self, entity: TRow) -> None:
        """Stage a new row inside the current transaction."""
        self._session.add(entity)

    def list_active(
        self,
        *criteria: Any,  # noqa: ANN401 - SQLAlchemy accepts heterogeneous expressions.
        order_by: Any | None = None,  # noqa: ANN401
        limit: int = 500,
        offset: int = 0,
    ) -> Sequence[TRow]:
        """List active rows with optional filters and bounded pagination."""
        query = select(self._model)
        deleted = getattr(self._model, "deleted_at", None)
        if deleted is not None:
            query = query.where(deleted.is_(None))
        for criterion in criteria:
            query = query.where(criterion)
        if order_by is not None:
            query = query.order_by(order_by)
        return cast(
            Sequence[TRow],
            tuple(self._session.scalars(query.limit(min(limit, 500)).offset(max(offset, 0))).all()),
        )

    def scalar(self, statement: Any) -> Any:  # noqa: ANN401
        """Execute a scalar statement on the unit-of-work session."""
        return self._session.scalar(statement)

    def scalars(self, statement: Any) -> Any:  # noqa: ANN401
        """Execute a row-returning statement on the unit-of-work session."""
        return self._session.scalars(statement)

    def flush(self) -> None:
        """Flush staged work without committing the use-case transaction."""
        self._session.flush()


class LoanRepository(RowRepository):
    """Loan aggregate including persisted EMI schedule rows."""

    def __init__(self, session: Session) -> None:
        """Initialize loan and installment persistence."""
        super().__init__(session, LoanRow)

    def replace_schedule(self, loan_id: str, schedule: Sequence[LoanInstallment]) -> None:
        """Replace the stored EMI schedule for a loan inside the current transaction."""
        self._session.execute(
            delete(LoanInstallmentRow).where(LoanInstallmentRow.loan_id == loan_id)
        )
        now = datetime.now(UTC)
        for part in schedule:
            self._session.add(
                LoanInstallmentRow(
                    loan_id=loan_id,
                    number=part.number,
                    due_date=part.due_date,
                    opening_balance=part.opening_balance,
                    principal=part.principal,
                    interest=part.interest,
                    payment=part.payment,
                    closing_balance=part.closing_balance,
                    created_at=now,
                    updated_at=now,
                )
            )

    def schedule(self, loan_id: str) -> Sequence[LoanInstallmentRow]:
        """Return persisted installments in due-date order."""
        return tuple(
            self._session.scalars(
                select(LoanInstallmentRow)
                .where(
                    LoanInstallmentRow.loan_id == loan_id,
                    LoanInstallmentRow.deleted_at.is_(None),
                )
                .order_by(LoanInstallmentRow.number)
            ).all()
        )


class SqlAlchemyUnitOfWork(UnitOfWork):
    """Use-case transaction boundary exposing operational repositories."""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        """Initialize a unit-of-work factory dependency."""
        self._session_factory = session_factory
        self.session: Session | None = None
        self.employees: EmployeeRepository
        self.companies: RowRepository
        self.users: RowRepository
        self.tickets: RowRepository
        self.loans: LoanRepository
        self.payments: RowRepository
        self.balances: RowRepository
        self.preferences: RowRepository
        self.rates: RowRepository
        self.attachments: RowRepository
        self.lookups: RowRepository
        self.ess_requests: RowRepository

    def __enter__(self) -> SqlAlchemyUnitOfWork:
        """Open a transaction and bind repositories to one session."""
        self.session = self._session_factory()
        self.employees = EmployeeRepository(self.session)
        self.companies = RowRepository(self.session, CompanyRow)
        self.users = RowRepository(self.session, UserRow)
        self.tickets = RowRepository(self.session, TicketRow)
        self.loans = LoanRepository(self.session)
        self.payments = RowRepository(self.session, LoanPaymentRow)
        self.balances = RowRepository(self.session, OpeningBalanceRow)
        self.preferences = RowRepository(self.session, PreferenceRow)
        self.rates = RowRepository(self.session, EntitlementRateRow)
        self.attachments = RowRepository(self.session, AttachmentRow)
        self.lookups = RowRepository(self.session, LookupRow)
        self.ess_requests = RowRepository(self.session, EssRequestRow)
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        """Roll back failed work and close the session."""
        assert self.session is not None
        if exc is not None:
            self.session.rollback()
        self.session.close()

    def commit(self) -> None:
        """Commit the current use-case transaction."""
        assert self.session is not None
        self.session.commit()

    def flush(self) -> None:
        """Flush pending writes so generated identifiers are available."""
        assert self.session is not None
        self.session.flush()

    def get_employee_row(self, employee_id: UUID) -> EmployeeRow | None:
        """Return the active employee ORM row for authorization and scoping."""
        assert self.session is not None
        return self.session.scalar(
            select(EmployeeRow).where(
                EmployeeRow.id == employee_id, EmployeeRow.deleted_at.is_(None)
            )
        )

    def get_employee(self, employee_id: UUID) -> Employee | None:
        """Return the employee domain aggregate."""
        return self.employees.get(employee_id)

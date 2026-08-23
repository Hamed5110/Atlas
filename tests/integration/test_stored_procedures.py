"""Stored procedure SQL artifacts and Python workflow parity tests."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import select

from airfare_management.application.use_cases import (
    post_loan_payment_with_schedule,
    recalculate_loan_schedule,
    soft_delete_employee_cascade,
)
from airfare_management.config import Settings
from airfare_management.infrastructure.database import Base, EmployeeRow, create_session_factory
from airfare_management.infrastructure import schema as _schema  # noqa: F401
from airfare_management.infrastructure.repositories import LoanRepository
from airfare_management.infrastructure.schema import (
    CompanyRow,
    EssRequestRow,
    LoanRow,
    OpeningBalanceRow,
    TicketRow,
)

pytestmark = pytest.mark.integration

SQL_ROOT = Path(__file__).resolve().parents[2] / "sql"


def test_reporting_sql_files_define_required_objects() -> None:
    views = (SQL_ROOT / "reporting_views.sql").read_text(encoding="utf-8")
    procedures = (SQL_ROOT / "reporting_procedures.sql").read_text(encoding="utf-8")
    for name in (
        "vw_employee_summary",
        "vw_ticket_ledger",
        "vw_loan_portfolio",
        "vw_monthly_spend",
        "vw_excess_recovery",
        "vw_preference_audit",
        "vw_ess_request_tracker",
        "vw_ai_anomaly_flags",
    ):
        assert f"dbo.{name}" in views
    for name in (
        "sp_generate_report",
        "sp_export_report_excel",
        "sp_backup_logical_json",
        "sp_restore_logical_json",
        "sp_recalculate_loan_schedule",
        "sp_post_loan_payment",
        "sp_employee_soft_delete_cascade",
    ):
        assert f"dbo.{name}" in procedures
    assert "TRY" in procedures and "CATCH" in procedures


def test_recalculate_loan_schedule_use_case() -> None:
    settings = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="s" * 32,
    )
    sessions = create_session_factory(settings)
    Base.metadata.create_all(sessions.bind_engine)
    now = datetime.now(UTC)
    company_id = "11111111-1111-1111-1111-111111111111"
    with sessions.begin() as session:
        if session.get(CompanyRow, company_id) is None:
            session.add(
                CompanyRow(
                    id=company_id,
                    code="DEFAULT",
                    name="Default Company",
                    currency="USD",
                )
            )
            session.flush()
        employee = EmployeeRow(
            id=uuid4(),
            company_id="11111111-1111-1111-1111-111111111111",
            code="SP001",
            full_name="Schedule Test",
            join_date=date(2024, 1, 1),
            created_at=now,
            updated_at=now,
        )
        session.add(employee)
        loan = LoanRow(
            employee_id=employee.id,
            principal=Decimal("1200"),
            annual_rate=Decimal("0"),
            installments=12,
            monthly_installment=Decimal("100"),
            outstanding=Decimal("1200"),
            first_due_date=date(2026, 1, 1),
        )
        session.add(loan)
        session.flush()
        count = recalculate_loan_schedule(session, loan.id)
        assert count == 12
        schedule = LoanRepository(session).schedule(loan.id)
        assert schedule is not None
        assert len(schedule) == 12


def test_post_loan_payment_reduces_outstanding() -> None:
    settings = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="p" * 32,
    )
    sessions = create_session_factory(settings)
    Base.metadata.create_all(sessions.bind_engine)
    now = datetime.now(UTC)
    company_id = "11111111-1111-1111-1111-111111111111"
    with sessions.begin() as session:
        if session.get(CompanyRow, company_id) is None:
            session.add(
                CompanyRow(
                    id=company_id,
                    code="DEFAULT",
                    name="Default Company",
                    currency="USD",
                )
            )
            session.flush()
        employee = EmployeeRow(
            id=uuid4(),
            company_id="11111111-1111-1111-1111-111111111111",
            code="SP002",
            full_name="Payment Test",
            join_date=date(2024, 1, 1),
            created_at=now,
            updated_at=now,
        )
        session.add(employee)
        loan = LoanRow(
            employee_id=employee.id,
            principal=Decimal("600"),
            annual_rate=Decimal("0"),
            installments=6,
            monthly_installment=Decimal("100"),
            outstanding=Decimal("600"),
            first_due_date=date(2026, 1, 1),
        )
        session.add(loan)
        session.flush()
        recalculate_loan_schedule(session, loan.id)
        post_loan_payment_with_schedule(
            session,
            loan,
            amount=Decimal("100"),
            paid_on=date(2026, 1, 15),
            reference="TEST",
        )
        session.refresh(loan)
        assert loan.outstanding == Decimal("500")


def test_soft_delete_employee_cascade_marks_related_rows() -> None:
    settings = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="d" * 32,
    )
    sessions = create_session_factory(settings)
    Base.metadata.create_all(sessions.bind_engine)
    now = datetime.now(UTC)
    company_id = "11111111-1111-1111-1111-111111111111"
    with sessions.begin() as session:
        if session.get(CompanyRow, company_id) is None:
            session.add(
                CompanyRow(
                    id=company_id,
                    code="DEFAULT",
                    name="Default Company",
                    currency="USD",
                )
            )
            session.flush()
        employee = EmployeeRow(
            id=uuid4(),
            company_id="11111111-1111-1111-1111-111111111111",
            code="SP003",
            full_name="Cascade Test",
            join_date=date(2024, 1, 1),
            created_at=now,
            updated_at=now,
        )
        session.add(employee)
        session.add(
            TicketRow(
                employee_id=employee.id,
                travel_date=date(2026, 6, 1),
                origin_code="BAH",
                destination_code="DXB",
                ticket_cost=Decimal("500"),
                entitlement=Decimal("400"),
                company_paid=Decimal("400"),
            )
        )
        session.add(
            LoanRow(
                employee_id=employee.id,
                principal=Decimal("100"),
                annual_rate=Decimal("0"),
                installments=1,
                monthly_installment=Decimal("100"),
                outstanding=Decimal("100"),
                first_due_date=date(2026, 7, 1),
            )
        )
        session.add(
            OpeningBalanceRow(
                employee_id=employee.id,
                balance_year=2026,
                opening_days=Decimal("10"),
                opening_amount=Decimal("25"),
                maximum_payout=Decimal("150"),
            )
        )
        session.add(
            EssRequestRow(
                employee_id=employee.id,
                request_type="airfare",
                travel_date=date(2026, 6, 1),
                origin_code="BAH",
                destination_code="DXB",
            )
        )
        session.flush()
        soft_delete_employee_cascade(session, employee)
        assert employee.deleted_at is not None
        assert session.scalar(
            select(TicketRow).where(
                TicketRow.employee_id == employee.id, TicketRow.deleted_at.is_(None)
            )
        ) is None
        assert session.scalar(
            select(LoanRow).where(LoanRow.employee_id == employee.id, LoanRow.deleted_at.is_(None))
        ) is None

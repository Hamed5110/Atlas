"""Integration tests for the SQLAlchemy unit of work."""

from datetime import date
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from airfare_management.config import Settings
from airfare_management.domain.models import Employee
from airfare_management.infrastructure.database import Base, create_session_factory
from airfare_management.infrastructure.repositories import SqlAlchemyUnitOfWork
from airfare_management.infrastructure.schema import CompanyRow


def _sessions() -> sessionmaker[Session]:
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="z" * 32,
    )
    sessions = create_session_factory(settings)
    Base.metadata.create_all(sessions.kw["bind"])
    return sessions


def test_employee_unit_of_work_persists_and_lists() -> None:
    """Employees can be created and retrieved through the unit of work."""
    sessions = _sessions()
    company_id = uuid4()
    employee = Employee(
        code="E100",
        full_name="Persisted Employee",
        company_id=company_id,
        join_date=date(2026, 2, 1),
        department="Finance",
        branch="Main",
    )
    with SqlAlchemyUnitOfWork(sessions) as uow:
        assert uow.session is not None
        uow.session.add(CompanyRow(id=str(company_id), code="P1", name="Persisted Co"))
        uow.session.flush()
        uow.employees.add(employee)
        uow.commit()
    with SqlAlchemyUnitOfWork(sessions) as uow:
        loaded = uow.employees.get(employee.id)
        listed = uow.employees.list()
    assert loaded is not None
    assert loaded.code == "E100"
    assert listed[0].full_name == "Persisted Employee"
    sessions.kw["bind"].dispose()


def test_employee_company_foreign_key_rejects_orphans() -> None:
    """SQLite foreign keys reject an employee whose company does not exist."""
    sessions = _sessions()
    employee = Employee(
        code="E101",
        full_name="Orphan Employee",
        company_id=uuid4(),
        join_date=date(2026, 2, 1),
    )
    with SqlAlchemyUnitOfWork(sessions) as uow:
        uow.employees.add(employee)
        with pytest.raises(IntegrityError):
            uow.commit()
    sessions.kw["bind"].dispose()

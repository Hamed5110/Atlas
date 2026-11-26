"""Integration tests for the SQLAlchemy unit of work."""

from datetime import date
from uuid import uuid4

from airfare_management.config import Settings
from airfare_management.domain.models import Employee
from airfare_management.infrastructure.database import (
    Base,
    SqlAlchemyUnitOfWork,
    create_session_factory,
)


def test_employee_unit_of_work_persists_and_lists() -> None:
    """Employees can be created and retrieved through the unit of work."""
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="z" * 32,
    )
    sessions = create_session_factory(settings)
    Base.metadata.create_all(sessions.kw["bind"])
    employee = Employee(
        code="E100",
        full_name="Persisted Employee",
        company_id=uuid4(),
        join_date=date(2026, 2, 1),
        department="Finance",
        branch="Main",
    )
    with SqlAlchemyUnitOfWork(sessions) as uow:
        uow.employees.add(employee)
        uow.commit()
    with SqlAlchemyUnitOfWork(sessions) as uow:
        loaded = uow.employees.get(employee.id)
        listed = uow.employees.list()
    assert loaded is not None
    assert loaded.code == "E100"
    assert listed[0].full_name == "Persisted Employee"
    sessions.kw["bind"].dispose()

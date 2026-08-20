"""Unit tests for application command, query, and event handlers."""

from datetime import date
from decimal import Decimal
from uuid import uuid4

from airfare_management.application.contracts import (
    CalculateEntitlement,
    CreateEmployee,
    DomainEvent,
    EmployeeCommandHandler,
    EntitlementQueryHandler,
    EventBus,
)


class FakeRepository:
    """In-memory employee repository used by the command test."""

    def __init__(self) -> None:
        """Initialize captured entities."""
        self.added: list[object] = []

    def add(self, entity: object) -> None:
        """Capture an added entity."""
        self.added.append(entity)


class FakeUnitOfWork:
    """Minimal command-handler transaction boundary."""

    def __init__(self) -> None:
        """Initialize repository and transaction state."""
        self.employees = FakeRepository()
        self.committed = False

    def __enter__(self) -> "FakeUnitOfWork":
        """Enter the fake transaction."""
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        """Leave the fake transaction."""
        return None

    def commit(self) -> None:
        """Capture commit."""
        self.committed = True


def test_command_query_and_event_dispatch() -> None:
    """Persist a command, publish its event, and calculate a query."""
    uow = FakeUnitOfWork()
    received: list[DomainEvent] = []
    events = EventBus()
    events.subscribe("employee.created", received.append)
    events.publish(DomainEvent("unhandled", uuid4(), None, {}))
    command = CreateEmployee(
        code="APP-01",
        full_name="Application Employee",
        company_id=uuid4(),
        join_date=date(2026, 1, 1),
    )
    employee = EmployeeCommandHandler(lambda: uow, events).handle(command)
    assert employee.code == "APP-01"
    assert uow.committed
    assert uow.employees.added == [employee]
    assert received[0].aggregate_id == employee.id
    result = EntitlementQueryHandler().handle(
        CalculateEntitlement(
            opening_days=Decimal("0"),
            current_working_days=360,
            paid_days=Decimal("0"),
            maximum_payout=Decimal("1200"),
        )
    )
    assert result.payable == Decimal("600.00")

"""Application ports, commands, queries, events, and unit-of-work contracts."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Generic, Protocol, TypeVar
from uuid import UUID

from airfare_management.domain.models import Employee, Entity
from airfare_management.domain.services import EntitlementResult, calculate_entitlement

TEntity = TypeVar("TEntity", bound=Entity)
TEvent = TypeVar("TEvent")


class Repository(Protocol, Generic[TEntity]):
    """Persistence abstraction for an aggregate type."""

    def get(self, entity_id: UUID) -> TEntity | None:
        """Find an active aggregate by identifier."""

    def list(self, *, limit: int = 100, offset: int = 0) -> Sequence[TEntity]:
        """List active aggregates with bounded pagination."""

    def add(self, entity: TEntity) -> None:
        """Stage a new aggregate."""


class UnitOfWork(Protocol):
    """Atomic transaction boundary exposed to application handlers."""

    employees: Repository[Employee]

    def __enter__(self) -> "UnitOfWork":
        """Enter a transaction."""

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        """Commit success or roll back failure."""

    def commit(self) -> None:
        """Commit staged work and queued audit events."""


@dataclass(frozen=True, slots=True)
class DomainEvent:
    """Immutable event published after a successful state change."""

    name: str
    aggregate_id: UUID
    actor_id: UUID | None
    payload: dict[str, str]


class EventBus:
    """Synchronous in-process event dispatcher for post-commit handlers."""

    def __init__(self) -> None:
        """Initialize an empty subscriber registry."""
        self._handlers: dict[str, list[Callable[[DomainEvent], None]]] = {}

    def subscribe(self, name: str, handler: Callable[[DomainEvent], None]) -> None:
        """Subscribe a handler to an event name.

        Args:
            name: Event name.
            handler: Function called for matching events.
        """
        self._handlers.setdefault(name, []).append(handler)

    def publish(self, event: DomainEvent) -> None:
        """Publish an event to current subscribers.

        Args:
            event: Event to dispatch.
        """
        for handler in self._handlers.get(event.name, []):
            handler(event)


@dataclass(frozen=True, slots=True)
class CreateEmployee:
    """Command to register an employee."""

    code: str
    full_name: str
    company_id: UUID
    join_date: date
    department: str = ""
    branch: str = ""
    email: str | None = None


@dataclass(frozen=True, slots=True)
class CalculateEntitlement:
    """Query inputs for an entitlement preview."""

    opening_days: Decimal
    current_working_days: int
    paid_days: Decimal
    maximum_payout: Decimal


class EmployeeCommandHandler:
    """CQRS command handler for employee registration."""

    def __init__(self, uow_factory: Callable[[], UnitOfWork], events: EventBus) -> None:
        """Initialize dependencies.

        Args:
            uow_factory: Unit-of-work factory.
            events: Post-commit event dispatcher.
        """
        self._uow_factory = uow_factory
        self._events = events

    def handle(self, command: CreateEmployee, actor_id: UUID | None = None) -> Employee:
        """Register and persist an employee.

        Args:
            command: Validated registration command.
            actor_id: Authenticated user identifier.

        Returns:
            Created employee.
        """
        employee = Employee(
            code=command.code,
            full_name=command.full_name,
            company_id=command.company_id,
            join_date=command.join_date,
            department=command.department,
            branch=command.branch,
            email=command.email,
        )
        with self._uow_factory() as uow:
            uow.employees.add(employee)
            uow.commit()
        self._events.publish(DomainEvent("employee.created", employee.id, actor_id, {}))
        return employee


class EntitlementQueryHandler:
    """CQRS query handler for side-effect-free entitlement previews."""

    def handle(self, query: CalculateEntitlement) -> EntitlementResult:
        """Calculate an entitlement preview.

        Args:
            query: Calculation inputs.

        Returns:
            Calculated result.
        """
        return calculate_entitlement(
            query.opening_days,
            query.current_working_days,
            query.paid_days,
            query.maximum_payout,
        )

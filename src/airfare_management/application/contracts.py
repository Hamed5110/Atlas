"""Application ports, commands, queries, events, and unit-of-work contracts."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Generic, Protocol, TypeVar
from uuid import UUID

from airfare_management.domain.models import Employee, Entity
from airfare_management.domain.services import (
    AIRFARE_CYCLE_DAYS,
    AllocationEntitlementResult,
    EntitlementResult,
    ExcessSettlementOption,
    ExcessSettlementResult,
    RateSource,
    calculate_allocation_entitlement,
    calculate_entitlement,
    resolve_airfare_rate_hierarchy,
    resolve_entitlement_cap,
    settle_excess_ticket,
)
from airfare_management.infrastructure.mssql_entitlement import (
    calculate_entitlement as calculate_entitlement_engine,
)

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


@dataclass(frozen=True, slots=True)
class PreviewAllocation:
    """Pure allocation-engine preview inputs."""

    as_of_date: date
    date_of_joining: date
    last_ticket_date: date | None
    opening_balance_days: Decimal
    opening_balance_amount: Decimal
    employee_custom_rate: Decimal | None
    pay_group_rate: Decimal | None
    global_company_preference_rate: Decimal | None
    global_rate_days: Decimal | None = None
    company_rate: Decimal | None = None
    employee_cap: Decimal | None = None
    pay_group_cap: Decimal | None = None
    company_cap: Decimal | None = None
    global_cap: Decimal | None = None
    requested_ticket_amount: Decimal | None = None
    excess_option: ExcessSettlementOption | None = None
    tenure_months: int | None = None
    paid_days: Decimal = Decimal("0")
    current_year_spending: Decimal = Decimal("0")


@dataclass(frozen=True, slots=True)
class AllocationPreview:
    """Combined entitlement and optional excess settlement."""

    entitlement: AllocationEntitlementResult
    rate_source: RateSource
    settlement: ExcessSettlementResult | None
    requested_ticket_amount: Decimal | None = None


class AllocationQueryHandler:
    """CQRS query handler for the mandated airfare allocation engine."""

    def handle(self, query: PreviewAllocation) -> AllocationPreview:
        """Resolve rates, calculate entitlement, and optionally settle excess.

        Args:
            query: Allocation preview inputs.

        Returns:
            Entitlement result plus optional excess settlement.
        """
        airfare_rate, source = resolve_airfare_rate_hierarchy(
            query.employee_custom_rate,
            query.pay_group_rate,
            query.global_company_preference_rate,
            query.company_rate,
        )
        cap = resolve_entitlement_cap(
            query.employee_cap,
            query.pay_group_cap,
            query.global_cap,
            query.company_cap,
        )
        entitlement = calculate_entitlement_engine(
            as_of_date=query.as_of_date,
            date_of_joining=query.date_of_joining,
            last_ticket_date=query.last_ticket_date,
            opening_balance_days=query.opening_balance_days,
            opening_balance_amount=query.opening_balance_amount,
            airfare_rate=airfare_rate,
            rate_source=source,
            max_entitlement_cap_rate=cap,
            paid_days=query.paid_days,
            current_year_spending=query.current_year_spending,
            prefer_mssql=False,
        )
        settlement = None
        ticket = query.requested_ticket_amount
        if ticket is not None and query.excess_option is not None:
            settlement = settle_excess_ticket(
                ticket,
                entitlement.final_entitlement_amount,
                query.excess_option,
                query.tenure_months,
            )
        elif ticket is not None and ticket <= entitlement.final_entitlement_amount:
            settlement = settle_excess_ticket(
                ticket,
                entitlement.final_entitlement_amount,
                ExcessSettlementOption.SELF_PAID,
                None,
            )
        return AllocationPreview(entitlement, source, settlement, ticket)

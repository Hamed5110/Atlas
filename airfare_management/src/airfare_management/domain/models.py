"""Framework-independent domain models and errors."""

from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID, uuid4


class DomainError(Exception):
    """Base error carrying a stable machine-readable code."""

    def __init__(self, code: str, message: str) -> None:
        """Initialize an error.

        Args:
            code: Stable error code.
            message: Safe human-readable detail.
        """
        self.code = code
        super().__init__(message)


class ConflictError(DomainError):
    """Raised when optimistic concurrency or uniqueness fails."""


class ValidationError(DomainError):
    """Raised when a domain invariant is violated."""


class LoanStatus(StrEnum):
    """Lifecycle status of an employee loan."""

    ACTIVE = "active"
    DEFERRED = "deferred"
    SETTLED = "settled"


class TicketStatus(StrEnum):
    """Workflow status of a leave-travel ticket."""

    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"
    PAID = "paid"


@dataclass(slots=True, kw_only=True)
class Entity:
    """Common auditable, soft-deletable aggregate state."""

    id: UUID = field(default_factory=uuid4)
    version: int = 1
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    deleted_at: datetime | None = None

    def touch(self, expected_version: int) -> None:
        """Advance the optimistic version after validating the caller.

        Args:
            expected_version: Version observed by the caller.

        Raises:
            ConflictError: If another writer has changed the entity.
        """
        if expected_version != self.version:
            raise ConflictError("stale_version", "The record was modified by another user.")
        self.version += 1
        self.updated_at = datetime.now(UTC)

    def soft_delete(self, expected_version: int) -> None:
        """Mark the entity deleted without destroying audit history.

        Args:
            expected_version: Version observed by the caller.
        """
        self.touch(expected_version)
        self.deleted_at = datetime.now(UTC)


@dataclass(slots=True, kw_only=True)
class Employee(Entity):
    """Employee eligible for leave-travel benefits."""

    code: str
    full_name: str
    company_id: UUID
    join_date: date
    department: str = ""
    branch: str = ""
    email: str | None = None
    active: bool = True


@dataclass(slots=True, kw_only=True)
class OpeningBalance(Entity):
    """An employee's opening entitlement for one allocation year."""

    employee_id: UUID
    balance_year: int
    opening_days: Decimal
    opening_amount: Decimal
    maximum_payout: Decimal


@dataclass(slots=True, kw_only=True)
class Ticket(Entity):
    """Leave-travel ticket and its excess recovery state."""

    employee_id: UUID
    travel_date: date
    ticket_cost: Decimal
    entitlement: Decimal
    company_paid: Decimal
    status: TicketStatus = TicketStatus.DRAFT
    attachment_ids: tuple[UUID, ...] = ()

    @property
    def excess_amount(self) -> Decimal:
        """Return company-paid cost above entitlement."""
        return max(Decimal("0.00"), self.company_paid - self.entitlement)


@dataclass(slots=True, kw_only=True)
class Loan(Entity):
    """Recoverable employee loan with deterministic EMI state."""

    employee_id: UUID
    principal: Decimal
    annual_rate: Decimal
    installments: int
    outstanding: Decimal
    status: LoanStatus = LoanStatus.ACTIVE
    deferred_until: date | None = None

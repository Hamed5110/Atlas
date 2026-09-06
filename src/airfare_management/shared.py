"""Shared result, money, clock, and correlation primitives."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Generic, Protocol, TypeVar
from uuid import UUID, uuid4

T = TypeVar("T")
E = TypeVar("E")
CENT = Decimal("0.01")


@dataclass(frozen=True, slots=True)
class Result(Generic[T, E]):
    """Typed success-or-error result without exception-driven branching."""

    value: T | None = None
    error: E | None = None

    @property
    def is_ok(self) -> bool:
        """Return whether this result contains a successful value."""
        return self.error is None

    @classmethod
    def ok(cls, value: T) -> Result[T, E]:
        """Create a successful result."""
        return cls(value=value)

    @classmethod
    def fail(cls, error: E) -> Result[T, E]:
        """Create a failed result."""
        return cls(error=error)

    def unwrap(self) -> T:
        """Return the value or raise the contained exception."""
        if self.error is not None:
            if isinstance(self.error, Exception):
                raise self.error
            raise RuntimeError(str(self.error))
        if self.value is None:
            raise RuntimeError("A successful result must contain a value.")
        return self.value


@dataclass(frozen=True, slots=True)
class Money:
    """Decimal monetary value rounded with banker's rounding."""

    amount: Decimal
    currency: str = "BHD"

    def __post_init__(self) -> None:
        """Normalize precision and ISO currency representation."""
        if not self.amount.is_finite():
            raise ValueError("Money must be finite.")
        currency = self.currency.strip().upper()
        if len(currency) != 3 or not currency.isalpha():
            raise ValueError("Currency must be a three-letter ISO code.")
        object.__setattr__(self, "amount", self.amount.quantize(CENT, rounding=ROUND_HALF_EVEN))
        object.__setattr__(self, "currency", currency)

    def add(self, other: Money) -> Money:
        """Add money values having the same currency."""
        self._require_currency(other)
        return Money(self.amount + other.amount, self.currency)

    def subtract(self, other: Money) -> Money:
        """Subtract money values having the same currency."""
        self._require_currency(other)
        return Money(self.amount - other.amount, self.currency)

    def _require_currency(self, other: Money) -> None:
        if self.currency != other.currency:
            raise ValueError("Money currencies must match.")


class Clock(Protocol):
    """UTC clock abstraction for deterministic application services."""

    def now(self) -> datetime:
        """Return a timezone-aware UTC timestamp."""


class SystemClock:
    """Production UTC clock."""

    def now(self) -> datetime:
        """Return the current timezone-aware UTC timestamp."""
        return datetime.now(UTC)


def correlation_id(value: str | None = None) -> str:
    """Return a validated correlation identifier."""
    if value:
        candidate = value.strip()
        if 1 <= len(candidate) <= 64 and all(
            character.isalnum() or character in "-_." for character in candidate
        ):
            return candidate
    return str(uuid4())


def parse_uuid(value: str) -> UUID:
    """Parse a UUID while keeping validation in the shared boundary."""
    return UUID(value)

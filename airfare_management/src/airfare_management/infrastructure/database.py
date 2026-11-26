"""SQLAlchemy 2 persistence, repositories, auditing, and unit of work."""

from collections.abc import Sequence
from contextvars import ContextVar
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, Date, DateTime, Integer, String, Uuid, create_engine, event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from airfare_management.application.contracts import Repository, UnitOfWork
from airfare_management.config import Settings
from airfare_management.domain.models import Employee

actor_context: ContextVar[str | None] = ContextVar("actor_context", default=None)
correlation_context: ContextVar[str | None] = ContextVar("correlation_context", default=None)


class Base(DeclarativeBase):
    """Declarative model base."""


class EmployeeRow(Base):
    """Relational employee record with soft-delete and row version."""

    __tablename__ = "employees"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    company_id: Mapped[UUID] = mapped_column(Uuid, nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(30), nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    join_date: Mapped[date] = mapped_column(Date, nullable=False)
    department: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    branch: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    email: Mapped[str | None] = mapped_column(String(320))
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __mapper_args__ = {"version_id_col": version}


class AuditRow(Base):
    """Append-only application audit event."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actor_id: Mapped[str | None] = mapped_column(String(36))
    correlation_id: Mapped[str | None] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)


def create_session_factory(settings: Settings) -> sessionmaker[Session]:
    """Create the configured SQLAlchemy session factory.

    Args:
        settings: Validated process settings.

    Returns:
        Session factory with connection pre-ping enabled.
    """
    engine: Engine = create_engine(settings.database_url, pool_pre_ping=True)
    return sessionmaker(engine, expire_on_commit=False)


class EmployeeRepository(Repository[Employee]):
    """SQLAlchemy implementation of the employee repository."""

    def __init__(self, session: Session) -> None:
        """Initialize with an active session."""
        self._session = session

    def get(self, entity_id: UUID) -> Employee | None:
        """Find an active employee by identifier."""
        row = self._session.scalar(
            select(EmployeeRow).where(EmployeeRow.id == entity_id, EmployeeRow.deleted_at.is_(None))
        )
        return self._to_domain(row) if row else None

    def list(self, *, limit: int = 100, offset: int = 0) -> Sequence[Employee]:
        """List active employees using bounded pagination."""
        rows = self._session.scalars(
            select(EmployeeRow)
            .where(EmployeeRow.deleted_at.is_(None))
            .order_by(EmployeeRow.code)
            .limit(min(limit, 500))
            .offset(max(offset, 0))
        )
        return tuple(self._to_domain(row) for row in rows)

    def add(self, entity: Employee) -> None:
        """Stage a new employee."""
        self._session.add(
            EmployeeRow(
                id=entity.id,
                company_id=entity.company_id,
                code=entity.code,
                full_name=entity.full_name,
                join_date=entity.join_date,
                department=entity.department,
                branch=entity.branch,
                email=entity.email,
                active=entity.active,
                version=entity.version,
                created_at=entity.created_at,
                updated_at=entity.updated_at,
                deleted_at=entity.deleted_at,
            )
        )

    @staticmethod
    def _to_domain(row: EmployeeRow) -> Employee:
        return Employee(
            id=row.id,
            company_id=row.company_id,
            code=row.code,
            full_name=row.full_name,
            join_date=row.join_date,
            department=row.department,
            branch=row.branch,
            email=row.email,
            active=row.active,
            version=row.version,
            created_at=row.created_at.replace(tzinfo=UTC)
            if row.created_at.tzinfo is None
            else row.created_at,
            updated_at=row.updated_at.replace(tzinfo=UTC)
            if row.updated_at.tzinfo is None
            else row.updated_at,
            deleted_at=row.deleted_at,
        )


class SqlAlchemyUnitOfWork(UnitOfWork):
    """SQLAlchemy transaction boundary."""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        """Initialize a unit-of-work factory dependency."""
        self._session_factory = session_factory
        self.session: Session | None = None
        self.employees: Repository[Employee]

    def __enter__(self) -> "SqlAlchemyUnitOfWork":
        """Open a transaction and repositories."""
        self.session = self._session_factory()
        self.employees = EmployeeRepository(self.session)
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        """Roll back failed work and close the session."""
        assert self.session is not None
        if exc is not None:
            self.session.rollback()
        self.session.close()

    def commit(self) -> None:
        """Commit the current transaction."""
        assert self.session is not None
        self.session.commit()


@event.listens_for(Session, "before_flush")
def append_audit_rows(session: Session, flush_context: object, instances: object) -> None:
    """Append metadata-only audit rows for changed mapped records."""
    for action, records in (
        ("insert", session.new),
        ("update", session.dirty),
        ("delete", session.deleted),
    ):
        for record in tuple(records):
            if isinstance(record, (AuditRow,)):
                continue
            identity: Any = getattr(record, "id", "")
            session.add(
                AuditRow(
                    occurred_at=datetime.now(UTC),
                    actor_id=actor_context.get(),
                    correlation_id=correlation_context.get(),
                    action=action,
                    entity_type=type(record).__name__,
                    entity_id=str(identity),
                )
            )

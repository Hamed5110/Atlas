"""Complete SQLAlchemy 2 relational schema for operational modules."""

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    Uuid,
    event,
    func,
    select,
    text,
)
from sqlalchemy.orm import Mapped, Session, mapped_column

from airfare_management.infrastructure.database import Base


def new_id() -> str:
    """Return a portable UUID string."""
    return str(uuid4())


def utc_now() -> datetime:
    """Return the current timezone-aware UTC timestamp."""
    return datetime.now(UTC)


def format_display_code(prefix: str, number: int | None) -> str | None:
    """Return a human-readable T-000123 / L-000045 style code."""
    if number is None:
        return None
    return f"{prefix}-{int(number):06d}"


class CompanyRow(Base):
    """Employing company."""

    __tablename__ = "companies"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    created_by: Mapped[str | None] = mapped_column(String(36))
    updated_by: Mapped[str | None] = mapped_column(String(36))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class UserRow(Base):
    """Authenticated application user."""

    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    roles: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    created_by: Mapped[str | None] = mapped_column(String(36))
    updated_by: Mapped[str | None] = mapped_column(String(36))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    employee_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("employees.id", ondelete="NO ACTION", onupdate="CASCADE"),
        index=True,
    )
    company_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("companies.id", ondelete="NO ACTION", onupdate="CASCADE"),
        index=True,
    )


class OpeningBalanceRow(Base):
    """Opening employee entitlement balance."""

    __tablename__ = "opening_balances"
    __table_args__ = (
        Index(
            "uq_opening_balances_active",
            "employee_id",
            "balance_year",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    employee_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("employees.id"), nullable=False, index=True
    )
    balance_year: Mapped[int] = mapped_column(Integer, nullable=False)
    opening_days: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    paid_days: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=Decimal("0"))
    opening_amount: Mapped[Decimal] = mapped_column(Numeric(19, 4), nullable=False)
    maximum_payout: Mapped[Decimal] = mapped_column(Numeric(19, 4), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    created_by: Mapped[str | None] = mapped_column(String(36))
    updated_by: Mapped[str | None] = mapped_column(String(36))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TicketRow(Base):
    """Travel ticket and approval workflow."""

    __tablename__ = "tickets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    employee_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("employees.id"), nullable=False, index=True
    )
    travel_date: Mapped[date] = mapped_column(Date, nullable=False)
    origin_code: Mapped[str] = mapped_column(String(3), nullable=False)
    destination_code: Mapped[str] = mapped_column(String(3), nullable=False)
    ticket_cost: Mapped[Decimal] = mapped_column(Numeric(19, 4), nullable=False)
    entitlement: Mapped[Decimal] = mapped_column(Numeric(19, 4), nullable=False)
    company_paid: Mapped[Decimal] = mapped_column(Numeric(19, 4), nullable=False)
    excess_handling: Mapped[str] = mapped_column(String(30), default="SELF_PAID", nullable=False)
    scenario: Mapped[str | None] = mapped_column(String(40))
    accrued_days: Mapped[Decimal | None] = mapped_column(Numeric(19, 8))
    daily_rate: Mapped[Decimal | None] = mapped_column(Numeric(19, 10))
    airfare_rate: Mapped[Decimal | None] = mapped_column(Numeric(19, 4))
    rate_source: Mapped[str | None] = mapped_column(String(20))
    excess_cost: Mapped[Decimal] = mapped_column(
        Numeric(19, 4), default=Decimal("0"), server_default="0", nullable=False
    )
    employee_payable: Mapped[Decimal] = mapped_column(
        Numeric(19, 4), default=Decimal("0"), server_default="0", nullable=False
    )
    company_payout: Mapped[Decimal] = mapped_column(
        Numeric(19, 4), default=Decimal("0"), server_default="0", nullable=False
    )
    last_ticket_date: Mapped[date | None] = mapped_column(Date)
    as_of_date: Mapped[date | None] = mapped_column(Date)
    tenure_months: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    ticket_number: Mapped[int | None] = mapped_column(Integer, unique=True, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    created_by: Mapped[str | None] = mapped_column(String(36))
    updated_by: Mapped[str | None] = mapped_column(String(36))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def excess_amount(self) -> Decimal:
        """Return amount recoverable from the employee."""
        return max(Decimal("0"), self.company_paid - self.entitlement)

    @property
    def ticket_code(self) -> str | None:
        """Return the sequential ticket display code."""
        return format_display_code("T", self.ticket_number)


class LoanRow(Base):
    """Employee recoverable loan."""

    __tablename__ = "loans"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    employee_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("employees.id"), nullable=False, index=True
    )
    source_ticket_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tickets.id"))
    principal: Mapped[Decimal] = mapped_column(Numeric(19, 4), nullable=False)
    annual_rate: Mapped[Decimal] = mapped_column(Numeric(9, 6), nullable=False)
    installments: Mapped[int] = mapped_column(Integer, nullable=False)
    monthly_installment: Mapped[Decimal] = mapped_column(Numeric(19, 4), nullable=False)
    outstanding: Mapped[Decimal] = mapped_column(Numeric(19, 4), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    deferred_until: Mapped[date | None] = mapped_column(Date)
    first_due_date: Mapped[date] = mapped_column(Date, nullable=False)
    loan_number: Mapped[int | None] = mapped_column(Integer, unique=True, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    created_by: Mapped[str | None] = mapped_column(String(36))
    updated_by: Mapped[str | None] = mapped_column(String(36))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def loan_code(self) -> str | None:
        """Return the sequential loan display code."""
        return format_display_code("L", self.loan_number)


class LoanPaymentRow(Base):
    """Posted recovery against a loan."""

    __tablename__ = "loan_payments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    loan_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("loans.id"), nullable=False, index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(19, 4), nullable=False)
    paid_on: Mapped[date] = mapped_column(Date, nullable=False)
    reference: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    created_by: Mapped[str | None] = mapped_column(String(36))
    updated_by: Mapped[str | None] = mapped_column(String(36))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class LoanInstallmentRow(Base):
    """Persisted reducing-balance EMI installment."""

    __tablename__ = "loan_installments"
    __table_args__ = (
        Index(
            "uq_loan_installments_active",
            "loan_id",
            "number",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    loan_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("loans.id"), nullable=False, index=True
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    opening_balance: Mapped[Decimal] = mapped_column(Numeric(19, 4), nullable=False)
    principal: Mapped[Decimal] = mapped_column(Numeric(19, 4), nullable=False)
    interest: Mapped[Decimal] = mapped_column(Numeric(19, 4), nullable=False)
    payment: Mapped[Decimal] = mapped_column(Numeric(19, 4), nullable=False)
    closing_balance: Mapped[Decimal] = mapped_column(Numeric(19, 4), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    created_by: Mapped[str | None] = mapped_column(String(36))
    updated_by: Mapped[str | None] = mapped_column(String(36))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class PreferenceRow(Base):
    """One preference layer value."""

    __tablename__ = "preferences"
    __table_args__ = (
        Index(
            "uq_preferences_active",
            "scope_type",
            "scope_id",
            "preference_key",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    scope_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    scope_id: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    preference_key: Mapped[str] = mapped_column(String(200), nullable=False)
    value: Mapped[object] = mapped_column(JSON, nullable=False)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    created_by: Mapped[str | None] = mapped_column(String(36))
    updated_by: Mapped[str | None] = mapped_column(String(36))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AttachmentRow(Base):
    """Attachment metadata and MSSQL-backed binary content."""

    __tablename__ = "attachments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), unique=True, nullable=False)
    content: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    scan_status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    created_by: Mapped[str | None] = mapped_column(String(36))
    updated_by: Mapped[str | None] = mapped_column(String(36))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class RefreshTokenRow(Base):
    """Rotating refresh-token family member with reuse detection."""

    __tablename__ = "refresh_tokens"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="NO ACTION", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    family_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    session_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    created_by: Mapped[str | None] = mapped_column(String(36))
    updated_by: Mapped[str | None] = mapped_column(String(36))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class PasswordHistoryRow(Base):
    """Historical password hash preventing credential reuse."""

    __tablename__ = "password_history"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="NO ACTION", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    created_by: Mapped[str | None] = mapped_column(String(36))
    updated_by: Mapped[str | None] = mapped_column(String(36))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class LookupRow(Base):
    """Reference value used by employee and policy forms."""

    __tablename__ = "lookups"
    __table_args__ = (
        Index(
            "uq_lookups_active",
            "lookup_type",
            "code",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    lookup_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    created_by: Mapped[str | None] = mapped_column(String(36))
    updated_by: Mapped[str | None] = mapped_column(String(36))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class EntitlementRateRow(Base):
    """Effective-dated entitlement rate at a cascade scope."""

    __tablename__ = "entitlement_rates"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    scope_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    scope_id: Mapped[str] = mapped_column(String(100), default="", nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(19, 4), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    effective_to: Mapped[date | None] = mapped_column(Date, index=True)
    cap_amount: Mapped[Decimal | None] = mapped_column(Numeric(19, 4))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    created_by: Mapped[str | None] = mapped_column(String(36))
    updated_by: Mapped[str | None] = mapped_column(String(36))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class EssRequestRow(Base):
    """Employee self-service airfare request and status tracker."""

    __tablename__ = "ess_requests"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    employee_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("employees.id", ondelete="NO ACTION", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    request_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    travel_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    origin_code: Mapped[str] = mapped_column(String(3), nullable=False)
    destination_code: Mapped[str] = mapped_column(String(3), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="submitted", nullable=False, index=True)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    created_by: Mapped[str | None] = mapped_column(String(36))
    updated_by: Mapped[str | None] = mapped_column(String(36))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


def _assign_sequence(session: Session, model: type[object], attr: str) -> None:
    """Give pending rows the next integer display number in this flush."""
    pending = [obj for obj in session.new if isinstance(obj, model) and getattr(obj, attr) is None]
    if not pending:
        return
    column = getattr(model, attr)
    current = session.scalar(select(func.coalesce(func.max(column), 0))) or 0
    current = int(current)
    for obj in pending:
        current += 1
        setattr(obj, attr, current)


@event.listens_for(Session, "before_flush")
def assign_ticket_and_loan_numbers(
    session: Session, flush_context: object, instances: object
) -> None:
    """Auto-increment ticket_number and loan_number without UUID display IDs."""
    _ = flush_context, instances
    _assign_sequence(session, TicketRow, "ticket_number")
    _assign_sequence(session, LoanRow, "loan_number")

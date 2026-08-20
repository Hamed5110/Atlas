"""Store attachment blobs, employee rate fields, EMI schedule, and tenant scope.

Revision ID: 0004_blobs_rates
Revises: 0003_enterprise
Create Date: 2026-08-17
"""

from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa
from alembic import op

from airfare_management.infrastructure.schema import LoanInstallmentRow

revision: str = "0004_blobs_rates"
down_revision: str | None = "0004_allocation_engine"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _add_missing(table: str, columns: tuple[sa.Column[object], ...]) -> None:
    """Add columns absent from an installation upgraded from earlier revisions."""
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns(table)}
    for column in columns:
        if column.name not in existing:
            op.add_column(table, column)


def _backfill_attachment_blobs() -> None:
    """Copy leftover filesystem attachments into MSSQL VARBINARY storage."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("attachments")}
    if "content" not in columns:
        return
    root = Path("./var/attachments")
    rows = bind.execute(sa.text("SELECT id, storage_key, content FROM attachments")).mappings()
    for row in rows:
        if row["content"]:
            continue
        candidate = root / str(row["storage_key"])
        payload = candidate.read_bytes() if candidate.is_file() else b""
        bind.execute(
            sa.text("UPDATE attachments SET content = :content WHERE id = :id"),
            {"content": payload, "id": row["id"]},
        )


def upgrade() -> None:
    """Add blob storage, rate hierarchy fields, EMI rows, and company scope."""
    bind = op.get_bind()
    LoanInstallmentRow.__table__.create(bind=bind, checkfirst=True)
    _add_missing(
        "attachments",
        (sa.Column("content", sa.LargeBinary(), nullable=True),),
    )
    _backfill_attachment_blobs()
    _add_missing(
        "employees",
        (
            sa.Column("pay_group", sa.String(100), nullable=False, server_default=""),
            sa.Column("repair_center", sa.String(100), nullable=False, server_default=""),
            sa.Column("custom_airfare_rate", sa.Numeric(19, 4)),
            sa.Column("max_entitlement_cap_rate", sa.Numeric(19, 4)),
        ),
    )
    _add_missing(
        "users",
        (sa.Column("company_id", sa.String(36)),),
    )
    _add_missing(
        "tickets",
        (
            sa.Column("scenario", sa.String(40)),
            sa.Column("accrued_days", sa.Numeric(19, 8)),
            sa.Column("daily_rate", sa.Numeric(19, 10)),
            sa.Column("airfare_rate", sa.Numeric(19, 4)),
            sa.Column("rate_source", sa.String(20)),
            sa.Column("excess_cost", sa.Numeric(19, 4), nullable=False, server_default="0"),
            sa.Column("employee_payable", sa.Numeric(19, 4), nullable=False, server_default="0"),
            sa.Column("company_payout", sa.Numeric(19, 4), nullable=False, server_default="0"),
            sa.Column("last_ticket_date", sa.Date()),
            sa.Column("as_of_date", sa.Date()),
            sa.Column("tenure_months", sa.Integer()),
        ),
    )


def downgrade() -> None:
    """Drop tables introduced by this revision."""
    bind = op.get_bind()
    LoanInstallmentRow.__table__.drop(bind=bind, checkfirst=True)

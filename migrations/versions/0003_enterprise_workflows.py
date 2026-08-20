"""Add enterprise security, reference, rates, and ESS workflows.

Revision ID: 0003_enterprise
Revises: 0002_operational
Create Date: 2026-08-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from airfare_management.infrastructure.schema import (
    EntitlementRateRow,
    EssRequestRow,
    LookupRow,
    PasswordHistoryRow,
    RefreshTokenRow,
)

revision: str = "0003_enterprise"
down_revision: str | None = "0002_operational"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_TABLES = (
    RefreshTokenRow.__table__,
    PasswordHistoryRow.__table__,
    LookupRow.__table__,
    EntitlementRateRow.__table__,
    EssRequestRow.__table__,
)


def _add_missing(table: str, columns: tuple[sa.Column[object], ...]) -> None:
    """Add columns absent from an installation upgraded from revision 0002."""
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns(table)}
    for column in columns:
        if column.name not in existing:
            op.add_column(table, column)


def upgrade() -> None:
    """Create security and workflow tables and enrich operational auditing."""
    bind = op.get_bind()
    for table in NEW_TABLES:
        table.create(bind=bind, checkfirst=True)

    audit_columns = (
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.Column("created_by", sa.String(36)),
        sa.Column("updated_by", sa.String(36)),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )
    for table in ("companies", "users", "loan_payments", "attachments"):
        _add_missing(table, audit_columns)
    _add_missing(
        "opening_balances",
        (
            sa.Column("created_by", sa.String(36)),
            sa.Column("updated_by", sa.String(36)),
            sa.Column("deleted_at", sa.DateTime(timezone=True)),
        ),
    )
    for table in ("tickets", "loans"):
        _add_missing(
            table,
            (
                sa.Column("created_by", sa.String(36)),
                sa.Column("updated_by", sa.String(36)),
                sa.Column("deleted_at", sa.DateTime(timezone=True)),
            ),
        )
    _add_missing(
        "tickets",
        (
            sa.Column(
                "excess_handling",
                sa.String(30),
                nullable=False,
                server_default="SELF_PAID",
            ),
        ),
    )
    _add_missing(
        "preferences",
        (
            sa.Column("created_at", sa.DateTime(timezone=True)),
            sa.Column("created_by", sa.String(36)),
            sa.Column("updated_by", sa.String(36)),
            sa.Column("deleted_at", sa.DateTime(timezone=True)),
        ),
    )
    _add_missing(
        "employees",
        (
            sa.Column("created_by", sa.String(36)),
            sa.Column("updated_by", sa.String(36)),
        ),
    )
    _add_missing(
        "users",
        (
            sa.Column("failed_login_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("locked_until", sa.DateTime(timezone=True)),
            sa.Column("employee_id", sa.Uuid()),
        ),
    )
    _add_missing(
        "audit_log",
        (
            sa.Column("ip_address", sa.String(64)),
            sa.Column("session_id", sa.String(36)),
            sa.Column("changes", sa.JSON(), nullable=False, server_default="{}"),
        ),
    )


def downgrade() -> None:
    """Drop tables introduced by this revision."""
    bind = op.get_bind()
    for table in reversed(NEW_TABLES):
        table.drop(bind=bind, checkfirst=True)

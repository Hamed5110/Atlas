"""Create initial employee and audit tables and seed reference data.

Revision ID: 0001_initial
Revises:
Create Date: 2026-08-16
"""

from collections.abc import Sequence
from datetime import UTC, date, datetime
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SEED_COMPANY = UUID("11111111-1111-1111-1111-111111111111")
SEED_EMPLOYEE = UUID("22222222-2222-2222-2222-222222222222")


def upgrade() -> None:
    """Create the portable ORM baseline and deterministic reference seed."""
    op.create_table(
        "employees",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(30), nullable=False),
        sa.Column("full_name", sa.String(200), nullable=False),
        sa.Column("join_date", sa.Date(), nullable=False),
        sa.Column("department", sa.String(100), server_default="", nullable=False),
        sa.Column("branch", sa.String(100), server_default="", nullable=False),
        sa.Column("email", sa.String(320)),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("version > 0", name="ck_employees_version"),
    )
    op.create_index(
        "ux_employees_company_code_active",
        "employees",
        ["company_id", "code"],
        unique=True,
        mssql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_id", sa.String(36)),
        sa.Column("correlation_id", sa.String(64)),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("entity_type", sa.String(100), nullable=False),
        sa.Column("entity_id", sa.String(36), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_log_correlation", "audit_log", ["correlation_id"])
    now = datetime(2026, 1, 1, tzinfo=UTC)
    employees = sa.table(
        "employees",
        sa.column("id", sa.Uuid()),
        sa.column("company_id", sa.Uuid()),
        sa.column("code", sa.String()),
        sa.column("full_name", sa.String()),
        sa.column("join_date", sa.Date()),
        sa.column("department", sa.String()),
        sa.column("branch", sa.String()),
        sa.column("email", sa.String()),
        sa.column("active", sa.Boolean()),
        sa.column("version", sa.Integer()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
        sa.column("deleted_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(
        employees,
        [
            {
                "id": SEED_EMPLOYEE,
                "company_id": SEED_COMPANY,
                "code": "E0001",
                "full_name": "Reference Employee",
                "join_date": date(2026, 1, 1),
                "department": "HR",
                "branch": "Head Office",
                "email": "reference.employee@example.com",
                "active": True,
                "version": 1,
                "created_at": now,
                "updated_at": now,
                "deleted_at": None,
            }
        ],
    )


def downgrade() -> None:
    """Drop the initial schema in reverse dependency order."""
    op.drop_index("ix_audit_log_correlation", table_name="audit_log")
    op.drop_table("audit_log")
    op.drop_index("ux_employees_company_code_active", table_name="employees")
    op.drop_table("employees")

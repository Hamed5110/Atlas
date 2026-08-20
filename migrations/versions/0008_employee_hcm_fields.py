"""Add HCM employee lookup fields for MSSQL-backed UI dropdowns.

Revision ID: 0008_employee_hcm_fields
Revises: 0007_ticket_loan_numbers
Create Date: 2026-08-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_employee_hcm_fields"
down_revision: str | None = "0007_ticket_loan_numbers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _add_missing(table: str, columns: tuple[sa.Column[object], ...]) -> None:
    """Add columns absent from an existing database."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns(table)}
    for column in columns:
        if column.name not in existing:
            op.add_column(table, column)


def upgrade() -> None:
    """Persist designation, nationality, sub-section, and reporting officer."""
    _add_missing(
        "employees",
        (
            sa.Column("designation", sa.String(100), server_default="", nullable=False),
            sa.Column("nationality", sa.String(100), server_default="", nullable=False),
            sa.Column("sub_section", sa.String(100), server_default="", nullable=False),
            sa.Column("reporting_officer_id", sa.String(36)),
        ),
    )


def downgrade() -> None:
    """Drop HCM employee lookup columns when present."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "employees" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("employees")}
    for name in ("reporting_officer_id", "sub_section", "nationality", "designation"):
        if name in existing:
            op.drop_column("employees", name)

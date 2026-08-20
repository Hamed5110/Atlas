"""Add allocation-engine columns for 365-day rate hierarchy and excess settlement.

Revision ID: 0004_allocation_engine
Revises: 0003_enterprise
Create Date: 2026-08-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_allocation_engine"
down_revision: str | None = "0003_enterprise"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _add_missing(table: str, columns: tuple[sa.Column[object], ...]) -> None:
    """Add columns absent from an existing database."""
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns(table)}
    for column in columns:
        if column.name not in existing:
            op.add_column(table, column)


def upgrade() -> None:
    """Persist rate hierarchy, last-ticket accrual, caps, and excess settlement."""
    _add_missing(
        "users",
        (sa.Column("company_id", sa.String(36)),),
    )
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
    """Drop allocation-engine columns."""
    for column in (
        "tenure_months",
        "as_of_date",
        "last_ticket_date",
        "company_payout",
        "employee_payable",
        "excess_cost",
        "rate_source",
        "airfare_rate",
        "daily_rate",
        "accrued_days",
        "scenario",
    ):
        op.drop_column("tickets", column)
    for column in (
        "max_entitlement_cap_rate",
        "custom_airfare_rate",
        "repair_center",
        "pay_group",
    ):
        op.drop_column("employees", column)

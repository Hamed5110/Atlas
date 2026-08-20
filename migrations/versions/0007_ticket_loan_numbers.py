"""Add sequential display numbers for tickets and loans.

Revision ID: 0007_ticket_loan_numbers
Revises: 0006_users_company_fk
Create Date: 2026-08-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_ticket_loan_numbers"
down_revision: str | None = "0006_users_company_fk"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _add_missing(table: str, columns: tuple[sa.Column[object], ...]) -> None:
    """Add columns absent from an existing database."""
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns(table)}
    for column in columns:
        if column.name not in existing:
            op.add_column(table, column)


def _backfill_numbers(table: str, column: str) -> None:
    """Assign MAX+1 sequential numbers to existing rows."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return
    names = {item["name"] for item in inspector.get_columns(table)}
    if column not in names:
        return
    current = bind.execute(sa.text(f"SELECT MAX({column}) FROM {table}")).scalar() or 0
    rows = bind.execute(
        sa.text(
            f"SELECT id FROM {table} WHERE {column} IS NULL ORDER BY created_at, id"
        )
    ).fetchall()
    for row in rows:
        current = int(current) + 1
        bind.execute(
            sa.text(f"UPDATE {table} SET {column} = :number WHERE id = :id"),
            {"number": current, "id": row[0]},
        )


def _unique_index(table: str, columns: list[str], name: str) -> None:
    """Create a unique index when the table exists and the index does not."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return
    existing = {index["name"] for index in inspector.get_indexes(table)}
    if name not in existing:
        op.create_index(name, table, columns, unique=True)


def upgrade() -> None:
    """Store human-readable ticket and loan numbers beside UUID primary keys."""
    _add_missing("tickets", (sa.Column("ticket_number", sa.Integer()),))
    _add_missing("loans", (sa.Column("loan_number", sa.Integer()),))
    _backfill_numbers("tickets", "ticket_number")
    _backfill_numbers("loans", "loan_number")
    _unique_index("tickets", ["ticket_number"], "ix_tickets_ticket_number")
    _unique_index("loans", ["loan_number"], "ix_loans_loan_number")


def downgrade() -> None:
    """Drop sequential display numbers."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table, index_name, column in (
        ("tickets", "ix_tickets_ticket_number", "ticket_number"),
        ("loans", "ix_loans_loan_number", "loan_number"),
    ):
        if table not in inspector.get_table_names():
            continue
        existing = {item["name"] for item in inspector.get_indexes(table)}
        if index_name in existing:
            op.drop_index(index_name, table_name=table)
        columns = {item["name"] for item in inspector.get_columns(table)}
        if column in columns:
            op.drop_column(table, column)

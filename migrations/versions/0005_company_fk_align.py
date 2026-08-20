"""Align employees.company_id with companies.id and add the FK.

Revision ID: 0005_company_fk
Revises: 0004_blobs_rates
Create Date: 2026-08-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_company_fk"
down_revision: str | None = "0004_blobs_rates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Convert UNIQUEIDENTIFIER company_id to VARCHAR(36) and add FK."""
    bind = op.get_bind()
    dialect = bind.dialect.name
    inspector = sa.inspect(bind)
    columns = {column["name"]: column for column in inspector.get_columns("employees")}
    company_col = columns.get("company_id")
    if company_col is None:
        return
    type_name = type(company_col["type"]).__name__.lower()
    raw = str(company_col["type"]).lower()
    needs_convert = "uuid" in type_name or "uniqueidentifier" in raw
    existing_fks = {fk["name"] for fk in inspector.get_foreign_keys("employees") if fk.get("name")}
    fk_name = "fk_employees_company_id_companies"
    dropped_indexes: list[tuple[str, bool, list[str]]] = []
    if dialect == "mssql" and needs_convert:
        for index in inspector.get_indexes("employees"):
            if "company_id" in index.get("column_names", []):
                dropped_indexes.append(
                    (
                        index["name"],
                        bool(index.get("unique")),
                        list(index.get("column_names") or []),
                    )
                )
                op.drop_index(index["name"], table_name="employees")
        op.execute(
            sa.text(
                "ALTER TABLE employees ALTER COLUMN company_id "
                "VARCHAR(36) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL"
            )
        )
        for name, unique, cols in dropped_indexes:
            op.create_index(name, "employees", cols, unique=unique)
    elif dialect != "mssql" and needs_convert:
        with op.batch_alter_table("employees") as batch:
            batch.alter_column(
                "company_id",
                existing_type=sa.Uuid(),
                type_=sa.String(36),
                existing_nullable=False,
            )
    if fk_name not in existing_fks:
        op.create_foreign_key(
            fk_name,
            "employees",
            "companies",
            ["company_id"],
            ["id"],
            ondelete="NO ACTION",
            onupdate="CASCADE",
        )


def downgrade() -> None:
    """Drop the company FK; leave VARCHAR storage in place."""
    op.drop_constraint("fk_employees_company_id_companies", "employees", type_="foreignkey")

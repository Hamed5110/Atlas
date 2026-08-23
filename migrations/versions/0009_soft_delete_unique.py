"""Replace soft-delete-blind unique constraints with filtered unique indexes.

Revision ID: 0009_soft_delete_unique
Revises: 0008_employee_hcm_fields
Create Date: 2026-08-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_soft_delete_unique"
down_revision: str | None = "0008_employee_hcm_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _drop_unique_if_exists(table: str, *candidate_names: str) -> None:
    """Drop legacy unique indexes/constraints when present."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return
    dialect = bind.dialect.name
    existing_indexes = {index["name"] for index in inspector.get_indexes(table)}
    unique_names: set[str] = set()
    if dialect != "mssql":
        unique_names = {uc["name"] for uc in inspector.get_unique_constraints(table)}
    for name in candidate_names:
        if name in existing_indexes:
            op.drop_index(name, table_name=table)
            continue
        if name in unique_names:
            op.drop_constraint(name, table_name=table, type_="unique")
            continue
        if dialect == "mssql":
            op.execute(
                sa.text(
                    f"""
                    IF EXISTS (
                        SELECT 1 FROM sys.indexes
                        WHERE name = N'{name}' AND object_id = OBJECT_ID(N'{table}')
                    )
                    DROP INDEX [{name}] ON [{table}]
                    """
                )
            )
            op.execute(
                sa.text(
                    f"""
                    IF EXISTS (
                        SELECT 1 FROM sys.key_constraints
                        WHERE name = N'{name}' AND parent_object_id = OBJECT_ID(N'{table}')
                    )
                    ALTER TABLE [{table}] DROP CONSTRAINT [{name}]
                    """
                )
            )


def upgrade() -> None:
    """Create filtered unique indexes that ignore soft-deleted rows."""
    _drop_unique_if_exists(
        "opening_balances",
        "uq_opening_balances_employee_id_balance_year",
        "opening_balances_employee_id_balance_year_key",
    )
    _drop_unique_if_exists(
        "loan_installments",
        "uq_loan_installments_loan_id_number",
        "loan_installments_loan_id_number_key",
    )
    _drop_unique_if_exists(
        "preferences",
        "uq_preferences_scope_type_scope_id_preference_key",
        "preferences_scope_type_scope_id_preference_key_key",
    )
    _drop_unique_if_exists(
        "lookups",
        "uq_lookups_lookup_type_code",
        "lookups_lookup_type_code_key",
    )

    dialect = op.get_bind().dialect.name
    if dialect == "mssql":
        op.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_opening_balances_active')
            CREATE UNIQUE INDEX uq_opening_balances_active
            ON opening_balances (employee_id, balance_year)
            WHERE deleted_at IS NULL
            """
        )
        op.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_loan_installments_active')
            CREATE UNIQUE INDEX uq_loan_installments_active
            ON loan_installments (loan_id, number)
            WHERE deleted_at IS NULL
            """
        )
        op.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_preferences_active')
            CREATE UNIQUE INDEX uq_preferences_active
            ON preferences (scope_type, scope_id, preference_key)
            WHERE deleted_at IS NULL
            """
        )
        op.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_lookups_active')
            CREATE UNIQUE INDEX uq_lookups_active
            ON lookups (lookup_type, code)
            WHERE deleted_at IS NULL
            """
        )
        op.execute(
            """
            IF EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID('attachments') AND name = 'content' AND is_nullable = 0
            )
            ALTER TABLE attachments ALTER COLUMN content VARBINARY(MAX) NULL
            """
        )
    else:
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_opening_balances_active "
            "ON opening_balances (employee_id, balance_year) WHERE deleted_at IS NULL"
        )
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_installments_active "
            "ON loan_installments (loan_id, number) WHERE deleted_at IS NULL"
        )
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_preferences_active "
            "ON preferences (scope_type, scope_id, preference_key) WHERE deleted_at IS NULL"
        )
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_lookups_active "
            "ON lookups (lookup_type, code) WHERE deleted_at IS NULL"
        )


def downgrade() -> None:
    """Drop filtered indexes (unique constraints are not restored)."""
    for table, name in (
        ("opening_balances", "uq_opening_balances_active"),
        ("loan_installments", "uq_loan_installments_active"),
        ("preferences", "uq_preferences_active"),
        ("lookups", "uq_lookups_active"),
    ):
        try:
            op.drop_index(name, table_name=table)
        except Exception:  # noqa: BLE001
            pass

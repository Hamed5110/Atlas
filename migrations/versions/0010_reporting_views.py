"""Apply MSSQL reporting views, stored procedures, and reporting indexes.

Revision ID: 0010_reporting_views
Revises: 0009_soft_delete_unique
Create Date: 2026-08-22
"""

from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision: str = "0010_reporting_views"
down_revision: str | None = "0009_soft_delete_unique"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SQL_ROOT = Path(__file__).resolve().parents[2] / "sql"


def _run_mssql_script(relative_name: str) -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mssql":
        return
    script = (_SQL_ROOT / relative_name).read_text(encoding="utf-8")
    batches = [
        batch.strip()
        for batch in script.replace("\r\n", "\n").split("\nGO\n")
        if batch.strip()
    ]
    for batch in batches:
        op.execute(sa.text(batch))


def _create_reporting_indexes() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    if dialect == "mssql":
        op.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tickets_travel_date')
            CREATE INDEX ix_tickets_travel_date
            ON tickets (travel_date)
            INCLUDE (ticket_cost, company_paid, employee_payable, status)
            WHERE deleted_at IS NULL
            """
        )
        op.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_loans_status_next_due')
            CREATE INDEX ix_loans_status_next_due
            ON loans (status, first_due_date)
            INCLUDE (outstanding, principal)
            WHERE deleted_at IS NULL
            """
        )
        op.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_payments_loan_date')
            CREATE INDEX ix_payments_loan_date
            ON loan_payments (loan_id, paid_on)
            INCLUDE (amount)
            WHERE deleted_at IS NULL
            """
        )
        return

    inspector = sa.inspect(bind)
    existing = {
        index["name"]
        for table in ("tickets", "loans", "loan_payments")
        if table in inspector.get_table_names()
        for index in inspector.get_indexes(table)
    }
    if "ix_tickets_travel_date" not in existing and "tickets" in inspector.get_table_names():
        op.create_index(
            "ix_tickets_travel_date",
            "tickets",
            ["travel_date"],
            sqlite_where=sa.text("deleted_at IS NULL"),
        )
    if "ix_loans_status_next_due" not in existing and "loans" in inspector.get_table_names():
        op.create_index(
            "ix_loans_status_next_due",
            "loans",
            ["status", "first_due_date"],
            sqlite_where=sa.text("deleted_at IS NULL"),
        )
    if "ix_payments_loan_date" not in existing and "loan_payments" in inspector.get_table_names():
        op.create_index(
            "ix_payments_loan_date",
            "loan_payments",
            ["loan_id", "paid_on"],
            sqlite_where=sa.text("deleted_at IS NULL"),
        )


def upgrade() -> None:
    """Create reporting indexes (views/procedures applied via scripts/apply_reporting_sql.py)."""
    _create_reporting_indexes()


def downgrade() -> None:
    """Drop reporting objects and indexes."""
    bind = op.get_bind()
    if bind.dialect.name == "mssql":
        for name in (
            "sp_employee_soft_delete_cascade",
            "sp_post_loan_payment",
            "sp_recalculate_loan_schedule",
            "sp_restore_logical_json",
            "sp_backup_logical_json",
            "sp_export_report_excel",
            "sp_generate_report",
        ):
            op.execute(
                sa.text(
                    f"IF OBJECT_ID(N'dbo.{name}', N'P') IS NOT NULL "
                    f"DROP PROCEDURE dbo.{name}"
                )
            )
        for name in (
            "vw_ai_anomaly_flags",
            "vw_ess_request_tracker",
            "vw_preference_audit",
            "vw_excess_recovery",
            "vw_monthly_spend",
            "vw_loan_portfolio",
            "vw_ticket_ledger",
            "vw_employee_summary",
        ):
            op.execute(
                sa.text(
                    f"IF OBJECT_ID(N'dbo.{name}', N'V') IS NOT NULL DROP VIEW dbo.{name}"
                )
            )

    for index_name, table_name in (
        ("ix_payments_loan_date", "loan_payments"),
        ("ix_loans_status_next_due", "loans"),
        ("ix_tickets_travel_date", "tickets"),
    ):
        try:
            op.drop_index(index_name, table_name=table_name)
        except Exception:  # noqa: BLE001
            pass

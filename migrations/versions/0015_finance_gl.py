"""Finance GL: chart of accounts + balanced journals for tickets and loans.

Revision ID: 0015_finance_gl
Revises: 0014_local_workspace_catalog
Create Date: 2026-09-07

Native MSSQL double-entry ledger (patterned on python-accounting; that library
does not officially support MSSQL).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_finance_gl"
down_revision: str | None = "0014_local_workspace_catalog"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_exists(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _table_exists("finance_accounts"):
        op.create_table(
            "finance_accounts",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("company_id", sa.String(36), sa.ForeignKey("companies.id"), nullable=False),
            sa.Column("code", sa.String(20), nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("account_type", sa.String(20), nullable=False),
            sa.Column("currency", sa.String(3), server_default="BHD", nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_by", sa.String(36)),
            sa.Column("updated_by", sa.String(36)),
            sa.Column("deleted_at", sa.DateTime(timezone=True)),
            sa.UniqueConstraint("company_id", "code", name="uq_finance_accounts_company_code"),
        )
        op.create_index("ix_finance_accounts_company", "finance_accounts", ["company_id"])

    if not _table_exists("finance_journals"):
        op.create_table(
            "finance_journals",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("company_id", sa.String(36), sa.ForeignKey("companies.id"), nullable=False),
            sa.Column("entry_date", sa.Date(), nullable=False),
            sa.Column("narration", sa.String(500), nullable=False),
            sa.Column("source_type", sa.String(40), nullable=False),
            sa.Column("source_id", sa.String(36)),
            sa.Column("employee_id", sa.String(36)),
            sa.Column("currency", sa.String(3), server_default="BHD", nullable=False),
            sa.Column("total_debit", sa.Numeric(19, 4), nullable=False),
            sa.Column("total_credit", sa.Numeric(19, 4), nullable=False),
            sa.Column("status", sa.String(20), server_default="posted", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_by", sa.String(36)),
            sa.Column("updated_by", sa.String(36)),
            sa.Column("deleted_at", sa.DateTime(timezone=True)),
        )
        op.create_index("ix_finance_journals_company", "finance_journals", ["company_id"])
        op.create_index("ix_finance_journals_source", "finance_journals", ["source_type", "source_id"])
        op.create_index("ix_finance_journals_date", "finance_journals", ["entry_date"])

    if not _table_exists("finance_journal_lines"):
        op.create_table(
            "finance_journal_lines",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "journal_id",
                sa.String(36),
                sa.ForeignKey("finance_journals.id"),
                nullable=False,
            ),
            sa.Column(
                "account_id",
                sa.String(36),
                sa.ForeignKey("finance_accounts.id"),
                nullable=False,
            ),
            sa.Column("account_code", sa.String(20), nullable=False),
            sa.Column("debit", sa.Numeric(19, 4), server_default="0", nullable=False),
            sa.Column("credit", sa.Numeric(19, 4), server_default="0", nullable=False),
            sa.Column("memo", sa.String(400), server_default="", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_finance_lines_journal", "finance_journal_lines", ["journal_id"])
        op.create_index("ix_finance_lines_account", "finance_journal_lines", ["account_code"])


def downgrade() -> None:
    if _table_exists("finance_journal_lines"):
        op.drop_table("finance_journal_lines")
    if _table_exists("finance_journals"):
        op.drop_table("finance_journals")
    if _table_exists("finance_accounts"):
        op.drop_table("finance_accounts")

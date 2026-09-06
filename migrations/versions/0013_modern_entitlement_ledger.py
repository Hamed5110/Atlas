"""Modern entitlement ledger: types, rules, accounts, transactions, eligibility log.

Revision ID: 0013_modern_entitlement_ledger
Revises: 1bce29f17538
Create Date: 2026-09-03

MSSQL functions/procedures: sql/atlas_aluminum/05_modern_entitlement_engine.sql
(applied via scripts/apply_entitlement_sql.py).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_modern_entitlement_ledger"
down_revision: str | None = "1bce29f17538"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_exists(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _table_exists("entitlement_types"):
        op.create_table(
            "entitlement_types",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("company_id", sa.String(36), sa.ForeignKey("companies.id"), nullable=False),
            sa.Column("code", sa.String(40), nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("accrual_frequency", sa.String(20), server_default="annual", nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
            sa.Column("effective_from", sa.Date(), nullable=False),
            sa.Column("effective_to", sa.Date(), server_default="9999-12-31", nullable=False),
            sa.Column("is_current", sa.Boolean(), server_default=sa.true(), nullable=False),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_by", sa.String(36)),
            sa.Column("updated_by", sa.String(36)),
            sa.Column("deleted_at", sa.DateTime(timezone=True)),
        )
        op.create_index("ix_entitlement_types_company", "entitlement_types", ["company_id"])
        op.create_index("ix_entitlement_types_code", "entitlement_types", ["company_id", "code"])

    if not _table_exists("entitlement_rules"):
        op.create_table(
            "entitlement_rules",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("company_id", sa.String(36), sa.ForeignKey("companies.id"), nullable=False),
            sa.Column(
                "entitlement_type_id",
                sa.String(36),
                sa.ForeignKey("entitlement_types.id"),
                nullable=False,
            ),
            sa.Column("grade", sa.String(40), server_default="", nullable=False),
            sa.Column("location", sa.String(100), server_default="", nullable=False),
            sa.Column("family_status", sa.String(40), server_default="", nullable=False),
            sa.Column("los_band_from", sa.Numeric(5, 2), server_default="0", nullable=False),
            sa.Column("los_band_to", sa.Numeric(5, 2), server_default="99", nullable=False),
            sa.Column("annual_amount", sa.Numeric(19, 4), nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
            sa.Column("effective_from", sa.Date(), nullable=False),
            sa.Column("effective_to", sa.Date(), server_default="9999-12-31", nullable=False),
            sa.Column("is_current", sa.Boolean(), server_default=sa.true(), nullable=False),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_by", sa.String(36)),
            sa.Column("updated_by", sa.String(36)),
            sa.Column("deleted_at", sa.DateTime(timezone=True)),
        )
        op.create_index("ix_entitlement_rules_company", "entitlement_rules", ["company_id"])
        op.create_index("ix_entitlement_rules_matrix", "entitlement_rules", ["company_id", "grade", "location"])

    if not _table_exists("entitlement_accounts"):
        op.create_table(
            "entitlement_accounts",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("company_id", sa.String(36), sa.ForeignKey("companies.id"), nullable=False),
            sa.Column("employee_id", sa.Uuid(), sa.ForeignKey("employees.id"), nullable=False),
            sa.Column(
                "entitlement_type_id",
                sa.String(36),
                sa.ForeignKey("entitlement_types.id"),
                nullable=False,
            ),
            sa.Column("fiscal_year", sa.Integer(), nullable=False),
            sa.Column("opening_balance", sa.Numeric(19, 4), server_default="0", nullable=False),
            sa.Column("accruals", sa.Numeric(19, 4), server_default="0", nullable=False),
            sa.Column("used_amount", sa.Numeric(19, 4), server_default="0", nullable=False),
            sa.Column("adjustments", sa.Numeric(19, 4), server_default="0", nullable=False),
            sa.Column("carry_over", sa.Numeric(19, 4), server_default="0", nullable=False),
            sa.Column("forfeited", sa.Numeric(19, 4), server_default="0", nullable=False),
            sa.Column("current_balance", sa.Numeric(19, 4), server_default="0", nullable=False),
            sa.Column("status", sa.String(20), server_default="open", nullable=False),
            sa.Column("effective_from", sa.Date(), nullable=False),
            sa.Column("effective_to", sa.Date(), server_default="9999-12-31", nullable=False),
            sa.Column("is_current", sa.Boolean(), server_default=sa.true(), nullable=False),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_by", sa.String(36)),
            sa.Column("updated_by", sa.String(36)),
            sa.Column("deleted_at", sa.DateTime(timezone=True)),
            sa.UniqueConstraint(
                "company_id",
                "employee_id",
                "entitlement_type_id",
                "fiscal_year",
                name="uq_entitlement_account_year",
            ),
        )
        op.create_index("ix_entitlement_accounts_employee", "entitlement_accounts", ["employee_id"])

    if not _table_exists("entitlement_transactions"):
        op.create_table(
            "entitlement_transactions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("company_id", sa.String(36), sa.ForeignKey("companies.id"), nullable=False),
            sa.Column(
                "account_id",
                sa.String(36),
                sa.ForeignKey("entitlement_accounts.id"),
                nullable=False,
            ),
            sa.Column("employee_id", sa.Uuid(), sa.ForeignKey("employees.id"), nullable=False),
            sa.Column("txn_type", sa.String(40), nullable=False),
            sa.Column("amount", sa.Numeric(19, 4), nullable=False),
            sa.Column("source", sa.String(40), server_default="", nullable=False),
            sa.Column("effective_from", sa.Date(), nullable=False),
            sa.Column("is_approved", sa.Boolean(), server_default=sa.true(), nullable=False),
            sa.Column("is_exported", sa.Boolean(), server_default=sa.false(), nullable=False),
            sa.Column("notes", sa.String(500), server_default="", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_by", sa.String(36)),
        )
        op.create_index("ix_entitlement_tx_account", "entitlement_transactions", ["account_id"])

    if not _table_exists("eligibility_change_log"):
        op.create_table(
            "eligibility_change_log",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("company_id", sa.String(36), sa.ForeignKey("companies.id"), nullable=False),
            sa.Column("employee_id", sa.Uuid(), sa.ForeignKey("employees.id"), nullable=False),
            sa.Column("change_date", sa.Date(), nullable=False),
            sa.Column("field_name", sa.String(40), nullable=False),
            sa.Column("old_value", sa.String(200), server_default="", nullable=False),
            sa.Column("new_value", sa.String(200), server_default="", nullable=False),
            sa.Column("trigger_reason", sa.String(40), server_default="MANUAL", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_by", sa.String(36)),
        )
        op.create_index("ix_eligibility_change_employee", "eligibility_change_log", ["employee_id"])

    if not _table_exists("payroll_integration_log"):
        op.create_table(
            "payroll_integration_log",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("company_id", sa.String(36), sa.ForeignKey("companies.id"), nullable=False),
            sa.Column("payroll_run_id", sa.String(36), nullable=False),
            sa.Column("fiscal_year", sa.Integer(), nullable=False),
            sa.Column("transaction_id", sa.String(36), sa.ForeignKey("entitlement_transactions.id")),
            sa.Column("amount", sa.Numeric(19, 4), nullable=False),
            sa.Column("exported_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("exported_by", sa.String(36)),
        )

    if not _table_exists("entitlement_period_end"):
        op.create_table(
            "entitlement_period_end",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("company_id", sa.String(36), sa.ForeignKey("companies.id"), nullable=False),
            sa.Column("fiscal_year", sa.Integer(), nullable=False),
            sa.Column("entitlement_type_id", sa.String(36)),
            sa.Column("accounts_closed", sa.Integer(), server_default="0", nullable=False),
            sa.Column("total_carried_over", sa.Numeric(19, 4), server_default="0", nullable=False),
            sa.Column("total_forfeited", sa.Numeric(19, 4), server_default="0", nullable=False),
            sa.Column("run_by", sa.String(100), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )

    bind = op.get_bind()
    if bind.dialect.name == "mssql":
        op.execute(
            sa.text(
                """
                IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'airfare')
                    EXEC(N'CREATE SCHEMA airfare');
                """
            )
        )


def downgrade() -> None:
    for name in (
        "entitlement_period_end",
        "payroll_integration_log",
        "eligibility_change_log",
        "entitlement_transactions",
        "entitlement_accounts",
        "entitlement_rules",
        "entitlement_types",
    ):
        if _table_exists(name):
            op.drop_table(name)

"""Alembic revision for HCM entitlement engine schema (grade / contract / family).

Revision ID: 0011_hcm_entitlement_engine
Revises: 0010_reporting_views
Create Date: 2026-08-23

MSSQL functions/procedures live in sql/atlas_aluminum/ and are applied via
scripts/apply_entitlement_sql.py (same pattern as reporting SQL).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_hcm_entitlement_engine"
down_revision: str | None = "0010_reporting_views"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _add_missing(table: str, columns: tuple[sa.Column[object], ...]) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns(table)}
    for column in columns:
        if column.name not in existing:
            op.add_column(table, column)


def _table_exists(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    """Add Atlas Aluminum entitlement columns and supporting tables."""
    _add_missing(
        "employees",
        (
            sa.Column("grade", sa.String(20), server_default="", nullable=False),
            sa.Column("contract_type", sa.String(40), server_default="", nullable=False),
            sa.Column("origin_country", sa.String(100), server_default="", nullable=False),
            sa.Column("employment_status", sa.String(40), server_default="active", nullable=False),
            sa.Column("monthly_salary", sa.Numeric(19, 4)),
            sa.Column("probation_end_date", sa.Date()),
        ),
    )

    if not _table_exists("family_members"):
        op.create_table(
            "family_members",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("employee_id", sa.Uuid(), sa.ForeignKey("employees.id"), nullable=False),
            sa.Column("full_name", sa.String(200), nullable=False),
            sa.Column("relationship", sa.String(40), nullable=False),
            sa.Column("date_of_birth", sa.Date()),
            sa.Column("eligible_for_ticket", sa.Boolean(), server_default=sa.true(), nullable=False),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_by", sa.String(36)),
            sa.Column("updated_by", sa.String(36)),
            sa.Column("deleted_at", sa.DateTime(timezone=True)),
        )
        op.create_index("ix_family_members_employee_id", "family_members", ["employee_id"])

    if not _table_exists("entitlement_policies"):
        op.create_table(
            "entitlement_policies",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("code", sa.String(40), nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("grade", sa.String(20), server_default="", nullable=False),
            sa.Column("contract_type", sa.String(40), server_default="", nullable=False),
            sa.Column("cycle_months", sa.Integer(), server_default="24", nullable=False),
            sa.Column("max_payout", sa.Numeric(19, 4), server_default="150", nullable=False),
            sa.Column("travel_class", sa.String(40), server_default="economy", nullable=False),
            sa.Column("family_included", sa.Boolean(), server_default=sa.false(), nullable=False),
            sa.Column("dependent_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
            sa.Column("effective_from", sa.Date(), nullable=False),
            sa.Column("effective_to", sa.Date()),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_by", sa.String(36)),
            sa.Column("updated_by", sa.String(36)),
            sa.Column("deleted_at", sa.DateTime(timezone=True)),
        )
        op.create_index("ix_entitlement_policies_code", "entitlement_policies", ["code"])
        op.create_index("ix_entitlement_policies_grade", "entitlement_policies", ["grade"])

    bind = op.get_bind()
    if bind.dialect.name == "mssql":
        # Marker only — full CREATE FUNCTION/PROCEDURE applied by apply_entitlement_sql.py
        op.execute(
            sa.text(
                """
                IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'airfare')
                    EXEC(N'CREATE SCHEMA airfare');
                """
            )
        )


def downgrade() -> None:
    """Drop entitlement schema additions."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "entitlement_policies" in tables:
        op.drop_table("entitlement_policies")
    if "family_members" in tables:
        op.drop_table("family_members")
    if "employees" in tables:
        existing = {column["name"] for column in inspector.get_columns("employees")}
        for name in (
            "probation_end_date",
            "monthly_salary",
            "employment_status",
            "origin_country",
            "contract_type",
            "grade",
        ):
            if name in existing:
                op.drop_column("employees", name)
    if bind.dialect.name == "mssql":
        for obj, kind in (
            ("vw_HCM_EmployeeEntitlementStatus", "V"),
            ("sp_HCM_CalculateEntitlementForEmployee", "P"),
            ("sp_HCM_CalculateEntitlement", "P"),
            ("fn_HCM_LoanEMI", "FN"),
            ("fn_HCM_NextDueDate", "FN"),
            ("fn_HCM_AirfareAmountFromDays", "FN"),
            ("fn_HCM_WorkingDays30360", "FN"),
        ):
            op.execute(
                sa.text(
                    f"IF OBJECT_ID(N'airfare.{obj}', N'{kind}') IS NOT NULL "
                    f"DROP {'VIEW' if kind == 'V' else 'PROCEDURE' if kind == 'P' else 'FUNCTION'} "
                    f"airfare.{obj}"
                )
            )

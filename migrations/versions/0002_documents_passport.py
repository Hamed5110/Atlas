"""Add documents table and employees.passport_no.

Revision ID: 0002_documents_passport
Revises: 0001_initial
Create Date: 2026-08-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_documents_passport"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the generated-documents table and the employee passport column."""
    op.add_column(
        "employees",
        sa.Column("passport_no", sa.String(40), server_default="", nullable=False),
    )
    op.create_table(
        "documents",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("document_number", sa.Integer(), nullable=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("template_key", sa.String(40), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("status", sa.String(20), server_default="issued", nullable=False),
        sa.Column("params", sa.JSON(), nullable=False),
        sa.Column("pdf_key", sa.String(500), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("issued_by", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.Column("updated_by", sa.String(36), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_number"),
    )
    op.create_index("ix_documents_kind", "documents", ["kind"])
    op.create_index("ix_documents_employee_id", "documents", ["employee_id"])
    op.create_index("ix_documents_status", "documents", ["status"])


def downgrade() -> None:
    """Drop the documents table and the passport column."""
    op.drop_table("documents")
    op.drop_column("employees", "passport_no")

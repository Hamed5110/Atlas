"""Add users.company_id foreign key now that company identifiers share one type.

Revision ID: 0006_users_company_fk
Revises: 0005_company_fk
Create Date: 2026-08-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_users_company_fk"
down_revision: str | None = "0005_company_fk"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FK_NAME = "fk_users_company_id_companies"


def upgrade() -> None:
    """Attach users.company_id to companies.id when the constraint is absent."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "users" not in inspector.get_table_names() or "companies" not in inspector.get_table_names():
        return
    existing = {
        fk["name"]
        for fk in inspector.get_foreign_keys("users")
        if fk.get("name") and fk.get("referred_table") == "companies"
    }
    if FK_NAME in existing or existing:
        return
    op.create_foreign_key(
        FK_NAME,
        "users",
        "companies",
        ["company_id"],
        ["id"],
        ondelete="NO ACTION",
        onupdate="CASCADE",
    )


def downgrade() -> None:
    """Drop the users company foreign key."""
    op.drop_constraint(FK_NAME, "users", type_="foreignkey")

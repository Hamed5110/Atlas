"""AI self-support learning store.

Revision ID: 0012_ai_learning_events
Revises: 0011_hcm_entitlement_engine
Create Date: 2026-08-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_ai_learning_events"
down_revision: str | None = "0011_hcm_entitlement_engine"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the ai_learning_events table when it does not exist yet."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "ai_learning_events" in inspector.get_table_names():
        return
    op.create_table(
        "ai_learning_events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("event_type", sa.String(length=20), nullable=False),
        sa.Column("check_code", sa.String(length=60), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False, server_default="info"),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("fix_applied", sa.String(length=60)),
        sa.Column("outcome", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("confidence", sa.Numeric(5, 4), nullable=False, server_default="0.5"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(length=36)),
    )
    op.create_index("ix_ai_learning_events_event_type", "ai_learning_events", ["event_type"])
    op.create_index("ix_ai_learning_events_check_code", "ai_learning_events", ["check_code"])
    op.create_index("ix_ai_learning_events_outcome", "ai_learning_events", ["outcome"])


def downgrade() -> None:
    """Drop the learning store."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "ai_learning_events" not in inspector.get_table_names():
        return
    for index in (
        "ix_ai_learning_events_event_type",
        "ix_ai_learning_events_check_code",
        "ix_ai_learning_events_outcome",
    ):
        existing = {item["name"] for item in inspector.get_indexes("ai_learning_events")}
        if index in existing:
            op.drop_index(index, table_name="ai_learning_events")
    op.drop_table("ai_learning_events")

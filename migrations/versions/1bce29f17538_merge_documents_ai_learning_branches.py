"""merge documents + ai learning branches

Revision ID: 1bce29f17538
Revises: 0002_documents_passport, 0012_ai_learning_events
Create Date: 2026-08-31 14:06:44.891649
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '1bce29f17538'
down_revision: str | None = ('0002_documents_passport', '0012_ai_learning_events')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    pass


def downgrade() -> None:
    """Revert this revision."""
    pass

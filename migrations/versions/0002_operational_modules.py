"""Add authentication and all operational Airfare modules.

Revision ID: 0002_operational
Revises: 0001_initial
Create Date: 2026-08-16
"""

from collections.abc import Sequence

from alembic import op

from airfare_management.infrastructure.schema import (
    AttachmentRow,
    CompanyRow,
    LoanPaymentRow,
    LoanRow,
    OpeningBalanceRow,
    PreferenceRow,
    TicketRow,
    UserRow,
)

revision: str = "0002_operational"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = (
    CompanyRow.__table__,
    UserRow.__table__,
    OpeningBalanceRow.__table__,
    TicketRow.__table__,
    LoanRow.__table__,
    LoanPaymentRow.__table__,
    PreferenceRow.__table__,
    AttachmentRow.__table__,
)


def upgrade() -> None:
    """Create the complete operational schema."""
    bind = op.get_bind()
    for table in TABLES:
        table.create(bind=bind, checkfirst=True)


def downgrade() -> None:
    """Drop operational tables in dependency-safe order."""
    bind = op.get_bind()
    for table in reversed(TABLES):
        table.drop(bind=bind, checkfirst=True)

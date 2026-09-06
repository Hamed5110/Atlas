"""Additive local workspace catalog + process execution log.

Revision ID: 0014_local_workspace_catalog
Revises: 0013_modern_entitlement_ledger
Create Date: 2026-09-06

Non-breaking: creates new tables only (ai_local_dataset_catalog,
local_tool_catalog, process_execution_log). No changes to existing tables.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_local_workspace_catalog"
down_revision: str | None = "0013_modern_entitlement_ledger"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_exists(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _table_exists("ai_local_dataset_catalog"):
        op.create_table(
            "ai_local_dataset_catalog",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("path_key", sa.String(64), nullable=False),
            sa.Column("absolute_path", sa.String(1000), nullable=False),
            sa.Column("relative_path", sa.String(1000), nullable=False),
            sa.Column("root_role", sa.String(40), nullable=False, server_default="ui_workspace"),
            sa.Column("category", sa.String(40), nullable=False, server_default="dataset"),
            sa.Column("size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("mtime_utc", sa.DateTime(timezone=True)),
            sa.Column("checksum_sha256", sa.String(64)),
            sa.Column("status", sa.String(20), nullable=False, server_default="present"),
            sa.Column("metadata_json", sa.JSON(), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("path_key", name="uq_ai_local_dataset_path_key"),
        )
        op.create_index("ix_ai_local_dataset_status", "ai_local_dataset_catalog", ["status"])
        op.create_index("ix_ai_local_dataset_category", "ai_local_dataset_catalog", ["category"])

    if not _table_exists("local_tool_catalog"):
        op.create_table(
            "local_tool_catalog",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("path_key", sa.String(64), nullable=False),
            sa.Column("absolute_path", sa.String(1000), nullable=False),
            sa.Column("relative_path", sa.String(1000), nullable=False),
            sa.Column("root_role", sa.String(40), nullable=False, server_default="api_runtime"),
            sa.Column("tool_name", sa.String(200), nullable=False),
            sa.Column("kind", sa.String(40), nullable=False, server_default="script"),
            sa.Column("size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("mtime_utc", sa.DateTime(timezone=True)),
            sa.Column("metadata_json", sa.JSON(), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("path_key", name="uq_local_tool_path_key"),
        )
        op.create_index("ix_local_tool_kind", "local_tool_catalog", ["kind"])

    if not _table_exists("process_execution_log"):
        op.create_table(
            "process_execution_log",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("process_name", sa.String(80), nullable=False),
            sa.Column("mode", sa.String(20), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("finished_at", sa.DateTime(timezone=True)),
            sa.Column("status", sa.String(20), nullable=False, server_default="running"),
            sa.Column("files_scanned", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("files_deleted", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("files_cataloged", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("bytes_freed", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("error_message", sa.Text()),
            sa.Column("details_json", sa.JSON(), nullable=False),
            sa.Column("created_by", sa.String(100)),
        )
        op.create_index("ix_process_execution_name", "process_execution_log", ["process_name"])
        op.create_index("ix_process_execution_started", "process_execution_log", ["started_at"])


def downgrade() -> None:
    for name in ("process_execution_log", "local_tool_catalog", "ai_local_dataset_catalog"):
        if _table_exists(name):
            op.drop_table(name)

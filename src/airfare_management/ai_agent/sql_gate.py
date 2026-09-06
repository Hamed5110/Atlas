"""SQL gate: only schema-dictionary objects; SELECT by default; no DDL."""

from __future__ import annotations

import re
from typing import Any

from airfare_management.ai_agent.schema_dictionary import (
    PII_COLUMNS,
    TABLES,
    candidates_for,
    table_columns,
)

_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|xp_)\b",
    re.I,
)
_FROM_JOIN = re.compile(r"\b(?:FROM|JOIN)\s+(?:dbo\.)?([A-Za-z_][A-Za-z0-9_]*)", re.I)


def assert_read_only_sql(sql: str) -> None:
    stripped = sql.strip().rstrip(";")
    if not stripped:
        raise ValueError("Empty SQL.")
    if _FORBIDDEN.search(stripped):
        raise ValueError(
            "DML/DDL is blocked. Auto-Repair Mode + whitelist confirmation is required for writes."
        )
    if not re.match(r"^\s*SELECT\b", stripped, re.I):
        raise ValueError("Only SELECT statements are permitted outside Auto-Repair.")


def referenced_tables(sql: str) -> list[str]:
    return [m.group(1).casefold() for m in _FROM_JOIN.finditer(sql)]


def validate_against_schema(sql: str, *, allow_write: bool = False) -> dict[str, Any]:
    """Return gate result; raises ValueError on hard violations."""
    if not allow_write:
        assert_read_only_sql(sql)
    tables = referenced_tables(sql)
    unknown = [t for t in tables if t not in TABLES]
    if unknown:
        suggestions = []
        for name in unknown:
            suggestions.extend(candidates_for(name))
        raise ValueError(
            f"I don't see table(s) {unknown} in the current schema. "
            f"Available candidates include: {suggestions[:12] or list_tables_preview()}"
        )
    pii_touched = sorted({col for col in PII_COLUMNS if re.search(rf"\b{re.escape(col)}\b", sql, re.I)})
    if "password_hash" in pii_touched:
        raise ValueError("password_hash is secret — never selectable by the agent.")
    return {
        "tables": tables,
        "pii_touched": pii_touched,
        "allow_write": allow_write,
        "ok": True,
    }


def list_tables_preview() -> list[str]:
    return sorted(TABLES)[:20]


def resolve_column(table: str, column: str) -> str | None:
    cols = table_columns(table)
    if cols is None:
        return None
    if column in cols:
        return f"{table}.{column}"
    return None


def missing_column_message(column: str) -> str:
    hits = candidates_for(column)
    if not hits:
        return f"I don't see `{column}` in the current schema."
    return f"I don't see `{column}` in the current schema. Available candidates are: {', '.join(hits)}"

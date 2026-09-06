"""Crystal-style report template catalog, seed, and run helpers."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from airfare_management.api.schemas.report import ReportName
from airfare_management.application.reporting import collect_report_rows
from airfare_management.infrastructure.schema import ReportTemplateRow

SEED_DATASETS: tuple[tuple[str, str, str], ...] = (
    ("employee-master", "Employee Master", "employee_master"),
    ("opening-balances", "Opening Balances", "opening_balances"),
    ("entitlements", "Entitlements", "entitlements"),
    ("ticket-register", "Ticket Register", "ticket_register"),
    ("loan-outstanding", "Loan Outstanding", "loan_outstanding"),
    ("loan-statement", "Loan Statement", "loan_statement"),
    ("liability-projections", "Liability Projections", "liability_projections"),
    ("excess-recovery", "Excess Recovery", "excess_recovery"),
)


def builder_root() -> Path:
    return Path(__file__).resolve().parents[1] / "templates" / "reports" / "builder"


def _default_definition(dataset: str, title: str, columns: list[str]) -> dict[str, Any]:
    return {
        "title": title,
        "dataset": dataset,
        "bands": {
            "header": {"title": title, "show_date": True},
            "detail": {"columns": columns},
            "footer": {"show_count": True},
        },
        "parameters": {},
        "filters": {},
        "group_by": [],
        "sort_by": columns[0] if columns else None,
    }


def seed_system_templates(session: Session) -> int:
    """Insert missing system templates and mirror JSON under templates/reports/builder."""
    root = builder_root()
    root.mkdir(parents=True, exist_ok=True)
    created = 0
    for dataset, title, code in SEED_DATASETS:
        existing = session.scalar(
            select(ReportTemplateRow).where(
                ReportTemplateRow.code == code,
                ReportTemplateRow.deleted_at.is_(None),
            )
        )
        columns, _ = collect_report_rows(session, dataset)  # type: ignore[arg-type]
        definition = _default_definition(dataset, title, columns)
        path = root / f"{code}.json"
        path.write_text(json.dumps(definition, indent=2), encoding="utf-8")
        if existing is not None:
            existing.definition = definition
            existing.title = title
            existing.dataset = dataset
            existing.is_system = True
            existing.active = True
            continue
        session.add(
            ReportTemplateRow(
                id=str(uuid4()),
                code=code,
                title=title,
                dataset=dataset,
                definition=definition,
                is_system=True,
                active=True,
                version=1,
            )
        )
        created += 1
    session.flush()
    return created


def list_templates(session: Session) -> list[dict[str, Any]]:
    seed_system_templates(session)
    items = session.scalars(
        select(ReportTemplateRow)
        .where(
            ReportTemplateRow.deleted_at.is_(None),
            ReportTemplateRow.active == True,  # noqa: E712 — MSSQL rejects `IS 1`
        )
        .order_by(ReportTemplateRow.title)
    )
    return [
        {
            "id": item.id,
            "code": item.code,
            "title": item.title,
            "dataset": item.dataset,
            "definition": item.definition,
            "is_system": item.is_system,
            "version": item.version,
        }
        for item in items
    ]


def get_template(session: Session, template_id: str) -> ReportTemplateRow | None:
    item = session.get(ReportTemplateRow, template_id)
    if item is None or item.deleted_at is not None:
        return None
    return item


def create_template(
    session: Session,
    *,
    code: str,
    title: str,
    dataset: str,
    definition: dict[str, Any],
    actor: str | None = None,
) -> ReportTemplateRow:
    item = ReportTemplateRow(
        id=str(uuid4()),
        code=code,
        title=title,
        dataset=dataset,
        definition=definition,
        is_system=False,
        active=True,
        created_by=actor,
        updated_by=actor,
        version=1,
    )
    session.add(item)
    session.flush()
    path = builder_root() / f"{code}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(definition, indent=2), encoding="utf-8")
    return item


def update_template(
    session: Session,
    item: ReportTemplateRow,
    *,
    title: str,
    definition: dict[str, Any],
    version: int,
    actor: str | None = None,
) -> ReportTemplateRow:
    if item.version != version:
        raise ValueError("stale_version")
    item.title = title
    item.definition = definition
    item.updated_by = actor
    item.updated_at = datetime.now(UTC)
    item.version += 1
    path = builder_root() / f"{item.code}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(definition, indent=2), encoding="utf-8")
    return item


def run_template(
    session: Session,
    item: ReportTemplateRow,
    *,
    selected_columns: list[str] | None = None,
) -> tuple[list[str], list[tuple[Any, ...]], dict[str, Any]]:
    dataset = item.dataset
    columns, rows = collect_report_rows(session, dataset)  # type: ignore[arg-type]
    detail_cols = (
        selected_columns
        or (item.definition or {}).get("bands", {}).get("detail", {}).get("columns")
        or columns
    )
    if detail_cols and set(detail_cols).issubset(set(columns)):
        indexes = [columns.index(name) for name in detail_cols]
        rows = [tuple(row[i] for i in indexes) for row in rows]
        columns = list(detail_cols)
    meta = {
        "template_id": item.id,
        "code": item.code,
        "title": item.title,
        "dataset": dataset,
        "generated_at": datetime.now(UTC).isoformat(),
    }
    return columns, rows, meta

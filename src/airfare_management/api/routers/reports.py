"""Report detail, export, and KPI routes."""

from collections.abc import Callable, Generator
from datetime import UTC, date, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from airfare_management.api.dependencies import Claims
from airfare_management.api.schemas.report import ReportName
from airfare_management.application.reporting import collect_report_rows, report_aggregate_value
from airfare_management.infrastructure.documents import build_pdf_report, export_workbook

ReportRoles = ("admin", "hr", "finance", "auditor")


def _report_filters(
    year: int | None,
    as_of_date: date | None,
    company_id: UUID | None,
    department: str | None,
) -> dict[str, Any]:
    return {
        "year": year,
        "as_of_date": as_of_date,
        "company_id": str(company_id) if company_id else None,
        "department": department,
    }


def create_reports_router(
    database: Callable[[], Generator[Session, None, None]],
    authorized: Callable[..., Callable[[Claims], Claims]],
) -> APIRouter:
    """Wire report endpoints using the app-scoped auth and DB dependencies."""
    router = APIRouter(tags=["reports"])
    report_auth = authorized(*ReportRoles)

    @router.get("/v1/reports/detail/{report_name}")
    def report_detail(
        report_name: ReportName,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(report_auth)],
        year: int | None = Query(default=None, ge=2000, le=2100),
        as_of_date: date | None = Query(default=None),
        company_id: UUID | None = Query(default=None),
        department: str | None = Query(default=None, max_length=120),
    ) -> dict[str, Any]:
        filters = _report_filters(year, as_of_date, company_id, department)
        columns, rows = collect_report_rows(session, report_name, **filters)
        return {
            "report": report_name,
            "columns": columns,
            "rows": [list(row) for row in rows],
            "count": len(rows),
            "filters": {k: (v.isoformat() if isinstance(v, date) else v) for k, v in filters.items()},
            "generated_at": datetime.now(UTC),
        }

    @router.get("/v1/reports/export/{report_name}.pdf")
    def report_pdf(
        report_name: ReportName,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(report_auth)],
        year: int | None = Query(default=None, ge=2000, le=2100),
        as_of_date: date | None = Query(default=None),
        company_id: UUID | None = Query(default=None),
        department: str | None = Query(default=None, max_length=120),
    ) -> Response:
        filters = _report_filters(year, as_of_date, company_id, department)
        columns, rows = collect_report_rows(session, report_name, **filters)
        title = report_name.replace("-", " ").title()
        pdf = build_pdf_report(title, columns, rows)
        return Response(
            pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{report_name}.pdf"'},
        )

    @router.get("/v1/reports/export/{report_name}.xlsx")
    def report_xlsx(
        report_name: ReportName,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(report_auth)],
        year: int | None = Query(default=None, ge=2000, le=2100),
        as_of_date: date | None = Query(default=None),
        company_id: UUID | None = Query(default=None),
        department: str | None = Query(default=None, max_length=120),
    ) -> Response:
        filters = _report_filters(year, as_of_date, company_id, department)
        columns, rows = collect_report_rows(session, report_name, **filters)
        records = [dict(zip(columns, row, strict=True)) for row in rows]
        workbook = export_workbook(report_name.replace("-", " ").title(), columns, records)
        return Response(
            workbook,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{report_name}.xlsx"'},
        )

    @router.get("/v1/reports/data/{report_name}")
    def report_data(
        report_name: ReportName,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(report_auth)],
        year: int | None = Query(default=None, ge=2000, le=2100),
        as_of_date: date | None = Query(default=None),
        company_id: UUID | None = Query(default=None),
        department: str | None = Query(default=None, max_length=120),
    ) -> dict[str, Any]:
        filters = _report_filters(year, as_of_date, company_id, department)
        report_value = report_aggregate_value(session, report_name, **filters)
        return {
            "report": report_name,
            "value": report_value or 0,
            "filters": {k: (v.isoformat() if isinstance(v, date) else v) for k, v in filters.items()},
            "generated_at": datetime.now(UTC),
        }

    @router.get("/v1/reports/excess.pdf")
    def excess_report(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(report_auth)],
    ) -> Response:
        columns, rows = collect_report_rows(session, "excess-recovery")
        pdf = build_pdf_report("Airfare Excess Recovery Report", columns, rows)
        return Response(
            pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="airfare-excess-report.pdf"'},
        )

    return router

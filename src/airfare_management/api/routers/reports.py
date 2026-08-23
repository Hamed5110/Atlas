"""Report detail, export, and KPI routes."""

from collections.abc import Callable, Generator
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from airfare_management.api.dependencies import Claims
from airfare_management.api.schemas.report import ReportName
from airfare_management.application.reporting import collect_report_rows, report_aggregate_value
from airfare_management.infrastructure.documents import build_pdf_report, export_workbook

ReportRoles = ("admin", "hr", "finance", "auditor")


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
    ) -> dict[str, Any]:
        columns, rows = collect_report_rows(session, report_name)
        return {
            "report": report_name,
            "columns": columns,
            "rows": [list(row) for row in rows],
            "count": len(rows),
            "generated_at": datetime.now(UTC),
        }

    @router.get("/v1/reports/export/{report_name}.pdf")
    def report_pdf(
        report_name: ReportName,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(report_auth)],
    ) -> Response:
        columns, rows = collect_report_rows(session, report_name)
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
    ) -> Response:
        columns, rows = collect_report_rows(session, report_name)
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
    ) -> dict[str, Any]:
        report_value = report_aggregate_value(session, report_name)
        return {
            "report": report_name,
            "value": report_value or 0,
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

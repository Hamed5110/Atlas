"""Finance GL API — chart of accounts, trial balance, ledger report."""

from collections.abc import Callable, Generator
from datetime import date
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from airfare_management.api.dependencies import Claims
from airfare_management.domain.models import DomainError
from airfare_management.infrastructure import finance_ledger as gl
from airfare_management.infrastructure.schema import CompanyRow

FinanceRoles = ("admin", "hr", "finance", "manager", "auditor", "SYSTEM_ADMIN", "FINANCE_MANAGER")


class SeedRequest(BaseModel):
    company_id: UUID | None = None


class BackfillRequest(BaseModel):
    company_id: UUID | None = None
    limit: int = Field(default=200, ge=1, le=2000)


def _primary_company(session: Session) -> UUID:
    row = session.scalar(select(CompanyRow).where(CompanyRow.deleted_at.is_(None)).limit(1))
    if row is None:
        raise DomainError("no_company", "Create a company before using the finance ledger.")
    return UUID(str(row.id))


def create_finance_router(
    database: Callable[[], Generator[Session, None, None]],
    authorized: Callable[..., Callable[[Claims], Claims]],
) -> APIRouter:
    router = APIRouter(tags=["finance-gl"])
    auth = authorized(*FinanceRoles)

    def resolve_company(session: Session, company_id: UUID | None) -> UUID:
        return company_id or _primary_company(session)

    @router.get("/v1/finance/status")
    def finance_status(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(auth)],
    ) -> dict[str, Any]:
        ready = gl.tables_ready(session)
        return {
            "ready": ready,
            "engine": "atlas_native_mssql_gl",
            "currency": "BHD",
            "pattern_source": (
                "Patterned on python-accounting (IFRS/GAAP: post journals → Trial Balance → "
                "account ledger). Library is MySQL/Postgres/SQLite only; ATLAS native MSSQL port."
            ),
            "ai_support": True,
            "migration": "0015_finance_gl",
            "how_to_report": (
                "Finance Ledger page → Ledger report section (filter account / as-of). "
                "Or GET /v1/finance/ledger-report (+ .csv). Empty until ticket issue, "
                "loan payment, or POST /v1/finance/backfill."
            ),
            "message": (
                "Finance GL ready. Ledger report is on this page below Chart of accounts."
                if ready
                else "Run Alembic upgrade to 0015_finance_gl, then POST /v1/finance/seed."
            ),
        }

    @router.post("/v1/finance/seed")
    def seed_coa(
        payload: SeedRequest,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(auth)],
    ) -> dict[str, Any]:
        cid = resolve_company(session, payload.company_id)
        accounts = gl.ensure_default_coa(
            session, cid, actor=str(claims.username or claims.subject)
        )
        return {"company_id": str(cid), "accounts": accounts, "count": len(accounts)}

    @router.post("/v1/finance/backfill")
    def backfill(
        payload: BackfillRequest,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(auth)],
    ) -> dict[str, Any]:
        """Create missing journals from existing tickets/loans/payments (idempotent)."""
        cid = resolve_company(session, payload.company_id)
        return gl.backfill_from_operations(
            session,
            cid,
            actor=str(claims.username or claims.subject),
            limit=payload.limit,
        )

    @router.get("/v1/finance/accounts")
    def accounts(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(auth)],
        company_id: UUID | None = None,
    ) -> list[dict[str, Any]]:
        cid = resolve_company(session, company_id)
        if not gl.tables_ready(session):
            return []
        gl.ensure_default_coa(session, cid)
        return gl.list_accounts(session, cid)

    @router.get("/v1/finance/trial-balance")
    def trial_balance(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(auth)],
        company_id: UUID | None = None,
        as_of: date | None = None,
    ) -> dict[str, Any]:
        cid = resolve_company(session, company_id)
        return gl.trial_balance(session, cid, as_of=as_of)

    @router.get("/v1/finance/ledger-report")
    def ledger_report(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(auth)],
        company_id: UUID | None = None,
        account_code: str | None = Query(default=None),
        from_date: date | None = None,
        to_date: date | None = None,
        limit: int = Query(default=200, ge=1, le=1000),
    ) -> dict[str, Any]:
        cid = resolve_company(session, company_id)
        return gl.ledger_report(
            session,
            cid,
            account_code=account_code,
            from_date=from_date,
            to_date=to_date,
            limit=limit,
        )

    @router.get("/v1/finance/ledger-report.csv")
    def ledger_report_csv(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(auth)],
        company_id: UUID | None = None,
        account_code: str | None = Query(default=None),
        from_date: date | None = None,
        to_date: date | None = None,
        limit: int = Query(default=1000, ge=1, le=5000),
    ) -> PlainTextResponse:
        """CSV export of ledger lines (printable ledger / trial balance footer)."""
        cid = resolve_company(session, company_id)
        report = gl.ledger_report(
            session,
            cid,
            account_code=account_code,
            from_date=from_date,
            to_date=to_date,
            limit=limit,
        )
        lines = [
            "entry_date,account_code,source_type,source_id,narration,memo,debit,credit"
        ]
        for e in report.get("entries") or []:
            narr = str(e.get("narration") or "").replace('"', "'")
            memo = str(e.get("memo") or "").replace('"', "'")
            lines.append(
                f'{e.get("entry_date")},{e.get("account_code")},{e.get("source_type")},'
                f'{e.get("source_id") or ""},"{narr}","{memo}",'
                f'{e.get("debit")},{e.get("credit")}'
            )
        lines.append("")
        lines.append("code,name,debit,credit,net")
        for a in report.get("accounts") or []:
            lines.append(
                f'{a.get("code")},{a.get("name")},{a.get("debit")},{a.get("credit")},{a.get("net")}'
            )
        lines.append(
            f'TOTAL,,{report.get("total_debit")},{report.get("total_credit")},'
            f'balanced={report.get("balanced")}'
        )
        return PlainTextResponse(
            "\n".join(lines) + "\n",
            media_type="text/csv",
            headers={
                "Content-Disposition": 'attachment; filename="finance-ledger-report.csv"'
            },
        )

    def _ledger_payload(
        session: Session,
        company_id: UUID | None,
        account_code: str | None,
        from_date: date | None,
        to_date: date | None,
        limit: int,
    ) -> dict[str, Any]:
        cid = resolve_company(session, company_id)
        return gl.ledger_report(
            session,
            cid,
            account_code=account_code,
            from_date=from_date,
            to_date=to_date,
            limit=limit,
        )

    @router.get("/v1/finance/ledger-report.xlsx")
    def ledger_report_xlsx(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(auth)],
        company_id: UUID | None = None,
        account_code: str | None = Query(default=None),
        from_date: date | None = None,
        to_date: date | None = None,
        limit: int = Query(default=1000, ge=1, le=5000),
    ) -> Response:
        """Excel export (Focus ERP style: Trial Balance + Journal Lines sheets)."""
        report = _ledger_payload(
            session, company_id, account_code, from_date, to_date, limit
        )
        payload = gl.build_ledger_export_xlsx(report)
        return Response(
            payload,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": 'attachment; filename="finance-ledger-report.xlsx"'
            },
        )

    @router.get("/v1/finance/ledger-report.pdf")
    def ledger_report_pdf(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(auth)],
        company_id: UUID | None = None,
        account_code: str | None = Query(default=None),
        from_date: date | None = None,
        to_date: date | None = None,
        limit: int = Query(default=1000, ge=1, le=5000),
    ) -> Response:
        """PDF export (Focus ERP style printable ledger report)."""
        report = _ledger_payload(
            session, company_id, account_code, from_date, to_date, limit
        )
        company = session.scalar(
            select(CompanyRow).where(CompanyRow.deleted_at.is_(None)).limit(1)
        )
        company_name = company.name if company is not None else "Atlas Aluminum"
        payload = gl.build_ledger_export_pdf(report, company_name=company_name)
        return Response(
            payload,
            media_type="application/pdf",
            headers={
                "Content-Disposition": 'attachment; filename="finance-ledger-report.pdf"'
            },
        )

    return router

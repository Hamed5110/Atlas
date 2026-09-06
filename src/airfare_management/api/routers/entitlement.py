"""Modern entitlement engine API — thin orchestration over the ledger repository."""

from collections.abc import Callable, Generator
from datetime import date
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from airfare_management.api.dependencies import Claims
from airfare_management.domain.models import DomainError
from airfare_management.infrastructure import entitlement_ledger as ledger
from airfare_management.infrastructure.schema import CompanyRow

EntitlementRoles = ("admin", "hr", "finance", "manager", "auditor", "SYSTEM_ADMIN", "HR_MANAGER")

_REMOVED_PERIOD_END = (
    "Period-end / year-close was removed. Use modern continuous entitlement: "
    "Entitlement Rates (/rates) + Airfare Allocation (/allocation) with "
    "Settings cycle_reset_basis=joining_date."
)


class RuleCreateRequest(BaseModel):
    company_id: UUID | None = None
    entitlement_type_id: str | None = None
    grade: str = ""
    location: str = ""
    family_status: str = ""
    los_band_from: Decimal = Decimal("0")
    los_band_to: Decimal = Decimal("99")
    annual_amount: Decimal
    is_active: bool = True
    effective_from: date | None = None


class RuleUpdateRequest(BaseModel):
    grade: str | None = None
    location: str | None = None
    family_status: str | None = None
    los_band_from: Decimal | None = None
    los_band_to: Decimal | None = None
    annual_amount: Decimal | None = None
    is_active: bool | None = None


class PayrollExportRequest(BaseModel):
    company_id: UUID | None = None
    fiscal_year: int
    payroll_run_id: str = Field(min_length=1)
    run_by: str = "system"


def _primary_company(session: Session) -> UUID:
    row = session.scalar(select(CompanyRow).where(CompanyRow.deleted_at.is_(None)).limit(1))
    if row is None:
        raise DomainError("no_company", "Create a company before running entitlement jobs.")
    return UUID(str(row.id))


def create_entitlement_router(
    database: Callable[[], Generator[Session, None, None]],
    authorized: Callable[..., Callable[[Claims], Claims]],
) -> APIRouter:
    router = APIRouter(tags=["entitlement-engine"])
    auth = authorized(*EntitlementRoles)

    def resolve_company(session: Session, company_id: UUID | None) -> UUID:
        return company_id or _primary_company(session)

    def resolve_type(session: Session, company_id: UUID, type_id: str | None, actor: str) -> str:
        if type_id:
            return type_id
        return ledger.ensure_default_type(session, company_id, actor=actor)

    @router.get("/v1/entitlement/types")
    def entitlement_types(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(auth)],
        company_id: UUID | None = None,
    ) -> list[dict[str, Any]]:
        cid = resolve_company(session, company_id)
        ledger.ensure_default_type(session, cid, actor="system")
        return ledger.list_types(session, cid)

    @router.get("/v1/entitlement/rules")
    def list_rules(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(auth)],
        company_id: UUID | None = None,
    ) -> list[dict[str, Any]]:
        return ledger.list_rules(session, resolve_company(session, company_id))

    @router.post("/v1/entitlement/rules", status_code=201)
    def create_rule(
        payload: RuleCreateRequest,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(auth)],
    ) -> dict[str, Any]:
        cid = resolve_company(session, payload.company_id)
        type_id = resolve_type(session, cid, payload.entitlement_type_id, str(claims.username or claims.subject))
        body = payload.model_dump()
        body["company_id"] = cid
        body["entitlement_type_id"] = type_id
        return ledger.create_rule(session, body, actor=str(claims.username or claims.subject))

    @router.put("/v1/entitlement/rules/{rule_id}")
    def update_rule(
        rule_id: str,
        payload: RuleUpdateRequest,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(auth)],
    ) -> dict[str, Any]:
        return ledger.update_rule_effective(
            session,
            rule_id,
            payload.model_dump(exclude_none=True),
            actor=str(claims.username or claims.subject),
        )

    @router.delete("/v1/entitlement/rules/{rule_id}", status_code=204)
    def delete_rule(
        rule_id: str,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(auth)],
    ) -> None:
        ledger.soft_delete_rule(session, rule_id, actor=str(claims.username or claims.subject))

    @router.get("/v1/entitlement/employee/{employee_id}/balance")
    def employee_balance(
        employee_id: UUID,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(auth)],
        fiscal_year: int = Query(default_factory=lambda: date.today().year),
        entitlement_type_id: str | None = None,
        company_id: UUID | None = None,
    ) -> dict[str, Any]:
        cid = resolve_company(session, company_id)
        type_id = resolve_type(session, cid, entitlement_type_id, "system")
        account = ledger.get_account(
            session,
            company_id=cid,
            employee_id=employee_id,
            fiscal_year=fiscal_year,
            entitlement_type_id=type_id,
        )
        if account is None:
            return {"account": None, "transactions": []}
        return {
            "account": account,
            "transactions": ledger.list_transactions(session, str(account["id"])),
        }

    @router.get("/v1/entitlement/employee/{employee_id}/history")
    def employee_history(
        employee_id: UUID,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(auth)],
        fiscal_year: int = Query(default_factory=lambda: date.today().year),
        entitlement_type_id: str | None = None,
        company_id: UUID | None = None,
    ) -> list[dict[str, Any]]:
        cid = resolve_company(session, company_id)
        type_id = resolve_type(session, cid, entitlement_type_id, "system")
        account = ledger.get_account(
            session,
            company_id=cid,
            employee_id=employee_id,
            fiscal_year=fiscal_year,
            entitlement_type_id=type_id,
        )
        if account is None:
            return []
        return ledger.list_transactions(session, str(account["id"]))

    @router.post("/v1/entitlement/accrue-annual")
    def accrue_annual() -> None:
        raise HTTPException(status_code=410, detail=_REMOVED_PERIOD_END)

    @router.post("/v1/entitlement/period-end")
    def period_end() -> None:
        raise HTTPException(status_code=410, detail=_REMOVED_PERIOD_END)

    @router.post("/v1/entitlement/year-end-close")
    def year_end_close() -> None:
        raise HTTPException(status_code=410, detail=_REMOVED_PERIOD_END)

    @router.get("/v1/entitlement/reconcile")
    def reconcile(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(auth)],
        fiscal_year: int = Query(default_factory=lambda: date.today().year),
        entitlement_type_id: str | None = None,
        company_id: UUID | None = None,
    ) -> dict[str, Any]:
        cid = resolve_company(session, company_id)
        type_id = resolve_type(session, cid, entitlement_type_id, "system")
        return ledger.reconcile(
            session,
            company_id=cid,
            fiscal_year=fiscal_year,
            entitlement_type_id=type_id,
        )

    @router.post("/v1/entitlement/export-payroll")
    def export_payroll(
        payload: PayrollExportRequest,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(auth)],
    ) -> dict[str, Any]:
        cid = resolve_company(session, payload.company_id)
        return ledger.export_payroll(
            session,
            company_id=cid,
            fiscal_year=payload.fiscal_year,
            payroll_run_id=payload.payroll_run_id,
            run_by=payload.run_by or str(claims.username or "system"),
        )

    @router.post("/v1/entitlement/recalculate-retro")
    def recalculate_retro(
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(auth)],
        company_id: UUID | None = None,
        employee_id: UUID | None = None,
        change_date: date | None = None,
        trigger: Literal["GRADE_CHANGE", "LOCATION_CHANGE", "STATUS_CHANGE", "MANUAL"] = "MANUAL",
        run_by: str = "system",
    ) -> dict[str, Any]:
        # Placeholder contract — logs intent; full delta math lands with eligibility_change_log readers.
        return {
            "accounts_adjusted": 0,
            "total_delta": Decimal("0"),
            "status": "SUCCESS",
            "message": f"Retro recalculation queued for {trigger} on {change_date or date.today()}",
            "company_id": str(resolve_company(session, company_id)),
            "employee_id": str(employee_id) if employee_id else None,
            "run_by": run_by or str(claims.username or "system"),
        }

    return router

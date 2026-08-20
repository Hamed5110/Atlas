"""FastAPI composition root for the complete Airfare Management service."""

import hashlib
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Generator, Mapping, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Any, Literal
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import delete, func, inspect, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from airfare_management.application.contracts import (
    AllocationPreview,
    AllocationQueryHandler,
    PreviewAllocation,
)
from airfare_management.config import Settings, get_settings
from airfare_management.domain.models import DomainError
from airfare_management.domain.services import (
    AIRFARE_CYCLE_DAYS,
    EntitlementScenario,
    ExcessSettlementOption,
    LoanInstallment,
    atlas_round,
    build_amortization_schedule,
    calculate_emi,
    calculate_entitlement_scenario,
    conditional_format,
    fn_atlas_airfare_amount,
    quantize_money,
    resolve_preferences,
    settle_excess_ticket,
)
from airfare_management.infrastructure.backup import (
    create_logical_backup,
    create_native_mssql_backup,
    list_backups,
    prune_backups,
    resolve_backup_file,
    resolve_mssql_login,
    restore_logical_backup,
    restore_native_mssql,
)
from airfare_management.infrastructure.database import (
    Base,
    EmployeeRow,
    actor_context,
    correlation_context,
    create_session_factory,
    ip_context,
    session_context,
)
from airfare_management.infrastructure.documents import (
    EMPLOYEE_COLUMNS,
    build_import_template,
    build_pdf_report,
    export_workbook,
    list_import_templates,
    parse_employee_workbook,
    parse_opening_balance_workbook,
)
from airfare_management.infrastructure.repositories import LoanRepository
from airfare_management.infrastructure.schema import (
    AttachmentRow,
    CompanyRow,
    EntitlementRateRow,
    EssRequestRow,
    LoanInstallmentRow,
    LoanPaymentRow,
    LoanRow,
    LookupRow,
    OpeningBalanceRow,
    PasswordHistoryRow,
    PreferenceRow,
    RefreshTokenRow,
    TicketRow,
    UserRow,
)
from airfare_management.infrastructure.security import (
    create_refresh_token,
    decode_access_token,
    hash_password,
    hash_refresh_token,
    issue_access_token,
    require_roles,
    verify_password,
)
from airfare_management.shared import correlation_id

LOGGER = logging.getLogger("airfare.api")
DEFAULT_COMPANY_ID = "11111111-1111-1111-1111-111111111111"
DEFAULT_LOOKUPS: tuple[tuple[str, str, str], ...] = (
    ("departments", "FIN", "Finance"),
    ("departments", "OPS", "Operations"),
    ("departments", "HR", "Human Resources"),
    ("pay_groups", "PG1", "Pay Group 1"),
    ("pay_groups", "PG2", "Pay Group 2"),
    ("repair_centers", "HQ", "Head Office"),
    ("designations", "OFF", "Officer"),
    ("nationalities", "BH", "Bahraini"),
    ("sub_sections", "GEN", "General"),
)
DEFAULT_PREFERENCES: tuple[tuple[str, str], ...] = (
    ("global_company_preference_rate", "150"),
    ("global_company_preference_days", "60"),
    ("airfare_rate", "150"),
    ("airfare_rate_days", "60"),
    ("max_entitlement_cap_rate", "150"),
)
EMPLOYEE_API_FIELDS = (
    "id",
    "code",
    "full_name",
    "company_id",
    "join_date",
    "department",
    "branch",
    "email",
    "pay_group",
    "custom_airfare_rate",
    "max_entitlement_cap_rate",
    "active",
    "version",
)


class ApiModel(BaseModel):
    """Base request model with strict unknown-field handling."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class LoginRequest(ApiModel):
    """Username/password login payload."""

    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)


class RefreshRequest(ApiModel):
    """Refresh-token rotation payload."""

    refresh_token: str = Field(min_length=40, max_length=200)


class PasswordChange(ApiModel):
    """Authenticated password-change payload."""

    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=12, max_length=200)


class UserCreate(ApiModel):
    """Administrative user creation payload."""

    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=12, max_length=200)
    display_name: str = Field(min_length=1, max_length=200)
    roles: set[Literal["SYSTEM_ADMIN", "HR_MANAGER", "FINANCE_MANAGER", "EMPLOYEE"]] = Field(
        min_length=1
    )
    employee_id: UUID | None = None


class CompanyCreate(ApiModel):
    """Company creation payload."""

    code: str = Field(min_length=1, max_length=30, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=2, max_length=200)
    currency: str = Field(default="USD", min_length=3, max_length=3)


class EmployeeCreate(ApiModel):
    """Employee creation payload."""

    code: str = Field(min_length=1, max_length=30, pattern=r"^[A-Za-z0-9_-]+$")
    full_name: str = Field(min_length=2, max_length=200)
    company_id: UUID
    join_date: date
    department: str = Field(default="", max_length=100)
    branch: str = Field(default="", max_length=100)
    pay_group: str = Field(default="", max_length=100)
    email: EmailStr | None = None
    custom_airfare_rate: Decimal | None = Field(default=None, ge=0)
    max_entitlement_cap_rate: Decimal | None = Field(default=None, ge=0)


class EmployeeUpdate(ApiModel):
    """Mutable employee profile fields."""

    full_name: str = Field(min_length=2, max_length=200)
    join_date: date
    department: str = Field(default="", max_length=100)
    branch: str = Field(default="", max_length=100)
    pay_group: str | None = Field(default=None, max_length=100)
    email: EmailStr | None = None
    custom_airfare_rate: Decimal | None = Field(default=None, ge=0)
    max_entitlement_cap_rate: Decimal | None = Field(default=None, ge=0)
    active: bool = True


class BalanceCreate(ApiModel):
    """Opening balance creation payload."""

    employee_id: UUID
    balance_year: int = Field(ge=2000, le=2200)
    opening_days: Decimal = Field(ge=0, le=60)
    paid_days: Decimal = Field(default=Decimal("0"), ge=0, le=60)
    opening_amount: Decimal = Field(ge=0)
    maximum_payout: Decimal = Field(ge=0)


class BalanceUpdate(ApiModel):
    """Mutable opening-balance values."""

    opening_days: Decimal = Field(ge=0, le=60)
    paid_days: Decimal = Field(ge=0, le=60)
    opening_amount: Decimal = Field(ge=0)
    maximum_payout: Decimal = Field(ge=0)


class EntitlementRequest(ApiModel):
    """Scenario-aware entitlement preview."""

    scenario: EntitlementScenario = EntitlementScenario.EXISTING
    target_date: date = Field(default_factory=date.today)
    allocation_year: int = Field(default_factory=lambda: date.today().year, ge=2000, le=2200)
    opening_days: Decimal = Field(ge=0)
    paid_days: Decimal = Field(ge=0)
    maximum_payout: Decimal = Field(ge=0)
    join_date: date | None = None
    previous_allocation_date: date | None = None
    carry_forward_cap: Decimal = Field(default=Decimal("30"), ge=0)
    current_working_days: int | None = Field(default=None, ge=0, le=360)


class AllocationPreviewRequest(ApiModel):
    """Airfare allocation engine preview payload."""

    employee_id: UUID | None = None
    as_of_date: date
    date_of_joining: date | None = None
    last_ticket_date: date | None = None
    opening_balance_days: Decimal | None = Field(default=None, ge=0)
    opening_balance_amount: Decimal | None = Field(default=None, ge=0)
    employee_custom_rate: Decimal | None = Field(default=None, ge=0)
    pay_group_rate: Decimal | None = Field(default=None, ge=0)
    global_company_preference_rate: Decimal | None = Field(default=None, ge=0)
    global_company_preference_days: Decimal | None = Field(default=None, gt=0)
    max_entitlement_cap_rate: Decimal | None = Field(default=None, ge=0)
    requested_ticket_amount: Decimal | None = Field(default=None, ge=0)
    excess_option: ExcessSettlementOption | None = None
    tenure_months: int | None = Field(default=None, ge=1, le=600)

    @field_validator(
        "employee_id",
        "date_of_joining",
        "last_ticket_date",
        "opening_balance_days",
        "opening_balance_amount",
        "employee_custom_rate",
        "pay_group_rate",
        "global_company_preference_rate",
        "global_company_preference_days",
        "max_entitlement_cap_rate",
        "requested_ticket_amount",
        "excess_option",
        "tenure_months",
        mode="before",
    )
    @classmethod
    def _blank_to_none(cls, value: object) -> object:
        if value == "" or value is None:
            return None
        return value


class AllocationIssueRequest(ApiModel):
    """Issue a ticket using the allocation engine and persist excess handling."""

    employee_id: UUID
    as_of_date: date
    requested_ticket_amount: Decimal = Field(ge=0)
    excess_option: ExcessSettlementOption | None = None
    tenure_months: int | None = Field(default=None, ge=1, le=600)
    origin_code: str = Field(default="ORG", min_length=3, max_length=3)
    destination_code: str = Field(default="DST", min_length=3, max_length=3)
    notes: str = Field(default="", max_length=4000)

    @field_validator("excess_option", "tenure_months", mode="before")
    @classmethod
    def _blank_issue_to_none(cls, value: object) -> object:
        if value == "" or value is None:
            return None
        return value


class LoanPreviewRequest(ApiModel):
    """Loan calculation payload."""

    principal: Decimal = Field(gt=0)
    annual_rate: Decimal = Field(ge=0, le=100)
    installments: int = Field(gt=0, le=600)


class RunEmiRequest(ApiModel):
    """Generate reducing-balance EMI schedules for an employee's active loans."""

    employee_id: UUID


class TicketCreate(ApiModel):
    """Ticket workflow creation payload."""

    employee_id: UUID
    travel_date: date
    origin_code: str = Field(min_length=3, max_length=3)
    destination_code: str = Field(min_length=3, max_length=3)
    ticket_cost: Decimal = Field(ge=0)
    entitlement: Decimal = Field(ge=0)
    company_paid: Decimal = Field(ge=0)
    excess_handling: Literal["CONVERT_TO_LOAN", "COMPANY_PAID", "SELF_PAID"] = "SELF_PAID"
    notes: str = Field(default="", max_length=4000)


class StatusChange(ApiModel):
    """Workflow status transition payload."""

    status: Literal["draft", "submitted", "approved", "rejected", "paid"]


class LoanCreate(LoanPreviewRequest):
    """Loan creation payload."""

    employee_id: UUID
    source_ticket_id: str | None = None
    first_due_date: date


class PaymentCreate(ApiModel):
    """Loan recovery posting payload."""

    amount: Decimal = Field(gt=0)
    paid_on: date
    reference: str = Field(default="", max_length=100)


class LoanDeferRequest(ApiModel):
    """Loan deferment request."""

    deferred_until: date


class LoanRestructureRequest(ApiModel):
    """Replacement terms for a current loan balance."""

    annual_rate: Decimal = Field(ge=0, le=100)
    installments: int = Field(gt=0, le=600)
    first_due_date: date


class BulkSettlementItem(ApiModel):
    """One item in an atomic settlement batch."""

    loan_id: UUID
    amount: Decimal = Field(gt=0)
    paid_on: date
    reference: str = Field(default="", max_length=100)


class BulkSettlementRequest(ApiModel):
    """Atomic group of loan settlements."""

    items: list[BulkSettlementItem] = Field(min_length=1, max_length=500)


class PreferenceUpsert(ApiModel):
    """Preference layer update."""

    scope_type: Literal[
        "global",
        "pay_group",
        "repair_center",
        "user",
        "default",
        "company",
        "branch",
        "department",
    ]
    scope_id: str = Field(default="", max_length=100)
    preference_key: str = Field(min_length=1, max_length=200)
    value: Any
    is_locked: bool = False


class LookupUpsert(ApiModel):
    """Reference lookup creation payload."""

    code: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=200)
    active: bool = True


class RateCreate(ApiModel):
    """Effective-dated entitlement rate."""

    scope_type: Literal["global", "company", "pay_group", "employee"]
    scope_id: str = Field(default="", max_length=100)
    amount: Decimal = Field(ge=0)
    effective_from: date
    effective_to: date | None = None
    cap_amount: Decimal | None = Field(default=None, ge=0)


class EssRequestCreate(ApiModel):
    """Employee self-service airfare request."""

    employee_id: UUID
    request_type: Literal["airfare", "ticket", "loan"]
    travel_date: date
    origin_code: str = Field(min_length=3, max_length=3)
    destination_code: str = Field(min_length=3, max_length=3)
    notes: str = Field(default="", max_length=4000)


class EmployeeImportCommitRow(ApiModel):
    """One employee row selected for import."""

    row: int = Field(ge=1)
    code: str = Field(min_length=1, max_length=30, pattern=r"^[A-Za-z0-9_-]+$")
    full_name: str = Field(min_length=2, max_length=200)
    company_id: UUID
    join_date: date
    department: str = Field(default="", max_length=100)
    branch: str = Field(default="", max_length=100)
    pay_group: str = Field(default="", max_length=100)
    email: EmailStr | None = None
    custom_airfare_rate: Decimal | None = Field(default=None, ge=0)
    max_entitlement_cap_rate: Decimal | None = Field(default=None, ge=0)
    selected: bool = True


class EmployeeImportCommit(ApiModel):
    """Commit a verified employee import selection."""

    rows: list[EmployeeImportCommitRow] = Field(min_length=1, max_length=10_000)


class OpeningBalanceImportCommitRow(ApiModel):
    """One opening-balance row selected for import."""

    row: int = Field(ge=1)
    employee_code: str = Field(min_length=1, max_length=30)
    employee_id: UUID
    balance_year: int = Field(ge=2000, le=2200)
    opening_days: Decimal = Field(ge=0, le=60)
    paid_days: Decimal = Field(default=Decimal("0"), ge=0, le=60)
    opening_amount: Decimal = Field(ge=0)
    maximum_payout: Decimal = Field(ge=0)
    selected: bool = True


class OpeningBalanceImportCommit(ApiModel):
    """Commit a verified opening-balance import selection."""

    rows: list[OpeningBalanceImportCommitRow] = Field(min_length=1, max_length=10_000)


class EraseDataRequest(ApiModel):
    """Destructive operational reset confirmation."""

    confirm: Literal["ERASE_ALL_DATA"]


class BackupCreateRequest(ApiModel):
    """Create a catalogued database backup."""

    kind: Literal["logical", "mssql"] = "logical"


class BackupRestoreRequest(ApiModel):
    """Restore from a catalogued backup file."""

    file_name: str = Field(min_length=1, max_length=260)
    confirm: Literal["RESTORE_CONFIRM"]


ReportName = Literal[
    "employee-master",
    "opening-balances",
    "entitlements",
    "ticket-register",
    "loan-outstanding",
    "loan-statement",
    "excess-recovery",
]

TemplateName = Literal[
    "employees",
    "opening-balances",
    "tickets",
    "loans",
    "ess-requests",
    "lookups",
    "entitlement-rates",
    "entitlement-preview",
    "allocation-preview",
    "report-employee-master",
    "report-opening-balances",
    "report-entitlements",
    "report-ticket-register",
    "report-loan-outstanding",
    "report-excess-recovery",
    "report-loan-statement",
]


class Claims(BaseModel):
    """Validated access-token claims."""

    subject: UUID
    roles: set[str]
    username: str | None = None


def _row(row: object, *fields: str) -> dict[str, Any]:
    return {field: getattr(row, field) for field in fields}


def _with_employee_fields(body: dict[str, Any], employee: EmployeeRow | None) -> dict[str, Any]:
    """Attach human-readable employee code/name used by HCM list screens."""
    if employee is None:
        body["employee_code"] = None
        body["employee_name"] = None
        body["employee_label"] = str(body.get("employee_id") or "—")
        return body
    body["employee_code"] = employee.code
    body["employee_name"] = employee.full_name
    body["employee_label"] = f"{employee.code} — {employee.full_name}"
    return body


def _attach_employees(session: Session, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Resolve UUID employee_id values to ERPNext-style employee numbers for display."""
    identifiers = [row.get("employee_id") for row in rows if row.get("employee_id")]
    if not identifiers:
        return rows
    people = {
        str(employee.id): employee
        for employee in session.scalars(
            select(EmployeeRow).where(EmployeeRow.id.in_(identifiers))
        )
    }
    return [
        _with_employee_fields(row, people.get(str(row.get("employee_id"))))
        for row in rows
    ]


def _decimal_text(value: Decimal | None, places: int | None = None) -> str | None:
    """Serialize a Decimal without scientific notation."""
    if value is None:
        return None
    if places is not None:
        value = atlas_round(value, places)
    return format(value, "f")


def _ticket_display(ticket: TicketRow) -> dict[str, Any]:
    """Public sequential ticket identifiers shown in the UI."""
    return {
        "ticket_number": ticket.ticket_number,
        "ticket_code": ticket.ticket_code,
    }


def _loan_display(loan: LoanRow | None) -> dict[str, Any]:
    """Public sequential loan identifiers shown in the UI."""
    if loan is None:
        return {"loan_id": None, "loan_number": None, "loan_code": None}
    return {
        "loan_id": loan.id,
        "loan_number": loan.loan_number,
        "loan_code": loan.loan_code,
    }


def _allocation_saved_message(ticket: TicketRow, loan: LoanRow | None) -> str:
    """Build the Issue success banner text."""
    ticket_label = ticket.ticket_code or "ticket"
    parts = [f"Allocation saved. Ticket {ticket_label} created."]
    if loan is not None:
        loan_label = loan.loan_code or "loan"
        parts.append(f"Loan {loan_label} created.")
    if ticket.excess_handling:
        parts.append(f"Excess option: {ticket.excess_handling}.")
    return " ".join(parts)


def _as_decimal(value: object) -> Decimal | None:
    """Coerce JSON/preference values to Decimal."""
    if value is None or value == "":
        return None
    return Decimal(str(value))


def _installment_payload(part: LoanInstallment | LoanInstallmentRow) -> dict[str, Any]:
    """Serialize one EMI installment for API and report consumers."""
    due = part.due_date
    return {
        "number": part.number,
        "due_date": due.isoformat() if hasattr(due, "isoformat") else due,
        "opening_balance": part.opening_balance,
        "principal": part.principal,
        "interest": part.interest,
        "payment": part.payment,
        "closing_balance": part.closing_balance,
    }


def _employee_username_map(session: Session, employee_ids: Sequence[UUID]) -> dict[UUID, str]:
    """Map employee identifiers to linked usernames."""
    if not employee_ids:
        return {}
    return {
        row.employee_id: row.username
        for row in session.execute(
            select(UserRow.employee_id, UserRow.username).where(
                UserRow.employee_id.in_(tuple(employee_ids)),
                UserRow.deleted_at.is_(None),
                UserRow.employee_id.is_not(None),
            )
        )
        if row.employee_id is not None
    }


def _allocation_response(
    preview: AllocationPreview,
    *,
    date_of_joining: date | None = None,
    employee: EmployeeRow | None = None,
    username: str | None = None,
) -> dict[str, Any]:
    """Serialize an allocation engine preview for the API."""
    entitlement = preview.entitlement
    remaining = entitlement.total_entitlement_days
    ticket = preview.requested_ticket_amount
    excess = Decimal("0")
    if ticket is not None:
        excess = max(Decimal("0"), ticket - entitlement.final_entitlement_amount)
    body: dict[str, Any] = {
        "scenario": entitlement.scenario.value,
        "accrual_start": entitlement.accrual_start.isoformat(),
        "accrued_days": _decimal_text(entitlement.accrued_days),
        "current_year_earned_days": _decimal_text(entitlement.accrued_days),
        "daily_rate": _decimal_text(entitlement.daily_rate, 4),
        "airfare_rate": _decimal_text(entitlement.airfare_rate),
        "max_payout": _decimal_text(entitlement.airfare_rate),
        "rate_source": entitlement.rate_source.value,
        "rate_days": _decimal_text(entitlement.rate_days),
        "calculated_entitlement_amount": _decimal_text(entitlement.calculated_entitlement_amount),
        "current_year_amount": _decimal_text(entitlement.current_year_amount),
        "current_year_earned_amount": _decimal_text(entitlement.current_year_amount),
        "total_entitlement_days": _decimal_text(remaining),
        "remaining_days": _decimal_text(remaining),
        "days_left": _decimal_text(remaining),
        "opening_balance_days": _decimal_text(entitlement.opening_balance_days),
        "opening_balance_amount": _decimal_text(entitlement.opening_balance_amount),
        "final_entitlement_amount": _decimal_text(entitlement.final_entitlement_amount),
        "entitlement_amount": _decimal_text(entitlement.final_entitlement_amount),
        "max_entitlement_cap_rate": _decimal_text(entitlement.max_entitlement_cap_rate),
        "last_ticket_date": (
            entitlement.last_ticket_date.isoformat() if entitlement.last_ticket_date else None
        ),
        "previous_allocation_date": (
            entitlement.last_ticket_date.isoformat() if entitlement.last_ticket_date else None
        ),
        "date_of_joining": date_of_joining.isoformat() if date_of_joining else None,
        "join_date": date_of_joining.isoformat() if date_of_joining else None,
        "already_paid_days": _decimal_text(entitlement.already_paid_days),
        "already_paid_amount": _decimal_text(entitlement.already_paid_amount),
        "current_year_remaining": _decimal_text(entitlement.current_year_remaining),
        "total_available_funds": _decimal_text(entitlement.total_available_funds),
        "eligible_balance_days": _decimal_text(remaining),
        "airfare_entitlement_amount": _decimal_text(entitlement.final_entitlement_amount),
        "per_day_rate": _decimal_text(entitlement.daily_rate, 4),
        "maximum_payout": _decimal_text(entitlement.airfare_rate),
    }
    if ticket is not None:
        body.update(
            {
                "requested_ticket_amount": _decimal_text(ticket),
                "excess_cost": _decimal_text(excess),
                "excess_requires_choice": bool(excess > 0 and preview.settlement is None),
            }
        )
    if employee is not None:
        body.update(
            {
                "employee_id": str(employee.id),
                "employee_code": employee.code,
                "employee_name": employee.full_name,
                "username": username,
                "pay_group": employee.pay_group,
            }
        )
    if preview.settlement is not None:
        settlement = preview.settlement
        body.update(
            {
                "requested_ticket_amount": _decimal_text(settlement.requested_ticket_amount),
                "excess_cost": _decimal_text(settlement.excess_cost),
                "excess_option": settlement.option.value,
                "employee_payable": _decimal_text(settlement.employee_payable),
                "company_payout": _decimal_text(settlement.company_payout),
                "loan_principal": _decimal_text(settlement.loan_principal),
                "emi": _decimal_text(settlement.emi),
                "tenure_months": settlement.tenure_months,
                "loan_status": settlement.loan_status,
                "excess_requires_choice": False,
            }
        )
    return body


def _problem(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "type": f"https://airfare.local/problems/{code}",
            "title": "Request rejected",
            "status": status,
            "code": code,
            "detail": detail,
            "correlation_id": correlation_context.get() or "",
        },
    )


def _preference_decimal(session: Session, key: str, default: Decimal | None = None) -> Decimal | None:
    """Read a global preference as Decimal."""
    item = session.scalar(
        select(PreferenceRow).where(
            PreferenceRow.scope_type == "global",
            PreferenceRow.scope_id == "",
            PreferenceRow.preference_key == key,
            PreferenceRow.deleted_at.is_(None),
        )
    )
    value = _as_decimal(None if item is None else item.value)
    return value if value is not None else default


def _employee_lookup(session: Session) -> dict[str, EmployeeRow]:
    """Return active employees keyed by lower-case code."""
    return {
        employee.code.casefold(): employee
        for employee in session.scalars(
            select(EmployeeRow).where(EmployeeRow.deleted_at.is_(None))
        )
    }


def _preview_employee_import(
    session: Session, records: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Validate employee workbook rows for preview and selection."""
    preview_rows: list[dict[str, Any]] = []
    seen_codes: set[tuple[str, str]] = set()
    existing_codes: set[tuple[str, str]] = {
        (employee.company_id, employee.code.casefold())
        for employee in session.scalars(
            select(EmployeeRow).where(EmployeeRow.deleted_at.is_(None))
        )
    }
    for record in records:
        row_number = int(record.get("_row") or 0)
        try:
            candidate = EmployeeCreate.model_validate(
                {key: value for key, value in record.items() if key != "_row"}
            )
            key = (str(candidate.company_id), candidate.code.casefold())
            duplicate_file = key in seen_codes
            duplicate_db = key in existing_codes
            if session.get(CompanyRow, str(candidate.company_id)) is None:
                preview_rows.append(
                    {
                        "row": row_number,
                        **candidate.model_dump(mode="json"),
                        "severity": "ERROR",
                        "status": "ERROR",
                        "message": "Company reference does not exist.",
                        "selected": False,
                        "action": None,
                    }
                )
            elif duplicate_file or duplicate_db:
                preview_rows.append(
                    {
                        "row": row_number,
                        **candidate.model_dump(mode="json"),
                        "severity": "ERROR",
                        "status": "ERROR",
                        "message": "Duplicate employee code.",
                        "selected": False,
                        "action": "UPDATE" if duplicate_db else None,
                    }
                )
            else:
                seen_codes.add(key)
                preview_rows.append(
                    {
                        "row": row_number,
                        **candidate.model_dump(mode="json"),
                        "severity": "READY",
                        "status": "READY",
                        "message": "Ready for import.",
                        "selected": True,
                        "action": "INSERT",
                    }
                )
        except Exception as exc:
            preview_rows.append(
                {
                    "row": row_number,
                    "code": record.get("code"),
                    "full_name": record.get("full_name"),
                    "company_id": record.get("company_id"),
                    "join_date": record.get("join_date"),
                    "severity": "ERROR",
                    "status": "ERROR",
                    "message": str(exc),
                    "selected": False,
                    "action": None,
                }
            )
    return preview_rows


def _preview_opening_balance_import(
    session: Session, records: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Validate opening-balance workbook rows for preview and selection."""
    employees = _employee_lookup(session)
    rate = _preference_decimal(session, "global_company_preference_rate", Decimal("150"))
    maximum_payout = Decimal(str(rate or "150"))
    preview_rows: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, int]] = set()
    existing_balances = {
        (balance.employee_id, balance.balance_year): balance
        for balance in session.scalars(
            select(OpeningBalanceRow).where(OpeningBalanceRow.deleted_at.is_(None))
        )
    }
    for record in records:
        row_number = int(record.get("_row") or 0)
        employee_code = str(record.get("employee_code") or "").strip()
        try:
            balance_year = int(record["balance_year"])
            opening_days = Decimal(str(record["opening_days"]))
            paid_days = Decimal(str(record.get("paid_days") or "0"))
            maximum_payout = Decimal(str(record.get("maximum_payout") or rate or "150"))
            opening_amount = record.get("opening_amount")
            if opening_amount in (None, ""):
                opening_amount = fn_atlas_airfare_amount(opening_days, maximum_payout)
            else:
                opening_amount = Decimal(str(opening_amount))
            employee = employees.get(employee_code.casefold())
            duplicate_file = (employee_code.casefold(), balance_year) in seen_keys
            if not employee_code:
                message = "Employee code is required."
                severity = "ERROR"
            elif employee is None:
                message = "Employee code not found in Employee Master."
                severity = "ERROR"
            elif duplicate_file:
                message = "Duplicate employee/year inside this Excel file."
                severity = "ERROR"
            else:
                seen_keys.add((employee_code.casefold(), balance_year))
                message = "Ready for import."
                severity = "READY"
            existing = None if employee is None else existing_balances.get((employee.id, balance_year))
            preview_rows.append(
                {
                    "row": row_number,
                    "employee_code": employee_code,
                    "employee_id": str(employee.id) if employee is not None else None,
                    "employee_name": employee.full_name if employee is not None else record.get("employee_name"),
                    "balance_year": balance_year,
                    "opening_days": _decimal_text(opening_days),
                    "paid_days": _decimal_text(paid_days),
                    "opening_amount": _decimal_text(opening_amount),
                    "maximum_payout": _decimal_text(maximum_payout),
                    "severity": severity,
                    "status": severity,
                    "message": message,
                    "selected": severity == "READY",
                    "action": "UPDATE" if existing is not None else "INSERT",
                }
            )
        except Exception as exc:
            preview_rows.append(
                {
                    "row": row_number,
                    "employee_code": employee_code,
                    "employee_id": None,
                    "balance_year": record.get("balance_year"),
                    "opening_days": record.get("opening_days"),
                    "severity": "ERROR",
                    "status": "ERROR",
                    "message": str(exc),
                    "selected": False,
                    "action": None,
                }
            )
    return preview_rows


def _import_summary(rows: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    """Summarize import preview rows."""
    return {
        "total": len(rows),
        "ready": sum(1 for row in rows if row.get("severity") == "READY"),
        "errors": sum(1 for row in rows if row.get("severity") == "ERROR"),
        "selected": sum(1 for row in rows if row.get("selected")),
    }


def _collect_report_rows(
    session: Session, report_name: ReportName
) -> tuple[list[str], list[tuple[Any, ...]]]:
    """Return report column headers and row tuples."""
    if report_name == "employee-master":
        columns = ("Code", "Employee", "Department", "Branch", "Join date", "Email", "Status")
        rows = [
            (
                item.code,
                item.full_name,
                item.department,
                item.branch,
                item.join_date.isoformat(),
                item.email or "",
                "Active" if item.active else "Inactive",
            )
            for item in session.scalars(
                select(EmployeeRow)
                .where(EmployeeRow.deleted_at.is_(None))
                .order_by(EmployeeRow.code)
            )
        ]
        return list(columns), rows
    if report_name == "opening-balances":
        columns = (
            "Employee",
            "Name",
            "Year",
            "Opening days",
            "Paid days",
            "Opening amount",
            "Maximum payout",
        )
        query = (
            select(OpeningBalanceRow, EmployeeRow)
            .join(EmployeeRow, EmployeeRow.id == OpeningBalanceRow.employee_id)
            .where(OpeningBalanceRow.deleted_at.is_(None))
            .order_by(EmployeeRow.code, OpeningBalanceRow.balance_year)
        )
        rows = [
            (
                employee.code,
                employee.full_name,
                balance.balance_year,
                balance.opening_days,
                balance.paid_days,
                balance.opening_amount,
                balance.maximum_payout,
            )
            for balance, employee in session.execute(query)
        ]
        return list(columns), rows
    if report_name == "entitlements":
        columns = ("Scope", "Scope ID", "Amount", "Effective from", "Effective to", "Cap")
        rows = [
            (
                item.scope_type,
                item.scope_id,
                item.amount,
                item.effective_from.isoformat(),
                item.effective_to.isoformat() if item.effective_to else "",
                item.cap_amount or "",
            )
            for item in session.scalars(
                select(EntitlementRateRow)
                .where(EntitlementRateRow.deleted_at.is_(None))
                .order_by(EntitlementRateRow.effective_from.desc())
            )
        ]
        return list(columns), rows
    if report_name == "ticket-register":
        columns = (
            "Travel date",
            "Employee",
            "Route",
            "Ticket cost",
            "Entitlement",
            "Company paid",
            "Excess",
            "Status",
        )
        query = (
            select(TicketRow, EmployeeRow)
            .join(EmployeeRow, EmployeeRow.id == TicketRow.employee_id)
            .where(TicketRow.deleted_at.is_(None))
            .order_by(TicketRow.travel_date.desc())
        )
        rows = [
            (
                ticket.travel_date.isoformat(),
                employee.code,
                f"{ticket.origin_code}-{ticket.destination_code}",
                ticket.ticket_cost,
                ticket.entitlement,
                ticket.company_paid,
                ticket.excess_amount,
                ticket.status,
            )
            for ticket, employee in session.execute(query)
        ]
        return list(columns), rows
    if report_name == "loan-outstanding":
        columns = (
            "Employee",
            "Principal",
            "Outstanding",
            "Monthly installment",
            "Installments",
            "Status",
        )
        query = (
            select(LoanRow, EmployeeRow)
            .join(EmployeeRow, EmployeeRow.id == LoanRow.employee_id)
            .where(LoanRow.deleted_at.is_(None))
            .order_by(LoanRow.outstanding.desc())
        )
        rows = [
            (
                employee.code,
                loan.principal,
                loan.outstanding,
                loan.monthly_installment,
                loan.installments,
                loan.status,
            )
            for loan, employee in session.execute(query)
        ]
        return list(columns), rows
    if report_name == "loan-statement":
        columns = (
            "Employee",
            "Loan ID",
            "Date",
            "Description",
            "Debit",
            "Credit",
            "Installment #",
            "Due date",
            "Principal",
            "Interest",
            "Payment",
            "Outstanding",
        )
        query = (
            select(LoanRow, EmployeeRow)
            .join(EmployeeRow, EmployeeRow.id == LoanRow.employee_id)
            .where(LoanRow.deleted_at.is_(None))
            .order_by(EmployeeRow.code, LoanRow.created_at, LoanRow.id)
        )
        repo = LoanRepository(session)
        rows: list[tuple[Any, ...]] = []
        for loan, employee in session.execute(query):
            persisted = repo.schedule(loan.id)
            schedule: Sequence[LoanInstallment | LoanInstallmentRow] = persisted or build_amortization_schedule(
                loan.principal, loan.annual_rate, loan.installments, loan.first_due_date
            )
            opened = loan.first_due_date.isoformat()
            rows.append(
                (
                    employee.code,
                    loan.id,
                    opened,
                    "Loan opened",
                    loan.principal,
                    Decimal("0"),
                    "",
                    opened,
                    loan.principal,
                    Decimal("0"),
                    Decimal("0"),
                    loan.principal,
                )
            )
            for part in schedule:
                due = part.due_date.isoformat() if hasattr(part.due_date, "isoformat") else str(part.due_date)
                rows.append(
                    (
                        employee.code,
                        loan.id,
                        due,
                        f"EMI {part.number}",
                        part.payment,
                        Decimal("0"),
                        part.number,
                        due,
                        part.principal,
                        part.interest,
                        part.payment,
                        part.closing_balance,
                    )
                )
            payments = session.scalars(
                select(LoanPaymentRow)
                .where(
                    LoanPaymentRow.loan_id == loan.id,
                    LoanPaymentRow.deleted_at.is_(None),
                )
                .order_by(LoanPaymentRow.paid_on, LoanPaymentRow.id)
            )
            remaining = loan.principal
            for payment in payments:
                remaining = max(Decimal("0"), remaining - payment.amount)
                paid_on = payment.paid_on.isoformat()
                rows.append(
                    (
                        employee.code,
                        loan.id,
                        paid_on,
                        f"Payment {payment.reference or payment.id}",
                        Decimal("0"),
                        payment.amount,
                        "",
                        paid_on,
                        payment.amount,
                        Decimal("0"),
                        payment.amount,
                        remaining,
                    )
                )
        return list(columns), rows
    columns = (
        "Travel date",
        "Employee",
        "Route",
        "Ticket cost",
        "Entitlement",
        "Excess",
        "Status",
    )
    query = (
        select(TicketRow, EmployeeRow)
        .join(EmployeeRow, EmployeeRow.id == TicketRow.employee_id)
        .where(
            TicketRow.deleted_at.is_(None),
            TicketRow.company_paid > TicketRow.entitlement,
        )
        .order_by(TicketRow.travel_date.desc())
    )
    rows = [
        (
            ticket.travel_date.isoformat(),
            employee.code,
            f"{ticket.origin_code}-{ticket.destination_code}",
            ticket.ticket_cost,
            ticket.entitlement,
            ticket.excess_amount,
            ticket.status,
        )
        for ticket, employee in session.execute(query)
    ]
    return list(columns), rows


def _commit_employee_import(session: Session, payload: EmployeeImportCommit) -> dict[str, Any]:
    """Persist selected employee import rows after validation."""
    selected = [row for row in payload.rows if row.selected]
    if not selected:
        raise DomainError("no_rows_selected", "Select at least one valid row to import.")
    preview = _preview_employee_import(
        session,
        [row.model_dump() | {"_row": row.row} for row in selected],
    )
    if any(row["severity"] != "READY" for row in preview):
        raise DomainError("invalid_import_rows", "One or more selected rows failed validation.")
    now = datetime.now(UTC)
    imported = 0
    for row in selected:
        fields = row.model_dump(exclude={"row", "selected"})
        fields["company_id"] = str(fields["company_id"])
        session.add(
            EmployeeRow(
                id=uuid4(),
                active=True,
                version=1,
                created_at=now,
                updated_at=now,
                deleted_at=None,
                **fields,
            )
        )
        imported += 1
    return {"imported": imported, "committed": True}


def _commit_opening_balance_import(
    session: Session, payload: OpeningBalanceImportCommit
) -> dict[str, Any]:
    """Persist selected opening-balance import rows after validation."""
    selected = [row for row in payload.rows if row.selected]
    if not selected:
        raise DomainError("no_rows_selected", "Select at least one valid row to import.")
    preview = _preview_opening_balance_import(
        session,
        [
            {
                "_row": row.row,
                "employee_code": row.employee_code,
                "balance_year": row.balance_year,
                "opening_days": row.opening_days,
                "paid_days": row.paid_days,
                "opening_amount": row.opening_amount,
                "maximum_payout": row.maximum_payout,
            }
            for row in selected
        ],
    )
    if any(row["severity"] != "READY" for row in preview):
        raise DomainError("invalid_import_rows", "One or more selected rows failed validation.")
    now = datetime.now(UTC)
    imported = 0
    updated = 0
    for row in selected:
        existing = session.scalar(
            select(OpeningBalanceRow).where(
                OpeningBalanceRow.employee_id == row.employee_id,
                OpeningBalanceRow.balance_year == row.balance_year,
                OpeningBalanceRow.deleted_at.is_(None),
            )
        )
        values = {
            "opening_days": row.opening_days,
            "paid_days": row.paid_days,
            "opening_amount": row.opening_amount,
            "maximum_payout": row.maximum_payout,
        }
        if existing is None:
            session.add(
                OpeningBalanceRow(
                    id=str(uuid4()),
                    employee_id=row.employee_id,
                    balance_year=row.balance_year,
                    version=1,
                    created_at=now,
                    updated_at=now,
                    deleted_at=None,
                    **values,
                )
            )
            imported += 1
        else:
            for key, value in values.items():
                setattr(existing, key, value)
            existing.updated_at = now
            existing.version += 1
            updated += 1
    return {"imported": imported, "updated": updated, "committed": True}


def _seed_default_preferences(session: Session) -> int:
    """Restore global ATLAS cycle defaults when no live preference row exists."""
    created = 0
    for key, value in DEFAULT_PREFERENCES:
        existing = session.scalar(
            select(PreferenceRow).where(
                PreferenceRow.scope_type == "global",
                PreferenceRow.scope_id == "",
                PreferenceRow.preference_key == key,
                PreferenceRow.deleted_at.is_(None),
            )
        )
        if existing is None:
            session.add(
                PreferenceRow(
                    scope_type="global",
                    scope_id="",
                    preference_key=key,
                    value=value,
                    is_locked=False,
                )
            )
            created += 1
        elif key in {"global_company_preference_days", "airfare_rate_days"} and str(
            existing.value
        ) in {"365", "365.0"}:
            existing.value = "60"
            existing.version += 1
    return created


def _erase_operational_data(session: Session) -> dict[str, int]:
    """Permanently remove transactional airfare data; keep users, companies, and lookups."""
    counts: dict[str, int] = {}
    unlinked = session.execute(
        update(UserRow).values(employee_id=None).where(UserRow.employee_id.is_not(None))
    )
    counts["users_unlinked"] = int(unlinked.rowcount or 0)
    for model in (
        LoanPaymentRow,
        LoanInstallmentRow,
        LoanRow,
        TicketRow,
        OpeningBalanceRow,
        EssRequestRow,
        EntitlementRateRow,
        AttachmentRow,
        PreferenceRow,
        EmployeeRow,
    ):
        result = session.execute(delete(model))
        counts[model.__tablename__] = int(result.rowcount or 0)
    revoked = session.execute(
        delete(RefreshTokenRow).where(RefreshTokenRow.revoked_at.is_(None))
    )
    counts["refresh_tokens"] = int(revoked.rowcount or 0)
    return counts


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create the fully wired API application."""
    config = settings or get_settings()
    sessions = create_session_factory(config)
    web_root = Path(__file__).resolve().parents[1] / "interface" / "web_client"
    if config.environment == "test":
        Base.metadata.create_all(sessions.kw["bind"])
    attachment_root = Path(config.attachment_root).resolve()
    attachment_root.mkdir(parents=True, exist_ok=True)
    preference_cache: dict[tuple[str, ...], tuple[float, dict[str, Any]]] = {}

    if inspect(sessions.kw["bind"]).has_table("users"):
        with sessions.begin() as session:
            if session.get(CompanyRow, DEFAULT_COMPANY_ID) is None:
                session.add(
                    CompanyRow(
                        id=DEFAULT_COMPANY_ID,
                        code="DEFAULT",
                        name="Default Company",
                        currency="USD",
                    )
                )
            if (
                session.scalar(
                    select(UserRow).where(UserRow.username == config.bootstrap_admin_username)
                )
                is None
            ):
                session.add(
                    UserRow(
                        username=config.bootstrap_admin_username,
                        password_hash=hash_password(config.bootstrap_admin_password),
                        display_name="System Administrator",
                        roles=[
                            "SYSTEM_ADMIN",
                            "HR_MANAGER",
                            "FINANCE_MANAGER",
                            "admin",
                            "hr",
                            "manager",
                            "finance",
                            "auditor",
                        ],
                    )
                )
            if config.environment != "test":
                if session.scalar(select(func.count()).select_from(LookupRow)) == 0:
                    now = datetime.now(UTC)
                    for lookup_type, code, name in DEFAULT_LOOKUPS:
                        session.add(
                            LookupRow(
                                lookup_type=lookup_type,
                                code=code,
                                name=name,
                                active=True,
                                created_at=now,
                                updated_at=now,
                            )
                        )
                _seed_default_preferences(session)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        LOGGER.info("api_started", extra={"environment": config.environment, "port": config.port})
        yield
        sessions.kw["bind"].dispose()

    app = FastAPI(
        title="HCM Airfare Management API",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if config.environment != "production" else None,
        redoc_url=None,
    )
    if config.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=config.cors_origins,
            allow_credentials=False,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "If-Match", "X-Correlation-ID"],
        )

    @app.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_correlation_id = correlation_id(request.headers.get("X-Correlation-ID"))
        context_token = correlation_context.set(request_correlation_id)
        ip_token = ip_context.set(request.client.host if request.client else None)
        started = time.perf_counter()
        try:
            response = await call_next(request)
            response.headers["X-Correlation-ID"] = request_correlation_id
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "DENY"
            return response
        finally:
            LOGGER.info(
                "request_completed",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status_ms": round((time.perf_counter() - started) * 1000, 2),
                },
            )
            correlation_context.reset(context_token)
            ip_context.reset(ip_token)

    @app.exception_handler(DomainError)
    async def domain_error(_: Request, error: DomainError) -> JSONResponse:
        status = {
            "invalid_token": 401,
            "token_reuse": 401,
            "account_locked": 403,
            "forbidden": 403,
            "not_found": 404,
            "stale_version": 409,
            "password_reuse": 409,
        }.get(error.code, 422)
        return _problem(status, error.code, str(error))

    @app.exception_handler(IntegrityError)
    async def integrity_error(_: Request, error: IntegrityError) -> JSONResponse:
        LOGGER.warning("database_constraint", exc_info=error)
        return _problem(
            409, "duplicate_or_invalid_reference", "The record conflicts with existing data."
        )

    def database() -> Generator[Session, None, None]:
        with sessions() as session:
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise

    def authenticated(authorization: Annotated[str | None, Header()] = None) -> Claims:
        if not authorization or not authorization.startswith("Bearer "):
            raise DomainError("invalid_token", "A Bearer access token is required.")
        payload = decode_access_token(authorization[7:], config)
        claims = Claims(
            subject=UUID(payload["sub"]),
            roles=set(payload.get("roles", ())),
            username=payload.get("username"),
        )
        actor_context.set(str(claims.subject))
        session_context.set(payload.get("session_id"))
        return claims

    def authorized(*roles: str) -> Callable[[Claims], Claims]:
        def dependency(claims: Annotated[Claims, Depends(authenticated)]) -> Claims:
            aliases = {
                "admin": "SYSTEM_ADMIN",
                "hr": "HR_MANAGER",
                "manager": "HR_MANAGER",
                "finance": "FINANCE_MANAGER",
                "auditor": "FINANCE_MANAGER",
            }
            allowed = set(roles) | {aliases[role] for role in roles if role in aliases}
            require_roles(claims.model_dump(), allowed)
            return claims

        return dependency

    def scoped_employee_id(session: Session, claims: Claims) -> UUID | None:
        """Return an employee restriction for non-privileged identities."""
        privileged = {
            "SYSTEM_ADMIN",
            "HR_MANAGER",
            "FINANCE_MANAGER",
            "admin",
            "hr",
            "manager",
            "finance",
            "auditor",
        }
        if claims.roles.intersection(privileged):
            return None
        user = session.get(UserRow, str(claims.subject))
        if user is None or user.employee_id is None:
            raise DomainError("forbidden", "No employee profile is linked to this account.")
        return user.employee_id

    @app.get("/assets/app.js")
    def web_client_script() -> FileResponse:
        """Serve the SPA script without browser caching so UI updates are visible."""
        return FileResponse(
            web_root / "app.js",
            media_type="text/javascript",
            headers={"Cache-Control": "no-store"},
        )

    app.mount("/assets", StaticFiles(directory=web_root), name="web-assets")

    @app.get("/", response_class=FileResponse)
    @app.get("/app", response_class=FileResponse)
    def landing() -> FileResponse:
        """Serve the browser application shell."""
        return FileResponse(
            web_root / "index.html",
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/favicon.ico")
    def favicon() -> Response:
        """Avoid noisy 404s from browsers requesting a missing icon."""
        return Response(status_code=204)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": "1.0.0", "port": str(config.port)}

    @app.get("/ready")
    def ready(session: Annotated[Session, Depends(database)]) -> dict[str, str]:
        session.scalar(select(func.count()).select_from(CompanyRow))
        return {"status": "ready"}

    @app.post("/v1/auth/login")
    def login(
        payload: LoginRequest, session: Annotated[Session, Depends(database)]
    ) -> dict[str, Any]:
        user = session.scalar(select(UserRow).where(UserRow.username == payload.username))
        now = datetime.now(UTC)
        locked_until = None
        if user is not None and user.locked_until is not None:
            locked_until = (
                user.locked_until.replace(tzinfo=UTC)
                if user.locked_until.tzinfo is None
                else user.locked_until
            )
        if locked_until is not None and locked_until > now:
            raise DomainError("account_locked", "The account is temporarily locked.")
        if (
            user is None
            or not user.active
            or not verify_password(payload.password, user.password_hash)
        ):
            if user is not None:
                user.failed_login_count += 1
                if user.failed_login_count >= 5:
                    user.locked_until = now + timedelta(minutes=30)
                    user.failed_login_count = 0
                session.commit()
            raise DomainError("invalid_token", "Invalid username or password.")
        user.failed_login_count = 0
        user.locked_until = None
        user.last_login_at = now
        session_id = str(uuid4())
        refresh = create_refresh_token()
        refresh_row = RefreshTokenRow(
            user_id=user.id,
            family_id=str(uuid4()),
            token_hash=refresh.digest,
            expires_at=now + timedelta(days=config.refresh_token_days),
            session_id=session_id,
        )
        session.add(refresh_row)
        token = issue_access_token(
            UUID(user.id),
            set(user.roles),
            config,
            username=user.username,
            session_id=session_id,
        )
        return {
            "access_token": token,
            "refresh_token": refresh.value,
            "token_type": "bearer",
            "expires_in": config.access_token_minutes * 60,
        }

    @app.post("/v1/auth/refresh")
    def refresh_access(
        payload: RefreshRequest, session: Annotated[Session, Depends(database)]
    ) -> dict[str, Any]:
        now = datetime.now(UTC)
        token = session.scalar(
            select(RefreshTokenRow).where(
                RefreshTokenRow.token_hash == hash_refresh_token(payload.refresh_token)
            )
        )
        if token is None:
            raise DomainError("invalid_token", "The refresh token is invalid.")
        expires_at = (
            token.expires_at.replace(tzinfo=UTC)
            if token.expires_at.tzinfo is None
            else token.expires_at
        )
        if token.revoked_at is not None or expires_at <= now:
            raise DomainError("invalid_token", "The refresh token is invalid or expired.")
        if token.consumed_at is not None:
            session.query(RefreshTokenRow).filter(
                RefreshTokenRow.family_id == token.family_id
            ).update({RefreshTokenRow.revoked_at: now})
            session.commit()
            raise DomainError("token_reuse", "Refresh-token reuse revoked the session.")
        user = session.get(UserRow, token.user_id)
        if user is None or not user.active:
            raise DomainError("invalid_token", "The account is unavailable.")
        token.consumed_at = now
        replacement = create_refresh_token()
        session.add(
            RefreshTokenRow(
                user_id=user.id,
                family_id=token.family_id,
                token_hash=replacement.digest,
                expires_at=now + timedelta(days=config.refresh_token_days),
                session_id=token.session_id,
            )
        )
        access = issue_access_token(
            UUID(user.id),
            set(user.roles),
            config,
            username=user.username,
            session_id=token.session_id,
        )
        return {
            "access_token": access,
            "refresh_token": replacement.value,
            "token_type": "bearer",
            "expires_in": config.access_token_minutes * 60,
        }

    @app.post("/v1/auth/logout", status_code=204)
    def logout(payload: RefreshRequest, session: Annotated[Session, Depends(database)]) -> Response:
        token = session.scalar(
            select(RefreshTokenRow).where(
                RefreshTokenRow.token_hash == hash_refresh_token(payload.refresh_token)
            )
        )
        if token is not None:
            token.revoked_at = datetime.now(UTC)
        return Response(status_code=204)

    @app.post("/v1/auth/change-password", status_code=204)
    def change_password(
        payload: PasswordChange,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authenticated)],
    ) -> Response:
        user = session.get(UserRow, str(claims.subject))
        if user is None or not verify_password(payload.current_password, user.password_hash):
            raise DomainError("invalid_credentials", "The current password is incorrect.")
        history = session.scalars(
            select(PasswordHistoryRow)
            .where(PasswordHistoryRow.user_id == user.id)
            .order_by(PasswordHistoryRow.created_at.desc())
            .limit(5)
        )
        if verify_password(payload.new_password, user.password_hash) or any(
            verify_password(payload.new_password, item.password_hash) for item in history
        ):
            raise DomainError("password_reuse", "The new password was used recently.")
        session.add(PasswordHistoryRow(user_id=user.id, password_hash=user.password_hash))
        user.password_hash = hash_password(payload.new_password)
        user.version += 1
        session.query(RefreshTokenRow).filter(
            RefreshTokenRow.user_id == user.id,
            RefreshTokenRow.revoked_at.is_(None),
        ).update({RefreshTokenRow.revoked_at: datetime.now(UTC)})
        return Response(status_code=204)

    @app.post("/v1/users", status_code=201)
    def create_user(
        payload: UserCreate,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin"))],
    ) -> dict[str, Any]:
        item = UserRow(
            username=payload.username,
            password_hash=hash_password(payload.password),
            display_name=payload.display_name,
            roles=sorted(payload.roles),
            employee_id=payload.employee_id,
        )
        session.add(item)
        session.flush()
        return _row(item, "id", "username", "display_name", "roles", "active", "employee_id")

    @app.get("/v1/auth/me")
    def me(claims: Annotated[Claims, Depends(authenticated)]) -> dict[str, Any]:
        return {"id": claims.subject, "username": claims.username, "roles": sorted(claims.roles)}

    @app.get("/v1/dashboard")
    def dashboard(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authenticated)],
    ) -> dict[str, Any]:
        return {
            "employees": session.scalar(select(func.count()).select_from(EmployeeRow)) or 0,
            "open_tickets": session.scalar(
                select(func.count())
                .select_from(TicketRow)
                .where(TicketRow.status.in_(["draft", "submitted"]))
            )
            or 0,
            "active_loans": session.scalar(
                select(func.count()).select_from(LoanRow).where(LoanRow.status != "settled")
            )
            or 0,
            "outstanding_loans": session.scalar(
                select(func.coalesce(func.sum(LoanRow.outstanding), 0))
            )
            or Decimal("0"),
        }

    @app.get("/v1/templates")
    def list_templates(
        _: Annotated[Claims, Depends(authenticated)],
    ) -> dict[str, list[str]]:
        return {"templates": list(list_import_templates())}

    @app.get("/v1/templates/{template_name}.xlsx")
    def download_template(
        template_name: TemplateName,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authenticated)],
    ) -> Response:
        company_id = session.scalar(
            select(CompanyRow.id)
            .where(CompanyRow.deleted_at.is_(None))
            .order_by(CompanyRow.code)
            .limit(1)
        )
        workbook = build_import_template(
            template_name,
            company_id=str(company_id or DEFAULT_COMPANY_ID),
        )
        return Response(
            workbook,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f'attachment; filename="{template_name}-template.xlsx"'
            },
        )

    @app.get("/v1/companies")
    def companies(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authenticated)],
    ) -> list[dict[str, Any]]:
        return [
            _row(item, "id", "code", "name", "currency", "active")
            for item in session.scalars(select(CompanyRow).order_by(CompanyRow.code))
        ]

    @app.post("/v1/companies", status_code=201)
    def create_company(
        payload: CompanyCreate,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin"))],
    ) -> dict[str, Any]:
        item = CompanyRow(**payload.model_dump())
        session.add(item)
        session.flush()
        return _row(item, "id", "code", "name", "currency", "active")

    @app.get("/v1/lookups/{lookup_type}")
    def list_lookups(
        lookup_type: Literal[
            "designations",
            "nationalities",
            "pay_groups",
            "sub_sections",
            "departments",
            "repair_centers",
        ],
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authenticated)],
    ) -> list[dict[str, Any]]:
        return [
            _row(item, "id", "lookup_type", "code", "name", "active", "version")
            for item in session.scalars(
                select(LookupRow)
                .where(
                    LookupRow.lookup_type == lookup_type,
                    LookupRow.deleted_at.is_(None),
                )
                .order_by(LookupRow.code)
            )
        ]

    @app.get("/v1/lookup-types")
    def list_lookup_types(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authenticated)],
    ) -> list[str]:
        rows = session.scalars(
            select(LookupRow.lookup_type)
            .where(LookupRow.deleted_at.is_(None))
            .distinct()
            .order_by(LookupRow.lookup_type.asc())
        )
        return list(rows)

    @app.post("/v1/lookups/{lookup_type}", status_code=201)
    def create_lookup(
        lookup_type: Literal[
            "designations",
            "nationalities",
            "pay_groups",
            "sub_sections",
            "departments",
            "repair_centers",
        ],
        payload: LookupUpsert,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr"))],
    ) -> dict[str, Any]:
        item = LookupRow(lookup_type=lookup_type, **payload.model_dump())
        session.add(item)
        session.flush()
        return _row(item, "id", "lookup_type", "code", "name", "active", "version")

    @app.put("/v1/lookups/{lookup_type}/{lookup_id}")
    def update_lookup(
        lookup_type: str,
        lookup_id: UUID,
        payload: LookupUpsert,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> dict[str, Any]:
        item = session.get(LookupRow, str(lookup_id))
        if item is None or item.lookup_type != lookup_type or item.deleted_at is not None:
            raise DomainError("not_found", "Lookup value not found.")
        if item.version != if_match:
            raise DomainError("stale_version", "The lookup was modified by another user.")
        for key, value in payload.model_dump().items():
            setattr(item, key, value)
        item.version += 1
        return _row(item, "id", "lookup_type", "code", "name", "active", "version")

    @app.delete("/v1/lookups/{lookup_type}/{lookup_id}", status_code=204)
    def delete_lookup(
        lookup_type: str,
        lookup_id: UUID,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> Response:
        item = session.get(LookupRow, str(lookup_id))
        if item is None or item.lookup_type != lookup_type or item.deleted_at is not None:
            raise DomainError("not_found", "Lookup value not found.")
        if item.version != if_match:
            raise DomainError("stale_version", "The lookup was modified by another user.")
        item.deleted_at = datetime.now(UTC)
        item.version += 1
        return Response(status_code=204)

    @app.get("/v1/employees")
    def employees(
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authenticated)],
        search: Annotated[str, Query(max_length=100)] = "",
        limit: Annotated[int, Query(ge=1, le=500)] = 100,
        offset: Annotated[int, Query(ge=0)] = 0,
        sort_by: Literal["code", "full_name", "department", "branch", "join_date"] = "code",
        sort_order: Literal["asc", "desc"] = "asc",
    ) -> list[dict[str, Any]]:
        query = select(EmployeeRow).where(EmployeeRow.deleted_at.is_(None))
        employee_scope = scoped_employee_id(session, claims)
        if employee_scope is not None:
            query = query.where(EmployeeRow.id == employee_scope)
        if search:
            term = f"%{search}%"
            linked_ids = select(UserRow.employee_id).where(
                UserRow.username.ilike(term),
                UserRow.deleted_at.is_(None),
                UserRow.employee_id.is_not(None),
            )
            query = query.where(
                EmployeeRow.code.ilike(term)
                | EmployeeRow.full_name.ilike(term)
                | EmployeeRow.id.in_(linked_ids)
            )
        sort_column = {
            "code": EmployeeRow.code,
            "full_name": EmployeeRow.full_name,
            "department": EmployeeRow.department,
            "branch": EmployeeRow.branch,
            "join_date": EmployeeRow.join_date,
        }[sort_by]
        ordering = sort_column.desc() if sort_order == "desc" else sort_column.asc()
        items = list(
            session.scalars(query.order_by(ordering, EmployeeRow.id).limit(limit).offset(offset))
        )
        usernames = _employee_username_map(session, [item.id for item in items])
        return [
            {
                **_row(
                    item,
                    "id",
                    "code",
                    "full_name",
                    "company_id",
                    "join_date",
                    "department",
                    "branch",
                    "email",
                    "pay_group",
                    "custom_airfare_rate",
                    "max_entitlement_cap_rate",
                    "active",
                    "version",
                ),
                "username": usernames.get(item.id),
            }
            for item in items
        ]

    @app.get("/v1/employees/export.xlsx")
    def export_employees(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authenticated)],
    ) -> Response:
        records = [
            _row(item, *EMPLOYEE_COLUMNS)
            for item in session.scalars(
                select(EmployeeRow)
                .where(EmployeeRow.deleted_at.is_(None))
                .order_by(EmployeeRow.code)
            )
        ]
        return Response(
            export_workbook("Employees", EMPLOYEE_COLUMNS, records),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="employees.xlsx"'},
        )

    @app.get("/v1/employees/{employee_id}")
    def employee_detail(
        employee_id: UUID,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authenticated)],
    ) -> dict[str, Any]:
        scope = scoped_employee_id(session, claims)
        if scope is not None and scope != employee_id:
            raise DomainError("forbidden", "Employees may only access their own profile.")
        item = session.scalar(
            select(EmployeeRow).where(
                EmployeeRow.id == employee_id, EmployeeRow.deleted_at.is_(None)
            )
        )
        if item is None:
            raise DomainError("not_found", "Employee not found.")
        return _row(item, *EMPLOYEE_API_FIELDS)

    @app.post("/v1/employees", status_code=201)
    def create_employee(
        payload: EmployeeCreate,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr"))],
    ) -> dict[str, Any]:
        if session.get(CompanyRow, str(payload.company_id)) is None:
            raise DomainError("invalid_company", "The selected company does not exist.")
        now = datetime.now(UTC)
        fields = payload.model_dump()
        fields["company_id"] = str(fields["company_id"])
        item = EmployeeRow(
            id=uuid4(),
            active=True,
            version=1,
            created_at=now,
            updated_at=now,
            deleted_at=None,
            **fields,
        )
        session.add(item)
        session.flush()
        return _row(item, *EMPLOYEE_API_FIELDS)

    @app.put("/v1/employees/{employee_id}")
    def update_employee(
        employee_id: UUID,
        payload: EmployeeUpdate,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> dict[str, Any]:
        item = session.get(EmployeeRow, employee_id)
        if item is None or item.deleted_at is not None:
            raise DomainError("not_found", "Employee not found.")
        if item.version != if_match:
            raise DomainError("stale_version", "The employee was modified by another user.")
        for key, value in payload.model_dump(exclude_unset=True).items():
            if key in {"pay_group", "custom_airfare_rate", "max_entitlement_cap_rate"} and (
                key not in payload.model_fields_set
            ):
                continue
            setattr(item, key, value)
        item.version += 1
        return _row(item, *EMPLOYEE_API_FIELDS)

    @app.delete("/v1/employees/{employee_id}", status_code=204)
    def delete_employee(
        employee_id: UUID,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> Response:
        item = session.get(EmployeeRow, employee_id)
        if item is None or item.deleted_at is not None:
            raise DomainError("not_found", "Employee not found.")
        if item.version != if_match:
            raise DomainError("stale_version", "The employee was modified by another user.")
        item.deleted_at = datetime.now(UTC)
        item.active = False
        item.version += 1
        return Response(status_code=204)

    @app.post("/v1/employees/import/preview")
    async def preview_employee_import(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr"))],
        file: Annotated[UploadFile, File()],
    ) -> dict[str, Any]:
        records = parse_employee_workbook(await file.read())
        rows = _preview_employee_import(session, records)
        return {
            "file_name": file.filename or "employee-import.xlsx",
            "summary": _import_summary(rows),
            "rows": rows,
        }

    @app.post("/v1/employees/import/commit")
    def commit_employee_import(
        payload: EmployeeImportCommit,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr"))],
    ) -> dict[str, Any]:
        return _commit_employee_import(session, payload)

    @app.post("/v1/employees/import")
    async def import_employees(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr"))],
        file: Annotated[UploadFile, File()],
        dry_run: bool = True,
    ) -> dict[str, Any]:
        records = parse_employee_workbook(await file.read())
        rows = _preview_employee_import(session, records)
        summary = _import_summary(rows)
        if not dry_run:
            selected = [row for row in rows if row.get("selected")]
            if summary["errors"]:
                raise DomainError("import_validation_failed", "Resolve import errors before committing.")
            return _commit_employee_import(
                session,
                EmployeeImportCommit(
                    rows=[
                        EmployeeImportCommitRow.model_validate(
                            {
                                key: value
                                for key, value in row.items()
                                if key not in {"severity", "status", "message", "action"}
                            }
                        )
                        for row in selected
                    ]
                ),
            )
        return {
            "rows": summary["total"],
            "accepted": summary["ready"],
            "errors": [
                {"row": row["row"], "error": row["message"]}
                for row in rows
                if row.get("severity") == "ERROR"
            ],
            "committed": False,
            "preview": rows,
            "summary": summary,
        }

    @app.get("/v1/opening-balances")
    def balances(
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authenticated)],
        search: Annotated[str, Query(max_length=100)] = "",
        balance_year: Annotated[int | None, Query(ge=2000, le=2200)] = None,
        limit: Annotated[int, Query(ge=1, le=500)] = 100,
        offset: Annotated[int, Query(ge=0)] = 0,
        sort_by: Literal[
            "balance_year", "opening_days", "opening_amount", "maximum_payout"
        ] = "balance_year",
        sort_order: Literal["asc", "desc"] = "desc",
    ) -> list[dict[str, Any]]:
        query = select(OpeningBalanceRow).where(OpeningBalanceRow.deleted_at.is_(None))
        scope = scoped_employee_id(session, claims)
        if scope is not None:
            query = query.where(OpeningBalanceRow.employee_id == scope)
        if search:
            term = f"%{search}%"
            query = query.join(EmployeeRow).where(
                EmployeeRow.code.ilike(term) | EmployeeRow.full_name.ilike(term)
            )
        if balance_year is not None:
            query = query.where(OpeningBalanceRow.balance_year == balance_year)
        sort_column = {
            "balance_year": OpeningBalanceRow.balance_year,
            "opening_days": OpeningBalanceRow.opening_days,
            "opening_amount": OpeningBalanceRow.opening_amount,
            "maximum_payout": OpeningBalanceRow.maximum_payout,
        }[sort_by]
        ordering = sort_column.desc() if sort_order == "desc" else sort_column.asc()
        return _attach_employees(
            session,
            [
                _row(
                    item,
                    "id",
                    "employee_id",
                    "balance_year",
                    "opening_days",
                    "paid_days",
                    "opening_amount",
                    "maximum_payout",
                    "version",
                )
                for item in session.scalars(
                    query.order_by(ordering, OpeningBalanceRow.id).limit(limit).offset(offset)
                )
            ],
        )

    @app.post("/v1/opening-balances", status_code=201)
    def create_balance(
        payload: BalanceCreate,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
    ) -> dict[str, Any]:
        item = OpeningBalanceRow(**payload.model_dump())
        session.add(item)
        session.flush()
        return _row(
            item,
            "id",
            "employee_id",
            "balance_year",
            "opening_days",
            "paid_days",
            "opening_amount",
            "maximum_payout",
            "version",
        )

    @app.put("/v1/opening-balances/{balance_id}")
    def update_balance(
        balance_id: UUID,
        payload: BalanceUpdate,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> dict[str, Any]:
        item = session.get(OpeningBalanceRow, str(balance_id))
        if item is None or item.deleted_at is not None:
            raise DomainError("not_found", "Opening balance not found.")
        if item.version != if_match:
            raise DomainError("stale_version", "The balance was modified by another user.")
        for key, value in payload.model_dump().items():
            setattr(item, key, value)
        item.version += 1
        return _row(
            item,
            "id",
            "employee_id",
            "balance_year",
            "opening_days",
            "paid_days",
            "opening_amount",
            "maximum_payout",
            "version",
        )

    @app.delete("/v1/opening-balances/{balance_id}", status_code=204)
    def delete_balance(
        balance_id: UUID,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> Response:
        item = session.get(OpeningBalanceRow, str(balance_id))
        if item is None or item.deleted_at is not None:
            raise DomainError("not_found", "Opening balance not found.")
        if item.version != if_match:
            raise DomainError("stale_version", "The balance was modified by another user.")
        item.deleted_at = datetime.now(UTC)
        item.version += 1
        return Response(status_code=204)

    @app.post("/v1/opening-balances/import/preview")
    async def preview_opening_balance_import(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
        file: Annotated[UploadFile, File()],
    ) -> dict[str, Any]:
        records = parse_opening_balance_workbook(await file.read())
        rows = _preview_opening_balance_import(session, records)
        return {
            "file_name": file.filename or "opening-balance-import.xlsx",
            "summary": _import_summary(rows),
            "rows": rows,
        }

    @app.post("/v1/opening-balances/import/commit")
    def commit_opening_balance_import(
        payload: OpeningBalanceImportCommit,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
    ) -> dict[str, Any]:
        return _commit_opening_balance_import(session, payload)

    @app.post("/v1/opening-balances/import")
    async def import_opening_balances(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
        file: Annotated[UploadFile, File()],
        dry_run: bool = True,
    ) -> dict[str, Any]:
        records = parse_opening_balance_workbook(await file.read())
        rows = _preview_opening_balance_import(session, records)
        summary = _import_summary(rows)
        if not dry_run:
            if summary["errors"]:
                raise DomainError("import_validation_failed", "Resolve import errors before committing.")
            selected = [row for row in rows if row.get("selected")]
            return _commit_opening_balance_import(
                session,
                OpeningBalanceImportCommit(
                    rows=[
                        OpeningBalanceImportCommitRow(
                            row=row["row"],
                            employee_code=row["employee_code"],
                            employee_id=UUID(row["employee_id"]),
                            balance_year=row["balance_year"],
                            opening_days=Decimal(str(row["opening_days"])),
                            paid_days=Decimal(str(row.get("paid_days") or "0")),
                            opening_amount=Decimal(str(row["opening_amount"])),
                            maximum_payout=Decimal(str(row["maximum_payout"])),
                            selected=True,
                        )
                        for row in selected
                    ]
                ),
            )
        return {
            "rows": summary["total"],
            "accepted": summary["ready"],
            "errors": [
                {"row": row["row"], "error": row["message"]}
                for row in rows
                if row.get("severity") == "ERROR"
            ],
            "committed": False,
            "preview": rows,
            "summary": summary,
        }

    @app.post("/v1/entitlements/preview")
    def entitlement_preview(
        payload: EntitlementRequest,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "manager", "finance"))],
    ) -> dict[str, Decimal]:
        if payload.current_working_days is not None:
            from airfare_management.domain.services import calculate_entitlement

            result = calculate_entitlement(
                payload.opening_days,
                payload.current_working_days,
                payload.paid_days,
                payload.maximum_payout,
            )
        else:
            values = payload.model_dump(exclude={"current_working_days"})
            result = calculate_entitlement_scenario(**values)
        return {
            "current_days": result.current_days,
            "remaining_days": result.remaining_days,
            "payable": result.payable,
        }

    def _effective_rate_row(
        session: Session, scope_type: str, scope_id: str, as_of: date
    ) -> EntitlementRateRow | None:
        rows = session.scalars(
            select(EntitlementRateRow)
            .where(
                EntitlementRateRow.deleted_at.is_(None),
                EntitlementRateRow.scope_type == scope_type,
                EntitlementRateRow.scope_id == scope_id,
                EntitlementRateRow.effective_from <= as_of,
            )
            .order_by(EntitlementRateRow.effective_from.desc())
        )
        for row in rows:
            if row.effective_to is None or row.effective_to >= as_of:
                return row
        return None

    def _global_preference_decimal(session: Session, key: str) -> Decimal | None:
        item = session.scalar(
            select(PreferenceRow).where(
                PreferenceRow.scope_type == "global",
                PreferenceRow.scope_id == "",
                PreferenceRow.preference_key == key,
                PreferenceRow.deleted_at.is_(None),
            )
        )
        return _as_decimal(None if item is None else item.value)

    def _allocation_query(
        session: Session,
        *,
        employee_id: UUID | None,
        as_of_date: date,
        date_of_joining: date | None,
        last_ticket_date: date | None,
        opening_balance_days: Decimal | None,
        opening_balance_amount: Decimal | None,
        employee_custom_rate: Decimal | None,
        pay_group_rate: Decimal | None,
        global_company_preference_rate: Decimal | None,
        global_company_preference_days: Decimal | None,
        max_entitlement_cap_rate: Decimal | None,
        requested_ticket_amount: Decimal | None,
        excess_option: ExcessSettlementOption | None,
        tenure_months: int | None,
    ) -> PreviewAllocation:
        joining = date_of_joining
        last_ticket = last_ticket_date
        opening_days = opening_balance_days if opening_balance_days is not None else Decimal("0")
        opening_amount = (
            opening_balance_amount if opening_balance_amount is not None else Decimal("0")
        )
        custom_rate = employee_custom_rate
        group_rate = pay_group_rate
        global_rate = global_company_preference_rate
        global_days = global_company_preference_days
        employee_cap = max_entitlement_cap_rate
        group_cap: Decimal | None = None
        company_rate: Decimal | None = None
        company_cap: Decimal | None = None
        global_cap: Decimal | None = None
        current_year_spending = Decimal("0")
        paid_days = Decimal("0")
        policy_resolved = False
        if employee_id is not None:
            employee = session.scalar(
                select(EmployeeRow).where(
                    EmployeeRow.id == employee_id, EmployeeRow.deleted_at.is_(None)
                )
            )
            if employee is None:
                raise DomainError("not_found", "Employee not found.")
            joining = joining or employee.join_date
            year_start = date(as_of_date.year, 1, 1)
            year_end = date(as_of_date.year, 12, 31)
            if last_ticket is None:
                last_ticket = session.scalar(
                    select(func.max(TicketRow.travel_date)).where(
                        TicketRow.employee_id == employee_id,
                        TicketRow.deleted_at.is_(None),
                        TicketRow.status.in_(("approved", "paid")),
                        TicketRow.travel_date >= year_start,
                        TicketRow.travel_date <= as_of_date,
                        TicketRow.entitlement > 0,
                    )
                )
            current_year_spending = session.scalar(
                select(func.coalesce(func.sum(TicketRow.entitlement), 0)).where(
                    TicketRow.employee_id == employee_id,
                    TicketRow.deleted_at.is_(None),
                    TicketRow.status.in_(("approved", "paid")),
                    TicketRow.travel_date >= year_start,
                    TicketRow.travel_date <= year_end,
                    TicketRow.excess_handling != "employee_full",
                )
            ) or Decimal("0")
            balance = session.scalar(
                select(OpeningBalanceRow).where(
                    OpeningBalanceRow.employee_id == employee_id,
                    OpeningBalanceRow.balance_year == as_of_date.year,
                    OpeningBalanceRow.deleted_at.is_(None),
                )
            )
            if balance is not None:
                if opening_balance_days is None:
                    opening_days = balance.opening_days
                if opening_balance_amount is None:
                    opening_amount = balance.opening_amount
                paid_days = balance.paid_days
            employee_policy = _effective_rate_row(
                session, "employee", str(employee_id), as_of_date
            ) or _effective_rate_row(session, "employee", employee.code, as_of_date)
            group_row = None
            if employee.pay_group:
                group_row = _effective_rate_row(
                    session, "pay_group", employee.pay_group, as_of_date
                )
            company_row = None
            if employee.company_id:
                company_row = _effective_rate_row(
                    session, "company", str(employee.company_id), as_of_date
                )
                company = session.get(CompanyRow, str(employee.company_id))
                if company_row is None and company is not None:
                    company_row = _effective_rate_row(
                        session, "company", company.code, as_of_date
                    )
            global_row = _effective_rate_row(session, "global", "", as_of_date)
            # ATLAS: AirfarePolicyRates.MaxPayoutAmount overwrites Employees.MaximumPayout.
            # Employees.CurrentAirfareRate is a stored leftover, not the policy rate.
            if custom_rate is None and employee_policy is not None:
                custom_rate = employee_policy.amount
            if group_rate is None and group_row is not None:
                group_rate = group_row.amount
            company_rate = company_row.amount if company_row is not None else None
            if global_rate is None and global_row is not None:
                global_rate = global_row.amount
            if employee_policy is not None:
                if employee_cap is None:
                    employee_cap = employee_policy.cap_amount
            elif group_row is not None:
                group_cap = group_row.cap_amount
            elif company_row is not None:
                company_cap = company_row.cap_amount
            elif global_row is not None:
                global_cap = global_row.cap_amount
            else:
                if custom_rate is None:
                    custom_rate = employee.custom_airfare_rate
                if employee_cap is None:
                    employee_cap = employee.max_entitlement_cap_rate
            policy_resolved = (
                employee_policy is not None
                or group_row is not None
                or company_row is not None
                or global_row is not None
            )
        if global_rate is None:
            global_rate = _global_preference_decimal(
                session, "airfare_rate"
            ) or _global_preference_decimal(session, "global_company_preference_rate")
        if global_days is None:
            global_days = (
                _global_preference_decimal(session, "airfare_rate_days")
                or _global_preference_decimal(session, "global_company_preference_days")
                or AIRFARE_CYCLE_DAYS
            )
        if global_days in {Decimal("365"), Decimal("365.0")}:
            global_days = AIRFARE_CYCLE_DAYS
        if global_cap is None and not policy_resolved:
            global_cap = _global_preference_decimal(session, "max_entitlement_cap_rate")
        if joining is None:
            raise DomainError("join_date_required", "Date of joining is required.")
        return PreviewAllocation(
            as_of_date=as_of_date,
            date_of_joining=joining,
            last_ticket_date=last_ticket,
            opening_balance_days=opening_days,
            opening_balance_amount=opening_amount,
            employee_custom_rate=custom_rate,
            pay_group_rate=group_rate,
            global_company_preference_rate=global_rate,
            global_rate_days=global_days,
            company_rate=company_rate,
            employee_cap=employee_cap,
            pay_group_cap=group_cap,
            company_cap=company_cap,
            global_cap=global_cap,
            requested_ticket_amount=requested_ticket_amount,
            excess_option=excess_option,
            tenure_months=tenure_months,
            paid_days=paid_days,
            current_year_spending=Decimal(str(current_year_spending)),
        )

    def _decorate_allocation(
        session: Session,
        preview: AllocationPreview,
        query: PreviewAllocation,
        employee_id: UUID | None,
    ) -> dict[str, Any]:
        employee = None
        username = None
        if employee_id is not None:
            employee = session.scalar(
                select(EmployeeRow).where(
                    EmployeeRow.id == employee_id, EmployeeRow.deleted_at.is_(None)
                )
            )
            if employee is not None:
                username = _employee_username_map(session, [employee.id]).get(employee.id)
        return _allocation_response(
            preview,
            date_of_joining=query.date_of_joining,
            employee=employee,
            username=username,
        )

    @app.post("/v1/allocations/preview")
    def allocation_preview(
        payload: AllocationPreviewRequest,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "manager", "finance"))],
    ) -> dict[str, Any]:
        query = _allocation_query(
            session,
            employee_id=payload.employee_id,
            as_of_date=payload.as_of_date,
            date_of_joining=payload.date_of_joining,
            last_ticket_date=payload.last_ticket_date,
            opening_balance_days=payload.opening_balance_days,
            opening_balance_amount=payload.opening_balance_amount,
            employee_custom_rate=payload.employee_custom_rate,
            pay_group_rate=payload.pay_group_rate,
            global_company_preference_rate=payload.global_company_preference_rate,
            global_company_preference_days=payload.global_company_preference_days,
            max_entitlement_cap_rate=payload.max_entitlement_cap_rate,
            requested_ticket_amount=payload.requested_ticket_amount,
            excess_option=payload.excess_option,
            tenure_months=payload.tenure_months,
        )
        return _decorate_allocation(
            session, AllocationQueryHandler().handle(query), query, payload.employee_id
        )

    @app.post("/v1/allocations/issue", status_code=201)
    def allocation_issue(
        payload: AllocationIssueRequest,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "manager"))],
    ) -> dict[str, Any]:
        if payload.origin_code.upper() == payload.destination_code.upper():
            raise DomainError("invalid_route", "Origin and destination must differ.")
        query = _allocation_query(
            session,
            employee_id=payload.employee_id,
            as_of_date=payload.as_of_date,
            date_of_joining=None,
            last_ticket_date=None,
            opening_balance_days=None,
            opening_balance_amount=None,
            employee_custom_rate=None,
            pay_group_rate=None,
            global_company_preference_rate=None,
            global_company_preference_days=None,
            max_entitlement_cap_rate=None,
            requested_ticket_amount=payload.requested_ticket_amount,
            excess_option=payload.excess_option,
            tenure_months=payload.tenure_months,
        )
        preview = AllocationQueryHandler().handle(query)
        entitlement = preview.entitlement
        settlement = preview.settlement
        if settlement is None:
            excess = max(
                Decimal("0"),
                payload.requested_ticket_amount - entitlement.final_entitlement_amount,
            )
            if excess > 0:
                raise DomainError(
                    "settlement_required",
                    "Ticket amount exceeds entitlement. Choose Self paid by employee, "
                    "Fully company paid, or Make loan.",
                )
            settlement = settle_excess_ticket(
                payload.requested_ticket_amount,
                entitlement.final_entitlement_amount,
                ExcessSettlementOption.SELF_PAID,
            )
        ticket = TicketRow(
            employee_id=payload.employee_id,
            travel_date=payload.as_of_date,
            origin_code=payload.origin_code.upper(),
            destination_code=payload.destination_code.upper(),
            ticket_cost=payload.requested_ticket_amount,
            entitlement=entitlement.final_entitlement_amount,
            company_paid=settlement.company_payout,
            excess_handling=settlement.option.value,
            scenario=entitlement.scenario.value,
            accrued_days=entitlement.accrued_days,
            daily_rate=entitlement.daily_rate,
            airfare_rate=entitlement.airfare_rate,
            rate_source=entitlement.rate_source.value,
            excess_cost=settlement.excess_cost,
            employee_payable=settlement.employee_payable,
            company_payout=settlement.company_payout,
            last_ticket_date=entitlement.last_ticket_date,
            as_of_date=payload.as_of_date,
            tenure_months=settlement.tenure_months,
            status="approved",
            notes=payload.notes,
        )
        session.add(ticket)
        session.flush()
        loan = None
        if (
            settlement.option is ExcessSettlementOption.LOAN
            and settlement.loan_principal is not None
            and settlement.emi is not None
            and settlement.tenure_months is not None
        ):
            due = payload.as_of_date + timedelta(days=32)
            loan = LoanRow(
                employee_id=payload.employee_id,
                source_ticket_id=ticket.id,
                principal=settlement.loan_principal,
                annual_rate=Decimal("0"),
                installments=settlement.tenure_months,
                monthly_installment=quantize_money(settlement.emi),
                outstanding=settlement.loan_principal,
                status="active",
                first_due_date=date(due.year, due.month, 1),
            )
            session.add(loan)
            session.flush()
            LoanRepository(session).replace_schedule(
                loan.id,
                build_amortization_schedule(
                    settlement.loan_principal,
                    Decimal("0"),
                    settlement.tenure_months,
                    loan.first_due_date,
                ),
            )
        body = _decorate_allocation(session, preview, query, payload.employee_id)
        body.update(
            {
                "id": ticket.id,
                "ticket_id": ticket.id,
                **_ticket_display(ticket),
                **_loan_display(loan),
                "status": ticket.status,
                "version": ticket.version,
                "message": _allocation_saved_message(ticket, loan),
            }
        )
        return body

    @app.get("/v1/entitlement-rates")
    def entitlement_rates(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authenticated)],
    ) -> list[dict[str, Any]]:
        return [
            _row(
                item,
                "id",
                "scope_type",
                "scope_id",
                "amount",
                "effective_from",
                "effective_to",
                "cap_amount",
                "version",
            )
            for item in session.scalars(
                select(EntitlementRateRow)
                .where(EntitlementRateRow.deleted_at.is_(None))
                .order_by(EntitlementRateRow.effective_from.desc())
            )
        ]

    @app.post("/v1/entitlement-rates", status_code=201)
    def create_entitlement_rate(
        payload: RateCreate,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
    ) -> dict[str, Any]:
        if payload.effective_to is not None and payload.effective_to < payload.effective_from:
            raise DomainError("invalid_date_range", "Effective-to cannot precede effective-from.")
        scope_id = "" if payload.scope_type == "global" else payload.scope_id.strip()
        if payload.scope_type != "global" and not scope_id:
            raise DomainError("scope_required", "Scope id is required for company, group, and employee rates.")
        now = datetime.now(UTC)
        prior_end = payload.effective_from - timedelta(days=1)
        for row in session.scalars(
            select(EntitlementRateRow).where(
                EntitlementRateRow.deleted_at.is_(None),
                EntitlementRateRow.scope_type == payload.scope_type,
                EntitlementRateRow.scope_id == scope_id,
            )
        ):
            if row.effective_from >= payload.effective_from:
                row.deleted_at = now
                row.version += 1
            elif row.effective_to is None or row.effective_to >= payload.effective_from:
                row.effective_to = prior_end if prior_end >= row.effective_from else row.effective_from
                row.version += 1
        item = EntitlementRateRow(**{**payload.model_dump(), "scope_id": scope_id})
        session.add(item)
        session.flush()
        return _row(
            item,
            "id",
            "scope_type",
            "scope_id",
            "amount",
            "effective_from",
            "effective_to",
            "cap_amount",
            "version",
        )

    @app.delete("/v1/entitlement-rates/{rate_id}", status_code=204)
    def delete_entitlement_rate(
        rate_id: UUID,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> Response:
        item = session.get(EntitlementRateRow, str(rate_id))
        if item is None or item.deleted_at is not None:
            raise DomainError("not_found", "Entitlement rate not found.")
        if item.version != if_match:
            raise DomainError("stale_version", "The rate was modified by another user.")
        item.deleted_at = datetime.now(UTC)
        item.version += 1
        return Response(status_code=204)

    @app.get("/v1/tickets")
    def tickets(
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authenticated)],
        search: Annotated[str, Query(max_length=100)] = "",
        status: Literal["draft", "submitted", "approved", "rejected", "paid"] | None = None,
        limit: Annotated[int, Query(ge=1, le=500)] = 100,
        offset: Annotated[int, Query(ge=0)] = 0,
        sort_by: Literal["travel_date", "ticket_cost", "entitlement", "status"] = "travel_date",
        sort_order: Literal["asc", "desc"] = "desc",
    ) -> list[dict[str, Any]]:
        query = select(TicketRow).where(TicketRow.deleted_at.is_(None))
        scope = scoped_employee_id(session, claims)
        if scope is not None:
            query = query.where(TicketRow.employee_id == scope)
        if search:
            term = f"%{search}%"
            query = query.join(EmployeeRow).where(
                EmployeeRow.code.ilike(term)
                | EmployeeRow.full_name.ilike(term)
                | TicketRow.notes.ilike(term)
            )
        if status is not None:
            query = query.where(TicketRow.status == status)
        sort_column = {
            "travel_date": TicketRow.travel_date,
            "ticket_cost": TicketRow.ticket_cost,
            "entitlement": TicketRow.entitlement,
            "status": TicketRow.status,
        }[sort_by]
        ordering = sort_column.desc() if sort_order == "desc" else sort_column.asc()
        return _attach_employees(
            session,
            [
                {
                    **_row(
                        item,
                        "id",
                        "employee_id",
                        "travel_date",
                        "origin_code",
                        "destination_code",
                        "ticket_cost",
                        "entitlement",
                        "company_paid",
                        "excess_handling",
                        "status",
                        "notes",
                        "version",
                    ),
                    **_ticket_display(item),
                    "excess_amount": item.excess_amount,
                    "format": conditional_format(status=item.status, amount=item.excess_amount),
                }
                for item in session.scalars(
                    query.order_by(ordering, TicketRow.id).limit(limit).offset(offset)
                )
            ],
        )

    @app.post("/v1/tickets", status_code=201)
    def create_ticket(
        payload: TicketCreate,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "manager"))],
    ) -> dict[str, Any]:
        if payload.origin_code.upper() == payload.destination_code.upper():
            raise DomainError("invalid_route", "Origin and destination must differ.")
        values = payload.model_dump(exclude={"origin_code", "destination_code"})
        item = TicketRow(
            **values,
            origin_code=payload.origin_code.upper(),
            destination_code=payload.destination_code.upper(),
        )
        session.add(item)
        session.flush()
        return {
            **_row(
                item,
                "id",
                "employee_id",
                "travel_date",
                "origin_code",
                "destination_code",
                "ticket_cost",
                "entitlement",
                "company_paid",
                "excess_handling",
                "status",
                "version",
            ),
            **_ticket_display(item),
            "excess_amount": item.excess_amount,
        }

    @app.patch("/v1/tickets/{ticket_id}/status")
    def change_ticket_status(
        ticket_id: str,
        payload: StatusChange,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "manager", "finance"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> dict[str, Any]:
        item = session.get(TicketRow, ticket_id)
        if item is None:
            raise HTTPException(404, "Ticket not found.")
        if item.version != if_match:
            raise DomainError("stale_version", "The ticket was modified by another user.")
        transitions = {
            "draft": {"submitted"},
            "submitted": {"approved", "rejected"},
            "approved": {"paid"},
            "rejected": {"draft"},
            "paid": set(),
        }
        if payload.status not in transitions[item.status]:
            raise DomainError(
                "invalid_transition", f"Cannot change {item.status} to {payload.status}."
            )
        item.status = payload.status
        item.version += 1
        if (
            payload.status == "approved"
            and item.excess_handling == "CONVERT_TO_LOAN"
            and item.excess_amount > 0
            and session.scalar(select(LoanRow).where(LoanRow.source_ticket_id == item.id)) is None
        ):
            session.add(
                LoanRow(
                    employee_id=item.employee_id,
                    source_ticket_id=item.id,
                    principal=item.excess_amount,
                    annual_rate=Decimal("0"),
                    installments=12,
                    monthly_installment=calculate_emi(item.excess_amount, Decimal("0"), 12),
                    outstanding=item.excess_amount,
                    first_due_date=date(item.travel_date.year, item.travel_date.month, 1)
                    + timedelta(days=32),
                )
            )
        return _row(item, "id", "status", "version")

    @app.delete("/v1/tickets/{ticket_id}", status_code=204)
    def delete_ticket(
        ticket_id: UUID,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "manager"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> Response:
        item = session.get(TicketRow, str(ticket_id))
        if item is None or item.deleted_at is not None:
            raise DomainError("not_found", "Ticket not found.")
        if item.status != "draft":
            raise DomainError("invalid_transition", "Only draft tickets may be deleted.")
        if item.version != if_match:
            raise DomainError("stale_version", "The ticket was modified by another user.")
        item.deleted_at = datetime.now(UTC)
        item.version += 1
        return Response(status_code=204)

    @app.post("/v1/loans/preview")
    def loan_preview(
        payload: LoanPreviewRequest,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "manager", "finance"))],
    ) -> dict[str, Decimal]:
        return {"monthly_installment": calculate_emi(**payload.model_dump())}

    @app.post("/v1/loans/run-emi")
    def run_emi(
        payload: RunEmiRequest,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "manager", "finance"))],
    ) -> dict[str, Any]:
        employee = session.scalar(
            select(EmployeeRow).where(
                EmployeeRow.id == payload.employee_id, EmployeeRow.deleted_at.is_(None)
            )
        )
        if employee is None:
            raise DomainError("not_found", "Employee not found.")
        loans = list(
            session.scalars(
                select(LoanRow)
                .where(
                    LoanRow.employee_id == payload.employee_id,
                    LoanRow.deleted_at.is_(None),
                    LoanRow.status.in_(("active", "deferred")),
                )
                .order_by(LoanRow.created_at.desc(), LoanRow.id)
            )
        )
        if not loans:
            return {
                "employee_id": str(payload.employee_id),
                "employee_code": employee.code,
                "employee_name": employee.full_name,
                "loans": [],
                "message": (
                    "No active loan exists for this employee. Create a loan from the Airfare "
                    "Allocation Engine by choosing Make loan when the ticket amount exceeds "
                    "entitlement."
                ),
            }
        repo = LoanRepository(session)
        results: list[dict[str, Any]] = []
        for loan in loans:
            schedule = build_amortization_schedule(
                loan.principal, loan.annual_rate, loan.installments, loan.first_due_date
            )
            repo.replace_schedule(loan.id, schedule)
            results.append(
                {
                    "loan_id": loan.id,
                    "loan_number": loan.loan_number,
                    "loan_code": loan.loan_code,
                    "principal": loan.principal,
                    "annual_rate": loan.annual_rate,
                    "installments": loan.installments,
                    "monthly_installment": loan.monthly_installment,
                    "outstanding": loan.outstanding,
                    "status": loan.status,
                    "first_due_date": loan.first_due_date,
                    "schedule": [_installment_payload(part) for part in schedule],
                }
            )
        return {
            "employee_id": str(payload.employee_id),
            "employee_code": employee.code,
            "employee_name": employee.full_name,
            "loans": results,
            "message": None,
        }

    @app.get("/v1/loans")
    def loans(
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authenticated)],
        search: Annotated[str, Query(max_length=100)] = "",
        status: Literal["active", "settled", "deferred"] | None = None,
        employee_id: UUID | None = None,
        limit: Annotated[int, Query(ge=1, le=500)] = 100,
        offset: Annotated[int, Query(ge=0)] = 0,
        sort_by: Literal["created_at", "principal", "outstanding", "status"] = "created_at",
        sort_order: Literal["asc", "desc"] = "desc",
    ) -> list[dict[str, Any]]:
        query = select(LoanRow).where(LoanRow.deleted_at.is_(None))
        scope = scoped_employee_id(session, claims)
        if scope is not None:
            query = query.where(LoanRow.employee_id == scope)
        elif employee_id is not None:
            query = query.where(LoanRow.employee_id == employee_id)
        if search:
            term = f"%{search}%"
            query = query.join(EmployeeRow).where(
                EmployeeRow.code.ilike(term) | EmployeeRow.full_name.ilike(term)
            )
        if status is not None:
            query = query.where(LoanRow.status == status)
        sort_column = {
            "created_at": LoanRow.created_at,
            "principal": LoanRow.principal,
            "outstanding": LoanRow.outstanding,
            "status": LoanRow.status,
        }[sort_by]
        ordering = sort_column.desc() if sort_order == "desc" else sort_column.asc()
        return _attach_employees(
            session,
            [
                {
                    **_row(
                        item,
                        "id",
                        "employee_id",
                        "source_ticket_id",
                        "principal",
                        "annual_rate",
                        "installments",
                        "monthly_installment",
                        "outstanding",
                        "status",
                        "deferred_until",
                        "first_due_date",
                        "version",
                    ),
                    "loan_number": item.loan_number,
                    "loan_code": item.loan_code,
                    "format": conditional_format(status=item.status, amount=item.outstanding),
                }
                for item in session.scalars(
                    query.order_by(ordering, LoanRow.id).limit(limit).offset(offset)
                )
            ],
        )

    @app.post("/v1/loans", status_code=201)
    def create_loan(
        payload: LoanCreate,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
    ) -> dict[str, Any]:
        monthly = calculate_emi(payload.principal, payload.annual_rate, payload.installments)
        item = LoanRow(
            **payload.model_dump(), monthly_installment=monthly, outstanding=payload.principal
        )
        session.add(item)
        session.flush()
        return {
            **_row(
                item,
                "id",
                "employee_id",
                "principal",
                "monthly_installment",
                "outstanding",
                "status",
                "first_due_date",
                "version",
            ),
            "loan_number": item.loan_number,
            "loan_code": item.loan_code,
        }

    @app.get("/v1/loans/{loan_id}/schedule")
    def loan_schedule(
        loan_id: str,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authenticated)],
    ) -> list[dict[str, Any]]:
        item = session.get(LoanRow, loan_id)
        if item is None:
            raise HTTPException(404, "Loan not found.")
        persisted = LoanRepository(session).schedule(loan_id)
        parts: Sequence[LoanInstallment | LoanInstallmentRow] = persisted or build_amortization_schedule(
            item.principal, item.annual_rate, item.installments, item.first_due_date
        )
        return [_installment_payload(part) for part in parts]

    @app.post("/v1/loans/{loan_id}/payments", status_code=201)
    def post_payment(
        loan_id: str,
        payload: PaymentCreate,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "finance"))],
    ) -> dict[str, Any]:
        item = session.get(LoanRow, loan_id)
        if item is None:
            raise HTTPException(404, "Loan not found.")
        if payload.amount > item.outstanding:
            raise DomainError("overpayment", "Payment cannot exceed outstanding principal.")
        payment = LoanPaymentRow(loan_id=loan_id, **payload.model_dump())
        item.outstanding -= payload.amount
        item.version += 1
        if item.outstanding == 0:
            item.status = "settled"
        session.add(payment)
        session.flush()
        return {
            "payment_id": payment.id,
            "outstanding": item.outstanding,
            "status": item.status,
            "version": item.version,
        }

    @app.post("/v1/loans/{loan_id}/defer")
    def defer_loan(
        loan_id: UUID,
        payload: LoanDeferRequest,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "finance"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> dict[str, Any]:
        item = session.get(LoanRow, str(loan_id))
        if item is None or item.deleted_at is not None:
            raise DomainError("not_found", "Loan not found.")
        if item.version != if_match:
            raise DomainError("stale_version", "The loan was modified by another user.")
        if item.status == "settled" or payload.deferred_until <= date.today():
            raise DomainError(
                "invalid_deferment", "Only active loans may be deferred to a future date."
            )
        item.deferred_until = payload.deferred_until
        item.status = "deferred"
        item.version += 1
        return _row(item, "id", "status", "deferred_until", "version")

    @app.post("/v1/loans/{loan_id}/restructure")
    def restructure_loan(
        loan_id: UUID,
        payload: LoanRestructureRequest,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "finance"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> dict[str, Any]:
        item = session.get(LoanRow, str(loan_id))
        if item is None or item.deleted_at is not None:
            raise DomainError("not_found", "Loan not found.")
        if item.version != if_match:
            raise DomainError("stale_version", "The loan was modified by another user.")
        if item.status == "settled":
            raise DomainError("invalid_restructure", "A settled loan cannot be restructured.")
        item.annual_rate = payload.annual_rate
        item.installments = payload.installments
        item.first_due_date = payload.first_due_date
        item.monthly_installment = calculate_emi(
            item.outstanding, payload.annual_rate, payload.installments
        )
        item.status = "active"
        item.deferred_until = None
        item.version += 1
        return _row(
            item,
            "id",
            "outstanding",
            "annual_rate",
            "installments",
            "monthly_installment",
            "first_due_date",
            "status",
            "version",
        )

    @app.post("/v1/loans/bulk-settle")
    def bulk_settle_loans(
        payload: BulkSettlementRequest,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "finance"))],
    ) -> dict[str, Any]:
        if len({item.loan_id for item in payload.items}) != len(payload.items):
            raise DomainError("duplicate_loan", "A settlement batch cannot repeat a loan.")
        prepared: list[tuple[LoanRow, BulkSettlementItem]] = []
        for settlement in payload.items:
            loan = session.get(LoanRow, str(settlement.loan_id))
            if loan is None or loan.deleted_at is not None:
                raise DomainError("not_found", f"Loan {settlement.loan_id} was not found.")
            if settlement.amount != loan.outstanding:
                raise DomainError(
                    "settlement_mismatch",
                    f"Loan {settlement.loan_id} must be settled for its exact outstanding amount.",
                )
            prepared.append((loan, settlement))
        payment_ids: list[str] = []
        for loan, settlement in prepared:
            payment = LoanPaymentRow(
                loan_id=loan.id,
                amount=settlement.amount,
                paid_on=settlement.paid_on,
                reference=settlement.reference,
            )
            session.add(payment)
            loan.outstanding = Decimal("0")
            loan.status = "settled"
            loan.version += 1
            session.flush()
            payment_ids.append(payment.id)
        return {"settled": len(prepared), "payment_ids": payment_ids}

    @app.delete("/v1/loans/{loan_id}", status_code=204)
    def delete_loan(
        loan_id: UUID,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "finance"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> Response:
        item = session.get(LoanRow, str(loan_id))
        if item is None or item.deleted_at is not None:
            raise DomainError("not_found", "Loan not found.")
        if item.version != if_match:
            raise DomainError("stale_version", "The loan was modified by another user.")
        has_payments = session.scalar(
            select(func.count())
            .select_from(LoanPaymentRow)
            .where(LoanPaymentRow.loan_id == item.id)
        )
        if has_payments:
            raise DomainError("loan_has_payments", "A loan with payments cannot be deleted.")
        item.deleted_at = datetime.now(UTC)
        item.status = "settled"
        item.outstanding = Decimal("0")
        item.version += 1
        return Response(status_code=204)

    @app.put("/v1/preferences")
    def upsert_preference(
        payload: PreferenceUpsert,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr"))],
    ) -> dict[str, Any]:
        item = session.scalar(
            select(PreferenceRow).where(
                PreferenceRow.scope_type == payload.scope_type,
                PreferenceRow.scope_id == payload.scope_id,
                PreferenceRow.preference_key == payload.preference_key,
            )
        )
        if item is None:
            item = PreferenceRow(**payload.model_dump())
            session.add(item)
        else:
            item.value = payload.value
            item.is_locked = payload.is_locked
            item.version += 1
        session.flush()
        preference_cache.clear()
        return _row(
            item, "id", "scope_type", "scope_id", "preference_key", "value", "is_locked", "version"
        )

    @app.get("/v1/preferences/effective")
    def effective_preferences(
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authenticated)],
        company_id: str = "",
        branch: str = "",
        department: str = "",
        pay_group: str = "",
        repair_center: str = "",
    ) -> dict[str, Any]:
        cache_key = (
            str(claims.subject),
            company_id,
            branch,
            department,
            pay_group,
            repair_center,
        )
        cached = preference_cache.get(cache_key)
        if cached is not None and cached[0] > time.monotonic():
            return cached[1]
        scopes = [
            ("global", ""),
            ("default", ""),
            ("company", company_id),
            ("branch", branch),
            ("department", department),
            ("repair_center", repair_center),
            ("pay_group", pay_group),
            ("user", str(claims.subject)),
        ]
        # Merge layers from least -> most specific, while enforcing `is_locked`.
        # If a key is locked in any earlier (less specific) layer, later layers cannot override it.
        effective: dict[str, Any] = {}
        locked: set[str] = set()
        for scope_type, scope_id in scopes:
            for item in session.scalars(
                select(PreferenceRow).where(
                    PreferenceRow.scope_type == scope_type,
                    PreferenceRow.scope_id == scope_id,
                )
            ):
                key = item.preference_key
                if key in locked:
                    continue
                if (
                    key in effective
                    and isinstance(effective[key], Mapping)
                    and isinstance(item.value, Mapping)
                ):
                    effective[key] = resolve_preferences((effective[key], item.value))
                else:
                    effective[key] = item.value
                if item.is_locked:
                    locked.add(key)
        preference_cache[cache_key] = (
            time.monotonic() + config.preference_cache_seconds,
            effective,
        )
        return effective

    @app.post("/v1/attachments", status_code=201)
    async def upload_attachment(
        entity_type: str,
        entity_id: UUID,
        file: Annotated[UploadFile, File()],
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "manager", "finance"))],
    ) -> dict[str, Any]:
        content = await file.read(config.max_attachment_bytes + 1)
        if not content or len(content) > config.max_attachment_bytes:
            raise DomainError(
                "invalid_attachment_size", "Attachment is empty or exceeds the size limit."
            )
        digest = hashlib.sha256(content).hexdigest()
        storage_key = f"{digest[:2]}/{digest}"
        destination = attachment_root / storage_key
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            destination.write_bytes(content)
        item = AttachmentRow(
            entity_type=entity_type[:50],
            entity_id=str(entity_id),
            original_name=Path(file.filename or "attachment").name[:255],
            content_type=(file.content_type or "application/octet-stream")[:100],
            size_bytes=len(content),
            sha256=digest,
            storage_key=storage_key,
            content=content,
            scan_status="pending",
        )
        session.add(item)
        session.flush()
        return _row(
            item,
            "id",
            "entity_type",
            "entity_id",
            "original_name",
            "content_type",
            "size_bytes",
            "sha256",
            "scan_status",
        )

    @app.get("/v1/ess/dashboard")
    def ess_dashboard(
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authenticated)],
    ) -> dict[str, Any]:
        employee_id = scoped_employee_id(session, claims)
        if employee_id is None:
            return {"employee_id": None, "requests": 0, "open_requests": 0}
        base = (
            select(func.count())
            .select_from(EssRequestRow)
            .where(
                EssRequestRow.employee_id == employee_id,
                EssRequestRow.deleted_at.is_(None),
            )
        )
        return {
            "employee_id": str(employee_id),
            "requests": session.scalar(base) or 0,
            "open_requests": session.scalar(
                base.where(EssRequestRow.status.in_(["submitted", "approved"]))
            )
            or 0,
        }

    @app.get("/v1/ess/requests")
    def ess_requests(
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authenticated)],
    ) -> list[dict[str, Any]]:
        query = select(EssRequestRow).where(EssRequestRow.deleted_at.is_(None))
        scope = scoped_employee_id(session, claims)
        if scope is not None:
            query = query.where(EssRequestRow.employee_id == scope)
        return [
            _row(
                item,
                "id",
                "employee_id",
                "request_type",
                "travel_date",
                "origin_code",
                "destination_code",
                "status",
                "notes",
                "version",
            )
            for item in session.scalars(query.order_by(EssRequestRow.created_at.desc()))
        ]

    @app.post("/v1/ess/requests", status_code=201)
    def create_ess_request(
        payload: EssRequestCreate,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authenticated)],
    ) -> dict[str, Any]:
        scope = scoped_employee_id(session, claims)
        if scope is not None and scope != payload.employee_id:
            raise DomainError("forbidden", "Employees may submit only their own requests.")
        if payload.origin_code.upper() == payload.destination_code.upper():
            raise DomainError("invalid_route", "Origin and destination must differ.")
        values = payload.model_dump(exclude={"origin_code", "destination_code"})
        item = EssRequestRow(
            **values,
            origin_code=payload.origin_code.upper(),
            destination_code=payload.destination_code.upper(),
        )
        session.add(item)
        session.flush()
        return _row(
            item,
            "id",
            "employee_id",
            "request_type",
            "travel_date",
            "origin_code",
            "destination_code",
            "status",
            "notes",
            "version",
        )

    @app.patch("/v1/ess/requests/{request_id}/status")
    def change_ess_status(
        request_id: UUID,
        payload: StatusChange,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "manager"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> dict[str, Any]:
        item = session.get(EssRequestRow, str(request_id))
        if item is None or item.deleted_at is not None:
            raise DomainError("not_found", "ESS request not found.")
        if item.version != if_match:
            raise DomainError("stale_version", "The request was modified by another user.")
        allowed = {
            "submitted": {"approved", "rejected"},
            "approved": {"paid"},
            "rejected": set(),
            "paid": set(),
        }
        if payload.status not in allowed.get(item.status, set()):
            raise DomainError("invalid_transition", "The requested status transition is invalid.")
        item.status = payload.status
        item.version += 1
        return _row(item, "id", "status", "version")

    @app.delete("/v1/ess/requests/{request_id}", status_code=204)
    def delete_ess_request(
        request_id: UUID,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authenticated)],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> Response:
        item = session.get(EssRequestRow, str(request_id))
        if item is None or item.deleted_at is not None:
            raise DomainError("not_found", "ESS request not found.")
        scope = scoped_employee_id(session, claims)
        if scope is not None and scope != item.employee_id:
            raise DomainError("forbidden", "Employees may delete only their own requests.")
        if item.version != if_match:
            raise DomainError("stale_version", "The request was modified by another user.")
        item.deleted_at = datetime.now(UTC)
        item.version += 1
        return Response(status_code=204)

    @app.post("/v1/admin/erase-data")
    def erase_operational_data(
        payload: EraseDataRequest,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin"))],
    ) -> dict[str, Any]:
        counts = _erase_operational_data(session)
        restored = _seed_default_preferences(session)
        preference_cache.clear()
        return {
            "status": "erased",
            "confirm": payload.confirm,
            "cleared": counts,
            "defaults_restored": restored,
            "erased_at": datetime.now(UTC),
        }

    @app.get("/v1/admin/backups")
    def admin_list_backups(
        _: Annotated[Claims, Depends(authorized("admin"))],
    ) -> dict[str, Any]:
        rows = list_backups(config.backup_root)
        native = str(config.database_url).startswith("mssql")
        credentials_ready = False
        credential_hint = ""
        if native:
            try:
                resolve_mssql_login(
                    config.database_url,
                    db_user=config.db_user,
                    db_password=config.db_password,
                    server=config.db_server,
                )
                credentials_ready = True
            except DomainError as error:
                credential_hint = str(error)
        return {
            "backup_root": str(Path(config.backup_root).resolve()),
            "retention_days": config.backup_retention_days,
            "native_mssql_available": native,
            "native_credentials_ready": credentials_ready,
            "native_credential_hint": credential_hint,
            "count": len(rows),
            "backups": [
                {
                    "file_name": item.file_name,
                    "kind": item.kind,
                    "size_bytes": item.size_bytes,
                    "created_at": item.created_at,
                    "sha256": item.sha256,
                }
                for item in rows
            ],
        }

    @app.post("/v1/admin/backups", status_code=201)
    def admin_create_backup(
        payload: BackupCreateRequest,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin"))],
    ) -> dict[str, Any]:
        if payload.kind == "mssql":
            created = create_native_mssql_backup(
                database_url=config.database_url,
                root=config.backup_root,
                db_user=config.db_user,
                db_password=config.db_password,
                server=config.db_server,
            )
        else:
            created = create_logical_backup(session, config.backup_root, label="HCM")
        pruned = prune_backups(config.backup_root, config.backup_retention_days)
        return {
            "status": "created",
            "file_name": created.file_name,
            "kind": created.kind,
            "size_bytes": created.size_bytes,
            "sha256": created.sha256,
            "created_at": created.created_at,
            "pruned": pruned,
        }

    @app.post("/v1/admin/backups/restore")
    def admin_restore_backup(
        payload: BackupRestoreRequest,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin"))],
    ) -> dict[str, Any]:
        path = resolve_backup_file(config.backup_root, payload.file_name)
        if path.suffix.lower() == ".bak":
            result = restore_native_mssql(
                database_url=config.database_url,
                backup_path=path,
                db_user=config.db_user,
                db_password=config.db_password,
                server=config.db_server,
            )
        else:
            result = restore_logical_backup(
                session,
                path,
                erase_fn=_erase_operational_data,
                seed_preferences_fn=_seed_default_preferences,
            )
            preference_cache.clear()
        return {**result, "confirm": payload.confirm, "restored_at": datetime.now(UTC)}

    @app.delete("/v1/admin/backups/{file_name}", status_code=204)
    def admin_delete_backup(
        file_name: str,
        _: Annotated[Claims, Depends(authorized("admin"))],
    ) -> Response:
        path = resolve_backup_file(config.backup_root, file_name)
        path.unlink(missing_ok=False)
        return Response(status_code=204)

    @app.get("/v1/reports/detail/{report_name}")
    def report_detail(
        report_name: ReportName,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance", "auditor"))],
    ) -> dict[str, Any]:
        columns, rows = _collect_report_rows(session, report_name)
        return {
            "report": report_name,
            "columns": columns,
            "rows": [list(row) for row in rows],
            "count": len(rows),
            "generated_at": datetime.now(UTC),
        }

    @app.get("/v1/reports/export/{report_name}.pdf")
    def report_pdf(
        report_name: ReportName,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance", "auditor"))],
    ) -> Response:
        columns, rows = _collect_report_rows(session, report_name)
        title = report_name.replace("-", " ").title()
        pdf = build_pdf_report(title, columns, rows)
        return Response(
            pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{report_name}.pdf"'},
        )

    @app.get("/v1/reports/export/{report_name}.xlsx")
    def report_xlsx(
        report_name: ReportName,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance", "auditor"))],
    ) -> Response:
        columns, rows = _collect_report_rows(session, report_name)
        records = [dict(zip(columns, row, strict=True)) for row in rows]
        workbook = export_workbook(report_name.replace("-", " ").title(), columns, records)
        return Response(
            workbook,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{report_name}.xlsx"'},
        )

    @app.get("/v1/reports/data/{report_name}")
    def report_data(
        report_name: ReportName,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance", "auditor"))],
    ) -> dict[str, Any]:
        report_value: int | Decimal | None
        if report_name == "employee-master":
            report_value = session.scalar(
                select(func.count())
                .select_from(EmployeeRow)
                .where(EmployeeRow.deleted_at.is_(None))
            )
        elif report_name == "opening-balances":
            report_value = session.scalar(
                select(func.count())
                .select_from(OpeningBalanceRow)
                .where(OpeningBalanceRow.deleted_at.is_(None))
            )
        elif report_name == "entitlements":
            report_value = session.scalar(
                select(func.count())
                .select_from(EntitlementRateRow)
                .where(EntitlementRateRow.deleted_at.is_(None))
            )
        elif report_name == "ticket-register":
            report_value = session.scalar(
                select(func.count()).select_from(TicketRow).where(TicketRow.deleted_at.is_(None))
            )
        elif report_name == "loan-outstanding":
            report_value = session.scalar(
                select(func.coalesce(func.sum(LoanRow.outstanding), 0)).where(
                    LoanRow.deleted_at.is_(None)
                )
            )
        elif report_name == "loan-statement":
            report_value = session.scalar(
                select(func.count()).select_from(LoanRow).where(LoanRow.deleted_at.is_(None))
            )
        else:
            report_value = session.scalar(
                select(func.coalesce(func.sum(TicketRow.company_paid - TicketRow.entitlement), 0))
                .where(TicketRow.company_paid > TicketRow.entitlement)
                .where(TicketRow.deleted_at.is_(None))
            )
        return {
            "report": report_name,
            "value": report_value or 0,
            "generated_at": datetime.now(UTC),
        }

    @app.get("/v1/reports/excess.pdf")
    def excess_report(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance", "auditor"))],
    ) -> Response:
        columns, rows = _collect_report_rows(session, "excess-recovery")
        pdf = build_pdf_report("Airfare Excess Recovery Report", columns, rows)
        return Response(
            pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="airfare-excess-report.pdf"'},
        )

    return app


app = create_app()


def run() -> None:
    """Run the HTTP service on the configured port (3388 by default)."""
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "airfare_management.api.main:app",
        host=settings.host,
        port=settings.port,
        proxy_headers=True,
    )

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
from sqlalchemy import case, delete, func, inspect, select, text, true, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from airfare_management.api.dependencies import (
    Claims,
    build_authenticated,
    build_authorized,
    build_database,
)
from airfare_management.api.health import register_health_routes, update_operational_gauges
from airfare_management.api.routers.reports import create_reports_router
from airfare_management.application.documents import (
    create_document,
    document_detail,
    document_pdf_path,
    employee_defaults,
    get_document,
    list_documents,
    list_templates as list_document_templates,
    preview_document,
    render_allocation_print_pdf,
    update_document,
)
from airfare_management.application.contracts import (
    AllocationPreview,
    AllocationQueryHandler,
    PreviewAllocation,
)
from airfare_management.config import Settings, get_settings
from airfare_management.domain.models import DomainError, ValidationError
from airfare_management.domain.services import (
    AIRFARE_CYCLE_DAYS,
    EntitlementScenario,
    ExcessSettlementOption,
    ExcessSettlementResult,
    LoanInstallment,
    _anniversary_window,
    atlas_round,
    build_amortization_schedule,
    calculate_emi,
    calculate_entitlement_scenario,
    conditional_format,
    fn_atlas_airfare_amount,
    is_loan_settlement,
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
    AuditRow,
    Base,
    EmployeeRow,
    actor_context,
    correlation_context,
    create_session_factory,
    ip_context,
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
from airfare_management.infrastructure.policy import (
    catalog_with_values,
    load_policy,
    policy_default_rows,
    to_allocation_policy,
    validate_setting,
)
from airfare_management.infrastructure.repositories import LoanRepository
from airfare_management.infrastructure.telemetry import (
    PrometheusMiddleware,
    configure_logging,
    metrics_response,
)
from airfare_management.infrastructure.schema import (
    AttachmentRow,
    CompanyRow,
    DocumentRow,
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
    ReportTemplateRow,
    TicketRow,
    UserRow,
    AiAgentAuditRow,
    AiRepairLogRow,
)
from airfare_management.infrastructure.security import (
    create_refresh_token,
    hash_password,
    hash_refresh_token,
    issue_access_token,
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
    "repair_center",
    "designation",
    "nationality",
    "passport_no",
    "arabic_name",
    "cpr_no",
    "date_of_birth",
    "gender",
    "passport_expiry",
    "visa_no",
    "visa_expiry",
    "airline_sector",
    "travel_class",
    "last_airticket_date",
    "sub_section",
    "reporting_officer_id",
    "custom_airfare_rate",
    "max_entitlement_cap_rate",
    "grade",
    "contract_type",
    "origin_country",
    "employment_status",
    "monthly_salary",
    "probation_end_date",
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


class UserUpdate(ApiModel):
    """Administrative user update payload."""

    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    roles: set[Literal["SYSTEM_ADMIN", "HR_MANAGER", "FINANCE_MANAGER", "EMPLOYEE"]] | None = None
    employee_id: UUID | None = None
    active: bool | None = None
    password: str | None = Field(default=None, min_length=12, max_length=200)


class CompanyCreate(ApiModel):
    """Company creation payload."""

    code: str = Field(min_length=1, max_length=30, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=2, max_length=200)
    currency: str = Field(default="BHD", min_length=3, max_length=3)
    cr_no: str | None = Field(default=None, max_length=60)
    address: str | None = Field(default=None, max_length=500)


class CompanyUpdate(ApiModel):
    """Mutable company branding fields."""

    name: str | None = Field(default=None, min_length=2, max_length=200)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    cr_no: str | None = Field(default=None, max_length=60)
    address: str | None = Field(default=None, max_length=500)
    active: bool | None = None


class EmployeeCreate(ApiModel):
    """Employee creation payload."""

    code: str = Field(min_length=1, max_length=30, pattern=r"^[A-Za-z0-9_-]+$")
    full_name: str = Field(min_length=2, max_length=200)
    company_id: UUID
    join_date: date
    department: str = Field(default="", max_length=100)
    branch: str = Field(default="", max_length=100)
    pay_group: str = Field(default="", max_length=100)
    designation: str = Field(default="", max_length=100)
    nationality: str = Field(default="", max_length=100)
    passport_no: str = Field(default="", max_length=40)
    arabic_name: str = Field(default="", max_length=200)
    cpr_no: str = Field(default="", max_length=40)
    date_of_birth: date | None = None
    gender: str = Field(default="", max_length=20)
    passport_expiry: date | None = None
    visa_no: str = Field(default="", max_length=40)
    visa_expiry: date | None = None
    airline_sector: str = Field(default="", max_length=100)
    travel_class: str = Field(default="", max_length=40)
    last_airticket_date: date | None = None
    sub_section: str = Field(default="", max_length=100)
    reporting_officer_id: str | None = Field(default=None, max_length=200)
    email: EmailStr | None = None
    custom_airfare_rate: Decimal | None = Field(default=None, ge=0)
    max_entitlement_cap_rate: Decimal | None = Field(default=None, ge=0)
    repair_center: str = Field(default="", max_length=100)
    grade: str = Field(default="", max_length=20)
    contract_type: str = Field(default="", max_length=40)
    origin_country: str = Field(default="", max_length=100)
    employment_status: str = Field(default="active", max_length=40)
    monthly_salary: Decimal | None = Field(default=None, ge=0)
    probation_end_date: date | None = None


class EmployeeUpdate(ApiModel):
    """Mutable employee profile fields."""

    full_name: str = Field(min_length=2, max_length=200)
    join_date: date
    department: str = Field(default="", max_length=100)
    branch: str = Field(default="", max_length=100)
    pay_group: str | None = Field(default=None, max_length=100)
    designation: str = Field(default="", max_length=100)
    nationality: str = Field(default="", max_length=100)
    passport_no: str = Field(default="", max_length=40)
    arabic_name: str = Field(default="", max_length=200)
    cpr_no: str = Field(default="", max_length=40)
    date_of_birth: date | None = None
    gender: str = Field(default="", max_length=20)
    passport_expiry: date | None = None
    visa_no: str = Field(default="", max_length=40)
    visa_expiry: date | None = None
    airline_sector: str = Field(default="", max_length=100)
    travel_class: str = Field(default="", max_length=40)
    last_airticket_date: date | None = None
    sub_section: str = Field(default="", max_length=100)
    reporting_officer_id: str | None = Field(default=None, max_length=200)
    email: EmailStr | None = None
    custom_airfare_rate: Decimal | None = Field(default=None, ge=0)
    max_entitlement_cap_rate: Decimal | None = Field(default=None, ge=0)
    repair_center: str = Field(default="", max_length=100)
    grade: str = Field(default="", max_length=20)
    contract_type: str = Field(default="", max_length=40)
    origin_country: str = Field(default="", max_length=100)
    employment_status: str = Field(default="active", max_length=40)
    monthly_salary: Decimal | None = Field(default=None, ge=0)
    probation_end_date: date | None = None
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


class AllocationPrintRequest(AllocationPreviewRequest):
    """Print-format payload for an Atlas-style airfare allocation slip."""

    origin_code: str = Field(default="ORG", min_length=3, max_length=3)
    destination_code: str = Field(default="DST", min_length=3, max_length=3)
    notes: str = Field(default="", max_length=4000)
    ticket_code: str | None = Field(default=None, max_length=40)
    status: str = Field(default="APPROVED", max_length=40)
    ticket_id: UUID | None = None


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
    excess_handling: Literal[
        "CONVERT_TO_LOAN", "COMPANY_PAID", "SELF_PAID", "ENTITLEMENT_AMOUNT"
    ] = "SELF_PAID"
    notes: str = Field(default="", max_length=4000)


class TicketUpdate(ApiModel):
    """Editable ticket fields (including paid corrections with loan revise)."""

    travel_date: date
    origin_code: str = Field(min_length=3, max_length=3)
    destination_code: str = Field(min_length=3, max_length=3)
    ticket_cost: Decimal = Field(ge=0)
    entitlement: Decimal = Field(ge=0)
    company_paid: Decimal = Field(ge=0)
    excess_handling: Literal[
        "CONVERT_TO_LOAN", "COMPANY_PAID", "SELF_PAID", "ENTITLEMENT_AMOUNT", "LOAN"
    ] = "SELF_PAID"
    notes: str = Field(default="", max_length=4000)
    tenure_months: int | None = Field(default=None, ge=1, le=600)


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


class RateUpdate(ApiModel):
    """Mutable fields for an existing entitlement rate."""

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


class ExpenseAnomalyRequest(ApiModel):
    """Pay-group expense anomaly check."""

    claim_amount: Decimal = Field(gt=0)
    pay_group: str = Field(default="", max_length=100)


class EmiRiskRequest(ApiModel):
    """EMI default-risk scoring before loan approval."""

    principal: Decimal = Field(gt=0)
    tenure_months: int = Field(gt=0, le=600)
    employee_id: UUID | None = None
    entitlement: Decimal | None = Field(default=None, ge=0)


class AgentChatRequest(ApiModel):
    """Schema-gated AI Data Agent chat turn."""

    message: str = Field(min_length=1, max_length=2000)
    apply_fix: str | None = Field(default=None, max_length=80)
    auto_repair_mode: bool = False
    apply_token: str | None = Field(default=None, max_length=64)
    confirm: str | None = Field(default=None, max_length=20)


class AgentRepairApplyRequest(ApiModel):
    """Confirm a previously previewed whitelisted repair."""

    apply_token: str = Field(min_length=8, max_length=64)
    confirm: Literal["APPLY"]
    auto_repair_mode: bool = True


class SaaSilentFixRequest(ApiModel):
    """Zero-risk SAA silent fixes (whitelist only)."""

    codes: list[str] = Field(default_factory=lambda: ["update_statistics"])
    confirm: Literal["SILENT_APPLY"] = "SILENT_APPLY"


class ReportTemplateCreate(ApiModel):
    """Create a Crystal-style report template."""

    code: str = Field(min_length=1, max_length=60, pattern=r"^[A-Za-z0-9_-]+$")
    title: str = Field(min_length=1, max_length=200)
    dataset: Literal[
        "employee-master",
        "opening-balances",
        "entitlements",
        "ticket-register",
        "loan-outstanding",
        "loan-statement",
        "liability-projections",
        "excess-recovery",
    ]
    definition: dict[str, Any] = Field(default_factory=dict)


class ReportTemplateUpdate(ApiModel):
    """Update a saved report template."""

    title: str = Field(min_length=1, max_length=200)
    definition: dict[str, Any] = Field(default_factory=dict)


class CrystalExportRequest(ApiModel):
    """Export a Crystal .rpt via BIP when configured."""

    report_id: str = Field(min_length=1, max_length=120)


class EmployeeImportCommitRow(ApiModel):
    """One employee row selected for import (Focus-style master fields)."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    row: int = Field(ge=1)
    code: str = Field(min_length=1, max_length=30, pattern=r"^[A-Za-z0-9_-]+$")
    full_name: str = Field(min_length=2, max_length=200)
    company_id: UUID
    join_date: date
    department: str = Field(default="", max_length=100)
    branch: str = Field(default="", max_length=100)
    pay_group: str = Field(default="", max_length=100)
    designation: str = Field(default="", max_length=100)
    nationality: str = Field(default="", max_length=100)
    passport_no: str = Field(default="", max_length=40)
    arabic_name: str = Field(default="", max_length=200)
    cpr_no: str = Field(default="", max_length=40)
    date_of_birth: date | None = None
    gender: str = Field(default="", max_length=20)
    passport_expiry: date | None = None
    visa_no: str = Field(default="", max_length=40)
    visa_expiry: date | None = None
    airline_sector: str = Field(default="", max_length=100)
    travel_class: str = Field(default="", max_length=40)
    last_airticket_date: date | None = None
    sub_section: str = Field(default="", max_length=100)
    reporting_officer_id: str | None = Field(default=None, max_length=200)
    email: EmailStr | None = None
    custom_airfare_rate: Decimal | None = Field(default=None, ge=0)
    max_entitlement_cap_rate: Decimal | None = Field(default=None, ge=0)
    repair_center: str = Field(default="", max_length=100)
    grade: str = Field(default="", max_length=20)
    contract_type: str = Field(default="", max_length=40)
    origin_country: str = Field(default="", max_length=100)
    employment_status: str = Field(default="active", max_length=40)
    monthly_salary: Decimal | None = Field(default=None, ge=0)
    probation_end_date: date | None = None
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


class SettingsBatchUpdate(ApiModel):
    """Batch update for the global rule-engine settings console."""

    settings: dict[str, Any] = Field(min_length=1)


class DocumentRequest(ApiModel):
    """Document preview/generation payload.

    employee_id is optional — Focus Soft issues offer/contract vouchers from
    recruitment before Employee Master exists. Party details live in params.
    """

    kind: Literal["offer_letter", "contract"]
    template_key: str = Field(min_length=1, max_length=40)
    employee_id: UUID | None = None
    company_id: UUID | None = None
    params: dict[str, Any] = Field(default_factory=dict)


class DocumentUpdateRequest(ApiModel):
    """Edit an issued voucher and regenerate PDF (keeps voucher_no)."""

    template_key: str | None = Field(default=None, min_length=1, max_length=40)
    employee_id: UUID | None = None
    company_id: UUID | None = None
    params: dict[str, Any] = Field(default_factory=dict)


class BackupCreateRequest(ApiModel):
    """Create a catalogued database backup."""

    kind: Literal["logical", "mssql"] = "logical"


class BackupRestoreRequest(ApiModel):
    """Restore from a catalogued backup file."""

    file_name: str = Field(min_length=1, max_length=260)
    confirm: Literal["RESTORE_CONFIRM"]


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
        return {
            "loan_id": None,
            "loan_number": None,
            "loan_code": None,
            "loan_status": None,
            "loan_version": None,
            "loan_outstanding": None,
        }
    return {
        "loan_id": loan.id,
        "loan_number": loan.loan_number,
        "loan_code": loan.loan_code,
        "loan_status": loan.status,
        "loan_version": loan.version,
        "loan_outstanding": loan.outstanding,
    }


def _active_source_loan(session: Session, ticket_id: str) -> LoanRow | None:
    """Return the non-deleted loan linked to a ticket, if any."""
    return session.scalar(
        select(LoanRow).where(
            LoanRow.source_ticket_id == ticket_id,
            LoanRow.deleted_at.is_(None),
        )
    )


def _loan_has_payments(session: Session, loan_id: str) -> bool:
    """True when any non-reversed recovery payment was posted against the loan."""
    count = session.scalar(
        select(func.count())
        .select_from(LoanPaymentRow)
        .where(
            LoanPaymentRow.loan_id == loan_id,
            LoanPaymentRow.deleted_at.is_(None),
        )
    )
    return bool(count)


def _reverse_loan_payments(session: Session, loan_id: str) -> int:
    """Soft-delete active payments (ERPNext-style repayment cancel) and return count."""
    payments = list(
        session.scalars(
            select(LoanPaymentRow).where(
                LoanPaymentRow.loan_id == loan_id,
                LoanPaymentRow.deleted_at.is_(None),
            )
        )
    )
    now = datetime.now(UTC)
    for payment in payments:
        payment.deleted_at = now
        payment.version += 1
    return len(payments)


def _soft_delete_loan(session: Session, loan: LoanRow) -> None:
    """Void a loan without posted payments (revise / cascade delete)."""
    loan.deleted_at = datetime.now(UTC)
    loan.status = "voided"
    loan.version += 1


def _create_loan_from_settlement(
    session: Session,
    *,
    ticket: TicketRow,
    settlement: ExcessSettlementResult,
    policy: Any,
) -> LoanRow | None:
    """Create a recovery loan from an excess settlement (issue / edit / approve)."""
    if (
        not is_loan_settlement(settlement.option)
        or settlement.loan_principal is None
        or settlement.emi is None
        or settlement.tenure_months is None
    ):
        return None
    principal = quantize_money(settlement.loan_principal)
    if principal <= 0:
        return None
    rate = getattr(policy, "loan_interest_rate", Decimal("0")) or Decimal("0")
    due = _first_of_next_month(ticket.travel_date)
    loan = LoanRow(
        employee_id=ticket.employee_id,
        source_ticket_id=ticket.id,
        principal=principal,
        annual_rate=rate,
        installments=settlement.tenure_months,
        monthly_installment=quantize_money(
            calculate_emi(principal, rate, settlement.tenure_months)
        ),
        outstanding=principal,
        status="active",
        first_due_date=due,
    )
    session.add(loan)
    session.flush()
    LoanRepository(session).replace_schedule(
        loan.id,
        build_amortization_schedule(
            principal,
            rate,
            settlement.tenure_months,
            loan.first_due_date,
        ),
    )
    return loan


def _ticket_recovery_changed(
    *,
    linked_loan: LoanRow | None,
    settlement: ExcessSettlementResult,
    money_changed: bool,
    handling_same: bool,
) -> bool:
    """Whether an existing linked loan must be voided/revised for this edit."""
    if linked_loan is None:
        return False
    if money_changed or not handling_same:
        return True
    if not is_loan_settlement(settlement.option):
        return True
    if settlement.loan_principal is None or settlement.tenure_months is None:
        return True
    return (
        quantize_money(settlement.loan_principal) != quantize_money(linked_loan.principal)
        or settlement.tenure_months != linked_loan.installments
    )


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
        "policy_notes": list(getattr(entitlement, "policy_notes", ()) or ()),
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
                "department": employee.department,
                "designation": employee.designation,
                "nationality": employee.nationality,
                "branch": employee.branch,
                "email": employee.email,
                "reporting_officer_id": employee.reporting_officer_id,
            }
        )
        if not body.get("join_date") and employee.join_date is not None:
            body["join_date"] = employee.join_date.isoformat()
            body["date_of_joining"] = employee.join_date.isoformat()
    if preview.settlement is not None:
        settlement = preview.settlement
        option = settlement.option
        if not isinstance(option, str):
            option = getattr(option, "value", option)
        body.update(
            {
                "requested_ticket_amount": _decimal_text(settlement.requested_ticket_amount),
                "excess_cost": _decimal_text(settlement.excess_cost),
                "excess_option": str(option),
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
    active_codes: set[tuple[str, str]] = set()
    soft_deleted_codes: set[tuple[str, str]] = set()
    for employee in session.scalars(select(EmployeeRow)):
        key = (str(employee.company_id), employee.code.casefold())
        if employee.deleted_at is None:
            active_codes.add(key)
        else:
            soft_deleted_codes.add(key)
    for record in records:
        row_number = int(record.get("_row") or 0)
        try:
            candidate = EmployeeCreate.model_validate(
                {
                    key: value
                    for key, value in record.items()
                    if value is not None
                    and key
                    not in {
                        "_row",
                        "row",
                        "selected",
                        "severity",
                        "status",
                        "message",
                        "action",
                    }
                }
            )
            key = (str(candidate.company_id), candidate.code.casefold())
            duplicate_file = key in seen_codes
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
            elif duplicate_file:
                preview_rows.append(
                    {
                        "row": row_number,
                        **candidate.model_dump(mode="json"),
                        "severity": "ERROR",
                        "status": "ERROR",
                        "message": "Duplicate employee code inside this Excel file.",
                        "selected": False,
                        "action": None,
                    }
                )
            elif key in active_codes or key in soft_deleted_codes:
                seen_codes.add(key)
                preview_rows.append(
                    {
                        "row": row_number,
                        **candidate.model_dump(mode="json"),
                        "severity": "READY",
                        "status": "READY",
                        "message": (
                            "Ready to update existing employee."
                            if key in active_codes
                            else "Ready to reactivate and update soft-deleted employee."
                        ),
                        "selected": True,
                        "action": "UPDATE",
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
            if balance_year < 2000 or balance_year > 2200:
                raise ValueError("balance_year must be between 2000 and 2200.")
            opening_days = Decimal(str(record["opening_days"]))
            paid_days = Decimal(str(record.get("paid_days") or "0"))
            if opening_days < 0 or opening_days > 60:
                raise ValueError("opening_days must be between 0 and 60.")
            if paid_days < 0 or paid_days > 60:
                raise ValueError("paid_days must be between 0 and 60.")
            maximum_payout = Decimal(str(record.get("maximum_payout") or rate or "150"))
            opening_amount = record.get("opening_amount")
            if opening_amount in (None, ""):
                opening_amount = fn_atlas_airfare_amount(opening_days, maximum_payout)
            else:
                opening_amount = Decimal(str(opening_amount))
            if opening_amount < 0 or maximum_payout < 0:
                raise ValueError("Amounts must be zero or greater.")
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
                    "message": message if severity == "ERROR" else (
                        "Ready to update existing opening balance."
                        if existing is not None
                        else "Ready for import."
                    ),
                    "selected": severity == "READY",
                    "action": (
                        None
                        if severity != "READY"
                        else ("UPDATE" if existing is not None else "INSERT")
                    ),
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


def _ensure_employee_hcm_columns(bind: Any) -> None:
    """Add HCM lookup columns on existing MSSQL/SQLite employees tables."""
    inspector = inspect(bind)
    if "employees" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("employees")}
    dialect = bind.dialect.name
    additions: list[tuple[str, str]] = [
        ("designation", "VARCHAR(100) NOT NULL DEFAULT ''"),
        ("nationality", "VARCHAR(100) NOT NULL DEFAULT ''"),
        ("sub_section", "VARCHAR(100) NOT NULL DEFAULT ''"),
        ("reporting_officer_id", "VARCHAR(200) NULL"),
        ("arabic_name", "VARCHAR(200) NOT NULL DEFAULT ''"),
        ("cpr_no", "VARCHAR(40) NOT NULL DEFAULT ''"),
        ("date_of_birth", "DATE NULL"),
        ("gender", "VARCHAR(20) NOT NULL DEFAULT ''"),
        ("passport_expiry", "DATE NULL"),
        ("visa_no", "VARCHAR(40) NOT NULL DEFAULT ''"),
        ("visa_expiry", "DATE NULL"),
        ("airline_sector", "VARCHAR(100) NOT NULL DEFAULT ''"),
        ("travel_class", "VARCHAR(40) NOT NULL DEFAULT ''"),
        ("last_airticket_date", "DATE NULL"),
        ("repair_center", "VARCHAR(100) NOT NULL DEFAULT ''"),
        ("grade", "VARCHAR(20) NOT NULL DEFAULT ''"),
        ("contract_type", "VARCHAR(40) NOT NULL DEFAULT ''"),
        ("origin_country", "VARCHAR(100) NOT NULL DEFAULT ''"),
        ("employment_status", "VARCHAR(40) NOT NULL DEFAULT 'active'"),
        ("monthly_salary", "DECIMAL(19,4) NULL"),
        ("probation_end_date", "DATE NULL"),
    ]
    with bind.begin() as connection:
        for name, ddl in additions:
            if name in existing:
                continue
            if dialect == "mssql":
                connection.execute(text(f"ALTER TABLE employees ADD {name} {ddl}"))
            else:
                connection.execute(text(f"ALTER TABLE employees ADD COLUMN {name} {ddl}"))
        # Focus Soft "Reporting To" stores a display name, not a 36-char id.
        if dialect == "mssql" and "reporting_officer_id" in existing:
            connection.execute(
                text(
                    """
                    IF EXISTS (
                        SELECT 1 FROM sys.columns
                        WHERE object_id = OBJECT_ID(N'dbo.employees')
                          AND name = N'reporting_officer_id'
                          AND max_length < 400
                    )
                    ALTER TABLE employees ALTER COLUMN reporting_officer_id VARCHAR(200) NULL
                    """
                )
            )


def _ensure_company_profile_columns(bind: Any) -> None:
    """Add CR No. and address columns used by Settings company profile."""
    inspector = inspect(bind)
    if "companies" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("companies")}
    dialect = bind.dialect.name
    additions: list[tuple[str, str]] = [
        ("cr_no", "VARCHAR(60) NULL"),
        ("address", "VARCHAR(500) NULL"),
        (
            "logo_data",
            "VARBINARY(MAX) NULL" if dialect == "mssql" else "BLOB NULL",
        ),
        ("logo_content_type", "VARCHAR(50) NULL"),
    ]
    with bind.begin() as connection:
        for name, ddl in additions:
            if name in existing:
                continue
            if dialect == "mssql":
                connection.execute(text(f"ALTER TABLE companies ADD {name} {ddl}"))
            else:
                connection.execute(text(f"ALTER TABLE companies ADD COLUMN {name} {ddl}"))


def _ensure_document_hr_columns(bind: Any) -> None:
    """Add Focus-inspired HR voucher columns on existing documents tables."""
    inspector = inspect(bind)
    if "documents" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("documents")}
    dialect = bind.dialect.name
    additions: list[tuple[str, str]] = [
        ("voucher_no", "VARCHAR(40) NULL"),
        ("document_date", "DATE NULL"),
        ("joining_date", "DATE NULL"),
        ("narration", "NVARCHAR(MAX) NULL" if dialect == "mssql" else "TEXT NULL"),
        ("employee_name_arabic", "VARCHAR(200) NULL"),
        ("cpr_no", "VARCHAR(40) NULL"),
        ("nature_of_employment", "VARCHAR(120) NULL"),
        ("basic_salary", "DECIMAL(19,4) NULL"),
        ("hra", "DECIMAL(19,4) NULL"),
        ("petrol_allowance", "DECIMAL(19,4) NULL"),
        ("car_allowance", "DECIMAL(19,4) NULL"),
        ("special_duty_allowance", "DECIMAL(19,4) NULL"),
        ("net_amount", "DECIMAL(19,4) NULL"),
        (
            "traveling_airfare",
            "BIT NOT NULL DEFAULT 0" if dialect == "mssql" else "BOOLEAN NOT NULL DEFAULT 0",
        ),
        ("additional_details", "NVARCHAR(MAX) NULL" if dialect == "mssql" else "TEXT NULL"),
        ("address_villa", "VARCHAR(120) NULL"),
        ("address_street", "VARCHAR(120) NULL"),
        ("address_block", "VARCHAR(40) NULL"),
        ("company_id", "VARCHAR(36) NULL"),
    ]
    with bind.begin() as connection:
        for name, ddl in additions:
            if name in existing:
                continue
            if dialect == "mssql":
                connection.execute(text(f"ALTER TABLE documents ADD {name} {ddl}"))
            else:
                connection.execute(text(f"ALTER TABLE documents ADD COLUMN {name} {ddl}"))
        if "voucher_no" not in existing or dialect == "mssql":
            # Best-effort unique index; ignore if already present.
            try:
                if dialect == "mssql":
                    connection.execute(
                        text(
                            "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_documents_voucher_no') "
                            "CREATE UNIQUE INDEX ux_documents_voucher_no ON documents(voucher_no) "
                            "WHERE voucher_no IS NOT NULL"
                        )
                    )
                else:
                    connection.execute(
                        text(
                            "CREATE UNIQUE INDEX IF NOT EXISTS ux_documents_voucher_no "
                            "ON documents(voucher_no)"
                        )
                    )
            except Exception:  # noqa: BLE001
                pass
        # Offer/contract vouchers may exist before Employee Master — allow NULL.
        # MSSQL refuses ALTER when a FK is present; drop/recreate the employee_id FK.
        try:
            if dialect == "mssql":
                fk_rows = connection.execute(
                    text(
                        """
                        SELECT fk.name AS fk_name
                        FROM sys.foreign_keys fk
                        JOIN sys.foreign_key_columns fkc
                          ON fkc.constraint_object_id = fk.object_id
                        JOIN sys.columns col
                          ON col.object_id = fkc.parent_object_id
                         AND col.column_id = fkc.parent_column_id
                        WHERE fk.parent_object_id = OBJECT_ID(N'dbo.documents')
                          AND col.name = N'employee_id'
                        """
                    )
                ).fetchall()
                for (fk_name,) in fk_rows:
                    connection.execute(text(f"ALTER TABLE documents DROP CONSTRAINT [{fk_name}]"))
                connection.execute(
                    text("ALTER TABLE documents ALTER COLUMN employee_id UNIQUEIDENTIFIER NULL")
                )
                for (fk_name,) in fk_rows:
                    connection.execute(
                        text(
                            f"IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'{fk_name}') "
                            f"ALTER TABLE documents ADD CONSTRAINT [{fk_name}] "
                            f"FOREIGN KEY (employee_id) REFERENCES employees(id)"
                        )
                    )
        except Exception:  # noqa: BLE001
            pass


def _first_of_next_month(anchor: date) -> date:
    """Return the first calendar day of the month after *anchor*."""
    if anchor.month == 12:
        return date(anchor.year + 1, 1, 1)
    return date(anchor.year, anchor.month + 1, 1)


def _employee_has_open_loan(session: Session, employee_id: UUID) -> bool:
    """True when the employee has any active loan with a remaining balance."""
    return (
        session.scalar(
            select(func.count())
            .select_from(LoanRow)
            .where(
                LoanRow.employee_id == employee_id,
                LoanRow.deleted_at.is_(None),
                LoanRow.status == "active",
                LoanRow.outstanding > 0,
            )
        )
        or 0
    ) > 0


def _assert_unlocked(session: Session, created_at: datetime | None, entity: str) -> None:
    """Enforce the transaction lock period from global preferences."""
    settings = load_policy(session)
    if settings.transaction_lock_days <= 0 or created_at is None:
        return
    age = datetime.now(UTC) - (
        created_at if created_at.tzinfo else created_at.replace(tzinfo=UTC)
    )
    if age.days >= settings.transaction_lock_days:
        raise DomainError(
            "transaction_locked",
            f"{entity} older than {settings.transaction_lock_days} days cannot be modified.",
        )


def _require_active_employee(session: Session, employee_id: UUID) -> EmployeeRow:
    """Raise when the employee is missing or soft-deleted."""
    emp = session.scalar(
        select(EmployeeRow).where(
            EmployeeRow.id == employee_id, EmployeeRow.deleted_at.is_(None)
        )
    )
    if emp is None:
        raise DomainError("not_found", "Active employee not found.")
    return emp


ALLOWED_ATTACHMENT_TYPES = {"application/pdf", "image/jpeg", "image/png"}


def _commit_employee_import(session: Session, payload: EmployeeImportCommit) -> dict[str, Any]:
    """Persist selected employee import rows after validation (insert or upsert)."""
    selected = [row for row in payload.rows if row.selected]
    if not selected:
        raise DomainError("no_rows_selected", "Select at least one valid row to import.")
    preview = _preview_employee_import(
        session,
        [row.model_dump() | {"_row": row.row} for row in selected],
    )
    if any(row["severity"] != "READY" for row in preview):
        raise DomainError("invalid_import_rows", "One or more selected rows failed validation.")
    action_by_row = {int(item["row"]): item.get("action") for item in preview}
    now = datetime.now(UTC)
    imported = 0
    updated = 0
    for row in selected:
        fields = row.model_dump(exclude={"row", "selected"})
        fields["company_id"] = str(fields["company_id"])
        action = action_by_row.get(row.row) or "INSERT"
        existing = session.scalar(
            select(EmployeeRow)
            .where(
                EmployeeRow.company_id == fields["company_id"],
                func.lower(EmployeeRow.code) == fields["code"].casefold(),
            )
            .order_by(
                case((EmployeeRow.deleted_at.is_(None), 0), else_=1),
                EmployeeRow.updated_at.desc(),
            )
        )
        if action == "UPDATE" or existing is not None:
            if existing is None:
                raise DomainError("invalid_import_rows", f"Employee {fields['code']} marked UPDATE but not found.")
            for key, value in fields.items():
                setattr(existing, key, value)
            existing.active = True
            existing.deleted_at = None
            existing.updated_at = now
            existing.version += 1
            updated += 1
        else:
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
    return {"imported": imported, "updated": updated, "committed": True}


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
        # Remove soft-deleted ghosts so import recreate does not hit unique conflicts.
        for stale in session.scalars(
            select(OpeningBalanceRow).where(
                OpeningBalanceRow.employee_id == row.employee_id,
                OpeningBalanceRow.balance_year == row.balance_year,
                OpeningBalanceRow.deleted_at.is_not(None),
            )
        ):
            session.delete(stale)
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
    all_defaults: list[tuple[str, Any]] = [
        *DEFAULT_PREFERENCES,
        *policy_default_rows(),
    ]
    seen: set[str] = set()
    for key, value in all_defaults:
        if key in seen:
            continue
        seen.add(key)
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
        DocumentRow,
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
    # Bulk deletes bypass ORM audit events, so record the erasure explicitly.
    session.add(
        AuditRow(
            occurred_at=datetime.now(UTC),
            actor_id=actor_context.get(),
            correlation_id=correlation_context.get(),
            ip_address=ip_context.get(),
            action="erase",
            entity_type="OperationalData",
            entity_id="all",
            changes={key: {"old": value, "new": 0} for key, value in counts.items()},
        )
    )
    return counts


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create the fully wired API application."""
    config = settings or get_settings()
    configure_logging(config)
    sessions = create_session_factory(config)
    engine = sessions.bind_engine
    web_root = Path(__file__).resolve().parents[1] / "interface" / "web_dist"
    _next_root = Path(__file__).resolve().parents[1] / "interface" / "web_dist_next"
    if (_next_root / "index.html").is_file():
        web_root = _next_root
    if config.environment == "test":
        Base.metadata.create_all(engine)
    else:
        ReportTemplateRow.__table__.create(bind=engine, checkfirst=True)
        AiAgentAuditRow.__table__.create(bind=engine, checkfirst=True)
        AiRepairLogRow.__table__.create(bind=engine, checkfirst=True)
    _ensure_employee_hcm_columns(engine)
    _ensure_document_hr_columns(engine)
    _ensure_company_profile_columns(engine)
    attachment_root = Path(config.attachment_root).resolve()
    attachment_root.mkdir(parents=True, exist_ok=True)
    preference_cache: dict[tuple[str, ...], tuple[float, dict[str, Any]]] = {}

    if inspect(engine).has_table("users"):
        with sessions.begin() as session:
            if session.get(CompanyRow, DEFAULT_COMPANY_ID) is None:
                session.add(
                    CompanyRow(
                        id=DEFAULT_COMPANY_ID,
                        code="DEFAULT",
                        name="Atlas Aluminum",
                        currency="BHD",
                    )
                )
            else:
                existing = session.get(CompanyRow, DEFAULT_COMPANY_ID)
                if existing is not None and existing.name.strip().lower() in {
                    "default company",
                    "default",
                }:
                    existing.name = "Atlas Aluminum"
                if existing is not None and (existing.currency or "").upper() != "BHD":
                    existing.currency = "BHD"
            # Application standard currency is Bahraini Dinar (BHD).
            for company in session.scalars(select(CompanyRow)).all():
                if (company.currency or "").upper() != "BHD":
                    company.currency = "BHD"
            try:
                from airfare_management.ai_agent.product_knowledge import (
                    ensure_product_knowledge_learned,
                )

                ensure_product_knowledge_learned(session, actor="system")
            except Exception:
                # Learning store may be unavailable during early boot; never block API.
                pass
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
        try:
            yield
        finally:
            LOGGER.info("api_shutdown", extra={"port": config.port})
            engine.dispose()

    app = FastAPI(
        title="HCM Airfare Management API",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if config.environment != "production" else None,
        redoc_url=None,
    )
    app.state.session_factory = sessions
    app.add_middleware(PrometheusMiddleware)
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

    database = build_database(sessions)
    authenticated = build_authenticated(config)
    authorized = build_authorized(authenticated)
    app.include_router(create_reports_router(database, authorized))
    from airfare_management.api.routers.entitlement import create_entitlement_router

    app.include_router(create_entitlement_router(database, authorized))

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

    web_assets = web_root / "assets"
    if web_assets.is_dir():
        app.mount("/assets", StaticFiles(directory=web_assets), name="web-assets")
    next_assets = web_root / "_next"
    if next_assets.is_dir():
        app.mount("/_next", StaticFiles(directory=next_assets), name="web-next-assets")

    def _spa_index() -> FileResponse:
        index = web_root / "index.html"
        if not index.is_file():
            raise HTTPException(503, "Web client is not built. Run `npm run build` in web/.")
        return FileResponse(index, headers={"Cache-Control": "no-store"})

    @app.get("/", response_class=FileResponse)
    @app.get("/app", response_class=FileResponse)
    def landing() -> FileResponse:
        """Serve the browser application shell."""
        return _spa_index()

    @app.get("/favicon.ico")
    def favicon() -> Response:
        """Avoid noisy 404s from browsers requesting a missing icon."""
        return Response(status_code=204)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": "1.0.0", "port": str(config.port)}

    @app.get("/metrics")
    def metrics(session: Annotated[Session, Depends(database)]) -> Response:
        update_operational_gauges(session)
        return metrics_response()

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

    @app.get("/v1/users")
    def list_users(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin"))],
    ) -> list[dict[str, Any]]:
        rows = session.scalars(
            select(UserRow)
            .where(UserRow.deleted_at.is_(None))
            .order_by(UserRow.username.asc())
        )
        return [
            _row(item, "id", "username", "display_name", "roles", "active", "employee_id")
            for item in rows
        ]

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

    @app.put("/v1/users/{user_id}")
    def update_user(
        user_id: str,
        payload: UserUpdate,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin"))],
    ) -> dict[str, Any]:
        item = session.get(UserRow, user_id)
        if item is None or item.deleted_at is not None:
            raise DomainError("not_found", "User not found.")
        data = payload.model_dump(exclude_unset=True)
        if "roles" in data and data["roles"] is not None:
            data["roles"] = sorted(data["roles"])
        if "password" in data:
            password = data.pop("password")
            if password:
                item.password_hash = hash_password(password)
        for key, value in data.items():
            setattr(item, key, value)
        session.flush()
        return _row(item, "id", "username", "display_name", "roles", "active", "employee_id")

    @app.delete("/v1/users/{user_id}", status_code=204)
    def delete_user(
        user_id: str,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin"))],
    ) -> Response:
        item = session.get(UserRow, user_id)
        if item is None or item.deleted_at is not None:
            raise DomainError("not_found", "User not found.")
        item.deleted_at = datetime.now(UTC)
        item.active = False
        session.execute(
            update(RefreshTokenRow)
            .where(
                RefreshTokenRow.user_id == item.id,
                RefreshTokenRow.revoked_at.is_(None),
            )
            .values(revoked_at=datetime.now(UTC))
        )
        session.flush()
        return Response(status_code=204)

    @app.get("/v1/auth/me")
    def me(claims: Annotated[Claims, Depends(authenticated)]) -> dict[str, Any]:
        return {"id": claims.subject, "username": claims.username, "roles": sorted(claims.roles)}

    @app.get("/v1/dashboard")
    def dashboard(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authenticated)],
    ) -> dict[str, Any]:
        return {
            "employees": session.scalar(
                select(func.count())
                .select_from(EmployeeRow)
                .where(EmployeeRow.deleted_at.is_(None))
            )
            or 0,
            "open_tickets": session.scalar(
                select(func.count())
                .select_from(TicketRow)
                .where(
                    TicketRow.status.in_(["draft", "submitted"]),
                    TicketRow.deleted_at.is_(None),
                )
            )
            or 0,
            "active_loans": session.scalar(
                select(func.count())
                .select_from(LoanRow)
                .where(LoanRow.status != "settled", LoanRow.deleted_at.is_(None))
            )
            or 0,
            "outstanding_loans": session.scalar(
                select(func.coalesce(func.sum(LoanRow.outstanding), 0)).where(
                    LoanRow.deleted_at.is_(None)
                )
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
        branding = Path(config.attachment_root).resolve() / "branding"
        rows = []
        for item in session.scalars(
            select(CompanyRow)
            .where(CompanyRow.deleted_at.is_(None))
            .order_by(CompanyRow.code)
        ):
            has_db_logo = bool(getattr(item, "logo_data", None))
            logo_file = next(
                (
                    branding / f"{item.id}{ext}"
                    for ext in (".png", ".jpg", ".jpeg", ".webp")
                    if (branding / f"{item.id}{ext}").exists()
                ),
                None,
            )
            has_logo = has_db_logo or logo_file is not None
            rows.append(
                {
                    **_row(item, "id", "code", "name", "currency", "active"),
                    "cr_no": getattr(item, "cr_no", None),
                    "address": getattr(item, "address", None),
                    "has_logo": has_logo,
                    "logo_url": f"/v1/companies/{item.id}/logo" if has_logo else None,
                }
            )
        return rows

    @app.patch("/v1/companies/{company_id}")
    def update_company(
        company_id: str,
        payload: CompanyUpdate,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin"))],
    ) -> dict[str, Any]:
        item = session.get(CompanyRow, company_id)
        if item is None or item.deleted_at is not None:
            raise DomainError("company_not_found", "Company was not found.")
        if payload.name is not None:
            item.name = payload.name.strip()
        if payload.currency is not None:
            item.currency = payload.currency.upper()
        if payload.cr_no is not None:
            item.cr_no = payload.cr_no.strip() or None
        if payload.address is not None:
            item.address = payload.address.strip() or None
        if payload.active is not None:
            item.active = payload.active
        item.version += 1
        session.flush()
        branding = Path(config.attachment_root).resolve() / "branding"
        has_db_logo = bool(getattr(item, "logo_data", None))
        logo_file = next(
            (branding / f"{item.id}{ext}" for ext in (".png", ".jpg", ".jpeg", ".webp")
             if (branding / f"{item.id}{ext}").exists()),
            None,
        )
        has_logo = has_db_logo or logo_file is not None
        return {
            **_row(item, "id", "code", "name", "currency", "active"),
            "cr_no": getattr(item, "cr_no", None),
            "address": getattr(item, "address", None),
            "has_logo": has_logo,
            "logo_url": f"/v1/companies/{item.id}/logo" if has_logo else None,
        }

    @app.post("/v1/companies/{company_id}/logo")
    async def upload_company_logo(
        company_id: str,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin"))],
        file: Annotated[UploadFile, File()],
    ) -> dict[str, Any]:
        item = session.get(CompanyRow, company_id)
        if item is None or item.deleted_at is not None:
            raise DomainError("company_not_found", "Company was not found.")
        content_type = (file.content_type or "").lower()
        allowed = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/webp": ".webp",
        }
        if content_type not in allowed:
            raise DomainError("invalid_logo_type", "Upload a PNG, JPG, or WebP company logo.")
        payload = await file.read()
        if not payload:
            raise DomainError("empty_logo", "Logo file is empty.")
        if len(payload) > 2_000_000:
            raise DomainError("logo_too_large", "Logo must be 2 MB or smaller.")
        # Persist in MSSQL (source of truth) and mirror to disk for PDF rendering.
        item.logo_data = payload
        item.logo_content_type = content_type if content_type != "image/jpg" else "image/jpeg"
        item.version += 1
        branding = Path(config.attachment_root).resolve() / "branding"
        branding.mkdir(parents=True, exist_ok=True)
        for stale in branding.glob(f"{company_id}.*"):
            stale.unlink(missing_ok=True)
        destination = branding / f"{company_id}{allowed[content_type]}"
        destination.write_bytes(payload)
        session.flush()
        return {
            "id": company_id,
            "has_logo": True,
            "logo_url": f"/v1/companies/{company_id}/logo",
            "bytes": len(payload),
            "stored_in": "mssql",
        }

    @app.get("/v1/companies/{company_id}/logo")
    def company_logo(
        company_id: str,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authenticated)],
    ) -> Response:
        item = session.get(CompanyRow, company_id)
        if item is None or item.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Company not found")
        if getattr(item, "logo_data", None):
            media = getattr(item, "logo_content_type", None) or "image/png"
            return Response(content=bytes(item.logo_data), media_type=media)
        branding = Path(config.attachment_root).resolve() / "branding"
        for ext, media in (
            (".png", "image/png"),
            (".jpg", "image/jpeg"),
            (".jpeg", "image/jpeg"),
            (".webp", "image/webp"),
        ):
            candidate = branding / f"{company_id}{ext}"
            if candidate.exists():
                # Backfill disk logos into MSSQL so everything lives in the database.
                data = candidate.read_bytes()
                item.logo_data = data
                item.logo_content_type = media
                session.flush()
                return Response(content=data, media_type=media)
        raise HTTPException(status_code=404, detail="Company logo not uploaded")

    @app.delete("/v1/companies/{company_id}/logo", status_code=204)
    def delete_company_logo(
        company_id: str,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin"))],
    ) -> Response:
        item = session.get(CompanyRow, company_id)
        if item is None or item.deleted_at is not None:
            raise DomainError("company_not_found", "Company was not found.")
        item.logo_data = None
        item.logo_content_type = None
        item.version += 1
        branding = Path(config.attachment_root).resolve() / "branding"
        for stale in branding.glob(f"{company_id}.*"):
            stale.unlink(missing_ok=True)
        session.flush()
        return Response(status_code=204)

    @app.post("/v1/companies", status_code=201)
    def create_company(
        payload: CompanyCreate,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin"))],
    ) -> dict[str, Any]:
        item = CompanyRow(**payload.model_dump())
        if not item.currency:
            item.currency = "BHD"
        else:
            item.currency = item.currency.upper()
        session.add(item)
        session.flush()
        return {
            **_row(item, "id", "code", "name", "currency", "active"),
            "cr_no": getattr(item, "cr_no", None),
            "address": getattr(item, "address", None),
            "has_logo": False,
            "logo_url": None,
        }

    @app.delete("/v1/companies/{company_id}", status_code=204)
    def delete_company(
        company_id: str,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin"))],
    ) -> Response:
        """Soft-delete a company in MSSQL. Blocked when employees still reference it."""
        item = session.get(CompanyRow, company_id)
        if item is None or item.deleted_at is not None:
            raise DomainError("company_not_found", "Company was not found.")
        live_count = session.scalar(
            select(func.count())
            .select_from(CompanyRow)
            .where(CompanyRow.deleted_at.is_(None))
        ) or 0
        if live_count <= 1:
            raise DomainError(
                "company_last_remaining",
                "Cannot delete the last company. Create another company first.",
            )
        employee_count = session.scalar(
            select(func.count())
            .select_from(EmployeeRow)
            .where(
                EmployeeRow.company_id == company_id,
                EmployeeRow.deleted_at.is_(None),
            )
        ) or 0
        if employee_count:
            raise DomainError(
                "company_in_use",
                f"Cannot delete: {employee_count} active employee(s) still use this company. "
                "Reassign or deactivate those employees first.",
            )
        now = datetime.now(UTC)
        # Free unique business code so a future company can reuse it (soft-delete tombstone pattern).
        stamp = now.strftime("%Y%m%d%H%M%S")
        freed = f"{item.code}__DEL_{stamp}"
        item.code = freed[:30]
        item.active = False
        item.deleted_at = now
        item.version += 1
        # Keep logo_data in MSSQL for audit/restore; clear PDF disk cache.
        branding = Path(config.attachment_root).resolve() / "branding"
        for stale in branding.glob(f"{company_id}.*"):
            stale.unlink(missing_ok=True)
        session.flush()
        return Response(status_code=204)

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
                | EmployeeRow.passport_no.ilike(term)
                | EmployeeRow.designation.ilike(term)
                | EmployeeRow.department.ilike(term)
                | EmployeeRow.nationality.ilike(term)
                | EmployeeRow.email.ilike(term)
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
                **_row(item, *EMPLOYEE_API_FIELDS),
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
        if fields.get("reporting_officer_id") is not None:
            fields["reporting_officer_id"] = str(fields["reporting_officer_id"])
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
            if key == "reporting_officer_id" and value is not None:
                value = str(value)
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
        now = item.deleted_at
        for model in (TicketRow, LoanRow, OpeningBalanceRow, EssRequestRow):
            session.execute(
                update(model).where(
                    model.employee_id == item.id,
                    model.deleted_at.is_(None),
                ).values(deleted_at=now, version=model.version + 1)
            )
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

    @app.get("/v1/opening-balances/export.xlsx")
    def export_opening_balances(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authenticated)],
        balance_year: Annotated[int | None, Query(ge=2000, le=2200)] = None,
    ) -> Response:
        query = (
            select(OpeningBalanceRow, EmployeeRow)
            .join(EmployeeRow, EmployeeRow.id == OpeningBalanceRow.employee_id)
            .where(
                OpeningBalanceRow.deleted_at.is_(None),
                EmployeeRow.deleted_at.is_(None),
            )
        )
        if balance_year is not None:
            query = query.where(OpeningBalanceRow.balance_year == balance_year)
        columns = (
            "employee_code",
            "balance_year",
            "opening_days",
            "paid_days",
            "opening_amount",
            "maximum_payout",
        )
        records = [
            {
                "employee_code": employee.code,
                "balance_year": balance.balance_year,
                "opening_days": balance.opening_days,
                "paid_days": balance.paid_days,
                "opening_amount": balance.opening_amount,
                "maximum_payout": balance.maximum_payout,
            }
            for balance, employee in session.execute(
                query.order_by(OpeningBalanceRow.balance_year.desc(), EmployeeRow.code)
            )
        ]
        return Response(
            export_workbook("Opening Balances", columns, records),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="opening-balances.xlsx"'},
        )

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
        _require_active_employee(session, payload.employee_id)
        # Purge soft-deleted legacy rows for the same natural key so recreate works
        # (soft-delete + unique conflict pattern — Odoo/SQLAlchemy discussions).
        for stale in session.scalars(
            select(OpeningBalanceRow).where(
                OpeningBalanceRow.employee_id == payload.employee_id,
                OpeningBalanceRow.balance_year == payload.balance_year,
                OpeningBalanceRow.deleted_at.is_not(None),
            )
        ):
            session.delete(stale)
        live = session.scalar(
            select(OpeningBalanceRow).where(
                OpeningBalanceRow.employee_id == payload.employee_id,
                OpeningBalanceRow.balance_year == payload.balance_year,
                OpeningBalanceRow.deleted_at.is_(None),
            )
        )
        if live is not None:
            raise DomainError(
                "duplicate_opening_balance",
                "An opening balance already exists for this employee and year. Edit or delete it first.",
            )
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
        _assert_unlocked(session, item.created_at, "Opening balances")
        # Permanent delete so the employee+year key can be reused (user-requested;
        # soft-delete left ghost rows that tripped unique / IntegrityError conflicts).
        session.delete(item)
        session.flush()
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
        ytd_spending = Decimal("0")
        ytd_paid_days = Decimal("0")
        spending_for_calc = Decimal("0")
        policy_resolved = False
        # Load cycle policy first so ticket/opening windows match continuous vs calendar.
        settings = load_policy(session)
        alloc_policy = to_allocation_policy(settings)
        if employee_id is not None:
            employee = session.scalar(
                select(EmployeeRow).where(
                    EmployeeRow.id == employee_id, EmployeeRow.deleted_at.is_(None)
                )
            )
            if employee is None:
                raise DomainError("not_found", "Employee not found.")
            joining = joining or employee.join_date
            if joining is None:
                raise DomainError("join_date_required", "Date of joining is required.")
            # Modern continuous (HCM industry): hire-date anniversary window.
            # Calendar: classic ATLAS Jan 1–Dec 31 fiscal pot.
            if alloc_policy.cycle_reset_basis == "joining_date":
                cycle_start = _anniversary_window(joining, as_of_date)
            else:
                cycle_start = date(as_of_date.year, 1, 1)
            cycle_end = as_of_date
            if last_ticket is None:
                last_ticket = session.scalar(
                    select(func.max(TicketRow.travel_date)).where(
                        TicketRow.employee_id == employee_id,
                        TicketRow.deleted_at.is_(None),
                        TicketRow.status.in_(("approved", "paid")),
                        TicketRow.travel_date >= cycle_start,
                        TicketRow.travel_date <= cycle_end,
                        TicketRow.entitlement > 0,
                    )
                )
            current_year_spending = session.scalar(
                select(func.coalesce(func.sum(TicketRow.entitlement), 0)).where(
                    TicketRow.employee_id == employee_id,
                    TicketRow.deleted_at.is_(None),
                    TicketRow.status.in_(("approved", "paid")),
                    TicketRow.travel_date >= cycle_start,
                    TicketRow.travel_date <= cycle_end,
                    TicketRow.excess_handling != "employee_full",
                )
            ) or Decimal("0")
            post_ticket_spending = Decimal("0")
            if last_ticket is not None:
                post_ticket_spending = session.scalar(
                    select(func.coalesce(func.sum(TicketRow.entitlement), 0)).where(
                        TicketRow.employee_id == employee_id,
                        TicketRow.deleted_at.is_(None),
                        TicketRow.status.in_(("approved", "paid")),
                        TicketRow.travel_date > last_ticket,
                        TicketRow.travel_date <= cycle_end,
                        TicketRow.excess_handling != "employee_full",
                    )
                ) or Decimal("0")
            # Opening for this cycle: prefer cycle-start year, else as-of calendar year.
            balance = session.scalar(
                select(OpeningBalanceRow).where(
                    OpeningBalanceRow.employee_id == employee_id,
                    OpeningBalanceRow.balance_year == cycle_start.year,
                    OpeningBalanceRow.deleted_at.is_(None),
                )
            )
            if balance is None and cycle_start.year != as_of_date.year:
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
            ytd_spending = Decimal(str(current_year_spending))
            ytd_paid_days = paid_days
            spending_for_calc = (
                Decimal(str(post_ticket_spending))
                if last_ticket is not None
                else ytd_spending
            )
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
            current_year_spending=spending_for_calc,
            ytd_paid_days=ytd_paid_days,
            ytd_spending=ytd_spending,
            policy=alloc_policy,
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
        body = _allocation_response(
            preview,
            date_of_joining=query.date_of_joining,
            employee=employee,
            username=username,
        )
        settings = load_policy(session)
        body["policy"] = {
            "negative_balance_allowed": settings.negative_balance_allowed,
            "partial_claim_allowed": settings.partial_claim_allowed,
            "advance_booking_allowed": settings.advance_booking_allowed,
            "loan_recovery_method": settings.loan_recovery_method,
            "loan_recovery_priority": settings.loan_recovery_priority,
            "loan_interest_rate": str(settings.loan_interest_rate),
            "dependent_coverage": settings.dependent_coverage,
            "static_conversion_rate": str(settings.static_conversion_rate),
        }
        if (
            employee_id is not None
            and settings.loan_recovery_method == "auto_deduct"
            and settings.loan_recovery_priority == "before_accrual"
        ):
            outstanding = session.scalar(
                select(func.coalesce(func.sum(LoanRow.outstanding), 0)).where(
                    LoanRow.employee_id == employee_id,
                    LoanRow.deleted_at.is_(None),
                    LoanRow.status == "active",
                )
            ) or Decimal("0")
            outstanding = Decimal(str(outstanding))
            if outstanding > 0:
                gross = Decimal(str(body.get("final_entitlement_amount") or 0))
                net = max(Decimal("0"), quantize_money(gross - outstanding))
                body["loan_offset"] = _decimal_text(outstanding)
                body["final_entitlement_amount"] = _decimal_text(net)
                body["entitlement_amount"] = _decimal_text(net)
                body["airfare_entitlement_amount"] = _decimal_text(net)
                body["policy_notes"] = [
                    *body.get("policy_notes", []),
                    f"Auto-deduct: {outstanding} outstanding loan netted from entitlement",
                ]
        return body

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
        policy = load_policy(session)
        if settlement is None:
            excess = max(
                Decimal("0"),
                payload.requested_ticket_amount - entitlement.final_entitlement_amount,
            )
            if excess > 0:
                raise DomainError(
                    "settlement_required",
                    "Ticket amount exceeds entitlement. Choose Self paid by employee, "
                    "Fully company paid, Make loan, or Entitlement amount.",
                )
            settlement = settle_excess_ticket(
                payload.requested_ticket_amount,
                entitlement.final_entitlement_amount,
                ExcessSettlementOption.SELF_PAID,
            )
        if (
            settlement.option is ExcessSettlementOption.ENTITLEMENT_AMOUNT
            and entitlement.final_entitlement_amount <= 0
        ):
            raise DomainError(
                "entitlement_amount_unavailable",
                "Entitlement amount is unavailable because this employee has no "
                "positive entitlement balance. Choose Self paid, Fully company paid, "
                "or Make loan.",
            )
        excess_cost = max(
            Decimal("0"),
            payload.requested_ticket_amount - entitlement.final_entitlement_amount,
        )
        if excess_cost > 0 and not policy.negative_balance_allowed:
            if is_loan_settlement(settlement.option):
                raise DomainError(
                    "negative_balance_forbidden",
                    "Negative balances are disabled. Reduce the ticket amount or choose "
                    "a settlement that does not create a loan.",
                )
        if (
            not policy.partial_claim_allowed
            and settlement.option
            in {
                ExcessSettlementOption.SELF_PAID,
                ExcessSettlementOption.ENTITLEMENT_AMOUNT,
            }
            and excess_cost > 0
        ):
            raise DomainError(
                "partial_claim_forbidden",
                "Partial claims are disabled. Cover the full ticket with entitlement, "
                "a loan, or company-paid settlement.",
            )
        if not policy.advance_booking_allowed and payload.as_of_date > date.today():
            raise DomainError(
                "advance_booking_forbidden",
                "Advance booking is disabled. Travel date cannot be in the future.",
            )
        if (
            policy.loan_recovery_method == "auto_deduct"
            and policy.loan_recovery_priority == "after_accrual"
            and _employee_has_open_loan(session, payload.employee_id)
        ):
            raise DomainError(
                "loan_blocks_claim",
                "An outstanding loan must be cleared before new claims "
                "(recovery priority: after accrual).",
            )
        issued_ticket_cost = (
            entitlement.final_entitlement_amount
            if settlement.option is ExcessSettlementOption.ENTITLEMENT_AMOUNT
            else payload.requested_ticket_amount
        )
        ticket = TicketRow(
            employee_id=payload.employee_id,
            travel_date=payload.as_of_date,
            origin_code=payload.origin_code.upper(),
            destination_code=payload.destination_code.upper(),
            ticket_cost=issued_ticket_cost,
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
            is_loan_settlement(settlement.option)
            and settlement.loan_principal is not None
            and settlement.emi is not None
            and settlement.tenure_months is not None
        ):
            due = _first_of_next_month(payload.as_of_date)
            loan = LoanRow(
                employee_id=payload.employee_id,
                source_ticket_id=ticket.id,
                principal=settlement.loan_principal,
                annual_rate=policy.loan_interest_rate,
                installments=settlement.tenure_months,
                monthly_installment=quantize_money(
                    calculate_emi(
                        settlement.loan_principal,
                        policy.loan_interest_rate,
                        settlement.tenure_months,
                    )
                ),
                outstanding=settlement.loan_principal,
                status="active",
                first_due_date=due,
            )
            session.add(loan)
            session.flush()
            LoanRepository(session).replace_schedule(
                loan.id,
                build_amortization_schedule(
                    settlement.loan_principal,
                    policy.loan_interest_rate,
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

    @app.post("/v1/allocations/print")
    @app.post("/v1/allocations/print.pdf")
    def allocation_print_pdf(
        payload: AllocationPrintRequest,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authorized("admin", "hr", "manager", "finance"))],
    ) -> Response:
        """Generate a professional A4 airfare allocation print PDF from MSSQL."""
        ticket: TicketRow | None = None
        linked_loan: LoanRow | None = None
        employee_id = payload.employee_id
        as_of_date = payload.as_of_date
        requested_ticket_amount = payload.requested_ticket_amount
        excess_option = payload.excess_option
        tenure_months = payload.tenure_months
        origin_code = payload.origin_code.upper()
        destination_code = payload.destination_code.upper()
        notes = payload.notes
        ticket_code = payload.ticket_code
        status = payload.status

        if payload.ticket_id is not None:
            ticket = session.scalar(
                select(TicketRow).where(
                    TicketRow.id == str(payload.ticket_id),
                    TicketRow.deleted_at.is_(None),
                )
            )
            if ticket is None:
                raise HTTPException(status_code=404, detail="Ticket not found")
            linked_loan = _active_source_loan(session, ticket.id)
            employee_id = ticket.employee_id
            as_of_date = ticket.as_of_date or ticket.travel_date
            requested_ticket_amount = ticket.ticket_cost
            handling = (ticket.excess_handling or "SELF_PAID").upper()
            if handling == "LOAN":
                handling = "CONVERT_TO_LOAN"
            excess_option = handling  # type: ignore[assignment]
            tenure_months = ticket.tenure_months or tenure_months
            origin_code = ticket.origin_code.upper()
            destination_code = ticket.destination_code.upper()
            notes = ticket.notes or notes
            ticket_code = ticket.ticket_code or ticket_code
            status = (ticket.status or status or "APPROVED").upper()

        query = _allocation_query(
            session,
            employee_id=employee_id,
            as_of_date=as_of_date,
            date_of_joining=payload.date_of_joining,
            last_ticket_date=payload.last_ticket_date,
            opening_balance_days=payload.opening_balance_days,
            opening_balance_amount=payload.opening_balance_amount,
            employee_custom_rate=payload.employee_custom_rate,
            pay_group_rate=payload.pay_group_rate,
            global_company_preference_rate=payload.global_company_preference_rate,
            global_company_preference_days=payload.global_company_preference_days,
            max_entitlement_cap_rate=payload.max_entitlement_cap_rate,
            requested_ticket_amount=requested_ticket_amount,
            excess_option=excess_option,
            tenure_months=tenure_months,
        )
        body = _decorate_allocation(
            session, AllocationQueryHandler().handle(query), query, employee_id
        )
        company_name = "Atlas Aluminum"
        company_id: str | None = None
        reporting_officer = ""
        employee = None
        if employee_id is not None:
            employee = session.scalar(
                select(EmployeeRow).where(
                    EmployeeRow.id == employee_id,
                    EmployeeRow.deleted_at.is_(None),
                )
            )
        company: CompanyRow | None = None
        if employee is not None:
            company = session.scalar(
                select(CompanyRow).where(CompanyRow.id == employee.company_id)
            )
            if employee.reporting_officer_id:
                officer_key = str(employee.reporting_officer_id)
                officer = None
                try:
                    officer = session.scalar(
                        select(EmployeeRow).where(
                            EmployeeRow.id == UUID(officer_key),
                            EmployeeRow.deleted_at.is_(None),
                        )
                    )
                except (ValueError, TypeError):
                    officer = None
                if officer is None:
                    officer = session.scalar(
                        select(EmployeeRow).where(
                            EmployeeRow.code == officer_key,
                            EmployeeRow.deleted_at.is_(None),
                        )
                    )
                if officer is not None:
                    reporting_officer = officer.full_name
                else:
                    reporting_officer = officer_key
        if company is None:
            company = session.scalar(
                select(CompanyRow)
                .where(CompanyRow.deleted_at.is_(None), CompanyRow.active == true())
                .order_by(CompanyRow.code)
            )
        if company is not None:
            company_id = company.id
            company_name = company.name or company_name
        body.update(
            {
                "as_of_date": as_of_date.isoformat() if as_of_date else payload.as_of_date.isoformat(),
                "origin_code": origin_code,
                "destination_code": destination_code,
                "notes": notes,
                "ticket_code": ticket_code or body.get("ticket_code"),
                "status": status or body.get("status") or "APPROVED",
                "reporting_officer": reporting_officer or body.get("reporting_officer"),
                "prepared_by": claims.username,
            }
        )
        if employee is not None:
            body.setdefault("employee_code", employee.code)
            body.setdefault("employee_name", employee.full_name)
            body.setdefault("arabic_name", getattr(employee, "arabic_name", None) or "")
            body.setdefault("nationality", employee.nationality)
            body.setdefault("department", employee.department)
            body.setdefault("designation", employee.designation)
            body.setdefault("pay_group", employee.pay_group)
            body.setdefault("branch", employee.branch)
            body.setdefault("join_date", employee.join_date.isoformat() if employee.join_date else None)
        if ticket is not None:
            # Saved ticket settlement is the source of truth (MSSQL), not a re-preview.
            body.update(
                {
                    "ticket_id": ticket.id,
                    **_ticket_display(ticket),
                    **_loan_display(linked_loan),
                    "travel_date": ticket.travel_date.isoformat(),
                    "ticket_cost": _decimal_text(ticket.ticket_cost),
                    "requested_ticket_amount": _decimal_text(ticket.ticket_cost),
                    "entitlement_amount": _decimal_text(ticket.entitlement),
                    "final_entitlement_amount": _decimal_text(ticket.entitlement),
                    "airfare_entitlement_amount": _decimal_text(ticket.entitlement),
                    "company_paid": _decimal_text(ticket.company_paid),
                    "company_payout": _decimal_text(ticket.company_payout or ticket.company_paid),
                    "employee_payable": _decimal_text(ticket.employee_payable),
                    "excess_cost": _decimal_text(ticket.excess_cost),
                    "excess_option": ticket.excess_handling,
                    "excess_handling": ticket.excess_handling,
                    "rate_source": ticket.rate_source,
                    "daily_rate": _decimal_text(ticket.daily_rate) if ticket.daily_rate is not None else None,
                    "per_day_rate": _decimal_text(ticket.daily_rate) if ticket.daily_rate is not None else None,
                    "airfare_rate": _decimal_text(ticket.airfare_rate) if ticket.airfare_rate is not None else None,
                    "maximum_payout": _decimal_text(ticket.airfare_rate) if ticket.airfare_rate is not None else None,
                    "tenure_months": ticket.tenure_months,
                    "scenario": ticket.scenario,
                    "status": (ticket.status or "APPROVED").upper(),
                    "notes": ticket.notes or notes,
                }
            )
        if company_id is None:
            raise HTTPException(status_code=400, detail="No company found for allocation print")
        branding_root = Path(config.attachment_root).resolve() / "branding"
        pdf = render_allocation_print_pdf(
            session,
            branding_root=branding_root,
            company_id=company_id,
            data=body,
            prepared_by=claims.username,
        )
        code = body.get("employee_code") or "allocation"
        filename = f"airfare-allocation-{code}.pdf"
        return Response(
            content=pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

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

    @app.put("/v1/entitlement-rates/{rate_id}")
    def update_entitlement_rate(
        rate_id: UUID,
        payload: RateUpdate,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> dict[str, Any]:
        item = session.get(EntitlementRateRow, str(rate_id))
        if item is None or item.deleted_at is not None:
            raise DomainError("not_found", "Entitlement rate not found.")
        if item.version != if_match:
            raise DomainError("stale_version", "The rate was modified by another user.")
        if payload.effective_to is not None and payload.effective_to < payload.effective_from:
            raise DomainError("invalid_date_range", "Effective-to cannot precede effective-from.")
        item.amount = payload.amount
        item.effective_from = payload.effective_from
        item.effective_to = payload.effective_to
        item.cap_amount = payload.cap_amount
        item.version += 1
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
        items = list(
            session.scalars(query.order_by(ordering, TicketRow.id).limit(limit).offset(offset))
        )
        loan_by_ticket = {
            loan.source_ticket_id: loan
            for loan in session.scalars(
                select(LoanRow).where(
                    LoanRow.deleted_at.is_(None),
                    LoanRow.source_ticket_id.in_([item.id for item in items] or ["__none__"]),
                )
            )
            if loan.source_ticket_id
        }
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
                    **_loan_display(loan_by_ticket.get(item.id)),
                    "tenure_months": item.tenure_months,
                    "excess_cost": item.excess_cost,
                    "excess_amount": item.excess_amount,
                    "format": conditional_format(status=item.status, amount=item.excess_amount),
                }
                for item in items
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
        _require_active_employee(session, payload.employee_id)
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

    @app.put("/v1/tickets/{ticket_id}")
    def update_ticket(
        ticket_id: UUID,
        payload: TicketUpdate,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "manager"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> dict[str, Any]:
        item = session.get(TicketRow, str(ticket_id))
        if item is None or item.deleted_at is not None:
            raise DomainError("not_found", "Ticket not found.")
        if item.version != if_match:
            raise DomainError("stale_version", "The ticket was modified by another user.")
        if payload.origin_code.upper() == payload.destination_code.upper():
            raise DomainError("invalid_route", "Origin and destination must differ.")

        handling = "CONVERT_TO_LOAN" if payload.excess_handling == "LOAN" else payload.excess_handling
        try:
            settlement = settle_excess_ticket(
                payload.ticket_cost,
                payload.entitlement,
                ExcessSettlementOption(handling),
                payload.tenure_months or item.tenure_months,
            )
        except ValidationError as exc:
            raise DomainError(getattr(exc, "code", "invalid_settlement"), str(exc)) from exc

        linked_loan = _active_source_loan(session, item.id)
        money_changed = (
            payload.ticket_cost != item.ticket_cost or payload.entitlement != item.entitlement
        )
        loan_aliases = {"LOAN", "CONVERT_TO_LOAN"}
        handling_same = payload.excess_handling == item.excess_handling or (
            payload.excess_handling in loan_aliases and item.excess_handling in loan_aliases
        )
        revise_recovery = _ticket_recovery_changed(
            linked_loan=linked_loan,
            settlement=settlement,
            money_changed=money_changed,
            handling_same=handling_same,
        )
        if revise_recovery and linked_loan is not None:
            if _loan_has_payments(session, linked_loan.id):
                raise DomainError(
                    "loan_has_payments",
                    "This ticket's recovery loan has posted payments. Reverse those "
                    "payments before changing amount, tenure, or excess handling.",
                )
            _soft_delete_loan(session, linked_loan)
            linked_loan = None

        item.travel_date = payload.travel_date
        item.origin_code = payload.origin_code.upper()
        item.destination_code = payload.destination_code.upper()
        item.ticket_cost = payload.ticket_cost
        item.entitlement = payload.entitlement
        item.company_paid = settlement.company_payout
        item.excess_handling = settlement.option.value
        item.excess_cost = settlement.excess_cost
        item.employee_payable = settlement.employee_payable
        item.company_payout = settlement.company_payout
        item.tenure_months = settlement.tenure_months
        item.notes = payload.notes
        item.version += 1

        loan = linked_loan
        loan_created = False
        if loan is None:
            policy = load_policy(session)
            loan = _create_loan_from_settlement(
                session, ticket=item, settlement=settlement, policy=policy
            )
            loan_created = loan is not None

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
                "notes",
                "version",
            ),
            **_ticket_display(item),
            **_loan_display(loan),
            "tenure_months": item.tenure_months,
            "excess_cost": item.excess_cost,
            "excess_amount": item.excess_amount,
            "loan_revised": bool(revise_recovery and loan_created),
            "loan_created": bool(loan_created and not revise_recovery),
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
        loan = _active_source_loan(session, item.id)
        if (
            payload.status in {"approved", "paid"}
            and item.excess_handling in {"CONVERT_TO_LOAN", "LOAN"}
            and loan is None
        ):
            tenure = item.tenure_months or 12
            try:
                settlement = settle_excess_ticket(
                    item.ticket_cost,
                    item.entitlement,
                    ExcessSettlementOption.CONVERT_TO_LOAN,
                    tenure,
                )
            except ValidationError as exc:
                raise DomainError(getattr(exc, "code", "invalid_settlement"), str(exc)) from exc
            policy = load_policy(session)
            loan = _create_loan_from_settlement(
                session, ticket=item, settlement=settlement, policy=policy
            )
            if settlement.tenure_months and item.tenure_months is None:
                item.tenure_months = settlement.tenure_months
            if settlement.excess_cost is not None:
                item.excess_cost = settlement.excess_cost
        return {
            **_row(item, "id", "status", "version"),
            **_loan_display(loan),
        }

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
        if item.version != if_match:
            raise DomainError("stale_version", "The ticket was modified by another user.")
        linked_loan = _active_source_loan(session, item.id)
        if linked_loan is not None:
            if _loan_has_payments(session, linked_loan.id):
                raise DomainError(
                    "loan_has_payments",
                    "This ticket's recovery loan has posted payments. Reverse those "
                    "payments before deleting the ticket.",
                )
            _soft_delete_loan(session, linked_loan)
        _assert_unlocked(session, item.created_at, "Tickets")
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
                loan.outstanding, loan.annual_rate, loan.installments, loan.first_due_date
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
        _require_active_employee(session, payload.employee_id)
        item = LoanRow(
            **payload.model_dump(), monthly_installment=monthly, outstanding=payload.principal
        )
        session.add(item)
        session.flush()
        LoanRepository(session).replace_schedule(
            item.id,
            build_amortization_schedule(
                item.principal, item.annual_rate, item.installments, item.first_due_date
            ),
        )
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
            item.outstanding, item.annual_rate, item.installments, item.first_due_date
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
        if item.status != "settled" and item.outstanding > 0:
            LoanRepository(session).replace_schedule(
                item.id,
                build_amortization_schedule(
                    item.outstanding, item.annual_rate, item.installments, item.first_due_date
                ),
            )
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
        if item.status != "active" or payload.deferred_until <= date.today():
            raise DomainError(
                "invalid_deferment", "Only active loans may be deferred to a future date."
            )
        item.deferred_until = payload.deferred_until
        item.status = "deferred"
        item.first_due_date = payload.deferred_until
        item.version += 1
        LoanRepository(session).replace_schedule(
            item.id,
            build_amortization_schedule(
                item.outstanding, item.annual_rate, item.installments, item.first_due_date
            ),
        )
        return _row(item, "id", "status", "deferred_until", "version")

    @app.post("/v1/loans/{loan_id}/return")
    def return_loan(
        loan_id: UUID,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "finance"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> dict[str, Any]:
        """Resume deferred recovery, or reopen a settled loan by reversing payments.

        Pattern (Frappe/ERPNext): cancel repayment entries, then reopen the loan
        schedule — do not silently mutate settled balances without an explicit return.
        """
        item = session.get(LoanRow, str(loan_id))
        if item is None or item.deleted_at is not None:
            raise DomainError("not_found", "Loan not found.")
        if item.version != if_match:
            raise DomainError("stale_version", "The loan was modified by another user.")
        if item.status not in {"deferred", "settled"}:
            raise DomainError(
                "invalid_return",
                "Only deferred or settled loans can be returned to active recovery.",
            )
        reversed_payments = 0
        if item.status == "settled":
            reversed_payments = _reverse_loan_payments(session, item.id)
            item.outstanding = quantize_money(item.principal)
            resume_from = date.today()
        else:
            resume_from = max(date.today(), item.deferred_until or date.today())
        item.status = "active"
        item.deferred_until = None
        item.first_due_date = resume_from
        item.monthly_installment = quantize_money(
            calculate_emi(item.outstanding, item.annual_rate, item.installments)
        )
        item.version += 1
        LoanRepository(session).replace_schedule(
            item.id,
            build_amortization_schedule(
                item.outstanding, item.annual_rate, item.installments, item.first_due_date
            ),
        )
        return {
            **_row(item, "id", "status", "deferred_until", "first_due_date", "outstanding", "version"),
            "reversed_payments": reversed_payments,
        }

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
        LoanRepository(session).replace_schedule(
            item.id,
            build_amortization_schedule(
                item.outstanding, item.annual_rate, item.installments, item.first_due_date
            ),
        )
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
        _assert_unlocked(session, item.created_at, "Loans")
        has_payments = session.scalar(
            select(func.count())
            .select_from(LoanPaymentRow)
            .where(
                LoanPaymentRow.loan_id == item.id,
                LoanPaymentRow.deleted_at.is_(None),
            )
        )
        if has_payments:
            raise DomainError("loan_has_payments", "A loan with payments cannot be deleted.")
        item.deleted_at = datetime.now(UTC)
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
                PreferenceRow.deleted_at.is_(None),
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
                    PreferenceRow.deleted_at.is_(None),
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

    @app.get("/v1/settings")
    def settings_catalog(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authenticated)],
    ) -> dict[str, Any]:
        """Return the enterprise settings catalog with current values."""
        return {"groups": catalog_with_values(session)}

    @app.put("/v1/settings")
    def settings_batch_update(
        payload: SettingsBatchUpdate,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin"))],
    ) -> dict[str, Any]:
        """Persist one or more global rule-engine settings."""
        updated: list[str] = []
        for key, raw in payload.settings.items():
            try:
                value = validate_setting(key, raw)
            except ValueError as exc:
                raise DomainError("invalid_setting", str(exc)) from exc
            item = session.scalar(
                select(PreferenceRow).where(
                    PreferenceRow.scope_type == "global",
                    PreferenceRow.scope_id == "",
                    PreferenceRow.preference_key == key,
                    PreferenceRow.deleted_at.is_(None),
                )
            )
            if item is None:
                session.add(
                    PreferenceRow(
                        scope_type="global",
                        scope_id="",
                        preference_key=key,
                        value=value if not isinstance(value, Decimal) else str(value),
                        is_locked=False,
                    )
                )
            else:
                item.value = value if not isinstance(value, Decimal) else str(value)
                item.version += 1
            updated.append(key)
        session.flush()
        preference_cache.clear()
        return {"updated": updated, "groups": catalog_with_values(session)}

    @app.post("/v1/attachments", status_code=201)
    async def upload_attachment(
        entity_type: str,
        entity_id: UUID,
        file: Annotated[UploadFile, File()],
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "manager", "finance"))],
    ) -> dict[str, Any]:
        mime = (file.content_type or "").split(";")[0].strip().lower()
        if mime not in ALLOWED_ATTACHMENT_TYPES:
            raise DomainError("invalid_content_type", "Unsupported attachment type.")
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
            content_type=mime[:100],
            size_bytes=len(content),
            sha256=digest,
            storage_key=storage_key,
            content=None,
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
        employee_id: Annotated[UUID | None, Query()] = None,
    ) -> dict[str, Any]:
        scope = scoped_employee_id(session, claims)
        target = scope or employee_id
        if target is None:
            return {
                "employee_id": None,
                "requests": 0,
                "open_requests": 0,
                "last_ticket_date": None,
                "active_loans": [],
                "opening_balance_amount": "0",
                "opening_balance_days": "0",
            }
        if scope is not None and employee_id is not None and employee_id != scope:
            raise DomainError("forbidden", "Employees may only view their own ESS dashboard.")
        base = (
            select(func.count())
            .select_from(EssRequestRow)
            .where(
                EssRequestRow.employee_id == target,
                EssRequestRow.deleted_at.is_(None),
            )
        )
        last_ticket = session.scalar(
            select(TicketRow.travel_date)
            .where(
                TicketRow.employee_id == target,
                TicketRow.deleted_at.is_(None),
                TicketRow.status.in_(["submitted", "approved", "paid"]),
            )
            .order_by(TicketRow.travel_date.desc())
            .limit(1)
        )
        loans = [
            {
                "id": str(loan.id),
                "loan_code": getattr(loan, "loan_number", None),
                "outstanding": str(loan.outstanding),
                "monthly_installment": str(loan.monthly_installment),
                "status": loan.status,
            }
            for loan in session.scalars(
                select(LoanRow).where(
                    LoanRow.employee_id == target,
                    LoanRow.deleted_at.is_(None),
                    LoanRow.status.in_(["active", "deferred"]),
                )
            )
        ]
        opening = session.scalar(
            select(OpeningBalanceRow)
            .where(
                OpeningBalanceRow.employee_id == target,
                OpeningBalanceRow.deleted_at.is_(None),
                OpeningBalanceRow.balance_year == date.today().year,
            )
            .limit(1)
        )
        return {
            "employee_id": str(target),
            "requests": session.scalar(base) or 0,
            "open_requests": session.scalar(
                base.where(EssRequestRow.status.in_(["submitted", "approved"]))
            )
            or 0,
            "last_ticket_date": last_ticket.isoformat() if last_ticket else None,
            "active_loans": loans,
            "opening_balance_amount": str(opening.opening_amount if opening else Decimal("0")),
            "opening_balance_days": str(opening.opening_days if opening else Decimal("0")),
        }

    @app.post("/v1/ai/expense-anomaly")
    def ai_expense_anomaly(
        payload: ExpenseAnomalyRequest,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "manager", "finance"))],
    ) -> dict[str, Any]:
        from airfare_management.ai_agent.travel_intelligence import detect_expense_anomaly

        peers_query = select(TicketRow.ticket_cost).where(TicketRow.deleted_at.is_(None))
        if payload.pay_group:
            peer_employees = select(EmployeeRow.id).where(
                EmployeeRow.pay_group == payload.pay_group,
                EmployeeRow.deleted_at.is_(None),
            )
            peers_query = peers_query.where(TicketRow.employee_id.in_(peer_employees))
        peers = list(session.scalars(peers_query.limit(500)))
        return detect_expense_anomaly(payload.claim_amount, peers).as_dict()

    @app.post("/v1/ai/emi-risk")
    def ai_emi_risk(
        payload: EmiRiskRequest,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "manager", "finance"))],
    ) -> dict[str, Any]:
        from airfare_management.ai_agent.travel_intelligence import score_emi_default_risk

        outstanding = Decimal("0")
        prior_defaults = 0
        entitlement = payload.entitlement
        if payload.employee_id is not None:
            outstanding = session.scalar(
                select(func.coalesce(func.sum(LoanRow.outstanding), 0)).where(
                    LoanRow.employee_id == payload.employee_id,
                    LoanRow.deleted_at.is_(None),
                    LoanRow.status.in_(["active", "deferred"]),
                )
            ) or Decimal("0")
            prior_defaults = int(
                session.scalar(
                    select(func.count())
                    .select_from(LoanRow)
                    .where(
                        LoanRow.employee_id == payload.employee_id,
                        LoanRow.deleted_at.is_(None),
                        LoanRow.status == "deferred",
                        LoanRow.deferred_until < date.today(),
                    )
                )
                or 0
            )
            employee = session.get(EmployeeRow, payload.employee_id)
            if employee is not None and entitlement is None:
                entitlement = employee.max_entitlement_cap_rate or employee.custom_airfare_rate
        return score_emi_default_risk(
            principal=payload.principal,
            tenure_months=payload.tenure_months,
            outstanding_loans=outstanding,
            prior_defaults=prior_defaults,
            entitlement=entitlement,
        ).as_dict()

    @app.post("/v1/ai/anomalies")
    def ai_anomalies(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "manager", "finance"))],
    ) -> dict[str, Any]:
        from airfare_management.ai_agent.anomaly_detector import score_ticket_anomalies

        rows = [
            {"ticket_cost": str(t.ticket_cost), "entitlement": str(t.entitlement), "employee_id": str(t.employee_id)}
            for t in session.scalars(select(TicketRow).where(TicketRow.deleted_at.is_(None)).limit(500))
        ]
        flagged = score_ticket_anomalies(rows)
        return {"count": len(flagged), "items": flagged}

    @app.post("/v1/ai/loans/{loan_id}/risk-score")
    def ai_loan_risk_score(
        loan_id: UUID,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "manager", "finance"))],
    ) -> dict[str, Any]:
        from airfare_management.ai_agent.risk_engine import loan_risk_score

        loan = session.get(LoanRow, str(loan_id))
        if loan is None or loan.deleted_at is not None:
            raise DomainError("not_found", "Loan not found.")
        outstanding = session.scalar(
            select(func.coalesce(func.sum(LoanRow.outstanding), 0)).where(
                LoanRow.employee_id == loan.employee_id,
                LoanRow.deleted_at.is_(None),
                LoanRow.status.in_(("active", "deferred")),
            )
        ) or Decimal("0")
        prior = int(
            session.scalar(
                select(func.count())
                .select_from(LoanRow)
                .where(
                    LoanRow.employee_id == loan.employee_id,
                    LoanRow.deleted_at.is_(None),
                    LoanRow.status == "deferred",
                    LoanRow.deferred_until < date.today(),
                )
            )
            or 0
        )
        return loan_risk_score(
            principal=loan.outstanding,
            tenure_months=loan.installments,
            outstanding_loans=outstanding,
            prior_defaults=prior,
        )

    @app.get("/v1/ai/forecasts/budget")
    def ai_budget_forecast(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
    ) -> dict[str, Any]:
        from airfare_management.ai_agent.forecaster import forecast_monthly_spend

        history = session.scalars(
            select(TicketRow.ticket_cost)
            .where(TicketRow.deleted_at.is_(None))
            .order_by(TicketRow.travel_date.desc())
            .limit(24)
        )
        return forecast_monthly_spend(list(history))

    @app.post("/v1/ai/ess-sentiment")
    def ai_ess_sentiment(
        payload: dict[str, str],
        _: Annotated[Claims, Depends(authenticated)],
    ) -> dict[str, Any]:
        from airfare_management.ai_agent.sentiment import analyze_sentiment

        return analyze_sentiment(str(payload.get("text") or ""))

    @app.get("/v1/ai/employees/{employee_id}/rate-recommendation")
    def ai_rate_recommendation(
        employee_id: UUID,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "manager", "finance"))],
    ) -> dict[str, Any]:
        from airfare_management.ai_agent.recommender import recommend_rate

        employee = _require_active_employee(session, employee_id)
        tenure_years = max(0, date.today().year - employee.join_date.year)
        costs = session.scalars(
            select(TicketRow.ticket_cost).where(
                TicketRow.employee_id == employee_id, TicketRow.deleted_at.is_(None)
            )
        )
        return recommend_rate(
            tenure_years=tenure_years,
            pay_group=employee.pay_group,
            repair_center=employee.repair_center,
            historical_ticket_costs=list(costs),
        )

    @app.get("/v1/ai/support/diagnose")
    def ai_support_diagnose(
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
    ) -> dict[str, Any]:
        from airfare_management.application import support

        return support.run_diagnostics(session, actor=claims.username)

    @app.post("/v1/ai/support/remediate")
    def ai_support_remediate(
        payload: dict[str, str],
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authorized("admin"))],
    ) -> dict[str, Any]:
        from airfare_management.application import support

        check_code = str(payload.get("check_code") or "").strip()
        if not check_code:
            raise HTTPException(status_code=422, detail="check_code is required")
        try:
            return support.apply_remediation(session, check_code, actor=claims.username)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post("/v1/ai/support/feedback")
    def ai_support_feedback(
        payload: dict[str, Any],
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
    ) -> dict[str, Any]:
        from airfare_management.application import support

        check_code = str(payload.get("check_code") or "").strip()
        if not check_code:
            raise HTTPException(status_code=422, detail="check_code is required")
        return support.record_feedback(
            session,
            check_code=check_code,
            worked=bool(payload.get("worked")),
            notes=str(payload.get("notes") or ""),
            actor=claims.username,
        )

    @app.get("/v1/ai/support/learning")
    def ai_support_learning(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
    ) -> dict[str, Any]:
        from airfare_management.application import support

        return support.learning_stats(session)

    @app.post("/v1/ai/support/train")
    def ai_support_train(
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authorized("admin"))],
    ) -> dict[str, Any]:
        """Re-seed product knowledge into ai_learning_events and return learning stats.

        Local-first training loop: upsert capability docs for BM25 recall, then
        report store size. Does not call cloud APIs.
        """
        from airfare_management.ai_agent.knowledge_brain import brain_stats
        from airfare_management.ai_agent.local_llm import llm_status
        from airfare_management.ai_agent.product_knowledge import (
            KNOWLEDGE_VERSION,
            ensure_product_knowledge_learned,
        )
        from airfare_management.application import support
        from airfare_management.config import get_settings

        touched = ensure_product_knowledge_learned(session, actor=claims.username)
        session.commit()
        settings = get_settings()
        return {
            "trained": True,
            "knowledge_version": KNOWLEDGE_VERSION,
            "product_knowledge_upserts": touched,
            "learning": support.learning_stats(session),
            "brain": brain_stats(session),
            "llm": llm_status(
                ollama_enabled=settings.ai_ollama_enabled,
                ollama_base_url=settings.ai_ollama_base_url,
                ollama_model=settings.ai_ollama_model,
                deepseek_api_key=settings.ai_deepseek_api_key or None,
                deepseek_base_url=settings.ai_deepseek_base_url,
                deepseek_model=settings.ai_deepseek_model,
                provider=settings.ai_llm_provider,
            ),
        }

    @app.get("/v1/ai/llm/status")
    def ai_llm_status(
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance", "auditor"))],
    ) -> dict[str, Any]:
        """LLM provider health: Ollama (free) vs optional DeepSeek API."""
        from airfare_management.ai_agent.local_llm import llm_status
        from airfare_management.config import get_settings

        settings = get_settings()
        return llm_status(
            ollama_enabled=settings.ai_ollama_enabled,
            ollama_base_url=settings.ai_ollama_base_url,
            ollama_model=settings.ai_ollama_model,
            deepseek_api_key=settings.ai_deepseek_api_key or None,
            deepseek_base_url=settings.ai_deepseek_base_url,
            deepseek_model=settings.ai_deepseek_model,
            provider=settings.ai_llm_provider,
        )

    @app.post("/v1/ai/agent/chat")
    def ai_agent_chat(
        payload: AgentChatRequest,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
    ) -> dict[str, Any]:
        from airfare_management.ai_agent.smart_agent import run_agent

        result = run_agent(
            session,
            message=payload.message,
            apply_fix=payload.apply_fix,
            auto_repair_mode=payload.auto_repair_mode,
            apply_token=payload.apply_token,
            confirm=payload.confirm,
            actor=claims.username,
        )
        return result.model_dump(mode="json")

    @app.post("/v1/ai/agent/repair/apply")
    def ai_agent_repair_apply(
        payload: AgentRepairApplyRequest,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authorized("admin"))],
    ) -> dict[str, Any]:
        from airfare_management.ai_agent.smart_agent import apply_repair_token

        if not payload.auto_repair_mode:
            raise DomainError("auto_repair_off", "Auto-Repair Mode must be enabled.")
        try:
            return apply_repair_token(
                session,
                apply_token=payload.apply_token,
                confirm=payload.confirm,
                actor=claims.username,
            )
        except ValueError as exc:
            raise DomainError("repair_rejected", str(exc)) from exc

    @app.get("/v1/ai/agent/schema")
    def ai_agent_schema(
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance", "auditor"))],
    ) -> dict[str, Any]:
        from airfare_management.ai_agent.schema_dictionary import as_public_dict

        return as_public_dict()

    @app.post("/v1/ai/saa/baseline")
    def ai_saa_baseline(
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
    ) -> dict[str, Any]:
        """Smart AI Agent OODA baseline: Focus catalog, DMVs, DQ flags, action queue."""
        from airfare_management.ai_agent.smart_system_agent import run_baseline

        return run_baseline(session, actor=claims.username).model_dump(mode="json")

    @app.post("/v1/ai/saa/silent-fixes")
    def ai_saa_silent_fixes(
        payload: SaaSilentFixRequest,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authorized("admin"))],
    ) -> dict[str, Any]:
        """Apply zero-risk whitelist only (e.g. UPDATE STATISTICS)."""
        from airfare_management.ai_agent.smart_system_agent import apply_silent_fixes

        if payload.confirm != "SILENT_APPLY":
            raise DomainError("saa_confirm_required", "confirm must be SILENT_APPLY")
        return apply_silent_fixes(session, codes=payload.codes, actor=claims.username)

    @app.get("/v1/report-templates")
    def list_report_templates(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance", "auditor"))],
    ) -> list[dict[str, Any]]:
        from airfare_management.application import report_templates as rt

        return rt.list_templates(session)

    @app.post("/v1/report-templates", status_code=201)
    def create_report_template(
        payload: ReportTemplateCreate,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
    ) -> dict[str, Any]:
        from airfare_management.application import report_templates as rt

        definition = payload.definition or {
            "title": payload.title,
            "dataset": payload.dataset,
            "bands": {"header": {"title": payload.title}, "detail": {"columns": []}, "footer": {}},
            "parameters": {},
            "filters": {},
            "group_by": [],
        }
        item = rt.create_template(
            session,
            code=payload.code,
            title=payload.title,
            dataset=payload.dataset,
            definition=definition,
            actor=claims.username,
        )
        return {
            "id": item.id,
            "code": item.code,
            "title": item.title,
            "dataset": item.dataset,
            "definition": item.definition,
            "is_system": item.is_system,
            "version": item.version,
        }

    @app.put("/v1/report-templates/{template_id}")
    def update_report_template(
        template_id: UUID,
        payload: ReportTemplateUpdate,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> dict[str, Any]:
        from airfare_management.application import report_templates as rt

        item = rt.get_template(session, str(template_id))
        if item is None:
            raise DomainError("not_found", "Report template not found.")
        try:
            item = rt.update_template(
                session,
                item,
                title=payload.title,
                definition=payload.definition,
                version=if_match,
                actor=claims.username,
            )
        except ValueError as exc:
            if str(exc) == "stale_version":
                raise DomainError("stale_version", "The template was modified by another user.") from exc
            raise
        return {
            "id": item.id,
            "code": item.code,
            "title": item.title,
            "dataset": item.dataset,
            "definition": item.definition,
            "is_system": item.is_system,
            "version": item.version,
        }

    @app.get("/v1/report-templates/{template_id}/run")
    @app.post("/v1/report-templates/{template_id}/run")
    def run_report_template(
        template_id: UUID,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance", "auditor"))],
        format: Annotated[Literal["json", "xlsx", "pdf"], Query()] = "json",
    ) -> Any:
        from airfare_management.application import report_templates as rt

        item = rt.get_template(session, str(template_id))
        if item is None:
            raise DomainError("not_found", "Report template not found.")
        columns, rows, meta = rt.run_template(session, item)
        if format == "json":
            return {
                **meta,
                "columns": columns,
                "rows": [list(row) for row in rows],
                "count": len(rows),
            }
        if format == "xlsx":
            records = [dict(zip(columns, row, strict=True)) for row in rows]
            workbook = export_workbook(item.title, columns, records)
            return Response(
                workbook,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f'attachment; filename="{item.code}.xlsx"'},
            )
        pdf = build_pdf_report(item.title, columns, rows)
        return Response(
            pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{item.code}.pdf"'},
        )

    @app.get("/v1/crystal/status")
    def crystal_status(
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance", "auditor"))],
    ) -> dict[str, Any]:
        from airfare_management.infrastructure.crystal_bridge import crystal_status as status

        return status(config)

    @app.get("/v1/crystal/opendocument")
    def crystal_opendocument(
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance", "auditor"))],
        cuid: Annotated[str | None, Query(max_length=120)] = None,
        doc_id: Annotated[str | None, Query(max_length=120)] = None,
    ) -> dict[str, Any]:
        from airfare_management.infrastructure.crystal_bridge import (
            crystal_configured,
            opendocument_url,
        )

        if not crystal_configured(config):
            raise DomainError("crystal_not_configured", "SAP Crystal BIP is not configured.")
        return {"url": opendocument_url(config, cuid=cuid, doc_id=doc_id)}

    @app.post("/v1/crystal/export.pdf")
    def crystal_export_pdf(
        payload: CrystalExportRequest,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "finance"))],
    ) -> Response:
        from airfare_management.infrastructure.crystal_bridge import (
            crystal_configured,
            export_report_pdf,
        )

        if not crystal_configured(config):
            raise DomainError("crystal_not_configured", "SAP Crystal BIP is not configured.")
        try:
            pdf = export_report_pdf(config, report_id=payload.report_id)
        except RuntimeError as exc:
            raise DomainError("crystal_export_failed", str(exc)) from exc
        return Response(
            pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="crystal-report.pdf"'},
        )

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
        _require_active_employee(session, payload.employee_id)
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

    @app.get("/v1/audit")
    def list_audit_events(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin"))],
        entity_type: Annotated[str, Query(max_length=100)] = "",
        action: Annotated[str, Query(max_length=20)] = "",
        limit: Annotated[int, Query(ge=1, le=500)] = 200,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> dict[str, Any]:
        query = select(AuditRow)
        if entity_type:
            query = query.where(AuditRow.entity_type == entity_type)
        if action:
            query = query.where(AuditRow.action == action)
        total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = session.scalars(
            query.order_by(AuditRow.occurred_at.desc(), AuditRow.id.desc())
            .offset(offset)
            .limit(limit)
        ).all()
        actors = {
            user.id: user.username
            for user in session.scalars(select(UserRow).where(UserRow.deleted_at.is_(None)))
        }
        return {
            "total": total,
            "events": [
                {
                    "id": row.id,
                    "occurred_at": row.occurred_at.isoformat() if row.occurred_at else None,
                    "actor": actors.get(row.actor_id or "", row.actor_id),
                    "correlation_id": row.correlation_id,
                    "ip_address": row.ip_address,
                    "action": row.action,
                    "entity_type": row.entity_type,
                    "entity_id": row.entity_id,
                    "changes": row.changes,
                }
                for row in rows
            ],
        }

    branding_root = Path(config.attachment_root).resolve() / "branding"

    @app.get("/v1/documents/templates")
    def document_templates(
        _: Annotated[Claims, Depends(authenticated)],
    ) -> dict[str, Any]:
        return {"templates": list_document_templates()}

    @app.get("/v1/documents")
    def documents(
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authenticated)],
        kind: Literal["offer_letter", "contract"] | None = None,
        employee_id: UUID | None = None,
        limit: Annotated[int, Query(ge=1, le=500)] = 100,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> dict[str, Any]:
        return {
            "documents": list_documents(
                session, kind=kind, employee_id=employee_id, limit=limit, offset=offset
            )
        }

    @app.post("/v1/documents/preview")
    def preview_document_html(
        payload: DocumentRequest,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr"))],
    ) -> Response:
        html = preview_document(
            session,
            branding_root=branding_root,
            kind=payload.kind,
            template_key=payload.template_key,
            employee_id=payload.employee_id,
            company_id=payload.company_id,
            raw_params=payload.params,
        )
        return Response(html, media_type="text/html")

    @app.post("/v1/documents", status_code=201)
    def generate_document(
        payload: DocumentRequest,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authorized("admin", "hr"))],
    ) -> dict[str, Any]:
        row = create_document(
            session,
            document_root=config.document_root,
            branding_root=branding_root,
            kind=payload.kind,
            template_key=payload.template_key,
            employee_id=payload.employee_id,
            company_id=payload.company_id,
            raw_params=payload.params,
            actor=claims.username,
        )
        return {
            "id": row.id,
            "document_number": row.document_number,
            "voucher_no": row.voucher_no,
            "kind": row.kind,
            "template_key": row.template_key,
            "title": row.title,
            "status": row.status,
            "employee_id": str(row.employee_id) if row.employee_id else None,
            "company_id": getattr(row, "company_id", None),
            "issued_at": row.issued_at.isoformat() if row.issued_at else None,
            "has_pdf": bool(row.pdf_key),
            "version": row.version,
        }

    @app.get("/v1/documents/defaults/{employee_id}")
    def document_defaults_for_employee(
        employee_id: UUID,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr"))],
    ) -> dict[str, Any]:
        employee = session.scalar(
            select(EmployeeRow).where(
                EmployeeRow.id == employee_id, EmployeeRow.deleted_at.is_(None)
            )
        )
        if employee is None:
            raise DomainError("not_found", "Employee not found.")
        return {
            "employee_id": str(employee.id),
            "employee_name": employee.full_name,
            "employee_code": employee.code,
            "department": employee.department,
            "nationality": employee.nationality,
            "passport_no": employee.passport_no,
            "params": employee_defaults(employee),
        }

    @app.get("/v1/documents/{document_id}")
    def get_document_detail(
        document_id: str,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr"))],
    ) -> dict[str, Any]:
        return document_detail(session, document_id)

    @app.put("/v1/documents/{document_id}")
    def edit_document(
        document_id: str,
        payload: DocumentUpdateRequest,
        session: Annotated[Session, Depends(database)],
        claims: Annotated[Claims, Depends(authorized("admin", "hr"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> dict[str, Any]:
        row = update_document(
            session,
            document_id=document_id,
            document_root=config.document_root,
            branding_root=branding_root,
            raw_params=payload.params,
            actor=claims.username,
            if_match=if_match,
            employee_id=payload.employee_id,
            company_id=payload.company_id,
            template_key=payload.template_key,
        )
        return {
            "id": row.id,
            "document_number": row.document_number,
            "voucher_no": row.voucher_no,
            "kind": row.kind,
            "template_key": row.template_key,
            "title": row.title,
            "status": row.status,
            "employee_id": str(row.employee_id) if row.employee_id else None,
            "company_id": getattr(row, "company_id", None),
            "issued_at": row.issued_at.isoformat() if row.issued_at else None,
            "has_pdf": bool(row.pdf_key),
            "version": row.version,
        }

    @app.get("/v1/documents/{document_id}/pdf")
    def download_document_pdf(
        document_id: str,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authenticated)],
    ) -> FileResponse:
        row = get_document(session, document_id)
        path = document_pdf_path(config.document_root, row)
        return FileResponse(
            path,
            media_type="application/pdf",
            filename=f"{(row.voucher_no or row.title).replace(' ', '_')}.pdf",
        )

    @app.delete("/v1/documents/{document_id}", status_code=204)
    def delete_document(
        document_id: str,
        session: Annotated[Session, Depends(database)],
        _: Annotated[Claims, Depends(authorized("admin", "hr"))],
        if_match: Annotated[int, Header(alias="If-Match")],
    ) -> Response:
        row = get_document(session, document_id)
        if row.version != if_match:
            raise DomainError("stale_version", "The document was modified by another user.")
        row.deleted_at = datetime.now(UTC)
        row.version += 1
        if row.pdf_key:
            path = Path(config.document_root) / row.pdf_key
            path.unlink(missing_ok=True)
            row.pdf_key = None
        session.flush()
        return Response(status_code=204)

    redis_client = None
    if config.environment != "test":
        try:
            from redis import Redis

            redis_client = Redis.from_url(
                config.redis_url, socket_connect_timeout=1, socket_timeout=1
            )
        except Exception:  # noqa: BLE001
            redis_client = None
    register_health_routes(app, config, redis_client, database)

    @app.get("/{full_path:path}", response_class=FileResponse, include_in_schema=False)
    def spa_fallback(full_path: str) -> FileResponse:
        """Client-side routes resolve to the SPA; API paths still 404 normally."""
        if full_path.split("/", 1)[0] in {"v1", "assets", "_next", "health", "metrics", "docs", "redoc", "openapi.json"}:
            raise HTTPException(404, "Not found.")
        # Static-export route: serve its prerendered document when present.
        candidate = (web_root / full_path / "index.html").resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(web_root):
            return FileResponse(candidate, headers={"Cache-Control": "no-store"})
        return _spa_index()

    return app


app = create_app()


def run() -> None:
    """Run the HTTP service on the configured port (3389 by default)."""
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "airfare_management.api.main:app",
        host=settings.host,
        port=settings.port,
        proxy_headers=True,
    )

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db


router = APIRouter(prefix="/api/v1", tags=["Module 2-11 Blueprints"])
SessionDep = Annotated[Session, Depends(get_db)]


class ImportModule(StrEnum):
    EMPLOYEES = "employees"


class ImportPreviewResponse(BaseModel):
    total: int
    valid: int
    failed: int
    errors: list[dict[str, Any]]
    rows: list[dict[str, Any]]


class AirfareClaimCreate(BaseModel):
    employee_id: int = Field(ge=1)
    claim_date: date
    sector_code: str = Field(min_length=1, max_length=40)
    claim_type: str = Field(pattern="^(Ticket|CashEncashment|DependentTicket)$")
    claim_amount: Decimal = Field(ge=0, max_digits=18, decimal_places=3)
    accrued_balance: Decimal = Field(ge=0, max_digits=18, decimal_places=3)
    notes: str | None = Field(default=None, max_length=400)

    @model_validator(mode="after")
    def claim_cannot_exceed_balance(self) -> "AirfareClaimCreate":
        if self.claim_amount > self.accrued_balance:
            raise ValueError("claim_amount cannot exceed accrued_balance.")
        return self


class LoanRequestCreate(BaseModel):
    employee_id: int = Field(ge=1)
    principal_amount: Decimal = Field(gt=0, max_digits=18, decimal_places=3)
    terms_months: int = Field(ge=1, le=120)
    annual_interest_rate: Decimal = Field(default=Decimal("0.000"), ge=0, le=100, max_digits=9, decimal_places=3)
    disbursement_date: date
    notes: str | None = Field(default=None, max_length=400)


class SeedEvidenceCreate(BaseModel):
    employee_id: int = Field(ge=1)
    seed_type: str = Field(pattern="^(LeaveBalance|GratuityAccrual|SalaryAdjustment|AirfareEntitlement)$")
    effective_date: date
    amount: Decimal = Field(max_digits=18, decimal_places=3)
    source_reference: str = Field(min_length=1, max_length=120)
    approved_by: str = Field(min_length=1, max_length=120)


class ReportRequest(BaseModel):
    report_code: str = Field(pattern="^(PayrollSummary|DepartmentCosting|DocumentExpiry|LoanBalances|AirfareUtilization)$")
    date_from: date | None = None
    date_to: date | None = None
    department_id: int | None = Field(default=None, ge=1)
    employee_id: int | None = Field(default=None, ge=1)
    export_format: str = Field(default="json", pattern="^(json|xlsx|pdf)$")


class SystemSettingUpsert(BaseModel):
    setting_key: str = Field(min_length=1, max_length=120)
    setting_value: str = Field(max_length=4000)
    value_type: str = Field(default="string", pattern="^(string|number|boolean|json|secret)$")
    is_secret: bool = False


class SelfServiceRequestCreate(BaseModel):
    employee_id: int = Field(ge=1)
    request_type: str = Field(pattern="^(PayslipView|LoanRequest|AirfareRequest|LeaveStatus|DocumentStatus|ProfileUpdate)$")
    requested_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    payload: dict[str, Any] = Field(default_factory=dict)


class AirportResponse(BaseModel):
    iata_code: str
    airport_name: str
    city_name: str
    country_code: str
    sector_code: str | None
    score: int


@router.post("/imports/{module_code}/preview", response_model=ImportPreviewResponse)
async def preview_import(module_code: ImportModule, file: UploadFile) -> ImportPreviewResponse:
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Import file exceeds 10 MB.")
    rows = parse_csv_bytes(content)
    errors = []
    valid_rows = []
    for index, row in enumerate(rows, start=1):
        row_errors = validate_employee_import_row(row)
        if row_errors:
            errors.append({"row": index, "errors": row_errors, "data": row})
        else:
            valid_rows.append(row)
    return ImportPreviewResponse(total=len(rows), valid=len(valid_rows), failed=len(errors), errors=errors, rows=valid_rows)


@router.post("/airfare/claims")
def create_airfare_claim(payload: AirfareClaimCreate, session: SessionDep) -> dict[str, Any]:
    result = session.execute(
        text(
            """
            INSERT INTO core.AirfareClaims (EmployeeID, ClaimDate, SectorCode, ClaimType, ClaimAmount, AccruedBalance, ApprovalStatus, Notes)
            OUTPUT INSERTED.ClaimID
            VALUES (:employee_id, :claim_date, :sector_code, :claim_type, :claim_amount, :accrued_balance, N'Submitted', :notes)
            """
        ),
        payload.model_dump(),
    ).scalar_one()
    session.commit()
    return {"claimId": int(result), "status": "Submitted"}


@router.post("/airfare/claims/{claim_id}/approve")
def approve_airfare_claim(claim_id: int, session: SessionDep) -> dict[str, Any]:
    affected = session.execute(
        text("UPDATE core.AirfareClaims SET ApprovalStatus = N'Approved', ApprovedAtUtc = SYSUTCDATETIME() WHERE ClaimID = :claim_id AND ApprovalStatus = N'Submitted'"),
        {"claim_id": claim_id},
    ).rowcount
    session.commit()
    if affected == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found or not approvable.")
    return {"claimId": claim_id, "status": "Approved"}


@router.post("/loans/amortization")
def generate_amortization(payload: LoanRequestCreate) -> dict[str, Any]:
    monthly_rate = Decimal(payload.annual_interest_rate) / Decimal("1200")
    if monthly_rate == 0:
        emi = payload.principal_amount / Decimal(payload.terms_months)
    else:
        factor = (Decimal("1") + monthly_rate) ** payload.terms_months
        emi = payload.principal_amount * monthly_rate * factor / (factor - Decimal("1"))
    schedule = []
    balance = payload.principal_amount
    for month in range(1, payload.terms_months + 1):
        interest = balance * monthly_rate
        principal = min(balance, emi - interest)
        balance = max(Decimal("0"), balance - principal)
        schedule.append({"installmentNo": month, "principal": round(principal, 3), "interest": round(interest, 3), "emi": round(emi, 3), "balance": round(balance, 3)})
    return {"termsMonths": payload.terms_months, "monthlyInstallment": round(emi, 3), "schedule": schedule}


@router.post("/loans")
def create_loan(payload: LoanRequestCreate, session: SessionDep) -> dict[str, Any]:
    emi = generate_amortization(payload)["monthlyInstallment"]
    loan_id = session.execute(
        text(
            """
            INSERT INTO core.Loans (EmployeeID, PrincipalAmount, TermsMonths, AnnualInterestRate, MonthlyInstallment, OutstandingAmount, DisbursementDate, LoanStatus, Notes)
            OUTPUT INSERTED.LoanID
            VALUES (:employee_id, :principal_amount, :terms_months, :annual_interest_rate, :emi, :principal_amount, :disbursement_date, N'Active', :notes)
            """
        ),
        {**payload.model_dump(), "emi": emi},
    ).scalar_one()
    session.commit()
    return {"loanId": int(loan_id), "monthlyInstallment": emi, "status": "Active"}


@router.post("/seed-evidence")
def create_seed_evidence(payload: SeedEvidenceCreate, session: SessionDep) -> dict[str, Any]:
    seed_id = session.execute(
        text(
            """
            INSERT INTO core.SeedEvidence (EmployeeID, SeedType, EffectiveDate, Amount, SourceReference, VerificationChecksum, ApprovalStatus, ApprovedBy)
            OUTPUT INSERTED.SeedID
            VALUES (:employee_id, :seed_type, :effective_date, :amount, :source_reference, CONVERT(NVARCHAR(64), HASHBYTES('SHA2_256', CONCAT(:employee_id, ':', :seed_type, ':', :effective_date, ':', :amount, ':', :source_reference)), 2), N'Approved', :approved_by)
            """
        ),
        payload.model_dump(),
    ).scalar_one()
    session.commit()
    return {"seedId": int(seed_id), "status": "Approved"}


@router.post("/reports/run")
def run_report(payload: ReportRequest, session: SessionDep) -> dict[str, Any]:
    params = payload.model_dump()
    report_id = session.execute(
        text(
            """
            INSERT INTO core.ReportRuns (ReportCode, DateFrom, DateTo, DepartmentID, EmployeeID, ExportFormat, RunStatus)
            OUTPUT INSERTED.ReportRunID
            VALUES (:report_code, :date_from, :date_to, :department_id, :employee_id, :export_format, N'Completed')
            """
        ),
        params,
    ).scalar_one()
    session.commit()
    return {"reportRunId": int(report_id), "status": "Completed", "parameters": params}


@router.put("/admin/settings/{setting_key}")
def upsert_setting(setting_key: str, payload: SystemSettingUpsert, session: SessionDep) -> dict[str, Any]:
    if setting_key != payload.setting_key:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="setting_key path/body mismatch.")
    session.execute(
        text(
            """
            MERGE core.SystemSettings AS target
            USING (SELECT :setting_key AS SettingKey) AS source
            ON target.SettingKey = source.SettingKey
            WHEN MATCHED THEN UPDATE SET SettingValue = :setting_value, ValueType = :value_type, IsSecret = :is_secret, UpdatedAtUtc = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, ValueType, IsSecret) VALUES (:setting_key, :setting_value, :value_type, :is_secret);
            """
        ),
        payload.model_dump(),
    )
    session.commit()
    return {"settingKey": setting_key, "status": "Saved"}


@router.post("/me/requests")
def create_self_service_request(payload: SelfServiceRequestCreate, session: SessionDep) -> dict[str, Any]:
    request_id = session.execute(
        text(
            """
            INSERT INTO core.SelfServiceRequestsV2 (EmployeeID, RequestType, RequestedAtUtc, RequestPayloadJSON, RequestStatus)
            OUTPUT INSERTED.RequestID
            VALUES (:employee_id, :request_type, :requested_at, :payload_json, N'Submitted')
            """
        ),
        {**payload.model_dump(exclude={"payload"}), "payload_json": json_dumps(payload.payload)},
    ).scalar_one()
    session.commit()
    return {"requestId": int(request_id), "status": "Submitted"}


@router.get("/airports", response_model=list[AirportResponse])
def search_airports(session: SessionDep, q: Annotated[str, Query(min_length=1, max_length=80)]) -> list[AirportResponse]:
    like = f"{q.strip()}%"
    contains = f"%{q.strip()}%"
    rows = session.execute(
        text(
            """
            SELECT TOP 20 IATACode, AirportName, CityName, CountryCode, SectorCode,
                   CASE WHEN IATACode = :exact THEN 100 WHEN IATACode LIKE :like THEN 90 WHEN CityName LIKE :like THEN 80 ELSE 50 END AS Score
            FROM core.Airports
            WHERE IsActive = 1 AND (IATACode LIKE :like OR CityName LIKE :contains OR AirportName LIKE :contains OR CountryCode LIKE :like)
            ORDER BY Score DESC, IATACode ASC
            """
        ),
        {"exact": q.strip().upper(), "like": like.upper(), "contains": contains},
    ).all()
    return [AirportResponse(iata_code=r[0], airport_name=r[1], city_name=r[2], country_code=r[3], sector_code=r[4], score=int(r[5])) for r in rows]


@router.post("/attachments/metadata")
def create_document_metadata(file_name: str, employee_id: int, document_type: str, session: SessionDep) -> dict[str, Any]:
    doc_id = session.execute(
        text(
            """
            INSERT INTO core.DocumentMetadata (EmployeeID, DocumentType, FileName, StorageProvider, StoragePath, MimeType, FileSizeBytes, VerificationStatus)
            OUTPUT INSERTED.DocumentID
            VALUES (:employee_id, :document_type, :file_name, N'local', CONCAT(N'documents/', :file_name), N'application/octet-stream', 0, N'Pending')
            """
        ),
        {"employee_id": employee_id, "document_type": document_type, "file_name": file_name},
    ).scalar_one()
    session.commit()
    return {"documentId": int(doc_id), "status": "Pending"}


@router.post("/admin/backups")
def request_backup(session: SessionDep) -> dict[str, Any]:
    backup_id = session.execute(
        text("INSERT INTO core.BackupJobs (JobType, JobStatus, RequestedAtUtc) OUTPUT INSERTED.BackupJobID VALUES (N'DatabaseBackup', N'Queued', SYSUTCDATETIME())")
    ).scalar_one()
    session.commit()
    return {"backupJobId": int(backup_id), "status": "Queued"}


def parse_csv_bytes(content: bytes) -> list[dict[str, str]]:
    import csv
    import io

    text_content = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text_content))
    return [{str(k): str(v or "").strip() for k, v in row.items()} for row in reader]


def validate_employee_import_row(row: dict[str, str]) -> list[str]:
    required = ["EmployeeCode", "FullName", "FirstName", "LastName", "Gender", "DateOfBirth", "Nationality", "JoiningDate", "Designation", "EmploymentType", "PaymentMode"]
    errors = [f"{field} is required" for field in required if not row.get(field)]
    if row.get("PaymentMode") in {"Bank", "WPS"} and not row.get("IBANAccountNumber"):
        errors.append("IBANAccountNumber is required for Bank/WPS payment.")
    return errors


def json_dumps(value: dict[str, Any]) -> str:
    import json

    return json.dumps(value, separators=(",", ":"), default=str)

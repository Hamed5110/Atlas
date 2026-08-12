from __future__ import annotations

import csv
import hashlib
import io
import json
import secrets
from datetime import date, datetime, timezone
from datetime import timedelta
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db


router = APIRouter(prefix="/api/v1", tags=["Continuous Entitlement and Operations"] )
SessionDep = Annotated[Session, Depends(get_db)]

class AirfareEntitlementResponse(BaseModel):
    employeeId: int
    employeeCode: str
    fullName: str
    joiningDate: date
    targetDate: date
    elapsedServiceDays: int
    monthlyRate: Decimal
    accruedBalance: Decimal
    seedBalance: Decimal
    claimedBalance: Decimal
    availableBalance: Decimal
    model: str


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


@router.get("/airfare/entitlement/{emp_id}", response_model=AirfareEntitlementResponse)
def get_airfare_entitlement(emp_id: int, session: SessionDep, target_date: Annotated[date, Query()]) -> AirfareEntitlementResponse:
    row = session.execute(
        text(
            """
            WITH RateSetting AS (
                SELECT TOP (1) TRY_CONVERT(DECIMAL(18,3), SettingValue) AS MonthlyRate
                FROM core.SystemSettings
                WHERE SettingKey = N'airfare.monthly_rate_bhd'
            ),
            ApprovedClaims AS (
                SELECT EmployeeID, SUM(ClaimAmount) AS ClaimedBalance
                FROM core.AirfareClaims
                WHERE ApprovalStatus = N'Approved' AND ClaimDate <= :target_date
                GROUP BY EmployeeID
            ),
            ApprovedSeeds AS (
                SELECT EmployeeID, SUM(Amount) AS SeedBalance
                FROM core.SeedEvidence
                WHERE SeedType = N'AirfareEntitlement' AND ApprovalStatus = N'Approved' AND EffectiveDate <= :target_date
                GROUP BY EmployeeID
            )
            SELECT
                e.EmployeeID,
                e.EmployeeCode,
                e.FullName,
                e.JoiningDate,
                :target_date AS TargetDate,
                DATEDIFF(DAY, e.JoiningDate, :target_date) AS ElapsedServiceDays,
                CAST(COALESCE((SELECT MonthlyRate FROM RateSetting), 150.000) AS DECIMAL(18,3)) AS MonthlyRate,
                CAST(ROUND((CASE WHEN DATEDIFF(DAY, e.JoiningDate, :target_date) < 0 THEN 0 ELSE DATEDIFF(DAY, e.JoiningDate, :target_date) END) * COALESCE((SELECT MonthlyRate FROM RateSetting), 150.000) / 30.4375, 3) AS DECIMAL(18,3)) AS AccruedBalance,
                CAST(COALESCE(s.SeedBalance, 0) AS DECIMAL(18,3)) AS SeedBalance,
                CAST(COALESCE(c.ClaimedBalance, 0) AS DECIMAL(18,3)) AS ClaimedBalance,
                CAST(ROUND(((CASE WHEN DATEDIFF(DAY, e.JoiningDate, :target_date) < 0 THEN 0 ELSE DATEDIFF(DAY, e.JoiningDate, :target_date) END) * COALESCE((SELECT MonthlyRate FROM RateSetting), 150.000) / 30.4375) + COALESCE(s.SeedBalance, 0) - COALESCE(c.ClaimedBalance, 0), 3) AS DECIMAL(18,3)) AS AvailableBalance
            FROM core.Employees e
            LEFT JOIN ApprovedClaims c ON c.EmployeeID = e.EmployeeID
            LEFT JOIN ApprovedSeeds s ON s.EmployeeID = e.EmployeeID
            WHERE e.EmployeeID = :emp_id AND e.IsDeleted = 0
            """
        ),
        {"emp_id": emp_id, "target_date": target_date},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
    return AirfareEntitlementResponse(
        employeeId=int(row["EmployeeID"]),
        employeeCode=row["EmployeeCode"],
        fullName=row["FullName"],
        joiningDate=row["JoiningDate"],
        targetDate=row["TargetDate"],
        elapsedServiceDays=max(0, int(row["ElapsedServiceDays"])),
        monthlyRate=row["MonthlyRate"],
        accruedBalance=row["AccruedBalance"],
        seedBalance=row["SeedBalance"],
        claimedBalance=row["ClaimedBalance"],
        availableBalance=row["AvailableBalance"],
        model="continuous-accrual-elapsed-service-days",
    )


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
    rows = execute_report_query(payload, session)
    summary = summarize_report_rows(payload.report_code, rows)
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
    session.execute(
        text(
            """
            INSERT INTO core.AuditLogs (Username, ActionCode, TableName, EntityID, NewValueJSON, IpAddress)
            VALUES (N'system', N'REPORT_RUN', N'core.ReportRuns', CONVERT(NVARCHAR(120), :report_id), :payload_json, N'127.0.0.1')
            """
        ),
        {"report_id": int(report_id), "payload_json": json_dumps({"parameters": normalize_json(params), "summary": summary})},
    )
    session.commit()
    return {
        "reportRunId": int(report_id),
        "status": "Completed",
        "reportCode": payload.report_code,
        "parameters": normalize_json(params),
        "summary": summary,
        "rows": rows,
    }


def execute_report_query(payload: ReportRequest, session: Session) -> list[dict[str, Any]]:
    common_filters = "WHERE e.IsDeleted = 0"
    params: dict[str, Any] = {
        "employee_id": payload.employee_id,
        "department_id": payload.department_id,
        "date_from": payload.date_from,
        "date_to": payload.date_to,
    }
    if payload.employee_id is not None:
        common_filters += " AND e.EmployeeID = :employee_id"
    if payload.department_id is not None:
        common_filters += " AND e.DepartmentID = :department_id"

    if payload.report_code == "PayrollSummary":
        sql = f"""
            SELECT TOP (500)
                e.EmployeeID AS employeeId, e.EmployeeCode AS employeeCode, e.FullName AS fullName,
                d.DepartmentName AS department, e.Designation AS designation, e.EmploymentType AS employmentType,
                e.Status AS status, e.PaymentMode AS paymentMode, e.BasicSalary AS basicSalary,
                e.HousingAllowance AS housingAllowance, e.TransportAllowance AS transportAllowance,
                e.OtherFixedAllowances AS otherFixedAllowances,
                CAST(e.BasicSalary + e.HousingAllowance + e.TransportAllowance + e.OtherFixedAllowances AS DECIMAL(18,3)) AS grossFixedPay
            FROM core.Employees e
            LEFT JOIN core.Departments d ON d.DepartmentID = e.DepartmentID
            {common_filters}
            ORDER BY e.EmployeeCode;
        """
    elif payload.report_code == "DepartmentCosting":
        sql = f"""
            SELECT TOP (500)
                COALESCE(d.DepartmentName, N'Unassigned') AS department,
                COUNT_BIG(*) AS employeeCount,
                SUM(CASE WHEN e.Status = N'Active' THEN 1 ELSE 0 END) AS activeCount,
                CAST(SUM(e.BasicSalary + e.HousingAllowance + e.TransportAllowance + e.OtherFixedAllowances) AS DECIMAL(18,3)) AS grossFixedPay
            FROM core.Employees e
            LEFT JOIN core.Departments d ON d.DepartmentID = e.DepartmentID
            {common_filters}
            GROUP BY COALESCE(d.DepartmentName, N'Unassigned')
            ORDER BY department;
        """
    elif payload.report_code == "DocumentExpiry":
        date_filter = ""
        if payload.date_to is not None:
            date_filter = " AND (e.PassportExpiry <= :date_to OR e.CivilIDExpiry <= :date_to OR e.VisaExpiry <= :date_to OR e.LabourCardExpiry <= :date_to)"
        sql = f"""
            SELECT TOP (500)
                e.EmployeeID AS employeeId, e.EmployeeCode AS employeeCode, e.FullName AS fullName,
                e.PassportExpiry AS passportExpiry, e.CivilIDExpiry AS civilIdExpiry,
                e.VisaExpiry AS visaExpiry, e.LabourCardExpiry AS labourCardExpiry,
                CASE
                    WHEN e.PassportExpiry <= COALESCE(:date_to, DATEADD(DAY, 60, CAST(GETDATE() AS DATE)))
                      OR e.CivilIDExpiry <= COALESCE(:date_to, DATEADD(DAY, 60, CAST(GETDATE() AS DATE)))
                      OR e.VisaExpiry <= COALESCE(:date_to, DATEADD(DAY, 60, CAST(GETDATE() AS DATE)))
                      OR e.LabourCardExpiry <= COALESCE(:date_to, DATEADD(DAY, 60, CAST(GETDATE() AS DATE)))
                    THEN N'Review' ELSE N'Clear'
                END AS status
            FROM core.Employees e
            {common_filters}{date_filter}
            ORDER BY e.EmployeeCode;
        """
    elif payload.report_code == "LoanBalances":
        sql = f"""
            SELECT TOP (500)
                e.EmployeeID AS employeeId, e.EmployeeCode AS employeeCode, e.FullName AS fullName,
                l.LoanID AS loanId, l.PrincipalAmount AS principalAmount, l.MonthlyInstallment AS monthlyInstallment,
                l.OutstandingAmount AS outstandingAmount, l.LoanStatus AS loanStatus, l.DisbursementDate AS disbursementDate
            FROM core.Loans l
            INNER JOIN core.Employees e ON e.EmployeeID = l.EmployeeID
            {common_filters}
            ORDER BY e.EmployeeCode, l.LoanID DESC;
        """
    elif payload.report_code == "AirfareUtilization":
        sql = f"""
            WITH RateSetting AS (
                SELECT TOP (1) TRY_CONVERT(DECIMAL(18,3), SettingValue) AS MonthlyRate
                FROM core.SystemSettings
                WHERE SettingKey = N'airfare.monthly_rate_bhd'
            ),
            ApprovedClaims AS (
                SELECT EmployeeID, SUM(ClaimAmount) AS ClaimedBalance
                FROM core.AirfareClaims
                WHERE ApprovalStatus = N'Approved'
                  AND (:date_to IS NULL OR ClaimDate <= :date_to)
                  AND (:date_from IS NULL OR ClaimDate >= :date_from)
                GROUP BY EmployeeID
            ),
            ApprovedSeeds AS (
                SELECT EmployeeID, SUM(Amount) AS SeedBalance
                FROM core.SeedEvidence
                WHERE SeedType = N'AirfareEntitlement' AND ApprovalStatus = N'Approved'
                  AND (:date_to IS NULL OR EffectiveDate <= :date_to)
                GROUP BY EmployeeID
            )
            SELECT TOP (500)
                e.EmployeeID AS employeeId, e.EmployeeCode AS employeeCode, e.FullName AS fullName,
                d.DepartmentName AS department, e.Designation AS designation, e.JoiningDate AS joiningDate,
                COALESCE(:date_to, CAST(GETDATE() AS DATE)) AS asOfDate,
                CASE WHEN DATEDIFF(DAY, e.JoiningDate, COALESCE(:date_to, CAST(GETDATE() AS DATE))) < 0 THEN 0 ELSE DATEDIFF(DAY, e.JoiningDate, COALESCE(:date_to, CAST(GETDATE() AS DATE))) END AS elapsedServiceDays,
                CAST(COALESCE((SELECT MonthlyRate FROM RateSetting), 150.000) AS DECIMAL(18,3)) AS monthlyRate,
                CAST(ROUND((CASE WHEN DATEDIFF(DAY, e.JoiningDate, COALESCE(:date_to, CAST(GETDATE() AS DATE))) < 0 THEN 0 ELSE DATEDIFF(DAY, e.JoiningDate, COALESCE(:date_to, CAST(GETDATE() AS DATE))) END) * COALESCE((SELECT MonthlyRate FROM RateSetting), 150.000) / 30.4375, 3) AS DECIMAL(18,3)) AS accruedBalance,
                CAST(COALESCE(s.SeedBalance, 0) AS DECIMAL(18,3)) AS seedBalance,
                CAST(COALESCE(c.ClaimedBalance, 0) AS DECIMAL(18,3)) AS claimedBalance,
                CAST(ROUND(((CASE WHEN DATEDIFF(DAY, e.JoiningDate, COALESCE(:date_to, CAST(GETDATE() AS DATE))) < 0 THEN 0 ELSE DATEDIFF(DAY, e.JoiningDate, COALESCE(:date_to, CAST(GETDATE() AS DATE))) END) * COALESCE((SELECT MonthlyRate FROM RateSetting), 150.000) / 30.4375) + COALESCE(s.SeedBalance, 0) - COALESCE(c.ClaimedBalance, 0), 3) AS DECIMAL(18,3)) AS availableBalance,
                CASE WHEN COALESCE(c.ClaimedBalance, 0) > 0 THEN N'Utilized' ELSE N'Available' END AS status
            FROM core.Employees e
            LEFT JOIN core.Departments d ON d.DepartmentID = e.DepartmentID
            LEFT JOIN ApprovedClaims c ON c.EmployeeID = e.EmployeeID
            LEFT JOIN ApprovedSeeds s ON s.EmployeeID = e.EmployeeID
            {common_filters}
            ORDER BY e.EmployeeCode;
        """
    else:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unsupported report_code.")

    result = session.execute(text(sql), params).mappings().all()
    return [normalize_json(dict(row)) for row in result]


def summarize_report_rows(report_code: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    numeric_keys = {
        "PayrollSummary": ["grossFixedPay", "basicSalary", "housingAllowance", "transportAllowance", "otherFixedAllowances"],
        "DepartmentCosting": ["grossFixedPay", "employeeCount", "activeCount"],
        "DocumentExpiry": [],
        "LoanBalances": ["principalAmount", "monthlyInstallment", "outstandingAmount"],
        "AirfareUtilization": ["accruedBalance", "seedBalance", "claimedBalance", "availableBalance"],
    }.get(report_code, [])
    totals: dict[str, Any] = {"rowCount": len(rows)}
    for key in numeric_keys:
        totals[key] = str(sum(Decimal(str(row.get(key) or 0)) for row in rows))
    return totals


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




def normalize_json(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): normalize_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [normalize_json(item) for item in value]
    return value


def json_dumps(value: dict[str, Any]) -> str:
    return json.dumps(value, separators=(",", ":"), default=str)

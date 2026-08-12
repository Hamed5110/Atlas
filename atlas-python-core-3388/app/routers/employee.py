from __future__ import annotations

import base64
from datetime import date, datetime, timezone
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from sqlalchemy import Boolean, Date, DateTime, FetchedValue, ForeignKey, Index, Integer, Numeric, String, Unicode, UnicodeText, and_, func, or_, select
from sqlalchemy.dialects.mssql import ROWVERSION
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from app.database import Base, get_db

router = APIRouter(prefix="/api/v1/employees", tags=["Employee Master"])


class Gender(StrEnum):
    MALE = "Male"
    FEMALE = "Female"
    OTHER = "Other"
    UNDISCLOSED = "Undisclosed"


class MaritalStatus(StrEnum):
    SINGLE = "Single"
    MARRIED = "Married"
    DIVORCED = "Divorced"
    WIDOWED = "Widowed"
    OTHER = "Other"


class EmploymentType(StrEnum):
    PERMANENT = "Permanent"
    CONTRACT = "Contract"
    PROBATION = "Probation"
    TEMPORARY = "Temporary"
    INTERN = "Intern"


class EmployeeStatus(StrEnum):
    ACTIVE = "Active"
    INACTIVE = "Inactive"
    RESIGNED = "Resigned"
    TERMINATED = "Terminated"
    ON_LEAVE = "OnLeave"


class PaymentMode(StrEnum):
    BANK = "Bank"
    CASH = "Cash"
    WPS = "WPS"


class Department(Base):
    __tablename__ = "Departments"
    __table_args__ = {"schema": "core"}

    department_id: Mapped[int] = mapped_column("DepartmentID", Integer, primary_key=True, autoincrement=True)
    department_code: Mapped[str] = mapped_column("DepartmentCode", Unicode(40), nullable=False, unique=True)
    department_name: Mapped[str] = mapped_column("DepartmentName", Unicode(160), nullable=False)
    is_active: Mapped[bool] = mapped_column("IsActive", Boolean, nullable=False, default=True)


class Branch(Base):
    __tablename__ = "Branches"
    __table_args__ = {"schema": "core"}

    branch_id: Mapped[int] = mapped_column("BranchID", Integer, primary_key=True, autoincrement=True)
    branch_code: Mapped[str] = mapped_column("BranchCode", Unicode(40), nullable=False, unique=True)
    branch_name: Mapped[str] = mapped_column("BranchName", Unicode(160), nullable=False)
    is_active: Mapped[bool] = mapped_column("IsActive", Boolean, nullable=False, default=True)


class Employee(Base):
    __tablename__ = "Employees"
    __table_args__ = (
        Index("IX_core_Employees_EmployeeCode", "EmployeeCode"),
        Index("IX_core_Employees_DepartmentID", "DepartmentID"),
        Index("IX_core_Employees_Status", "Status", "IsDeleted"),
        {"schema": "core"},
    )

    employee_id: Mapped[int] = mapped_column("EmployeeID", Integer, primary_key=True, autoincrement=True)
    employee_code: Mapped[str] = mapped_column("EmployeeCode", Unicode(50), nullable=False, unique=True)
    punch_machine_id: Mapped[str | None] = mapped_column("PunchMachineID", Unicode(50))

    full_name: Mapped[str] = mapped_column("FullName", Unicode(200), nullable=False)
    first_name: Mapped[str] = mapped_column("FirstName", Unicode(80), nullable=False)
    middle_name: Mapped[str | None] = mapped_column("MiddleName", Unicode(80))
    last_name: Mapped[str] = mapped_column("LastName", Unicode(80), nullable=False)
    passport_name: Mapped[str | None] = mapped_column("PassportName", Unicode(200))
    gender: Mapped[str] = mapped_column("Gender", Unicode(20), nullable=False)
    date_of_birth: Mapped[date] = mapped_column("DateOfBirth", Date, nullable=False)
    nationality: Mapped[str] = mapped_column("Nationality", Unicode(80), nullable=False)
    religion: Mapped[str | None] = mapped_column("Religion", Unicode(80))
    marital_status: Mapped[str | None] = mapped_column("MaritalStatus", Unicode(30))

    joining_date: Mapped[date] = mapped_column("JoiningDate", Date, nullable=False)
    probation_end_date: Mapped[date | None] = mapped_column("ProbationEndDate", Date)
    confirmation_date: Mapped[date | None] = mapped_column("ConfirmationDate", Date)
    department_id: Mapped[int | None] = mapped_column("DepartmentID", ForeignKey("core.Departments.DepartmentID"))
    designation: Mapped[str] = mapped_column("Designation", Unicode(120), nullable=False)
    grade_level: Mapped[str | None] = mapped_column("GradeLevel", Unicode(60))
    branch_id: Mapped[int | None] = mapped_column("BranchID", ForeignKey("core.Branches.BranchID"))
    employment_type: Mapped[str] = mapped_column("EmploymentType", Unicode(30), nullable=False)
    status: Mapped[str] = mapped_column("Status", Unicode(30), nullable=False, default=EmployeeStatus.ACTIVE.value)
    direct_manager_id: Mapped[int | None] = mapped_column("DirectManagerID", ForeignKey("core.Employees.EmployeeID"))

    personal_email: Mapped[str | None] = mapped_column("PersonalEmail", String(254))
    work_email: Mapped[str | None] = mapped_column("WorkEmail", String(254))
    mobile_number: Mapped[str | None] = mapped_column("MobileNumber", Unicode(40))
    emergency_contact_name: Mapped[str | None] = mapped_column("EmergencyContactName", Unicode(160))
    emergency_contact_phone: Mapped[str | None] = mapped_column("EmergencyContactPhone", Unicode(40))
    emergency_contact_relationship: Mapped[str | None] = mapped_column("EmergencyContactRelationship", Unicode(80))
    local_address: Mapped[str | None] = mapped_column("LocalAddress", UnicodeText)
    home_country_address: Mapped[str | None] = mapped_column("HomeCountryAddress", UnicodeText)

    passport_number: Mapped[str | None] = mapped_column("PassportNumber", Unicode(80), unique=True)
    passport_expiry: Mapped[date | None] = mapped_column("PassportExpiry", Date)
    civil_id: Mapped[str | None] = mapped_column("CivilID", Unicode(80), unique=True)
    civil_id_expiry: Mapped[date | None] = mapped_column("CivilIDExpiry", Date)
    visa_number: Mapped[str | None] = mapped_column("VisaNumber", Unicode(80))
    visa_type: Mapped[str | None] = mapped_column("VisaType", Unicode(80))
    visa_expiry: Mapped[date | None] = mapped_column("VisaExpiry", Date)
    labour_card_number: Mapped[str | None] = mapped_column("LabourCardNumber", Unicode(80))
    labour_card_expiry: Mapped[date | None] = mapped_column("LabourCardExpiry", Date)

    basic_salary: Mapped[Decimal] = mapped_column("BasicSalary", Numeric(18, 3), nullable=False, default=Decimal("0.000"))
    housing_allowance: Mapped[Decimal] = mapped_column("HousingAllowance", Numeric(18, 3), nullable=False, default=Decimal("0.000"))
    transport_allowance: Mapped[Decimal] = mapped_column("TransportAllowance", Numeric(18, 3), nullable=False, default=Decimal("0.000"))
    other_fixed_allowances: Mapped[Decimal] = mapped_column("OtherFixedAllowances", Numeric(18, 3), nullable=False, default=Decimal("0.000"))
    payment_mode: Mapped[str] = mapped_column("PaymentMode", Unicode(20), nullable=False)
    bank_name: Mapped[str | None] = mapped_column("BankName", Unicode(160))
    iban_account_number: Mapped[str | None] = mapped_column("IBANAccountNumber", Unicode(80))
    swift_code: Mapped[str | None] = mapped_column("SwiftCode", Unicode(40))

    resignation_date: Mapped[date | None] = mapped_column("ResignationDate", Date)
    last_working_day: Mapped[date | None] = mapped_column("LastWorkingDay", Date)
    reason_for_leaving: Mapped[str | None] = mapped_column("ReasonForLeaving", Unicode(400))
    rehire_eligible: Mapped[bool] = mapped_column("RehireEligible", Boolean, nullable=False, default=True)

    row_version: Mapped[bytes] = mapped_column("RowVersion", ROWVERSION, nullable=False, server_default=FetchedValue(), server_onupdate=FetchedValue())
    is_deleted: Mapped[bool] = mapped_column("IsDeleted", Boolean, nullable=False, default=False)
    created_at_utc: Mapped[datetime] = mapped_column("CreatedAtUtc", DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at_utc: Mapped[datetime] = mapped_column("UpdatedAtUtc", DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    department: Mapped[Department | None] = relationship()
    branch: Mapped[Branch | None] = relationship()


class EmployeeBase(BaseModel):
    employee_code: str = Field(min_length=1, max_length=50)
    punch_machine_id: str | None = Field(default=None, max_length=50)

    full_name: str = Field(min_length=1, max_length=200)
    first_name: str = Field(min_length=1, max_length=80)
    middle_name: str | None = Field(default=None, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    passport_name: str | None = Field(default=None, max_length=200)
    gender: Gender
    date_of_birth: date
    nationality: str = Field(min_length=1, max_length=80)
    religion: str | None = Field(default=None, max_length=80)
    marital_status: MaritalStatus | None = None

    joining_date: date
    probation_end_date: date | None = None
    confirmation_date: date | None = None
    department_id: int | None = Field(default=None, ge=1)
    designation: str = Field(min_length=1, max_length=120)
    grade_level: str | None = Field(default=None, max_length=60)
    branch_id: int | None = Field(default=None, ge=1)
    employment_type: EmploymentType
    status: EmployeeStatus = EmployeeStatus.ACTIVE
    direct_manager_id: int | None = Field(default=None, ge=1)

    personal_email: EmailStr | None = None
    work_email: EmailStr | None = None
    mobile_number: str | None = Field(default=None, max_length=40)
    emergency_contact_name: str | None = Field(default=None, max_length=160)
    emergency_contact_phone: str | None = Field(default=None, max_length=40)
    emergency_contact_relationship: str | None = Field(default=None, max_length=80)
    local_address: str | None = Field(default=None, max_length=500)
    home_country_address: str | None = Field(default=None, max_length=500)

    passport_number: str | None = Field(default=None, max_length=80)
    passport_expiry: date | None = None
    civil_id: str | None = Field(default=None, max_length=80)
    civil_id_expiry: date | None = None
    visa_number: str | None = Field(default=None, max_length=80)
    visa_type: str | None = Field(default=None, max_length=80)
    visa_expiry: date | None = None
    labour_card_number: str | None = Field(default=None, max_length=80)
    labour_card_expiry: date | None = None

    basic_salary: Decimal = Field(default=Decimal("0.000"), ge=0, max_digits=18, decimal_places=3)
    housing_allowance: Decimal = Field(default=Decimal("0.000"), ge=0, max_digits=18, decimal_places=3)
    transport_allowance: Decimal = Field(default=Decimal("0.000"), ge=0, max_digits=18, decimal_places=3)
    other_fixed_allowances: Decimal = Field(default=Decimal("0.000"), ge=0, max_digits=18, decimal_places=3)
    payment_mode: PaymentMode
    bank_name: str | None = Field(default=None, max_length=160)
    iban_account_number: str | None = Field(default=None, max_length=80)
    swift_code: str | None = Field(default=None, max_length=40)

    resignation_date: date | None = None
    last_working_day: date | None = None
    reason_for_leaving: str | None = Field(default=None, max_length=400)
    rehire_eligible: bool = True

    @field_validator("*", mode="before")
    @classmethod
    def trim_strings(cls, value: Any) -> Any:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    @model_validator(mode="after")
    def validate_date_logic(self) -> "EmployeeBase":
        if self.date_of_birth >= self.joining_date:
            raise ValueError("date_of_birth must be before joining_date.")
        if self.probation_end_date and self.probation_end_date < self.joining_date:
            raise ValueError("probation_end_date cannot be before joining_date.")
        if self.confirmation_date and self.confirmation_date < self.joining_date:
            raise ValueError("confirmation_date cannot be before joining_date.")
        if self.last_working_day and self.resignation_date and self.last_working_day < self.resignation_date:
            raise ValueError("last_working_day cannot be before resignation_date.")
        if self.status in {EmployeeStatus.RESIGNED, EmployeeStatus.TERMINATED} and not self.last_working_day:
            raise ValueError("last_working_day is required for resigned or terminated employees.")
        if self.payment_mode in {PaymentMode.BANK, PaymentMode.WPS} and not self.iban_account_number:
            raise ValueError("iban_account_number is required for Bank or WPS payment mode.")
        return self


class EmployeeCreate(EmployeeBase):
    pass


class EmployeeUpdate(EmployeeBase):
    row_version: str = Field(description="Base64 encoded SQL Server rowversion from the latest read.")


class EmployeeResponse(EmployeeBase):
    model_config = ConfigDict(from_attributes=True)

    employee_id: int
    row_version: str
    is_deleted: bool
    created_at_utc: datetime
    updated_at_utc: datetime


class EmployeeListResponse(BaseModel):
    items: list[EmployeeResponse]
    page: int
    page_size: int
    total: int


SessionDep = Annotated[Session, Depends(get_db)]


@router.get("", response_model=EmployeeListResponse)
def list_employees(
    session: SessionDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int | None, Query(ge=1, le=100)] = None,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
    department_id: Annotated[int | None, Query(ge=1)] = None,
    department: Annotated[int | None, Query(ge=1)] = None,
    status_filter: Annotated[EmployeeStatus | None, Query(alias="status")] = None,
    search: Annotated[str | None, Query(max_length=120)] = None,
) -> EmployeeListResponse:
    resolved_page_size = limit or page_size or 25
    resolved_department_id = department_id or department
    filters = [Employee.is_deleted == False]  # noqa: E712 - SQLAlchemy SQL Server BIT comparison
    if resolved_department_id is not None:
        filters.append(Employee.department_id == resolved_department_id)
    if status_filter is not None:
        filters.append(Employee.status == status_filter.value)
    if search:
        like = f"%{search.strip()}%"
        filters.append(or_(Employee.employee_code.like(like), Employee.full_name.like(like), Employee.work_email.like(like), Employee.civil_id.like(like)))

    total = session.scalar(select(func.count()).select_from(Employee).where(and_(*filters))) or 0
    rows = session.scalars(
        select(Employee)
        .where(and_(*filters))
        .order_by(Employee.employee_code.asc())
        .offset((page - 1) * resolved_page_size)
        .limit(resolved_page_size)
    ).all()
    return EmployeeListResponse(items=[to_response(row) for row in rows], page=page, page_size=resolved_page_size, total=total)


@router.get("/{emp_id}", response_model=EmployeeResponse)
def get_employee(emp_id: int, session: SessionDep) -> EmployeeResponse:
    employee = find_active_employee(session, emp_id)
    return to_response(employee)


@router.post("", response_model=EmployeeResponse, status_code=status.HTTP_201_CREATED)
def create_employee(payload: EmployeeCreate, session: SessionDep, response: Response) -> EmployeeResponse:
    ensure_unique_fields(session, payload)
    employee = Employee(**payload.model_dump(mode="python"))
    session.add(employee)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Employee unique field conflict.") from exc
    session.refresh(employee)
    response.headers["ETag"] = encode_row_version(employee.row_version)
    return to_response(employee)


@router.put("/{emp_id}", response_model=EmployeeResponse)
def update_employee(emp_id: int, payload: EmployeeUpdate, session: SessionDep, response: Response) -> EmployeeResponse:
    employee = find_active_employee(session, emp_id)
    expected = decode_row_version(payload.row_version)
    if employee.row_version != expected:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Employee was changed by another user. Refresh and retry.")

    ensure_unique_fields(session, payload, exclude_employee_id=emp_id)
    data = payload.model_dump(mode="python", exclude={"row_version"})
    for key, value in data.items():
        setattr(employee, key, value)
    employee.updated_at_utc = datetime.now(timezone.utc)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Employee unique field conflict.") from exc
    session.refresh(employee)
    response.headers["ETag"] = encode_row_version(employee.row_version)
    return to_response(employee)


@router.delete("/{emp_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_employee(emp_id: int, session: SessionDep) -> Response:
    employee = find_active_employee(session, emp_id)
    employee.is_deleted = True
    employee.status = EmployeeStatus.INACTIVE.value
    employee.updated_at_utc = datetime.now(timezone.utc)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def find_active_employee(session: Session, emp_id: int) -> Employee:
    employee = session.get(Employee, emp_id)
    if employee is None or employee.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
    return employee


def ensure_unique_fields(session: Session, payload: EmployeeBase, exclude_employee_id: int | None = None) -> None:
    checks = [(Employee.employee_code, payload.employee_code, "employee_code already exists.")]
    if payload.civil_id:
        checks.append((Employee.civil_id, payload.civil_id, "civil_id already exists."))
    if payload.passport_number:
        checks.append((Employee.passport_number, payload.passport_number, "passport_number already exists."))

    for column, value, message in checks:
        query = select(Employee.employee_id).where(column == value, Employee.is_deleted == False)  # noqa: E712
        if exclude_employee_id is not None:
            query = query.where(Employee.employee_id != exclude_employee_id)
        if session.scalar(query) is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)


def encode_row_version(value: bytes) -> str:
    return base64.b64encode(bytes(value)).decode("ascii")


def decode_row_version(value: str) -> bytes:
    try:
        return base64.b64decode(value.encode("ascii"), validate=True)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="row_version must be valid base64.") from exc


def to_response(employee: Employee) -> EmployeeResponse:
    raw = {
        "employee_id": employee.employee_id,
        "employee_code": employee.employee_code,
        "punch_machine_id": employee.punch_machine_id,
        "full_name": employee.full_name,
        "first_name": employee.first_name,
        "middle_name": employee.middle_name,
        "last_name": employee.last_name,
        "passport_name": employee.passport_name,
        "gender": employee.gender,
        "date_of_birth": employee.date_of_birth,
        "nationality": employee.nationality,
        "religion": employee.religion,
        "marital_status": employee.marital_status,
        "joining_date": employee.joining_date,
        "probation_end_date": employee.probation_end_date,
        "confirmation_date": employee.confirmation_date,
        "department_id": employee.department_id,
        "designation": employee.designation,
        "grade_level": employee.grade_level,
        "branch_id": employee.branch_id,
        "employment_type": employee.employment_type,
        "status": employee.status,
        "direct_manager_id": employee.direct_manager_id,
        "personal_email": employee.personal_email,
        "work_email": employee.work_email,
        "mobile_number": employee.mobile_number,
        "emergency_contact_name": employee.emergency_contact_name,
        "emergency_contact_phone": employee.emergency_contact_phone,
        "emergency_contact_relationship": employee.emergency_contact_relationship,
        "local_address": employee.local_address,
        "home_country_address": employee.home_country_address,
        "passport_number": employee.passport_number,
        "passport_expiry": employee.passport_expiry,
        "civil_id": employee.civil_id,
        "civil_id_expiry": employee.civil_id_expiry,
        "visa_number": employee.visa_number,
        "visa_type": employee.visa_type,
        "visa_expiry": employee.visa_expiry,
        "labour_card_number": employee.labour_card_number,
        "labour_card_expiry": employee.labour_card_expiry,
        "basic_salary": employee.basic_salary,
        "housing_allowance": employee.housing_allowance,
        "transport_allowance": employee.transport_allowance,
        "other_fixed_allowances": employee.other_fixed_allowances,
        "payment_mode": employee.payment_mode,
        "bank_name": employee.bank_name,
        "iban_account_number": employee.iban_account_number,
        "swift_code": employee.swift_code,
        "resignation_date": employee.resignation_date,
        "last_working_day": employee.last_working_day,
        "reason_for_leaving": employee.reason_for_leaving,
        "rehire_eligible": employee.rehire_eligible,
        "row_version": encode_row_version(employee.row_version),
        "is_deleted": employee.is_deleted,
        "created_at_utc": employee.created_at_utc,
        "updated_at_utc": employee.updated_at_utc,
    }
    return EmployeeResponse.model_validate(raw)


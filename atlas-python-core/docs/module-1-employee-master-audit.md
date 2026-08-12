# Module 1: Employee Master Audit and Rebuild

STATUS: GREEN — clean-room Port 3356 Employee Master artifacts exist.

ACTION: Compare legacy employee requirements against the Python + MSSQL target without carrying old UI, old code, or Year-End logic.

RED TEAM: Missing employee fields cause downstream failures in airfare allocation, loans, reporting, import, and statutory document alerts. The target schema therefore stores employee identity, job, contact, legal, salary/bank, and exit fields explicitly.

HISTORY GIT REF: Legacy employee screens/imports showed the need for employee code, department, group/pay information, legal identity, and document tracking. Legacy Year-End is excluded.

## Step 1 — Comparative Mapping Matrix

| Legacy Field Name (Port 3355) | New Field Name (Port 3356) | Data Type & Validation Constraints | Required | Audit Notes / Edge Case Safeguards |
|---|---|---|---|---|
| Employee Code / ID | EmployeeCode | `NVARCHAR(50)`, unique, non-empty | Yes | Main business key; indexed for lookup/import. |
| Punch Machine ID | PunchMachineID | `NVARCHAR(50)`, nullable | No | Kept separate from employee code to avoid attendance-device coupling. |
| Full Name | FullName | `NVARCHAR(200)`, non-empty | Yes | Display/search field. |
| First Name | FirstName | `NVARCHAR(80)`, non-empty | Yes | Required for formal identity. |
| Middle Name | MiddleName | `NVARCHAR(80)`, nullable | No | Optional. |
| Last Name | LastName | `NVARCHAR(80)`, non-empty | Yes | Required for formal identity. |
| Passport Name | PassportName | `NVARCHAR(200)`, nullable | No | Can differ from display/full name. |
| Gender | Gender | enum: Male/Female/Other/Undisclosed | Yes | Avoid free-text drift. |
| DOB | DateOfBirth | `DATE`; must be before JoiningDate | Yes | Backend validates chronology. |
| Nationality | Nationality | `NVARCHAR(80)`, non-empty | Yes | Used for statutory/travel context. |
| Religion | Religion | `NVARCHAR(80)`, nullable | No | Optional local HR field. |
| Marital Status | MaritalStatus | enum: Single/Married/Divorced/Widowed/Other | No | Nullable but controlled if present. |
| Joining Date | JoiningDate | `DATE` | Yes | Anchor for service and probation. |
| Probation End Date | ProbationEndDate | `DATE`, >= JoiningDate when present | No | Backend and DB guard chronology. |
| Confirmation Date | ConfirmationDate | `DATE`, >= JoiningDate when present | No | Backend and DB guard chronology. |
| Department | DepartmentID | `INT` FK placeholder to `core.Departments` | No | Indexed; avoids repeated text names. |
| Designation / Role | Designation | `NVARCHAR(120)`, non-empty | Yes | Required employment field. |
| Grade / Level | GradeLevel | `NVARCHAR(60)`, nullable | No | Supports allowance/payroll grouping. |
| Branch / Location | BranchID | `INT` FK placeholder to `core.Branches` | No | Normalized location scope. |
| Employment Type | EmploymentType | enum: Permanent/Contract/Probation/Temporary/Intern | Yes | Controlled values. |
| Status | Status | enum: Active/Inactive/Resigned/Terminated/OnLeave | Yes | Indexed with IsDeleted. |
| Direct Manager / Supervisor | DirectManagerID | `INT` self-FK | No | Prevents free-text manager names. |
| Personal Email | PersonalEmail | email, `NVARCHAR(254)` | No | Pydantic email validation. |
| Work Email | WorkEmail | email, `NVARCHAR(254)` | No | Pydantic email validation. |
| Mobile Number | MobileNumber | `NVARCHAR(40)` | No | Not numeric to preserve country codes. |
| Emergency Contact Name | EmergencyContactName | `NVARCHAR(160)` | No | Optional. |
| Emergency Contact Phone | EmergencyContactPhone | `NVARCHAR(40)` | No | Not numeric to preserve country codes. |
| Emergency Relationship | EmergencyContactRelationship | `NVARCHAR(80)` | No | Optional. |
| Local Address | LocalAddress | `NVARCHAR(500)` | No | Long text but bounded. |
| Permanent / Home Country Address | HomeCountryAddress | `NVARCHAR(500)` | No | Long text but bounded. |
| Passport Number | PassportNumber | `NVARCHAR(80)`, unique nullable | No | Duplicate guard. |
| Passport Expiry | PassportExpiry | `DATE` | No | Indexed through document-expiry index. |
| National ID / Civil ID | CivilID | `NVARCHAR(80)`, unique nullable | No | Duplicate guard. |
| ID Expiry | CivilIDExpiry | `DATE` | No | Document alert source. |
| Visa Number | VisaNumber | `NVARCHAR(80)` | No | Optional. |
| Visa Type | VisaType | `NVARCHAR(80)` | No | Optional. |
| Visa Expiry | VisaExpiry | `DATE` | No | Document alert source. |
| Labour Card Number | LabourCardNumber | `NVARCHAR(80)` | No | Optional. |
| Labour Card Expiry | LabourCardExpiry | `DATE` | No | Document alert source. |
| Basic Salary | BasicSalary | `DECIMAL(18,3)`, >= 0 | Yes, default 0 | Strict decimal for payroll adjacency. |
| Housing Allowance | HousingAllowance | `DECIMAL(18,3)`, >= 0 | Yes, default 0 | Stored separately, not collapsed. |
| Transport Allowance | TransportAllowance | `DECIMAL(18,3)`, >= 0 | Yes, default 0 | Stored separately. |
| Other Fixed Allowances | OtherFixedAllowances | `DECIMAL(18,3)`, >= 0 | Yes, default 0 | Stored separately. |
| Payment Mode | PaymentMode | enum: Bank/Cash/WPS | Yes | Bank/WPS requires account value in backend. |
| Bank Name | BankName | `NVARCHAR(160)` | No | Optional unless operational policy requires. |
| IBAN / Account Number | IBANAccountNumber | `NVARCHAR(80)` | Conditional | Required by backend for Bank/WPS. |
| Swift Code | SwiftCode | `NVARCHAR(40)` | No | Optional cross-border bank field. |
| Resignation Date | ResignationDate | `DATE` | No | Exit tracking only. |
| Last Working Day | LastWorkingDay | `DATE`; >= ResignationDate if both present | Conditional | Required by backend for resigned/terminated status. |
| Reason for Leaving | ReasonForLeaving | `NVARCHAR(400)` | No | Bounded text. |
| Rehire Eligible | RehireEligible | `BIT`, default 1 | Yes | Explicit flag. |
| Year-End Process | Not created | Not applicable | No | Explicitly stripped. |
| Year-End Closing | Not created | Not applicable | No | Explicitly stripped. |
| Yearly Balance Rollover | Not created | Not applicable | No | Explicitly stripped. |

## Step 2 — MSSQL Database DDL

Artifact: `C:\Airfare_Allowance\atlas-python-core\schema\mssql\Port3356_EmployeeMaster.sql`

Includes:

- `core.Departments`
- `core.Branches`
- `core.Employees`
- Primary key, unique employee/civil/passport constraints
- Department, branch, manager FK placeholders
- Status, gender, employment type, payment mode checks
- Salary non-negative checks
- Date chronology checks
- `ROWVERSION` concurrency token
- Soft-delete field
- Performance indexes on EmployeeCode, DepartmentID, Status, document expiries

## Step 3 — Python FastAPI Backend

Artifact: `C:\Airfare_Allowance\atlas-python-core\app\routers\employee.py`

Includes:

- SQLAlchemy ORM model
- Pydantic v2 schemas: `EmployeeCreate`, `EmployeeUpdate`, `EmployeeResponse`
- `GET /api/v1/employees`
- `GET /api/v1/employees/{emp_id}`
- `POST /api/v1/employees`
- `PUT /api/v1/employees/{emp_id}`
- `DELETE /api/v1/employees/{emp_id}`
- Duplicate validation for employee code, civil ID, passport number
- Optimistic concurrency with base64 SQL Server `ROWVERSION`
- Soft delete by setting `IsDeleted = 1` and `Status = Inactive`

## Step 4 — UI/UX Blueprint

Artifact: `C:\Airfare_Allowance\atlas-python-core\web\employee-master-blueprint.html`

Includes:

- Modern glass UI
- Header statistics cards
- Sticky employee data table
- Status/document badges
- Search, department, status filters
- Multi-tab employee form modal blueprint: Personal, Job Details, Identity Docs, Salary/Bank

## Step 5 — Red Team / Kill Critic Audit

| Check | Result |
|---|---|
| Zero Year-End logic | PASS |
| Complete field coverage from requested groups | PASS |
| MSSQL strict data types | PASS |
| Unique employee/civil/passport safeguards | PASS |
| Backend duplicate handling | PASS |
| Backend concurrency handling | PASS |
| Soft delete instead of destructive delete | PASS |
| Isolated from Port 3355 legacy styling/code | PASS |

BROKEN — REWRITE TARGETED if future work adds any annual close, year-end closing, or yearly rollover artifact to Employee Master.

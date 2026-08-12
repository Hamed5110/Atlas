# Port 3388 Field Parity and Clean-Room Audit

STATUS: GREEN — Port 3388 is a fresh Python + MSSQL implementation. Port 3355 is reference only. No active runtime code binds to 3355, 3356, or 3357.

## Module Parity Matrix

| Module | Legacy Reference Scope | Port 3388 Implementation | Delta / Red Team Decision |
|---|---|---|---|
| Employee Master | Personal, job, contact, identity, salary/bank, exit fields | `core.Employees`, `/api/v1/employees`, multi-tab UI form | Full enterprise field coverage retained; periodic close fields excluded. |
| Employee Bulk Import | Excel/CSV import and duplicate checks | `/api/v1/import/verify-preview`, `/api/v1/import/commit`, `core.ImportPreviewSessions` | Commit requires preview token; row-level errors before DB write. |
| Airfare Allocation | Allocation, ticket, claim, balance usage | `core.AirfareClaims`, `core.AirfareAllocationsV2`, `/api/v1/airfare/claims` | Continuous entitlement replaces periodic reset workflows. |
| Continuous Entitlement | Eligibility and balance calculations | `/api/v1/airfare/entitlement/{emp_id}?target_date=YYYY-MM-DD`, `core.vw_EmployeeAirfareEntitlement` | Balance computed from service days + seed evidence + approved claims. |
| Loans / EMI | Loan issue and deduction schedule | `core.Loans`, `core.LoanSchedules`, `/api/v1/loans`, `/api/v1/loans/amortization` | EMI calculated on request; DB stores loan state. |
| Reports Engine | Payroll/document/loan/airfare reports | `core.ReportRuns`, `/api/v1/reports/run` | Report request is audited and parameterized. |
| System Preferences & Admin | Settings and roles | `core.SystemSettings`, `core.UserRoles`, `/api/v1/admin/settings/{setting_key}` | MERGE upsert prevents duplicate setting crashes. |
| Self-Service | Employee requests | `core.SelfServiceRequestsV2`, `/api/v1/me/requests` | JSON payload validated and persisted. |
| Attachments | Document metadata | `core.DocumentMetadata`, `/api/v1/attachments/metadata` | Metadata endpoint avoids unsafe file execution. |
| Airport Search | IATA lookup and ranking | `core.Airports`, `/api/v1/airports?q=BAH` | Ranked SQL lookup by exact/prefix/contains score. |
| Backup / Audit | Backup queue and audit | `core.BackupJobs`, `core.AuditLogs`, `/api/v1/admin/backups` | Request is queued/auditable; no hidden destructive restore. |

## Employee Master Field Matrix

| Group | Field | Port 3388 DB Column | API Field | Constraint |
|---|---|---|---|---|
| Primary Identification | Employee Code | EmployeeCode | employee_code | Required, unique, NVARCHAR(50) |
| Primary Identification | Punch Machine ID | PunchMachineID | punch_machine_id | Optional, NVARCHAR(50) |
| Primary Identification | Full Name | FullName | full_name | Required, NVARCHAR(200) |
| Primary Identification | First Name | FirstName | first_name | Required, NVARCHAR(80) |
| Primary Identification | Middle Name | MiddleName | middle_name | Optional, NVARCHAR(80) |
| Primary Identification | Last Name | LastName | last_name | Required, NVARCHAR(80) |
| Primary Identification | Passport Name | PassportName | passport_name | Optional, NVARCHAR(200) |
| Primary Identification | Gender | Gender | gender | Required enum: Male/Female/Other/Undisclosed |
| Primary Identification | DOB | DateOfBirth | date_of_birth | Required DATE, before joining date |
| Primary Identification | Nationality | Nationality | nationality | Required, NVARCHAR(80) |
| Primary Identification | Religion | Religion | religion | Optional, NVARCHAR(80) |
| Primary Identification | Marital Status | MaritalStatus | marital_status | Optional enum |
| Job | Joining Date | JoiningDate | joining_date | Required DATE |
| Job | Probation End | ProbationEndDate | probation_end_date | Optional DATE >= joining |
| Job | Confirmation Date | ConfirmationDate | confirmation_date | Optional DATE >= joining |
| Job | Department | DepartmentID | department_id | Optional FK |
| Job | Designation | Designation | designation | Required, NVARCHAR(120) |
| Job | Grade / Level | GradeLevel | grade_level | Optional, NVARCHAR(60) |
| Job | Branch / Location | BranchID | branch_id | Optional FK |
| Job | Employment Type | EmploymentType | employment_type | Required enum |
| Job | Status | Status | status | Required enum, defaults Active |
| Job | Direct Manager | DirectManagerID | direct_manager_id | Optional self-FK |
| Contact | Personal Email | PersonalEmail | personal_email | Optional email |
| Contact | Work Email | WorkEmail | work_email | Optional email |
| Contact | Mobile Number | MobileNumber | mobile_number | Optional, NVARCHAR(40) |
| Contact | Emergency Contact Name | EmergencyContactName | emergency_contact_name | Optional |
| Contact | Emergency Contact Phone | EmergencyContactPhone | emergency_contact_phone | Optional |
| Contact | Emergency Contact Relationship | EmergencyContactRelationship | emergency_contact_relationship | Optional |
| Contact | Local Address | LocalAddress | local_address | Optional NVARCHAR(MAX/500 API) |
| Contact | Home Country Address | HomeCountryAddress | home_country_address | Optional NVARCHAR(MAX/500 API) |
| Identity | Passport Number | PassportNumber | passport_number | Optional, unique when present |
| Identity | Passport Expiry | PassportExpiry | passport_expiry | Optional DATE |
| Identity | Civil ID | CivilID | civil_id | Optional, unique when present |
| Identity | Civil ID Expiry | CivilIDExpiry | civil_id_expiry | Optional DATE |
| Identity | Visa Number | VisaNumber | visa_number | Optional |
| Identity | Visa Type | VisaType | visa_type | Optional |
| Identity | Visa Expiry | VisaExpiry | visa_expiry | Optional DATE |
| Identity | Labour Card Number | LabourCardNumber | labour_card_number | Optional |
| Identity | Labour Card Expiry | LabourCardExpiry | labour_card_expiry | Optional DATE |
| Salary / Bank | Basic Salary | BasicSalary | basic_salary | DECIMAL(18,3), >= 0 |
| Salary / Bank | Housing Allowance | HousingAllowance | housing_allowance | DECIMAL(18,3), >= 0 |
| Salary / Bank | Transport Allowance | TransportAllowance | transport_allowance | DECIMAL(18,3), >= 0 |
| Salary / Bank | Other Fixed Allowance | OtherFixedAllowances | other_fixed_allowances | DECIMAL(18,3), >= 0 |
| Salary / Bank | Payment Mode | PaymentMode | payment_mode | Required enum Bank/Cash/WPS |
| Salary / Bank | Bank Name | BankName | bank_name | Optional |
| Salary / Bank | IBAN / Account | IBANAccountNumber | iban_account_number | Required for Bank/WPS |
| Salary / Bank | Swift Code | SwiftCode | swift_code | Optional |
| Exit | Resignation Date | ResignationDate | resignation_date | Optional DATE |
| Exit | Last Working Day | LastWorkingDay | last_working_day | Required if resigned/terminated |
| Exit | Reason for Leaving | ReasonForLeaving | reason_for_leaving | Optional |
| Exit | Rehire Eligible | RehireEligible | rehire_eligible | BIT default 1 |

## Hard Exclusion

Periodic close, yearly rollover, and batch reset workflows are not represented in Port 3388 schema, routers, service startup, or UI. Continuous entitlement is computed from service days, seed evidence, approved claims, and policy rate.

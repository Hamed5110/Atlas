# ATLAS 3388 Clean-Room Comparison Report

## Status

GREEN — Port 3355 was used only as a read-only behavior reference. Port 3388 is a separate Python + MSSQL application using database `AtlasPythonCore3388`.

## Hard exclusions

- No Year-End screen.
- No yearly rollover workflow.
- No batch close process.
- No legacy port binding to 3355, 3356, or 3357.
- No reuse of legacy frontend code or styling.

## Employee Master parity

| Legacy behavior reference | Port 3388 implementation | Status |
|---|---|---|
| Employee code / employee number | `core.Employees.EmployeeCode`, unique, required | Covered |
| Punch / machine ID | `core.Employees.PunchMachineID` | Covered |
| Full name and split names | FullName, FirstName, MiddleName, LastName, PassportName | Covered |
| Gender, DOB, nationality, religion, marital status | Typed Pydantic validation + MSSQL columns | Covered |
| Joining/probation/confirmation | Date validation prevents invalid chronology | Covered |
| Department, branch, designation, grade, manager | Normalized Department/Branch FK support + direct manager FK | Covered |
| Contact and emergency fields | Email, mobile, emergency contact, local/home address | Covered |
| Legal document fields | Passport, civil ID, visa, labour card numbers/expiry | Covered |
| Salary and bank fields | Basic, housing, transport, other allowances, payment mode, bank, IBAN, SWIFT | Covered |
| Exit tracking | Resignation date, last working day, reason, rehire flag | Covered |
| Soft delete | `IsDeleted` + status update | Covered |

## Reports comparison

| Legacy 3355 behavior reference | Problem in legacy model | Port 3388 clean-room replacement |
|---|---|---|
| `sp_ATLAS_GetAirfareReport` returned employee airfare report rows | Mixed annual/year-bound entitlement assumptions with report output | `/api/v1/reports/run` returns `AirfareUtilization` rows using continuous accrual and claims/seeds |
| Employee master report/grid | Legacy schemas had broad employee columns but uneven validation | `PayrollSummary` and Employee Master APIs share typed Employee model |
| Department/cost summaries | Report logic was coupled to old master views | `DepartmentCosting` groups live `core.Employees` fixed compensation |
| Expiry review | Document expiry existed as scattered fields | `DocumentExpiry` reports passport/civil ID/visa/labour card dates from one master table |
| Loan reports | Legacy report references loan values inside airfare views | `LoanBalances` reads `core.Loans` directly |

## Port 3388 report endpoints

`POST /api/v1/reports/run`

Supported report codes:

- `AirfareUtilization`
- `PayrollSummary`
- `DepartmentCosting`
- `DocumentExpiry`
- `LoanBalances`

Response now includes:

- `reportRunId`
- `status`
- `reportCode`
- `parameters`
- `summary`
- `rows`

## Database auto-creation proof

Validated with temporary database `AtlasPythonCore3388_AutoCreateProof`:

- Database did not need to exist before run.
- Migration created the database.
- Schema file `Port3388_Complete_Schema.sql` applied successfully.
- Seed data inserted.
- Verification passed: 13 tables, 8 indexes, 12 foreign keys.
- Temporary proof database was dropped after validation.

## Red team result

The previous broken state was not a formula problem. It was a startup sequencing problem:

1. UI loaded.
2. API attempted DB work.
3. DB was missing or schema not ready.
4. API returned `500 Database operation failed`.

Fix applied:

- FastAPI lifespan now runs the migration/seed verification before serving requests.
- Direct `app.server` / EXE startup now has the same database safety as the batch/installer path.


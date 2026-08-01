# ATLAS Patch Breakage Red-Team Verification Plan

Date: 2026-08-01  
Scope: post-patch failures reported after manifest-driven patch `2.3.87`, with fix path through `2.3.88`.

## Direct diagnosis

### `/preferences?fiscalYear=2026` returns 404

Most likely root cause: patch `2.3.87` did not contain the route-based Preferences static page. In this repository, the fixed route exists at:

```text
atlas-hcm-next/app/(dashboard)/preferences/page.tsx
atlas-hcm-next/out/preferences/index.html
```

Local verification after the `2.3.88` build:

```powershell
Invoke-WebRequest http://127.0.0.1:3355/preferences?fiscalYear=2026 -UseBasicParsing
```

Expected: HTTP `200`, HTML containing `Preferences` / `Settings Command Center`.

If the installed machine still returns `404`, check these in order:

1. Installed frontend output:
   ```powershell
   Test-Path "C:\Program Files\ATLAS Airfare Allowance\atlas-hcm-next\out\preferences\index.html"
   ```
   If false, the frontend artifact is old or partially patched.

2. Runtime version:
   ```powershell
   Invoke-RestMethod http://127.0.0.1:3355/api/version
   ```
   Required fields must match the release manifest: `version`, `gitCommit`, `frontendBuildHash`, `backendBuildHash`, `databaseSchemaVersion`.

3. Server fallback:
   `server.js` must serve `atlas-hcm-next/out` through `express.static` and fallback non-file frontend routes to `index.html`.

4. Patch history:
   ```powershell
   Get-Content "C:\ProgramData\ATLAS Airfare Allowance\patch-history.json" -Raw
   Get-Content "C:\ProgramData\ATLAS Airfare Allowance\pending-patch.json" -Raw
   ```
   If `pending-patch.json` exists after restart, treat the patch as incomplete.

### Missing old Global Settings / Airfare Rate section

Truth: Airfare/Rate configuration is business configuration and must remain MSSQL-backed. It should not live inside UI-only Preferences.

Correct current API:

```text
GET  /api/airfare-policy-rates
POST /api/airfare-policy-rates
GET  /api/airfare-policy-rates/:policyRateId/references
DELETE /api/airfare-policy-rates/:policyRateId
POST /api/airfare-policy-rates/:policyRateId/delete
POST /api/airfare-policy-rates/bulk-delete
```

Correct MSSQL objects:

```sql
SELECT TOP (50)
    PolicyRateID,
    CompanyID,
    EmployeeID,
    Department,
    EmpGroup,
    EffectiveFrom,
    EffectiveTo,
    MaxPayoutAmount,
    CycleDays,
    PerDayRate,
    IsActive,
    IsDeleted,
    PolicyStatus
FROM dbo.AirfarePolicyRates
ORDER BY IsActive DESC, EffectiveFrom DESC, PolicyRateID DESC;

EXEC dbo.sp_ATLAS_GetEffectiveAirfarePolicy
    @AllocationDate = '2026-06-18',
    @CompanyID = NULL,
    @EmployeeID = NULL;
```

UI placement:

- Preferences route should own app/user settings: theme, density, workspace, notifications, keyboard, diagnostics visibility.
- Airfare rate/policy settings should remain a business card/panel backed by `/api/airfare-policy-rates`.
- If shown from Preferences, it must be a clearly labeled “Airfare policy settings” section that calls the policy API, not the preferences API.

## Loan module triage

Likely failure points after a patch:

1. Frontend calling stale or renamed API paths.
2. Request/response shape mismatch: UI expects `LoanID`, `RemainingBalance`, `EMI`, `MonthsPaid`, `Status`; SQL/API returns missing/null/renamed fields.
3. Migration not applied: code expects procedures or columns that do not exist.
4. Duplicate submits: settlement, EMI run, defer, restructure called twice.
5. SQL state mismatch: UI filters active loans differently than `sp_ATLAS_GetLoanRegister`.

Core APIs to verify:

```text
GET  /api/loans/register
GET  /api/loans/register?status=active
GET  /api/loans/summary
GET  /api/loans/:id
GET  /api/loans/:id/history
POST /api/loans
PUT  /api/loans/:id
POST /api/loans/run-emis/preview
POST /api/loans/run-emis
POST /api/loans/reverse-emis/preview
POST /api/loans/reverse-emis
POST /api/loans/:id/settle
POST /api/loans/:id/defer
POST /api/loans/:id/restructure
DELETE /api/loans/:id
```

MSSQL objects to verify:

```sql
SELECT OBJECT_ID(N'dbo.Loans', N'U') AS LoansTable;
SELECT OBJECT_ID(N'dbo.LoanHistory', N'U') AS LoanHistoryTable;
SELECT OBJECT_ID(N'dbo.sp_ATLAS_GetLoanRegister', N'P') AS GetLoanRegisterProc;
SELECT OBJECT_ID(N'dbo.sp_ATLAS_GetLoanSummary', N'P') AS GetLoanSummaryProc;
SELECT OBJECT_ID(N'dbo.sp_ATLAS_CreateManualLoan', N'P') AS CreateManualLoanProc;
SELECT OBJECT_ID(N'dbo.sp_ATLAS_RunMonthlyLoanEMI', N'P') AS RunMonthlyLoanEmiProc;
SELECT OBJECT_ID(N'dbo.sp_ATLAS_SettleLoan', N'P') AS SettleLoanProc;
SELECT OBJECT_ID(N'dbo.sp_ATLAS_DeferLoan', N'P') AS DeferLoanProc;
SELECT OBJECT_ID(N'dbo.sp_ATLAS_RestructureLoanEMI', N'P') AS RestructureLoanProc;

EXEC dbo.sp_ATLAS_GetLoanRegister @Status = NULL;
EXEC dbo.sp_ATLAS_GetLoanSummary;

SELECT TOP (50)
    LoanID,
    EmployeeID,
    AllocationID,
    OriginalAmount,
    RemainingBalance,
    EMI,
    Tenure,
    MonthsPaid,
    TotalPaid,
    Status,
    DeferMonths,
    DeferStart,
    SettledDate
FROM dbo.Loans
ORDER BY LoanID DESC;
```

Manual API examples:

```powershell
$login = Invoke-RestMethod http://127.0.0.1:3355/api/auth/login -Method Post -ContentType application/json -Body '{"username":"<admin>","password":"<password>"}'
$h = @{ Authorization = "Bearer $($login.token)"; "X-Session-Id" = $login.sessionId }
Invoke-RestMethod http://127.0.0.1:3355/api/loans/register -Headers $h
Invoke-RestMethod http://127.0.0.1:3355/api/loans/summary -Headers $h
Invoke-RestMethod http://127.0.0.1:3355/api/loans/run-emis/preview -Method Post -Headers $h -ContentType application/json -Body '{"paymentDate":"2026-08-01","loanIds":[]}'
```

## Full screen/API matrix

| Area | Frontend route/view | APIs | MSSQL truth source | Success | Known failure statuses |
|---|---|---|---|---|---|
| Overview | `/` | `/api/reports/airfare-payable`, `/api/intelligence/*` | `Employees`, `Allocations`, `Loans`, policy procedures | 200 with metrics matching SQL aggregates | 401/403 auth, 429 rate limit, 500 SQL |
| Employees | `/` Employees view | `/api/employees`, `/api/employees/:id`, import endpoints | `Employees`, `OpeningBalances`, related FK counts | list/detail/import preview load | 400 bad import, 409/422 validation, 500 SQL |
| Opening Balance | `/` Opening Balance view | `/api/opening-balances`, `/api/opening-loan-balances` | `OpeningBalances`, `OpeningLoanBalances` | year-scoped rows match SQL | 400 invalid year, 403 role, 500 proc |
| Airfare / Rate config | `/` Airfare/Preferences policy panel | `/api/airfare-policy-rates` | `AirfarePolicyRates`, `sp_ATLAS_GetEffectiveAirfarePolicy` | active policy shown equals effective SQL row | 403 role, 409 references, 422 invalid policy |
| Self-Service | `/` Self-Service view | `/api/employee-self-service/*` | self-service extension tables/claims | employee-scoped data only | 403 role scope, 409 duplicate claim |
| Loans | `/` Loans view | `/api/loans/*` | `Loans`, `LoanHistory`, loan procedures | register/summary/action results match SQL | 400 invalid body, 403 role, 409 state conflict, 500 missing proc |
| Year End | `/` Year End view | `/api/year-end/preview/:year`, `/api/year-end/close`, `/api/year-end/history` | `YearEndHistory`, `OpeningBalances`, `OpeningLoanBalances` | preview is read-only and close is audited | 400 invalid year, 409 already closed, 500 migration |
| Reports | `/` Reports view | `/api/reports/*` | report queries over `Employees`, `Allocations`, `Loans` | exported rows equal direct SQL count/sums | 401/403/500 |
| Preferences | `/preferences?fiscalYear=2026` | `/api/preferences` | `UserPreferences.PreferencesJSON` + split legacy columns | route 200, GET/PUT 2xx, no 429 burst | 404 missing static export, 401 auth, 422 invalid JSON |
| Support / Diagnostics | `/` Support/Diagnostics view | `/api/health`, `/api/version`, `/api/diagnostics/*` | SQL connectivity + runtime manifest | version/hash/schema match manifest | 429 support limit, 500 SQL |

## MSSQL-backed configuration validation

Run these after every patch:

```sql
-- Runtime schema evidence expected by /api/version
SELECT DB_NAME() AS DatabaseName;

-- Airfare policy must come from SQL
SELECT COUNT(*) AS PolicyRows FROM dbo.AirfarePolicyRates;
EXEC dbo.sp_ATLAS_GetEffectiveAirfarePolicy @AllocationDate = '2026-08-01', @CompanyID = NULL, @EmployeeID = NULL;

-- Preferences must come from SQL for persisted settings
SELECT TOP (20)
    UserID,
    SelectedCompanyID,
    FiscalYear,
    ISJSON(PreferencesJSON) AS IsPreferencesJson,
    UpdatedAt
FROM dbo.UserPreferences
ORDER BY UpdatedAt DESC;

-- Loan data must come from SQL
EXEC dbo.sp_ATLAS_GetLoanRegister @Status = NULL;
EXEC dbo.sp_ATLAS_GetLoanSummary;
```

Red-team rule: if a UI value affects payroll/business behavior and cannot be traced to a table/procedure, the patch is not verified.

## Automation

Safe post-patch smoke:

```powershell
$env:ATLAS_APP_BASE_URL="http://127.0.0.1:3355"
$env:ATLAS_EXPECTED_VERSION="2.3.88"
$env:ATLAS_TEST_USERNAME="<admin>"
$env:ATLAS_TEST_PASSWORD="<password>"
npm run test:post-patch-smoke
```

Source/artifact route guard:

```powershell
npm run test:preferences-route
npm run test:preferences-api
npm run test:release-manifest
```

Full verification:

```powershell
npm run check
npm run test:full
npm --prefix .\atlas-hcm-next test
npm --prefix .\atlas-hcm-next run build
```

## Go / no-go

Declare the patch verified only if:

- `/api/version` matches the target manifest version, git commit, frontend hash, backend hash, and database schema version.
- `/preferences?fiscalYear=2026` returns 200 on the installed machine.
- `GET /api/airfare-policy-rates` returns rows from MSSQL or a valid empty array.
- `GET /api/loans/register` and `GET /api/loans/summary` match direct SQL counts/sums.
- `GET /api/preferences` and one idempotent `PUT /api/preferences` succeed without 429 bursts.
- `pending-patch.json` does not exist after restart.
- `patch-history.json` records the applied version and migration actions.

Trigger rollback/repair if:

- frontend hash in `/api/version` does not match the artifact manifest;
- `/preferences` is 404 after restart;
- required SQL migration verification fails, especially `UserPreferences.PreferencesJSON`;
- loan stored procedures are missing or throw during read-only register/summary calls;
- backend updated but frontend still serves the old build.

Rollback record should include:

```json
{
  "version": "2.3.88",
  "status": "rolledBack",
  "reason": "frontend hash mismatch or preferences route 404",
  "failedAtUtc": "2026-08-01T00:00:00Z",
  "failedChecks": ["/preferences", "/api/version.frontendBuildHash"],
  "rollbackSource": "pending-patch.json"
}
```

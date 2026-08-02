# ATLAS Year End Removal - Phase 0 to Phase 1 Executable Spec

Date: 2026-08-02
Scope: first reversible implementation slice for continuous airfare entitlement, running beside the existing Year End process.

## Truth-mode boundary

This phase must not remove, disable, rename, or change production Year End behavior.

This phase only adds:

- feature flags, default OFF;
- additive MSSQL objects from `database/ContinuousAirfareEntitlement_Blueprint.sql`;
- idempotent seed/backfill scripts;
- read-only entitlement balance and reconciliation APIs;
- optional admin-only Migration Debug / Reconciliation UI;
- tests proving legacy behavior remains untouched.

If any change needs a data restore instead of a flag flip or one-commit revert, it is not Phase 0-1.

## Phase 0-1 scope

### In scope

1. Configuration and flags.
2. Additive DB schema for continuous entitlement.
3. Read-only balance computation.
4. Idempotent seed/backfill into new continuous tables only.
5. Read-only compare endpoint: legacy balance vs continuous balance.
6. Admin-only, flag-guarded reconciliation view.
7. Contract/source tests for flags, SQL safety, and API shapes.

### Explicitly out of scope

- no deletion of Year End UI;
- no disabling `/api/year-end/close`;
- no change to `OpeningBalances`, `OpeningLoanBalances`, `YearEndHistory`, `YearEndEmployeeSnapshots`, or existing Year End stored procedures;
- no automatic writes from allocations into continuous entitlement yet;
- no payroll-impacting entitlement source switch;
- no report source switch.

## Feature flags and config

Use `ATLAS_` prefixed server env vars and map them into a single config object.

### Server env vars

```env
ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_BACKFILL=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI=false
```

Phase 0-1 defaults:

| Flag | Default | Phase 0-1 behavior |
|---|---:|---|
| `ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT` | `false` | gates all new API routes |
| `ATLAS_ENABLE_CONTINUOUS_AIRFARE_BACKFILL` | `false` | allows explicit admin backfill script/API only in test/staging |
| `ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION` | `false` | gates compare endpoint and UI |
| `ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES` | `false` | must remain false in Phase 0-1 |
| `ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI` | `false` | gates admin-only frontend panel |

### `server.js` config sketch

```js
function readBooleanEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

const config = {
  flags: {
    ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT: readBooleanEnv("ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT", false),
    ENABLE_CONTINUOUS_AIRFARE_BACKFILL: readBooleanEnv("ATLAS_ENABLE_CONTINUOUS_AIRFARE_BACKFILL", false),
    ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION: readBooleanEnv("ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION", false),
    ENABLE_CONTINUOUS_AIRFARE_WRITES: readBooleanEnv("ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES", false),
    ENABLE_CONTINUOUS_AIRFARE_UI: readBooleanEnv("ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI", false),
  },
};

function requireFeatureFlag(flagName, res) {
  if (config.flags[flagName]) return true;
  res.status(404).json({
    code: "FEATURE_DISABLED",
    feature: flagName,
    message: "Continuous airfare entitlement is disabled on this installation.",
  });
  return false;
}
```

### `/api/version` addition

Expose flags as read-only feature capabilities, not raw secrets.

```json
{
  "product": "ATLAS Airfare Allowance",
  "version": "2.3.89",
  "gitCommit": "resolved-at-build-time",
  "databaseSchemaVersion": "2026.08.02.001",
  "features": {
    "continuousAirfareEntitlement": false,
    "continuousAirfareReconciliation": false,
    "continuousAirfareWrites": false,
    "continuousAirfareUi": false
  }
}
```

Red-team rule: frontend must not infer feature enablement from local storage. It must use `/api/version` or a server-fed config payload.

## Database schema additions

Phase 0-1 should apply the additive parts of `database/ContinuousAirfareEntitlement_Blueprint.sql`:

### Tables

- `dbo.EmployeeAirfareEntitlementPlans`
- `dbo.EmployeeAirfarePlanEnrollments`
- `dbo.EmployeeAirfareTransactions`
- `dbo.EmployeeAirfareBalances`
- `dbo.PayrollPeriodLocks`

### View

- `dbo.vw_ATLAS_AirfareEntitlementBalanceAsOf`

### Stored procedures

- `dbo.sp_ATLAS_GetAirfareEntitlementBalance`
- `dbo.sp_ATLAS_PreviewAirfareEntitlementReset`
- `dbo.sp_ATLAS_ApplyAirfareTransaction`

### Minimum indexes and constraints

- `UQ_EmployeeAirfareEntitlementPlans_Code`
- `IX_EmployeeAirfarePlanEnrollments_Employee_Active`
- `IX_EmployeeAirfareTransactions_AsOf`
- `UQ_EmployeeAirfareBalances`
- `UQ_PayrollPeriodLocks`
- JSON checks on `PolicyJSON` and `PolicySnapshotJSON`
- transaction type check for `accrual`, `usage`, `payout`, `adjustment`, `carryover`, `forfeiture`, `reversal`

### Required non-destructive checks

Migration script must not contain:

```sql
DROP TABLE dbo.OpeningBalances
DROP TABLE dbo.OpeningLoanBalances
DROP TABLE dbo.YearEndHistory
DROP TABLE dbo.YearEndEmployeeSnapshots
DROP PROCEDURE dbo.sp_ATLAS_GetYearEndPreview
```

No existing Year End table or stored procedure is dropped or altered in this phase.

## Phase 0-1 DB migration file

Create:

```text
database/migrations/2026.08.02_add_continuous_airfare_entitlement_phase1.sql
```

The file should either contain the relevant additive blueprint SQL or invoke the same checked-in content during release packaging. It must end with an object verification SELECT:

```sql
SELECT
    OBJECT_ID(N'dbo.EmployeeAirfareEntitlementPlans', N'U') AS HasPlans,
    OBJECT_ID(N'dbo.EmployeeAirfarePlanEnrollments', N'U') AS HasEnrollments,
    OBJECT_ID(N'dbo.EmployeeAirfareTransactions', N'U') AS HasTransactions,
    OBJECT_ID(N'dbo.EmployeeAirfareBalances', N'U') AS HasBalances,
    OBJECT_ID(N'dbo.PayrollPeriodLocks', N'U') AS HasPayrollLocks,
    OBJECT_ID(N'dbo.sp_ATLAS_GetAirfareEntitlementBalance', N'P') AS HasBalanceProc,
    OBJECT_ID(N'dbo.sp_ATLAS_PreviewAirfareEntitlementReset', N'P') AS HasResetPreviewProc,
    OBJECT_ID(N'dbo.sp_ATLAS_ApplyAirfareTransaction', N'P') AS HasApplyTransactionProc;
```

## Idempotent backfill and seed strategy

Backfill is allowed only when explicitly run by admin/operator in test/staging first. It writes only to new continuous tables.

### Parameters

```sql
DECLARE @CutoverDate DATE = '2026-01-01';
DECLARE @FiscalYear INT = YEAR(@CutoverDate);
DECLARE @CreatedBy INT = NULL;
```

### Seed plans from policy rates

```sql
DECLARE @CutoverDate DATE = '2026-01-01';
DECLARE @CreatedBy INT = NULL;

INSERT INTO dbo.EmployeeAirfareEntitlementPlans (
    PlanCode,
    PlanName,
    CompanyID,
    EffectiveFrom,
    AccrualRule,
    AccrualAmount,
    AccrualFrequency,
    ResetRule,
    ResetMonth,
    ResetDay,
    CarryOverRule,
    CarryOverCapAmount,
    PayoutRule,
    PolicyJSON,
    CreatedBy
)
SELECT
    CONCAT(N'PHASE1_POLICY_', COALESCE(CONVERT(NVARCHAR(20), pr.CompanyID), N'GLOBAL')),
    CONCAT(N'Phase 1 Airfare Policy ', COALESCE(CONVERT(NVARCHAR(20), pr.CompanyID), N'Global')),
    pr.CompanyID,
    @CutoverDate,
    N'lump_sum',
    MAX(COALESCE(pr.MaxPayoutAmount, pr.Amount, 0)),
    N'annual',
    N'calendar_year',
    1,
    1,
    N'none',
    0,
    N'manual_approval',
    CONCAT(N'{"source":"Phase 0-1 backfill","cutoverDate":"', CONVERT(NVARCHAR(10), @CutoverDate, 126), N'"}'),
    @CreatedBy
FROM dbo.AirfarePolicyRates pr
WHERE ISNULL(pr.IsDeleted, 0) = 0
GROUP BY pr.CompanyID
HAVING NOT EXISTS (
    SELECT 1
    FROM dbo.EmployeeAirfareEntitlementPlans existing
    WHERE existing.PlanCode = CONCAT(N'PHASE1_POLICY_', COALESCE(CONVERT(NVARCHAR(20), pr.CompanyID), N'GLOBAL'))
);
```

If `AirfarePolicyRates.Amount` does not exist in the local schema, remove that fallback and use `MaxPayoutAmount`. This is intentionally called out because older ATLAS installs have had policy-rate schema drift.

### Seed enrollments from active employees

```sql
DECLARE @CutoverDate DATE = '2026-01-01';
DECLARE @CreatedBy INT = NULL;

INSERT INTO dbo.EmployeeAirfarePlanEnrollments (
    PlanID,
    EmployeeID,
    CompanyID,
    EnrollmentStart,
    Status,
    EligibilityDate,
    ContractStartDate,
    CreatedBy
)
SELECT
    p.PlanID,
    e.EmployeeID,
    p.CompanyID,
    COALESCE(e.JoinDate, @CutoverDate),
    N'active',
    e.JoinDate,
    e.JoinDate,
    @CreatedBy
FROM dbo.Employees e
JOIN dbo.EmployeeAirfareEntitlementPlans p
  ON p.IsActive = 1
 AND p.EffectiveFrom <= @CutoverDate
 AND (
      p.CompanyID IS NULL
      OR p.CompanyID = TRY_CONVERT(INT, NULLIF(e.CompanyID, N''))
 )
WHERE ISNULL(e.Status, N'active') = N'active'
  AND NOT EXISTS (
      SELECT 1
      FROM dbo.EmployeeAirfarePlanEnrollments existing
      WHERE existing.PlanID = p.PlanID
        AND existing.EmployeeID = e.EmployeeID
        AND existing.Status = N'active'
  );
```

If local `Employees.CompanyID` is numeric already, remove `TRY_CONVERT`. If the schema only has `Employees.Company`, join through `Companies`.

### Seed carryover from existing opening balances

```sql
DECLARE @CutoverDate DATE = '2026-01-01';
DECLARE @FiscalYear INT = YEAR(@CutoverDate);
DECLARE @CreatedBy INT = NULL;

INSERT INTO dbo.EmployeeAirfareTransactions (
    PlanID,
    EnrollmentID,
    EmployeeID,
    CompanyID,
    TransactionDate,
    FiscalYear,
    PeriodCode,
    TransactionType,
    Amount,
    Days,
    SourceModule,
    SourceID,
    PolicySnapshotJSON,
    Description,
    CreatedBy
)
SELECT
    en.PlanID,
    en.EnrollmentID,
    ob.EmployeeID,
    en.CompanyID,
    @CutoverDate,
    @FiscalYear,
    CONCAT(@FiscalYear, N'-OPEN'),
    N'carryover',
    COALESCE(ob.OpeningBHD, 0),
    ob.OpeningDays,
    N'OpeningBalances',
    ob.OpeningBalanceID,
    CONCAT(N'{"source":"OpeningBalances","cutoverDate":"', CONVERT(NVARCHAR(10), @CutoverDate, 126), N'"}'),
    N'Phase 0-1 legacy opening balance comparison seed',
    @CreatedBy
FROM dbo.OpeningBalances ob
JOIN dbo.EmployeeAirfarePlanEnrollments en
  ON en.EmployeeID = ob.EmployeeID
WHERE ob.BalanceYear = @FiscalYear
  AND COALESCE(ob.OpeningBHD, 0) <> 0
  AND NOT EXISTS (
      SELECT 1
      FROM dbo.EmployeeAirfareTransactions existing
      WHERE existing.SourceModule = N'OpeningBalances'
        AND existing.SourceID = ob.OpeningBalanceID
        AND existing.TransactionType = N'carryover'
        AND existing.IsReversal = 0
  );
```

### Seed usage from existing allocations

```sql
DECLARE @CutoverDate DATE = '2026-01-01';
DECLARE @FiscalYear INT = YEAR(@CutoverDate);
DECLARE @CreatedBy INT = NULL;

INSERT INTO dbo.EmployeeAirfareTransactions (
    PlanID,
    EnrollmentID,
    EmployeeID,
    CompanyID,
    TransactionDate,
    FiscalYear,
    PeriodCode,
    TransactionType,
    Amount,
    SourceModule,
    SourceID,
    PolicySnapshotJSON,
    Description,
    CreatedBy
)
SELECT
    en.PlanID,
    en.EnrollmentID,
    a.EmployeeID,
    en.CompanyID,
    COALESCE(a.AllocationDate, DATEFROMPARTS(a.AllocYear, 1, 1)),
    a.AllocYear,
    FORMAT(COALESCE(a.AllocationDate, DATEFROMPARTS(a.AllocYear, 1, 1)), N'yyyy-MM'),
    N'usage',
    COALESCE(a.Entitlement, a.CompanyPaid, 0),
    N'Allocations',
    a.AllocationID,
    CONCAT(N'{"source":"Allocations","cutoverDate":"', CONVERT(NVARCHAR(10), @CutoverDate, 126), N'"}'),
    N'Phase 0-1 legacy allocation comparison seed',
    @CreatedBy
FROM dbo.Allocations a
JOIN dbo.EmployeeAirfarePlanEnrollments en
  ON en.EmployeeID = a.EmployeeID
WHERE a.AllocYear = @FiscalYear
  AND COALESCE(a.Entitlement, a.CompanyPaid, 0) > 0
  AND NOT EXISTS (
      SELECT 1
      FROM dbo.EmployeeAirfareTransactions existing
      WHERE existing.SourceModule = N'Allocations'
        AND existing.SourceID = a.AllocationID
        AND existing.TransactionType = N'usage'
        AND existing.IsReversal = 0
  );
```

## New API endpoints

All routes are added to `server.js`. All are read-only in Phase 0-1 except an optional admin-only manual transaction sketch, which must stay disabled while `ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES=false`.

### `GET /api/airfare/entitlement/balance`

Purpose: read continuous balance only.

Query:

```text
employeeId=123
companyId=1
asOfDate=2026-12-31
```

Response:

```json
{
  "mode": "continuous-readonly",
  "asOfDate": "2026-12-31",
  "rows": [
    {
      "employeeId": 123,
      "companyId": 1,
      "planId": 10,
      "planName": "Phase 1 Airfare Policy 1",
      "accruedAmount": 150,
      "usedAmount": 80,
      "carryOverAmount": 0,
      "remainingAmount": 70
    }
  ]
}
```

Errors:

- `404 FEATURE_DISABLED` when `ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT=false`.
- `400 VALIDATION_ERROR` for invalid date or IDs.
- `503 SQL_OBJECT_MISSING` if proc/table is not installed.

Handler sketch:

```js
app.get("/api/airfare/entitlement/balance", authenticateToken, async (req, res) => {
  if (!requireFeatureFlag("ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT", res)) return;

  const startedAt = Date.now();
  const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  const asOfDate = String(req.query.asOfDate || "").trim();

  if (!asOfDate || Number.isNaN(Date.parse(asOfDate))) {
    return res.status(400).json({ code: "VALIDATION_ERROR", field: "asOfDate", message: "asOfDate is required in YYYY-MM-DD format." });
  }
  if (employeeId !== null && (!Number.isInteger(employeeId) || employeeId <= 0)) {
    return res.status(400).json({ code: "VALIDATION_ERROR", field: "employeeId", message: "employeeId must be a positive integer." });
  }

  const pool = await getPool();
  const result = await pool.request()
    .input("EmployeeID", sql.Int, employeeId)
    .input("CompanyID", sql.Int, companyId)
    .input("AsOfDate", sql.Date, asOfDate)
    .execute("dbo.sp_ATLAS_GetAirfareEntitlementBalance");

  logger.info("continuous airfare balance read", {
    employeeId,
    companyId,
    asOfDate,
    rowCount: result.recordset.length,
    elapsedMs: Date.now() - startedAt,
  });

  res.json({ mode: "continuous-readonly", asOfDate, rows: result.recordset });
});
```

### `GET /api/airfare/entitlement/reconciliation`

Purpose: compare legacy and continuous balances for admin migration debug.

Query:

```text
companyId=1
employeeId=123
asOfDate=2026-12-31
tolerance=0.010
```

Response:

```json
{
  "mode": "migration-reconciliation",
  "asOfDate": "2026-12-31",
  "tolerance": 0.01,
  "summary": {
    "checked": 25,
    "matched": 24,
    "mismatched": 1,
    "missingContinuous": 0
  },
  "rows": [
    {
      "employeeId": 123,
      "employeeCode": "E001",
      "legacyRemaining": 70,
      "continuousRemaining": 70,
      "difference": 0,
      "status": "MATCH",
      "notes": "Within tolerance"
    }
  ]
}
```

Errors:

- `404 FEATURE_DISABLED` when entitlement or reconciliation flag is OFF.
- `403 FORBIDDEN` if user is not admin.
- `400 VALIDATION_ERROR` for invalid date/IDs.

Handler sketch:

```js
app.get("/api/airfare/entitlement/reconciliation", authenticateToken, requireAdmin, async (req, res) => {
  if (!requireFeatureFlag("ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT", res)) return;
  if (!requireFeatureFlag("ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION", res)) return;

  const startedAt = Date.now();
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
  const asOfDate = String(req.query.asOfDate || "").trim();
  const tolerance = req.query.tolerance ? Number(req.query.tolerance) : 0.01;

  if (!asOfDate || Number.isNaN(Date.parse(asOfDate))) {
    return res.status(400).json({ code: "VALIDATION_ERROR", field: "asOfDate", message: "asOfDate is required in YYYY-MM-DD format." });
  }

  const pool = await getPool();
  const result = await pool.request()
    .input("CompanyID", sql.Int, companyId)
    .input("EmployeeID", sql.Int, employeeId)
    .input("AsOfDate", sql.Date, asOfDate)
    .input("Tolerance", sql.Decimal(12, 4), tolerance)
    .query(`
      DECLARE @FiscalYear INT = YEAR(@AsOfDate);
      ;WITH Legacy AS (
        SELECT
          e.EmployeeID,
          MAX(e.EmployeeCode) AS EmployeeCode,
          SUM(COALESCE(ob.OpeningBHD, 0)) AS OpeningAmount,
          SUM(COALESCE(a.Entitlement, 0)) AS UsedAmount
        FROM dbo.Employees e
        LEFT JOIN dbo.OpeningBalances ob
          ON ob.EmployeeID = e.EmployeeID
         AND ob.BalanceYear = @FiscalYear
        LEFT JOIN dbo.Allocations a
          ON a.EmployeeID = e.EmployeeID
         AND a.AllocYear = @FiscalYear
        WHERE (@EmployeeID IS NULL OR e.EmployeeID = @EmployeeID)
          AND (@CompanyID IS NULL OR TRY_CONVERT(INT, NULLIF(e.CompanyID, N'')) = @CompanyID)
        GROUP BY e.EmployeeID
      ),
      Continuous AS (
        SELECT
          EmployeeID,
          SUM(RemainingAmount) AS ContinuousRemaining
        FROM dbo.vw_ATLAS_AirfareEntitlementBalanceAsOf
        WHERE (@EmployeeID IS NULL OR EmployeeID = @EmployeeID)
          AND (@CompanyID IS NULL OR CompanyID = @CompanyID)
        GROUP BY EmployeeID
      )
      SELECT
        l.EmployeeID,
        l.EmployeeCode,
        CAST(l.OpeningAmount - l.UsedAmount AS DECIMAL(12,2)) AS LegacyRemaining,
        CAST(COALESCE(c.ContinuousRemaining, 0) AS DECIMAL(12,2)) AS ContinuousRemaining,
        CAST((l.OpeningAmount - l.UsedAmount) - COALESCE(c.ContinuousRemaining, 0) AS DECIMAL(12,2)) AS Difference,
        CASE
          WHEN ABS((l.OpeningAmount - l.UsedAmount) - COALESCE(c.ContinuousRemaining, 0)) <= @Tolerance THEN N'MATCH'
          WHEN c.EmployeeID IS NULL THEN N'MISSING_CONTINUOUS'
          ELSE N'MISMATCH_REVIEW'
        END AS Status,
        CASE
          WHEN ABS((l.OpeningAmount - l.UsedAmount) - COALESCE(c.ContinuousRemaining, 0)) <= @Tolerance THEN N'Within tolerance'
          WHEN c.EmployeeID IS NULL THEN N'Employee has legacy data but no continuous seed rows'
          ELSE N'Review opening balance, allocation usage, and policy snapshot'
        END AS Notes
      FROM Legacy l
      LEFT JOIN Continuous c ON c.EmployeeID = l.EmployeeID
      ORDER BY ABS((l.OpeningAmount - l.UsedAmount) - COALESCE(c.ContinuousRemaining, 0)) DESC;
    `);

  const rows = result.recordset;
  const summary = rows.reduce((acc, row) => {
    acc.checked += 1;
    if (row.Status === "MATCH") acc.matched += 1;
    else if (row.Status === "MISSING_CONTINUOUS") acc.missingContinuous += 1;
    else acc.mismatched += 1;
    return acc;
  }, { checked: 0, matched: 0, mismatched: 0, missingContinuous: 0 });

  logger.warn("continuous airfare reconciliation read", {
    companyId,
    employeeId,
    asOfDate,
    tolerance,
    ...summary,
    elapsedMs: Date.now() - startedAt,
  });

  res.json({ mode: "migration-reconciliation", asOfDate, tolerance, summary, rows });
});
```

### `GET /api/airfare/entitlement/preview-reset`

Purpose: read-only preview of reset/carryover/forfeiture. Do not apply anything in Phase 0-1.

Query:

```text
companyId=1
resetDate=2026-12-31
```

Response:

```json
{
  "mode": "continuous-reset-preview-readonly",
  "resetDate": "2026-12-31",
  "rows": [
    {
      "employeeId": 123,
      "currentRemainingAmount": 70,
      "carryOverAmount": 0,
      "forfeitureAmount": 70
    }
  ]
}
```

### `POST /api/airfare/entitlement/transaction`

Do not enable this route in Phase 0-1. If it exists for future work, it must return disabled while writes are OFF:

```json
{
  "code": "FEATURE_DISABLED",
  "feature": "ENABLE_CONTINUOUS_AIRFARE_WRITES",
  "message": "Continuous airfare writes are disabled in Phase 0-1."
}
```

HTTP status should be `404` or `423 Locked`; prefer `404` if hiding unfinished feature surface from clients.

## Minimal frontend integration

File: `atlas-hcm-next/app/page.tsx`

Do not add another large `activeView` branch if avoidable. For Phase 0-1, the least risky UI slice is an admin-only card inside Diagnostics or Preferences named:

```text
Migration Debug / Reconciliation
```

Visibility conditions:

- user role is admin/system admin;
- `/api/version.features.continuousAirfareUi === true`;
- `/api/version.features.continuousAirfareReconciliation === true`.

Card fields:

- Company selector.
- Employee optional selector/search.
- As-of date.
- Tolerance.
- "Run comparison" button.

Table columns:

- Employee code.
- Legacy Airfare Balance.
- Continuous Airfare Balance.
- Difference.
- Status.
- Notes.

Hard UI copy:

```text
Read-only migration comparison. This does not change Year End, Opening Balances, loans, allocations, or payroll results.
```

Red-team UI rule: do not place this beside normal employee payroll workflows. It must look like a migration/debug tool, not an operational balance source.

## Focused test plan

### New test file

```text
tests/airfare-entitlement-phase1.test.js
```

### New script

```json
{
  "test:airfare-entitlement-phase1": "node tests/airfare-entitlement-phase1.test.js"
}
```

### Contract/source tests

1. Flags exist in docs/spec and implementation:
   - `ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT`
   - `ATLAS_ENABLE_CONTINUOUS_AIRFARE_BACKFILL`
   - `ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION`
   - `ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES`
   - `ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI`
2. Flags default OFF.
3. New routes are gated by feature flags.
4. No existing Year End route contract is changed:
   - `/api/year-end/preview/:year`
   - `/api/year-end/close`
   - `/api/year-end/history`
5. SQL blueprint remains additive:
   - no `DROP TABLE`;
   - no `TRUNCATE TABLE`;
   - no destructive edits to `OpeningBalances`, `OpeningLoanBalances`, `YearEndHistory`, `YearEndEmployeeSnapshots`.

### SQL procedure tests

Run on test DB seeded with known employees and policies:

1. `sp_ATLAS_GetAirfareEntitlementBalance`
   - no transactions -> empty result;
   - one carryover BHD 150 -> remaining BHD 150;
   - carryover BHD 150 + usage BHD 80 -> remaining BHD 70;
   - as-of date before usage -> remaining BHD 150;
   - company filter excludes other company rows.
2. `sp_ATLAS_PreviewAirfareEntitlementReset`
   - carryover rule `none` -> all remaining becomes forfeiture;
   - carryover rule `cap_amount` with cap 50 and remaining 70 -> carryover 50, forfeiture 20.
3. `sp_ATLAS_ApplyAirfareTransaction`
   - duplicate SourceModule + SourceID + TransactionType returns original row;
   - locked payroll period throws 53004;
   - invalid JSON throws 53003.

### API tests

1. Flag OFF:
   - `GET /api/airfare/entitlement/balance` returns `404 FEATURE_DISABLED`.
   - `GET /api/airfare/entitlement/reconciliation` returns `404 FEATURE_DISABLED`.
2. Flag ON:
   - invalid `asOfDate` returns `400 VALIDATION_ERROR`.
   - valid balance request executes `sp_ATLAS_GetAirfareEntitlementBalance`.
   - reconciliation request returns summary fields: `checked`, `matched`, `mismatched`, `missingContinuous`.
3. Writes OFF:
   - `POST /api/airfare/entitlement/transaction` returns disabled.

### Integration tests

Use a seeded test DB:

| Scenario | Legacy setup | Continuous seed | Expected |
|---|---|---|---|
| Match | opening 150, allocation 80 | carryover 150, usage 80 | difference 0 |
| Missing continuous | opening 150, allocation 80 | no seed | `MISSING_CONTINUOUS` |
| Usage mismatch | opening 150, allocation 80 | carryover 150, usage 70 | `MISMATCH_REVIEW`, difference -10 |
| As-of before allocation | opening 150, allocation after date | carryover 150, usage after date | remaining 150 |

### Manual smoke checklist

- Existing Year End preview still loads.
- Existing Year End close button still exists.
- Existing opening balance create/edit/delete still works.
- Existing allocation create/edit still works.
- Existing loans screen still loads.
- Existing reports still export.
- New reconciliation UI is invisible to non-admin users.
- New reconciliation UI is invisible when UI flag is OFF.

## Rollback and safety

### Rollback steps

1. Set all continuous flags OFF.
2. Restart the app service.
3. Confirm `/api/version.features.continuousAirfareEntitlement=false`.
4. Confirm new API routes return `FEATURE_DISABLED`.
5. Keep new tables/procs in place unless DBA specifically requests cleanup.
6. Revert the Phase 0-1 commit if code rollback is required.

Optional DBA cleanup in non-production only:

```sql
-- Non-production cleanup only, never part of normal app rollback:
-- DROP PROCEDURE dbo.sp_ATLAS_GetAirfareEntitlementBalance;
-- DROP PROCEDURE dbo.sp_ATLAS_PreviewAirfareEntitlementReset;
-- DROP PROCEDURE dbo.sp_ATLAS_ApplyAirfareTransaction;
```

Production rollback should not drop tables because they may contain audit-worthy comparison evidence.

### Pre-deploy safety checks

- migration script runs cleanly twice in test DB;
- backfill script runs cleanly twice and row counts do not increase on second run;
- no write happens to legacy Year End tables during backfill;
- new APIs return disabled with flags OFF;
- new APIs return read-only data with flags ON;
- existing Year End safety tests remain green;
- release manifest bumps `databaseSchemaVersion`;
- `/api/version` reports the expected database schema version and feature states.

## Monitoring and diagnostics

Log each new API call with:

- route;
- user ID;
- employee ID if provided;
- company ID if provided;
- as-of/reset date;
- flag state;
- row count;
- elapsed milliseconds.

Warn when:

- reconciliation mismatch count > 0;
- absolute difference > BHD 0.010;
- SQL object missing;
- query time > 2000 ms;
- continuous write endpoint is called while writes are disabled.

Diagnostics card:

```json
{
  "continuousAirfareEntitlement": {
    "enabled": false,
    "schemaInstalled": true,
    "lastReconciliationAt": null,
    "lastMismatchCount": null,
    "writesEnabled": false
  }
}
```

## Implementation checklist

1. Add server feature flags in `server.js`.
2. Add `/api/version.features` entries.
3. Add migration file `database/migrations/2026.08.02_add_continuous_airfare_entitlement_phase1.sql`.
4. Add idempotent backfill script `database/migrations/2026.08.02_seed_continuous_airfare_entitlement_phase1.sql`.
5. Run migration twice in test DB.
6. Run seed twice in test DB and verify row counts remain stable.
7. Add read-only API routes:
   - `GET /api/airfare/entitlement/balance`
   - `GET /api/airfare/entitlement/reconciliation`
   - `GET /api/airfare/entitlement/preview-reset`
8. Add disabled placeholder for future write route only if needed:
   - `POST /api/airfare/entitlement/transaction`
9. Add admin-only Migration Debug / Reconciliation UI behind server feature flags.
10. Add `tests/airfare-entitlement-phase1.test.js`.
11. Add `npm run test:airfare-entitlement-phase1`.
12. Run:
    - `npm run test:continuous-entitlement`
    - `npm run test:year-end-removal-plan`
    - `npm run test:airfare-entitlement-phase1`
    - `npm run test:year-end-safety`
13. Deploy to staging with flags OFF.
14. Turn ON entitlement/reconciliation/UI in staging only.
15. Record discrepancies before any production rollout.

## Red-team critique

### Balance miscompute risks

- Policy-rate schema drift can seed wrong plan amounts. Mitigation: run policy seed preview query first and require row count/amount review.
- Employee-company joins are historically inconsistent. Mitigation: reconciliation must classify `MISSING_CONTINUOUS` separately from value mismatch.
- As-of date logic can overcount if the view does not filter by date. Mitigation: APIs should call `sp_ATLAS_GetAirfareEntitlementBalance` with `@AsOfDate`, not only the view.
- Allocation amount choice can be wrong if `Entitlement` and `CompanyPaid` mean different things in some installs. Mitigation: document the selected source field and verify with sample employees.

### Feature-flag leak risks

- Frontend-only flags can expose unfinished UI. Mitigation: server gates every API route.
- Default ON env mistakes can alter behavior. Mitigation: default OFF and test `/api/version`.
- A future developer may use continuous balances in dashboard early. Mitigation: contract test should fail if dashboard/report code references continuous procs before Phase 3.

### DB/performance risks

- Large `Allocations` backfill can lock under load. Mitigation: run in batches by fiscal year/company in maintenance windows.
- Missing indexes can make reconciliation slow. Mitigation: require `IX_EmployeeAirfareTransactions_AsOf` and company/employee filters.
- `FORMAT()` in SQL is slower on large datasets. Mitigation: acceptable for one-time seed; for production backfill, replace with deterministic string concatenation.

### Smaller safer slice if needed

If Phase 0-1 is still too large, split it:

1. Phase 0A: flags + `/api/version` + SQL object install only.
2. Phase 0B: read-only balance API only.
3. Phase 1A: seed/backfill in staging.
4. Phase 1B: reconciliation API/UI.

Do not build preview-reset until balance and reconciliation are trusted.

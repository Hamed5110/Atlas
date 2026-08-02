# ATLAS Continuous Airfare Entitlement Execution and Validation Runbook

Date: 2026-08-02
Purpose: implement Phase 0-1 safely, validate legacy-vs-continuous balances, and provide the roadmap through final Year End airfare close removal.

Source artifacts:

- `database/ContinuousAirfareEntitlement_Blueprint.sql`
- `docs/YEAR_END_CLOSE_REMOVAL_MIGRATION_PLAN.md`
- `docs/YEAR_END_PHASE_0_1_EXECUTABLE_SPEC.md`
- `tests/continuous-entitlement-blueprint.test.js`
- `tests/year-end-removal-migration-plan.test.js`
- `tests/airfare-entitlement-phase1.test.js`

## Non-negotiable operating rule

No production Year End behavior changes in Phase 0-1.

The first executable slice builds continuous entitlement beside legacy Year End. It must let ATLAS compare balances without changing opening balances, loans, allocation behavior, reports, diagnostics, company deletion guards, or Year End close behavior.

## Part 1 - Phase 0-1 implementation guide

### 1. Feature flags and config

Add server-side flags in `server.js`. Use `ATLAS_` env vars so installer and support config are explicit.

```env
ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_BACKFILL=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI=false
```

Internal config shape:

```js
const config = {
  flags: {
    ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT: readBooleanEnv("ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT", false),
    ENABLE_CONTINUOUS_AIRFARE_BACKFILL: readBooleanEnv("ATLAS_ENABLE_CONTINUOUS_AIRFARE_BACKFILL", false),
    ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION: readBooleanEnv("ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION", false),
    ENABLE_CONTINUOUS_AIRFARE_WRITES: readBooleanEnv("ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES", false),
    ENABLE_CONTINUOUS_AIRFARE_UI: readBooleanEnv("ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI", false),
  },
};
```

Implementation sketch:

```js
function readBooleanEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

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

Expose the safe feature state through `/api/version`:

```json
{
  "product": "ATLAS Airfare Allowance",
  "version": "2.3.89",
  "gitCommit": "build-commit",
  "databaseSchemaVersion": "2026.08.02.001",
  "features": {
    "continuousAirfareEntitlement": false,
    "continuousAirfareBackfill": false,
    "continuousAirfareReconciliation": false,
    "continuousAirfareWrites": false,
    "continuousAirfareUi": false
  }
}
```

Frontend rule: `app/page.tsx` must not use local storage or hardcoded booleans to reveal migration UI. It must read the server feature state and also enforce admin role visibility.

### 2. Database changes

Create a migration file:

```text
database/migrations/2026.08.02_add_continuous_airfare_entitlement_phase1.sql
```

Use the additive objects from `database/ContinuousAirfareEntitlement_Blueprint.sql`.

Tables:

- `dbo.EmployeeAirfareEntitlementPlans`
- `dbo.EmployeeAirfarePlanEnrollments`
- `dbo.EmployeeAirfareTransactions`
- `dbo.EmployeeAirfareBalances`
- `dbo.PayrollPeriodLocks`

View:

- `dbo.vw_ATLAS_AirfareEntitlementBalanceAsOf`

Stored procedures:

- `dbo.sp_ATLAS_GetAirfareEntitlementBalance`
- `dbo.sp_ATLAS_PreviewAirfareEntitlementReset`
- `dbo.sp_ATLAS_ApplyAirfareTransaction`

Minimum constraints and indexes:

- `UQ_EmployeeAirfareEntitlementPlans_Code`
- `IX_EmployeeAirfarePlanEnrollments_Employee_Active`
- `IX_EmployeeAirfareTransactions_AsOf`
- `UQ_EmployeeAirfareBalances`
- `UQ_PayrollPeriodLocks`
- JSON checks on plan and transaction snapshots
- transaction type CHECK constraint
- foreign keys from transactions/enrollments/balances to plans

Hard SQL safety checks:

Phase 0-1 must not contain any destructive operation against legacy Year End objects. Forbidden changes include dropping, truncating, or altering `OpeningBalances`, `OpeningLoanBalances`, `YearEndHistory`, `YearEndEmployeeSnapshots`, or existing Year End stored procedures such as `sp_ATLAS_GetYearEndPreview`.

Object verification at the end of the migration:

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

### 3. Backfill and seed scripts

Create:

```text
database/migrations/2026.08.02_seed_continuous_airfare_entitlement_phase1.sql
```

The seed writes only to continuous tables. It must be safe to rerun.

Parameters:

```sql
DECLARE @CutoverDate DATE = '2026-01-01';
DECLARE @FiscalYear INT = YEAR(@CutoverDate);
DECLARE @CreatedBy INT = NULL;
```

#### 3.1 Seed entitlement plans from policy config

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
    MAX(COALESCE(pr.MaxPayoutAmount, 0)),
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

If a target database does not have `AirfarePolicyRates.MaxPayoutAmount`, stop and map the local policy amount column first. Do not guess the allowance field.

#### 3.2 Enroll eligible employees

Prefer `Employees.CompanyID` when present. If the installed schema only has company names/codes, join through `Companies`.

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
      OR p.CompanyID = TRY_CONVERT(INT, NULLIF(CONVERT(NVARCHAR(30), e.CompanyID), N''))
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

#### 3.3 Seed starting balances from legacy opening balances

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

#### 3.4 Seed usage from legacy allocations

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

Rerun safety:

- plan seed uses `PlanCode` existence check;
- enrollment seed checks `PlanID + EmployeeID + active status`;
- carryover seed checks `OpeningBalances + OpeningBalanceID + carryover`;
- usage seed checks `Allocations + AllocationID + usage`;
- legacy tables are read only.

### 4. Backend API implementation

Add new routes below existing auth middleware setup in `server.js`. Do not edit existing Year End routes except for optional shared helper extraction.

#### 4.1 `GET /api/airfare/entitlement/balance`

```js
app.get("/api/airfare/entitlement/balance", authenticateToken, async (req, res) => {
  if (!requireFeatureFlag("ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT", res)) return;

  const startedAt = Date.now();
  const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  const asOfDate = String(req.query.asOfDate || "").trim();

  if (!asOfDate || Number.isNaN(Date.parse(asOfDate))) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      field: "asOfDate",
      message: "asOfDate is required in YYYY-MM-DD format.",
    });
  }
  if (employeeId !== null && (!Number.isInteger(employeeId) || employeeId <= 0)) {
    return res.status(400).json({ code: "VALIDATION_ERROR", field: "employeeId" });
  }
  if (companyId !== null && (!Number.isInteger(companyId) || companyId <= 0)) {
    return res.status(400).json({ code: "VALIDATION_ERROR", field: "companyId" });
  }

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("EmployeeID", sql.Int, employeeId)
      .input("CompanyID", sql.Int, companyId)
      .input("AsOfDate", sql.Date, asOfDate)
      .execute("dbo.sp_ATLAS_GetAirfareEntitlementBalance");

    logger.info("continuous airfare balance read", {
      userId: req.user?.id,
      employeeId,
      companyId,
      asOfDate,
      rowCount: result.recordset.length,
      elapsedMs: Date.now() - startedAt,
    });

    res.json({
      mode: "continuous-readonly",
      asOfDate,
      rows: result.recordset,
    });
  } catch (error) {
    logger.error("continuous airfare balance failed", { error: error.message });
    res.status(500).json({ code: "CONTINUOUS_AIRFARE_BALANCE_FAILED", message: "Failed to read continuous airfare balance." });
  }
});
```

#### 4.2 `GET /api/airfare/entitlement/preview-reset`

```js
app.get("/api/airfare/entitlement/preview-reset", authenticateToken, requireAdmin, async (req, res) => {
  if (!requireFeatureFlag("ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT", res)) return;

  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  const resetDate = String(req.query.resetDate || "").trim();
  if (!resetDate || Number.isNaN(Date.parse(resetDate))) {
    return res.status(400).json({ code: "VALIDATION_ERROR", field: "resetDate" });
  }

  const pool = await getPool();
  const result = await pool.request()
    .input("CompanyID", sql.Int, companyId)
    .input("ResetDate", sql.Date, resetDate)
    .execute("dbo.sp_ATLAS_PreviewAirfareEntitlementReset");

  res.json({
    mode: "continuous-reset-preview-readonly",
    resetDate,
    rows: result.recordset,
  });
});
```

#### 4.3 `GET /api/airfare/entitlement/reconciliation`

```js
app.get("/api/airfare/entitlement/reconciliation", authenticateToken, requireAdmin, async (req, res) => {
  if (!requireFeatureFlag("ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT", res)) return;
  if (!requireFeatureFlag("ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION", res)) return;

  const startedAt = Date.now();
  const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  const asOfDate = String(req.query.asOfDate || "").trim();
  const tolerance = req.query.tolerance ? Number(req.query.tolerance) : 0.01;

  if (!asOfDate || Number.isNaN(Date.parse(asOfDate))) {
    return res.status(400).json({ code: "VALIDATION_ERROR", field: "asOfDate" });
  }

  const pool = await getPool();
  const result = await pool.request()
    .input("EmployeeID", sql.Int, employeeId)
    .input("CompanyID", sql.Int, companyId)
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
          WHEN ABS((l.OpeningAmount - l.UsedAmount) - COALESCE(c.ContinuousRemaining, 0)) <= @Tolerance THEN N'OK'
          WHEN c.EmployeeID IS NULL THEN N'MISSING_CONTINUOUS'
          ELSE N'INVESTIGATE'
        END AS Status,
        CASE
          WHEN ABS((l.OpeningAmount - l.UsedAmount) - COALESCE(c.ContinuousRemaining, 0)) <= @Tolerance THEN N'Within tolerance'
          WHEN c.EmployeeID IS NULL THEN N'Legacy balance exists but continuous seed is missing'
          ELSE N'Review opening balance, allocation usage, policy, and employee-company mapping'
        END AS Notes
      FROM Legacy l
      LEFT JOIN Continuous c ON c.EmployeeID = l.EmployeeID
      ORDER BY ABS((l.OpeningAmount - l.UsedAmount) - COALESCE(c.ContinuousRemaining, 0)) DESC;
    `);

  const rows = result.recordset;
  const summary = rows.reduce((acc, row) => {
    acc.checked += 1;
    if (row.Status === "OK") acc.ok += 1;
    else acc.investigate += 1;
    return acc;
  }, { checked: 0, ok: 0, investigate: 0 });

  logger.warn("continuous airfare reconciliation", {
    userId: req.user?.id,
    employeeId,
    companyId,
    asOfDate,
    tolerance,
    ...summary,
    elapsedMs: Date.now() - startedAt,
  });

  res.json({
    mode: "migration-reconciliation",
    asOfDate,
    tolerance,
    summary,
    rows,
  });
});
```

#### 4.4 Future write route remains disabled

Route:

```text
POST /api/airfare/entitlement/transaction
```

```js
app.post("/api/airfare/entitlement/transaction", authenticateToken, requireAdmin, async (req, res) => {
  if (!requireFeatureFlag("ENABLE_CONTINUOUS_AIRFARE_WRITES", res)) return;
  res.status(501).json({
    code: "NOT_IMPLEMENTED_IN_PHASE_0_1",
    message: "Continuous airfare writes are not implemented in Phase 0-1.",
  });
});
```

### 5. Frontend reconciliation UI

Preferred file:

```text
atlas-hcm-next/app/components/AirfareEntitlementReconciliation.tsx
```

If the app still has most UI in `atlas-hcm-next/app/page.tsx`, import the component and mount it inside an admin-only Diagnostics or Preferences section. Do not add a new broad `activeView` branch unless the UI has already been split into route modules.

Visibility:

```tsx
const canShowEntitlementDebug =
  currentUser?.role === "admin" &&
  versionInfo?.features?.continuousAirfareUi === true &&
  versionInfo?.features?.continuousAirfareReconciliation === true;
```

UI layout:

- title: `Airfare Entitlement - Migration Debug`
- warning text: `Read-only comparison. This does not change Year End, Opening Balances, loans, allocations, reports, or payroll results.`
- filters:
  - company
  - optional employee
  - as-of date
  - tolerance
- table:
  - employee code
  - `Legacy Airfare Balance`
  - `Continuous Airfare Balance`
  - `Difference`
  - status: `OK`, `MISSING_CONTINUOUS`, `INVESTIGATE`
  - notes
- export:
  - CSV export of currently loaded rows

UI red-team rule: normal users must never see two balances. It will create payroll confusion.

### 6. Phase 0-1 implementation checklist

1. Add flags and `readBooleanEnv` helper to `server.js`.
2. Add `/api/version.features` entries.
3. Add migration file for additive continuous entitlement objects.
4. Add seed/backfill file for plans, enrollments, carryover, and usage.
5. Run schema migration twice in test DB.
6. Run seed twice in test DB and prove second run does not increase seeded rows.
7. Add read-only API routes.
8. Add disabled write route only if future clients need a stable placeholder.
9. Add admin-only reconciliation component or card.
10. Add tests:
    - source/contract tests;
    - SQL procedure tests;
    - API flag tests;
    - integration reconciliation tests.
11. Run:
    - `npm run test:continuous-entitlement`
    - `npm run test:year-end-removal-plan`
    - `npm run test:airfare-entitlement-phase1`
    - `npm run test:year-end-safety`
12. Deploy staging with all continuous flags OFF.
13. Turn ON only:
    - `ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT=true`
    - `ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION=true`
    - `ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI=true`
14. Keep writes OFF.
15. Export reconciliation report and classify every mismatch.

## Part 2 - Validation and reconciliation strategy

### Test suite expansion

Extend or add:

```text
tests/airfare-entitlement-phase1.test.js
tests/airfare-phase1-integration.test.js
```

Add script:

```json
{
  "test:airfare-phase1-integration": "node tests/airfare-phase1-integration.test.js"
}
```

### Stored procedure test cases

`sp_ATLAS_GetAirfareEntitlementBalance`:

- employee has no continuous transactions -> no rows;
- carryover 150 as of Jan 1 -> remaining 150;
- carryover 150 plus usage 80 as of Dec 31 -> remaining 70;
- as-of date before usage -> remaining 150;
- multiple employees return isolated balances;
- company filter excludes rows from other companies.

`sp_ATLAS_PreviewAirfareEntitlementReset`:

- carryover rule `none` -> remaining becomes forfeiture;
- carryover cap 50 with remaining 70 -> carryover 50, forfeiture 20;
- no active plan -> no row;
- company filter is honored.

`sp_ATLAS_ApplyAirfareTransaction`:

- duplicate source returns existing row;
- invalid transaction type throws 53001;
- negative amount throws 53002;
- invalid JSON throws 53003;
- locked period throws 53004.

### API tests

Flag OFF:

- balance route returns `404 FEATURE_DISABLED`;
- reconciliation route returns `404 FEATURE_DISABLED`;
- preview-reset route returns `404 FEATURE_DISABLED`;
- transaction route returns disabled.

Flag ON:

- invalid date returns `400 VALIDATION_ERROR`;
- invalid ID returns `400 VALIDATION_ERROR`;
- valid balance request returns `mode=continuous-readonly`;
- reconciliation returns `summary.checked`, `summary.ok`, `summary.investigate`;
- non-admin reconciliation request returns `403`.

Regression tests:

- `/api/year-end/preview/:year` remains unchanged;
- `/api/year-end/close` remains unchanged;
- `/api/year-end/history` remains unchanged;
- opening balance APIs remain unchanged.

### Reconciliation SQL/report

Create a stored procedure in a later implementation patch or use the inline query first:

```sql
CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_ReconcileLegacyVsContinuousAirfare
    @CompanyID INT = NULL,
    @EmployeeID INT = NULL,
    @AsOfDate DATE,
    @Tolerance DECIMAL(12,4) = 0.010
AS
BEGIN
    SET NOCOUNT ON;

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
            WHEN ABS((l.OpeningAmount - l.UsedAmount) - COALESCE(c.ContinuousRemaining, 0)) <= @Tolerance THEN N'OK'
            WHEN c.EmployeeID IS NULL THEN N'MISSING_CONTINUOUS'
            ELSE N'INVESTIGATE'
        END AS Status
    FROM Legacy l
    LEFT JOIN Continuous c ON c.EmployeeID = l.EmployeeID
    ORDER BY ABS((l.OpeningAmount - l.UsedAmount) - COALESCE(c.ContinuousRemaining, 0)) DESC;
END;
```

Expose as:

- admin-only UI report;
- CSV export from the reconciliation card;
- optional support diagnostics attachment for staging validation.

### Phase 0-1 pass criteria

Phase 0-1 is done and safe only when:

- all new source/contract tests pass;
- SQL migration runs twice without error;
- seed/backfill runs twice without duplicate row growth;
- existing Year End safety tests pass;
- existing Year End UI and APIs are unchanged with flags OFF;
- reconciliation is produced for all active employees in staging;
- every mismatch above BHD 0.010 is classified;
- rollback is tested by flipping flags OFF and confirming routes hide/disable;
- support runbook includes the meaning of `OK`, `MISSING_CONTINUOUS`, and `INVESTIGATE`.

## Part 3 - Phase 0-1 red-team review

| Risk | Likelihood | Impact | Detection | Mitigation |
|---|---:|---:|---|---|
| DB performance from reconciliation on large data | medium | high | elapsedMs logs, SQL duration, timeout alerts | required indexes, company/date filters, batch exports |
| Feature flag leakage exposes debug UI | medium | medium | UI smoke as normal user, `/api/version` check | server-gated APIs plus admin role gate |
| Wrong employee-company mapping | high | high | `MISSING_CONTINUOUS` and mismatch rows | classify separately; fix mapping before writes |
| Policy amount seed uses wrong column | medium | high | plan seed preview, sample employee review | stop if policy schema drift exists |
| Admin confusion from two balances | high | medium | support tickets, UI feedback | hard "read-only migration" copy; admin-only surface |
| `vw_ATLAS_AirfareEntitlementBalanceAsOf` overcounts as-of date | medium | high | date-bound proc tests | use stored proc for date-specific balance |
| Seed script locks production tables | medium | high | blocking/session monitoring | staging first, maintenance window, company/year batches |

Smaller safer slice if Phase 0-1 feels too aggressive:

1. Phase 0A: flags plus `/api/version` only.
2. Phase 0B: schema install only.
3. Phase 1A: balance API only, no preview-reset.
4. Phase 1B: seed/backfill in staging only.
5. Phase 1C: reconciliation UI/export.

Strong recommendation: do not implement preview-reset before balance/reconciliation is trusted.

## Part 4 - High-level roadmap for Phases 2-5

### Phase 2 - Continuous writes and reset preview/apply

What changes:

- enable controlled continuous writes for accruals, allocation usage, adjustments, reset preview, and reset apply;
- write via `sp_ATLAS_ApplyAirfareTransaction`;
- keep idempotency by `SourceModule + SourceID + TransactionType`;
- add reset apply that writes carryover/forfeiture transactions, not destructive updates.

What stays:

- legacy Year End close remains functional;
- legacy reports remain source of truth unless explicitly comparing;
- legacy audit tables remain unchanged.

Entry criteria:

- Phase 0-1 reconciliation is green or every mismatch is classified;
- write idempotency tests pass;
- payroll period lock tests pass;
- staging rollback by flag has been proven.

Exit criteria:

- duplicate submit cannot create duplicate transactions;
- preview vs apply rows match;
- allocation usage writes match allocation records;
- reset apply writes reversible/reversal-friendly transactions;
- no unexplained delta above BHD 0.010 in agreed test set.

Major risks:

- duplicate accruals inflate balances;
- reset apply becomes a hidden Year End clone;
- locked periods are bypassed.

Mitigation:

- unique source hash/idempotency checks;
- payroll lock enforcement;
- reversal transactions instead of deletes;
- keep legacy close enabled until Phase 4.

### Phase 3 - Switch calculations and reports

What changes:

- dashboards and new reports read continuous entitlement;
- allocation eligibility reads continuous balance;
- reports become date-range/as-of based;
- legacy Year End preview no longer drives new calculations.

What stays:

- legacy tables/procs remain read-only audit support;
- Year End close API remains emergency fallback until Phase 4.

Entry criteria:

- Phase 2 writes are stable for N payroll periods;
- reconciliation report is green for active companies;
- report outputs validated by payroll/HR users.

Exit criteria:

- all active reports use continuous source;
- dashboard numbers match continuous balance procs;
- support can explain every remaining legacy-vs-continuous difference;
- no material discrepancy for N consecutive periods.

Major risks:

- dashboard/report mismatch causes payroll distrust;
- old report export still uses legacy balance;
- allocation eligibility changes too early.

Mitigation:

- report source contract tests;
- side-by-side staging exports;
- phased feature flag for reports: `ATLAS_ENABLE_CONTINUOUS_AIRFARE_REPORTS`.

### Phase 4 - Disable Year End close UI/API

What changes:

- hide or remove "Close Airfare Year" UI;
- `/api/year-end/close` returns `410 Gone` with `YEAR_END_CLOSE_DEPRECATED`;
- Year End screen becomes `Legacy Year End Archive` if retained.

What stays:

- `YearEndHistory` read-only;
- `YearEndEmployeeSnapshots` read-only;
- archive exports;
- company deletion audit guard remains.

Entry criteria:

- continuous calculations and reports are source of truth;
- Phase 3 has passed N consecutive periods;
- rollback plan is documented;
- support and HR comms are ready.

Exit criteria:

- no UI close actions are visible;
- direct close API call returns 410;
- history export works;
- continuous model works end-to-end after close disabled.

Major risks:

- hidden client still calls close API;
- user cannot access historical close evidence;
- emergency rollback needed during payroll cycle.

Mitigation:

- API telemetry for blocked close attempts;
- keep read-only history;
- disable by flags first before deleting code.

### Phase 5 - Retire legacy active paths after audit retention

What changes:

- remove active production references to legacy close procs;
- mark legacy objects deprecated;
- archive or drop only with DBA/audit approval after retention;
- simplify UI and support docs.

What stays:

- final continuous entitlement model;
- audit export access;
- historical records in archive or read-only tables.

Entry criteria:

- Phase 4 has been stable through retention/signoff window;
- no blocked close attempts from real users/clients;
- all reports and dashboards are continuous.

Exit criteria:

- source scan finds no active calls to:
  - `/api/year-end/close`
  - `handleYearEndClose`
  - `sp_ATLAS_GetYearEndPreview` for active calculations;
- archive exports validated;
- final docs updated.

Major risks:

- deleting audit evidence too early;
- installer patch leaves old frontend with close button;
- support loses ability to answer historical questions.

Mitigation:

- archive before drop;
- version manifest/health endpoint validation;
- retain history UI/export until audit signoff.

## Part 5 - Final Year End removed architecture

### Still exists

- `EmployeeAirfareEntitlementPlans`
- `EmployeeAirfarePlanEnrollments`
- `EmployeeAirfareTransactions`
- rebuildable `EmployeeAirfareBalances`
- `PayrollPeriodLocks`
- read-only `YearEndHistory` archive
- read-only `YearEndEmployeeSnapshots` archive
- audit/export support

### Removed or disabled

- active Year End close UI;
- active `/api/year-end/close` write behavior;
- new Year End writes to next-year `OpeningBalances`;
- Year End preview as calculation source;
- hard calendar-year close dependency.

### Entitlement calculation model

- employee balance is the sum of dated entitlement transactions;
- fiscal year is a reporting dimension, not a destructive close boundary;
- usage is recorded as dated transactions;
- resets create carryover/forfeiture/payout transactions;
- payroll period locks prevent backdated silent changes;
- policy snapshots preserve why a transaction was created.

### Audit model

- old Year End close records remain readable/exportable;
- new transactions carry source module, source ID, policy snapshot, created user, and dates;
- historical reports can be produced as-of a date without running an annual close.

### Final "Year End airfare close is removed" checklist

- no active code path calls `/api/year-end/close`;
- no active code path calls `sp_ATLAS_GetYearEndPreview` for new calculations;
- no UI shows "Close Airfare Year" or equivalent close action;
- continuous balance tests pass;
- continuous write idempotency tests pass;
- payroll period lock tests pass;
- report source tests pass;
- reconciliation reports are green for N consecutive periods;
- all mismatches above BHD 0.010 are explained or corrected;
- audit/history export is verified;
- installer/version manifest proves frontend and backend are on the same build;
- rollback path has been tested in staging;
- HR/payroll/support signoff is recorded.

## Sprint execution order

1. Sprint A: flags, `/api/version.features`, SQL object migration, source tests.
2. Sprint B: staging seed/backfill and read-only balance API.
3. Sprint C: reconciliation API and admin-only UI/export.
4. Sprint D: mismatch cleanup and documented signoff.
5. Sprint E: Phase 2 continuous writes behind flags.
6. Sprint F: Phase 3 report/calculation switch.
7. Sprint G: Phase 4 close disablement.
8. Sprint H: Phase 5 archive/retirement after retention.

Do not combine installer/version changes, DB write behavior, frontend close removal, and report source switching in one PR.

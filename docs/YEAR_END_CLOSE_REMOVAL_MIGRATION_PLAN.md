# ATLAS Year End Close Removal Migration Plan

Date: 2026-08-02
Target: remove mandatory airfare Year End close using the continuous entitlement model.

## Red-team position

Do not remove Year End in one patch. That is the high-risk path.

The safe path is:

1. Add flags.
2. Run continuous entitlement in parallel.
3. Reconcile legacy vs continuous results.
4. Switch reads/reports.
5. Disable close UI/API.
6. Keep legacy history read-only.
7. Retire only after audit retention.

The dangerous misconception is "Year End is only a screen." It is not. It is tied into backend close APIs, opening balance generation, loan opening carry-forward, company deletion guards, maintenance reset, support diagnostics, reports, and user workflows.

## Current-state dependency map

### UI dependencies

| File | Dependency | Type | Criticality |
|---|---|---|---|
| `atlas-hcm-next/app/page.tsx` | `ViewKey` includes `Year End` | navigation/state | medium |
| `atlas-hcm-next/app/page.tsx` | `handleYearEndPreview()` calls `/api/year-end/preview/:year` | write-preview evidence | high |
| `atlas-hcm-next/app/page.tsx` | `handleYearEndClose()` calls `/api/year-end/close` | destructive close | critical |
| `atlas-hcm-next/app/page.tsx` | Year End screen renders "Run preview", "Close year", "Open next-year opening balance" | workflow UI | critical |
| `atlas-hcm-next/app/page.tsx` | Opening Balance screen imports/edits/deletes `OpeningBalances` | current operations | critical |
| `atlas-hcm-next/app/page.tsx` | Loans screen references opening loan balance carried by Year End | loan reporting | high |
| `atlas-hcm-next/app/page.tsx` | Reports export includes Year End preview data | reporting | medium |

### Backend API dependencies

| API/function | Writes? | Current role | Migration stance |
|---|---:|---|---|
| `POST /api/year-end/preview/:year` | yes, preview evidence | creates non-final preview evidence | keep until Phase 4; later replace with reconciliation preview |
| `POST /api/year-end/close` | yes, destructive | writes next-year opening balances and history | disable in Phase 4 |
| `GET /api/year-end/history?companyId=` | no | closed-year audit history | keep read-only |
| `GET /api/opening-balances` | no | register opening balances by year | keep during parallel phases |
| `POST /api/opening-balances` | yes | manual opening balance maintenance | keep until continuous cutover; then restrict |
| `GET /api/opening-loan-balances` | no | loan carry-forward register | keep as legacy until loans are decoupled |
| `POST /api/year-end/close` calls `sp_ATLAS_UpsertOpeningLoanBalance` | yes | creates opening loan balance | must not break loans |
| `GET /api/diagnostics/*` | no | readiness checks include Year End | update labels gradually |
| `DELETE /api/companies/:id` | yes | blocks when `YearEndHistory` exists | keep: audit history must block destructive company deletion |
| `DELETE /api/admin/business-data` | yes | deletes `OpeningBalances`, `YearEndHistory` | must be updated carefully for continuous tables |

### MSSQL dependencies

| Object | Type | Criticality | Migration stance |
|---|---|---:|---|
| `OpeningBalances` | table | critical | legacy source until continuous balance is live |
| `OpeningLoanBalances` | table | high | loan-specific; do not mix with airfare entitlement |
| `YearEndHistory` | table | high audit | keep read-only |
| `YearEndEmployeeSnapshots` | table | high audit | keep read-only |
| `YearEndPreviewEvidence` | table | medium | can be retired after close disabled |
| `sp_ATLAS_GetYearEndPreview` | proc | high until Phase 3 | compare against continuous preview |
| `sp_ATLAS_UpsertOpeningLoanBalance` | proc | high loan continuity | keep until loan opening migration defined |
| `sp_ATLAS_GetOpeningLoanBalances` | proc | high reporting | keep during transition |
| `AuditLog` | table | critical | must record all continuous adjustments/reset/payouts |

### Hidden couplings

- Employee delete guards count `OpeningBalances`.
- Company delete guards count `YearEndHistory`.
- Business data reset deletes `OpeningBalances` and `YearEndHistory`.
- Reports and dashboard summaries still join `OpeningBalances`.
- Allocation eligibility uses opening balance + policy + allocations.
- Loan register references opening loan carry-forward in UI copy.
- Existing tests enforce Year End safety; they must be replaced or repurposed only after Phase 4.

## Feature flags

Add flags before implementation:

```env
ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT=false
ENABLE_CONTINUOUS_AIRFARE_WRITES=false
ENABLE_CONTINUOUS_AIRFARE_REPORTS=false
DISABLE_YEAR_END_CLOSE_UI=false
DISABLE_YEAR_END_CLOSE_API=false
ENABLE_LEGACY_YEAR_END_ARCHIVE=true
ENABLE_ENTITLEMENT_RECONCILIATION=true
```

File-level guidance:

- `server.js`
  - add `isFeatureEnabled(name, fallback)` helper.
  - guard new `/api/airfare-entitlement/*` endpoints with `ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT`.
  - guard writes with `ENABLE_CONTINUOUS_AIRFARE_WRITES`.
  - in `/api/year-end/close`, return `410` if `DISABLE_YEAR_END_CLOSE_API=true`.
- `atlas-hcm-next/app/page.tsx`
  - add frontend env flags via `NEXT_PUBLIC_*`.
  - wrap "Close year" button with `!DISABLE_YEAR_END_CLOSE_UI`.
  - replace Year End label with "Legacy Year End Archive" when close disabled.
- `release/atlas-release-manifest.json`
  - each phase that changes DB behavior must bump `databaseSchemaVersion`.

## Phase 0 - Prep and flags

Goal: make migration controllable.

Changes:

- Add feature flags.
- Add health/version exposure of entitlement mode.
- Add source tests proving close UI/API are flag-gated.
- Add runbook and support docs.

Unchanged:

- No business logic changes.
- Year End close still works.
- Opening balances still work.

Success criteria:

- `npm run test:continuous-entitlement`
- new flag contract test passes.
- `/api/version` exposes feature mode.

Rollback:

- Set all continuous flags to false.
- No DB rollback needed.

Failure modes:

| Failure | Impact | Detection | Rollback |
|---|---|---|---|
| Flag default accidentally enables writes | payroll risk | config test + smoke | set env false, restart |
| UI hides close too early | operational block | UI smoke | set `DISABLE_YEAR_END_CLOSE_UI=false` |
| API blocks close too early | P0 if close required | close API contract | set `DISABLE_YEAR_END_CLOSE_API=false` |

## Phase 1 - Parallel model, read-only

Goal: create continuous reads beside legacy results.

Changes:

- Apply additive DB script:
  - `database/ContinuousAirfareEntitlement_Blueprint.sql`
  - or phase migration `database/migrations/2026.08.xx_add_continuous_entitlement_tables.sql`.
- Add API:
  - `GET /api/airfare-entitlement/plans`
  - `GET /api/airfare-entitlement/balances?companyId=&employeeId=&asOfDate=`
  - `GET /api/airfare-entitlement/reconciliation?companyId=&asOfDate=`
- Admin-only UI panel:
  - "Legacy balance"
  - "Continuous balance"
  - "Difference"

Unchanged:

- Allocations still use existing opening-balance/policy logic.
- Year End close still works.
- Continuous model is read-only.

Success criteria:

- 0 SQL object missing.
- Continuous balance endpoint returns rows or valid empty response.
- Reconciliation report generated for last 2 fiscal years.
- No material unexplained discrepancies.

Minimum promotion gate:

```text
0 P0/P1 bugs
100% API smoke green
No unexplained balance discrepancy above BHD 0.010 for active employees
```

Rollback:

- Disable `ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT`.
- Leave additive tables in place.

## Phase 2 - Parallel writes, preview/reset only

Goal: begin writing continuous transactions without replacing legacy.

Changes:

- Add transaction writes for:
  - accrual preview/apply,
  - usage transaction generated from allocation,
  - adjustment transaction,
  - reset preview/apply.
- Add API:
  - `POST /api/airfare-entitlement/accruals/preview`
  - `POST /api/airfare-entitlement/accruals/apply`
  - `POST /api/airfare-entitlement/resets/preview`
  - `POST /api/airfare-entitlement/resets/apply`
- Keep each write idempotent by source module/source ID.
- Log all differences vs legacy Year End preview.

Unchanged:

- Year End close still source of truth for opening balances.
- Existing reports remain legacy.

Success criteria:

- `sp_ATLAS_ApplyAirfareTransaction` idempotency passes.
- Double-click allocation does not create duplicate usage transaction.
- Reset preview rows match apply results.
- Differences from legacy preview are explainable and classified.

Rollback:

- Set `ENABLE_CONTINUOUS_AIRFARE_WRITES=false`.
- Keep transaction rows; if needed, write reversal rows, not deletes.

Red-team warning:

Do not allow continuous writes unless transaction idempotency and payroll period locks are tested. Duplicate accruals will silently inflate employee entitlement.

## Phase 3 - Switch calculations and reports

Goal: continuous model becomes source of truth for balances/reports.

Changes:

- Allocation eligibility uses `sp_ATLAS_GetAirfareEntitlementBalance`.
- Dashboard metrics use continuous balances.
- Reports use transaction date/fiscal year dimensions.
- Add report:
  - "Entitlement Usage by Date Range"
  - "Balance As Of Date"
  - "Carryover/Forfeiture Forecast"

Unchanged:

- Year End close API still exists as emergency fallback.
- Legacy history still readable.

Success criteria:

- YTD/prior-year reports match legacy within agreed tolerance.
- Allocation create/update smoke green.
- Payroll users sign off on reports for 2 consecutive payroll periods.

Rollback:

- Set `ENABLE_CONTINUOUS_AIRFARE_REPORTS=false`.
- Switch read path back to legacy procedures.

## Phase 4 - Disable Year End close UI/API

Goal: no new airfare Year End close.

Changes:

- `app/page.tsx`
  - hide/remove "Close year" button under `DISABLE_YEAR_END_CLOSE_UI`.
  - rename screen to "Legacy Year End Archive" or move to Support/Audit.
- `server.js`
  - `/api/year-end/close` returns:
    ```json
    {
      "code": "YEAR_END_CLOSE_DEPRECATED",
      "error": "Airfare Year End close is disabled. Use continuous entitlement reset/reconciliation."
    }
    ```
    with HTTP `410 Gone`.
- Leave `/api/year-end/history` active read-only.

Unchanged:

- Legacy tables are retained.
- Historical exports still work.

Success criteria:

- close button absent.
- close API returns 410 when flag enabled.
- continuous balance/report/API smoke green.
- support can access legacy history.

Rollback:

- Set `DISABLE_YEAR_END_CLOSE_UI=false`.
- Set `DISABLE_YEAR_END_CLOSE_API=false`.
- Restart app.

## Phase 5 - Retire legacy objects after audit retention

Goal: remove active dependencies, not audit evidence.

Changes:

- Mark legacy objects deprecated in DB docs.
- Remove active code calls to:
  - `sp_ATLAS_GetYearEndPreview`
  - `sp_ATLAS_UpsertOpeningLoanBalance` for airfare close context.
- Keep archive access for:
  - `YearEndHistory`
  - `YearEndEmployeeSnapshots`
- Optional DBA-approved archive/drop after retention.

Non-reversible risk:

DROPs are non-reversible without backup. Do not drop legacy tables in application migration. Archive first.

Success criteria:

- `rg "year-end/close|sp_ATLAS_GetYearEndPreview|handleYearEndClose"` returns no active production path.
- reconciliation green for N consecutive periods.
- audit export tested.

## Data migration design

### Seed plans

```sql
INSERT INTO dbo.EmployeeAirfareEntitlementPlans (
    PlanCode, PlanName, CompanyID, EffectiveFrom, AccrualRule, AccrualAmount,
    AccrualFrequency, ResetRule, ResetMonth, ResetDay, CarryOverRule, PayoutRule, PolicyJSON
)
SELECT DISTINCT
    CONCAT(N'AIRFARE_POLICY_', ISNULL(CAST(CompanyID AS NVARCHAR(20)), N'GLOBAL')),
    CONCAT(N'Airfare Policy ', ISNULL(CAST(CompanyID AS NVARCHAR(20)), N'Global')),
    CompanyID,
    MIN(EffectiveFrom),
    N'lump_sum',
    MAX(MaxPayoutAmount),
    N'annual',
    N'calendar_year',
    1,
    1,
    N'none',
    N'manual_approval',
    N'{"source":"AirfarePolicyRates migration"}'
FROM dbo.AirfarePolicyRates
WHERE ISNULL(IsDeleted, 0) = 0
GROUP BY CompanyID;
```

### Seed enrollments

```sql
INSERT INTO dbo.EmployeeAirfarePlanEnrollments (PlanID, EmployeeID, CompanyID, EnrollmentStart, Status, EligibilityDate, ContractStartDate)
SELECT
    p.PlanID,
    e.EmployeeID,
    c.CompanyID,
    COALESCE(e.JoinDate, p.EffectiveFrom),
    N'active',
    e.JoinDate,
    e.JoinDate
FROM dbo.Employees e
LEFT JOIN dbo.Companies c
  ON LOWER(LTRIM(RTRIM(e.Company))) IN (LOWER(c.CompanyName), LOWER(c.CompanyCode))
JOIN dbo.EmployeeAirfareEntitlementPlans p
  ON (p.CompanyID = c.CompanyID OR p.CompanyID IS NULL)
WHERE e.Status = N'active'
  AND NOT EXISTS (
      SELECT 1
      FROM dbo.EmployeeAirfarePlanEnrollments x
      WHERE x.EmployeeID = e.EmployeeID
        AND x.PlanID = p.PlanID
        AND x.Status = N'active'
  );
```

### Seed baseline transactions from legacy opening balances

```sql
INSERT INTO dbo.EmployeeAirfareTransactions (
    PlanID, EnrollmentID, EmployeeID, CompanyID, TransactionDate, FiscalYear, PeriodCode,
    TransactionType, Amount, Days, SourceModule, SourceID, PolicySnapshotJSON, Description
)
SELECT
    en.PlanID,
    en.EnrollmentID,
    ob.EmployeeID,
    en.CompanyID,
    DATEFROMPARTS(ob.BalanceYear, 1, 1),
    ob.BalanceYear,
    CONCAT(ob.BalanceYear, '-OPEN'),
    N'carryover',
    ob.OpeningBHD,
    ob.OpeningDays,
    N'OpeningBalances',
    ob.OpeningBalanceID,
    N'{"source":"legacy opening balance"}',
    N'Legacy opening balance migrated to continuous entitlement'
FROM dbo.OpeningBalances ob
JOIN dbo.EmployeeAirfarePlanEnrollments en
  ON en.EmployeeID = ob.EmployeeID
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.EmployeeAirfareTransactions t
    WHERE t.SourceModule = N'OpeningBalances'
      AND t.SourceID = ob.OpeningBalanceID
      AND t.TransactionType = N'carryover'
);
```

### Seed usage from allocations

```sql
INSERT INTO dbo.EmployeeAirfareTransactions (
    PlanID, EnrollmentID, EmployeeID, CompanyID, TransactionDate, FiscalYear, PeriodCode,
    TransactionType, Amount, SourceModule, SourceID, PolicySnapshotJSON, Description
)
SELECT
    en.PlanID,
    en.EnrollmentID,
    a.EmployeeID,
    en.CompanyID,
    COALESCE(a.AllocationDate, DATEFROMPARTS(a.AllocYear, 1, 1)),
    a.AllocYear,
    FORMAT(COALESCE(a.AllocationDate, DATEFROMPARTS(a.AllocYear, 1, 1)), 'yyyy-MM'),
    N'usage',
    COALESCE(a.Entitlement, a.CompanyPaid, 0),
    N'Allocations',
    a.AllocationID,
    N'{"source":"legacy allocation"}',
    N'Legacy allocation usage migrated to continuous entitlement'
FROM dbo.Allocations a
JOIN dbo.EmployeeAirfarePlanEnrollments en
  ON en.EmployeeID = a.EmployeeID
WHERE COALESCE(a.Entitlement, a.CompanyPaid, 0) > 0
  AND NOT EXISTS (
      SELECT 1
      FROM dbo.EmployeeAirfareTransactions t
      WHERE t.SourceModule = N'Allocations'
        AND t.SourceID = a.AllocationID
        AND t.TransactionType = N'usage'
  );
```

## Reconciliation query

```sql
DECLARE @AsOfDate DATE = '2026-12-31';
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
    GROUP BY e.EmployeeID
),
Continuous AS (
    SELECT
        EmployeeID,
        SUM(RemainingAmount) AS ContinuousRemaining
    FROM dbo.vw_ATLAS_AirfareEntitlementBalanceAsOf
    GROUP BY EmployeeID
)
SELECT
    l.EmployeeID,
    l.EmployeeCode,
    l.OpeningAmount,
    l.UsedAmount,
    CAST(l.OpeningAmount - l.UsedAmount AS DECIMAL(12,2)) AS LegacyRemaining,
    CAST(COALESCE(c.ContinuousRemaining, 0) AS DECIMAL(12,2)) AS ContinuousRemaining,
    CAST((l.OpeningAmount - l.UsedAmount) - COALESCE(c.ContinuousRemaining, 0) AS DECIMAL(12,2)) AS Difference,
    CASE
        WHEN ABS((l.OpeningAmount - l.UsedAmount) - COALESCE(c.ContinuousRemaining, 0)) <= 0.010 THEN N'MATCH'
        WHEN c.EmployeeID IS NULL THEN N'MISSING_CONTINUOUS'
        ELSE N'MISMATCH_REVIEW'
    END AS ReconciliationStatus
FROM Legacy l
LEFT JOIN Continuous c ON c.EmployeeID = l.EmployeeID
ORDER BY ABS((l.OpeningAmount - l.UsedAmount) - COALESCE(c.ContinuousRemaining, 0)) DESC;
```

## Test strategy per phase

| Phase | Unit/source tests | Integration tests | E2E tests | Promotion gate |
|---|---|---|---|---|
| 0 | flag contract test | `/api/version` flags visible | UI close button visibility by flag | flags default safe |
| 1 | SQL object test | balance endpoint read-only | admin comparison panel renders | 0 missing objects |
| 2 | transaction idempotency test | accrual/reset preview/apply | allocation writes usage transaction | no duplicate transactions |
| 3 | report source test | report APIs use continuous procs | reports match SQL as-of results | 0 unexplained material differences |
| 4 | close blocked test | `/api/year-end/close` returns 410 | close button absent | all continuous smoke green |
| 5 | active dependency scan | archive export API works | legacy archive readable | retention signoff |

## Red-team failure scenarios

1. Mid-migration policy change
   - Detection: policy version/snapshot mismatch report.
   - Mitigation: policy snapshot JSON on every transaction.
   - Rollback: disable continuous writes; keep transaction rows for audit.

2. Manual adjustment in legacy but not continuous
   - Detection: reconciliation mismatch.
   - Mitigation: all adjustment screens write both paths in Phase 2 or continuous-only after Phase 3.
   - Rollback: write compensating continuous adjustment.

3. Partial deployment: app updated, DB migration missing
   - Detection: `/api/version.databaseSchemaVersion`, SQL object smoke.
   - Mitigation: manifest migration verifies `EmployeeAirfareTransactions` and procs.
   - Rollback: disable flags; patch repair migration.

4. Rollback mid-phase
   - Detection: pending patch + smoke failure.
   - Mitigation: additive DB only; flags off restores legacy behavior.
   - Rollback: config flip first, code revert second.

5. Duplicate accrual/apply
   - Detection: unique source hash/idempotency checks.
   - Mitigation: `SourceModule + SourceID + TransactionType` idempotency.
   - Rollback: reversal transaction, not delete.

## User/admin communication

### HR/admin message

Airfare entitlement will move from a manual Year End close to continuous entitlement balances. You will still see reporting by year and period, but you will not need to close an airfare year to start the next period. Reset dates, carryover rules, and payouts will be shown on each employee balance.

### Support message

During migration, check both legacy and continuous balances. If values differ, use the reconciliation report to classify the difference before changing data. Do not manually edit SQL tables. Use adjustment transactions so the audit trail remains complete.

### Auditor message

Historical Year End records remain read-only. New entitlement balances are traceable through dated transactions, policy snapshots, payroll period locks, and audit logs. Reports can be generated as of any date without requiring a destructive close operation.

### UI label changes

| Old label | New label |
|---|---|
| Year End | Legacy Year End Archive |
| Close year | Deprecated - use entitlement reset/reconciliation |
| Opening balance | Starting/carryover entitlement |
| Run preview | Reconcile as of date |
| Final close | Apply reset/payout rules |

## Final "Year End removed" state

Still exists:

- `YearEndHistory` read-only archive.
- `YearEndEmployeeSnapshots` read-only archive.
- old docs marked legacy.

Removed/disabled:

- Year End close button.
- `/api/year-end/close` active write behavior.
- new writes to next-year `OpeningBalances` from Year End close.
- hard calendar-year close dependency.

Source of truth:

- `EmployeeAirfareEntitlementPlans`
- `EmployeeAirfarePlanEnrollments`
- `EmployeeAirfareTransactions`
- rebuildable `EmployeeAirfareBalances`
- `PayrollPeriodLocks`

Checklist before declaring removed:

- no active code path calls `/api/year-end/close`;
- no active code path executes `sp_ATLAS_GetYearEndPreview` for new calculations;
- no UI shows "Close year";
- continuous smoke tests green;
- reconciliation green for agreed periods;
- audit history export verified;
- support runbook updated;
- payroll/HR signoff recorded.

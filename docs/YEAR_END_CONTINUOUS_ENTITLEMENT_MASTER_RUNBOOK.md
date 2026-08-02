# ATLAS Continuous Airfare Entitlement Master Runbook

Date: 2026-08-02
Scope: execute Patch 2.3.89 safely and guide the full journey from legacy airfare Year End close to continuous entitlement.

Primary source artifacts:

- `docs/PATCH_2_3_89_CONTINUOUS_ENTITLEMENT_PHASE_0_1_SPEC.md`
- `database/migrations/2026.08.02_patch_2_3_89_continuous_entitlement_phase1.sql`
- `docs/YEAR_END_CONTINUOUS_ENTITLEMENT_EXECUTION_RUNBOOK.md`
- `docs/YEAR_END_PHASE_0_1_EXECUTABLE_SPEC.md`
- `docs/YEAR_END_CLOSE_REMOVAL_MIGRATION_PLAN.md`
- `database/ContinuousAirfareEntitlement_Blueprint.sql`

## Executive truth

Patch 2.3.89 is not the Year End removal patch. It is the safe foundation patch.

It installs continuous entitlement beside legacy Year End, with production flags OFF by default. Existing Year End preview, close, history, opening balances, loans, allocations, reports, and audit/history behavior must remain unchanged.

## Part 1 - Patch 2.3.89 full execution guide

### 1.1 Feature flags and config

Server env vars:

```env
ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_BACKFILL=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI=false
```

Runtime names in `server.js`:

```text
config.flags.ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT
config.flags.ENABLE_CONTINUOUS_AIRFARE_BACKFILL
config.flags.ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION
config.flags.ENABLE_CONTINUOUS_AIRFARE_WRITES
config.flags.ENABLE_CONTINUOUS_AIRFARE_UI
```

Default values:

| Environment | Entitlement | Backfill | Reconciliation | Writes | UI |
|---|---:|---:|---:|---:|---:|
| dev/test | true allowed | true allowed | true allowed | false | true allowed |
| staging | true for validation | true only during seed | true for validation | false | true for admin |
| production initial | false | false | false | false | false |
| production admin validation window | true | false | true | false | true |

Toggle method:

- local/dev: `.env`;
- staging/production: deployment environment config or Windows service environment;
- verification: `/api/version.features`.

Expected `/api/version.features`:

```json
{
  "continuousAirfareEntitlement": false,
  "continuousAirfareBackfill": false,
  "continuousAirfareReconciliation": false,
  "continuousAirfareWrites": false,
  "continuousAirfareUi": false
}
```

Hard rule: frontend visibility alone is not security. Every new API must also check server flags and admin role where applicable.

### 1.2 Database migration

Migration file:

```text
database/migrations/2026.08.02_patch_2_3_89_continuous_entitlement_phase1.sql
```

Run with SQLCMD because it includes the tested blueprint by reference:

```powershell
sqlcmd -S "<server>" -d "<database>" -E -b -i "database\migrations\2026.08.02_patch_2_3_89_continuous_entitlement_phase1.sql" -v CutoverDate="2026-01-01" CreatedBy="0"
```

New objects:

- tables:
  - `EmployeeAirfareEntitlementPlans`
  - `EmployeeAirfarePlanEnrollments`
  - `EmployeeAirfareTransactions`
  - `EmployeeAirfareBalances`
  - `PayrollPeriodLocks`
- view:
  - `vw_ATLAS_AirfareEntitlementBalanceAsOf`
- stored procedures:
  - `sp_ATLAS_GetAirfareEntitlementBalance`
  - `sp_ATLAS_PreviewAirfareEntitlementReset`
  - `sp_ATLAS_ApplyAirfareTransaction`
- indexes/constraints:
  - plan-code uniqueness;
  - active-enrollment index;
  - transaction as-of index;
  - payroll-period lock uniqueness;
  - JSON checks;
  - transaction-type checks;
  - plan/enrollment foreign keys.

Why the script is safe:

- additive only;
- idempotent object creation;
- idempotent seed/backfill using `NOT EXISTS`;
- reads legacy `AirfarePolicyRates`, `Employees`, `OpeningBalances`, and `Allocations`;
- writes only to new continuous entitlement tables;
- does not modify legacy Year End tables or stored procedures.

Seed/backfill:

- creates entitlement plans from existing airfare policy configuration;
- enrolls eligible active employees;
- seeds opening carryover from `OpeningBalances` at the chosen cutover date;
- seeds usage from `Allocations` for the cutover fiscal year;
- records source evidence in `SourceModule`, `SourceID`, and JSON snapshots.

Pre-checks for DBA/engineering:

```sql
SELECT COUNT(*) AS OpeningBalanceCount FROM dbo.OpeningBalances;
SELECT COUNT(*) AS AllocationCount FROM dbo.Allocations;
SELECT COUNT(*) AS EmployeeCount FROM dbo.Employees;
SELECT COUNT(*) AS PolicyRateCount FROM dbo.AirfarePolicyRates;
```

Pre-check operational rules:

- take a database backup or snapshot;
- run outside peak payroll operations;
- confirm SQLCMD mode is available;
- confirm `CutoverDate` is agreed by payroll/HR;
- record baseline row counts.

Post-checks:

```sql
SELECT COUNT(*) AS PlanCount FROM dbo.EmployeeAirfareEntitlementPlans;
SELECT COUNT(*) AS EnrollmentCount FROM dbo.EmployeeAirfarePlanEnrollments;
SELECT COUNT(*) AS TransactionCount FROM dbo.EmployeeAirfareTransactions;

EXEC dbo.sp_ATLAS_GetAirfareEntitlementBalance
    @EmployeeID = NULL,
    @CompanyID = NULL,
    @AsOfDate = '2026-12-31';
```

Idempotency check:

1. run migration once;
2. capture plan/enrollment/transaction counts;
3. run migration again;
4. confirm counts do not unexpectedly grow.

### 1.3 Backend API implementation

Add routes in `server.js` after authentication helpers and before fallback handlers. Do not edit existing `/api/year-end/*` behavior.

#### `GET /api/airfare/entitlement/balance`

Purpose: read continuous balance.

Guard:

- `ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT`;
- authenticated user.

Request:

```text
employeeId=123&companyId=1&asOfDate=2026-12-31
```

Response:

```json
{
  "mode": "continuous-readonly",
  "asOfDate": "2026-12-31",
  "rows": []
}
```

Handler sketch:

```js
app.get("/api/airfare/entitlement/balance", authenticateToken, async (req, res) => {
  if (!requireFeatureFlag("ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT", res)) return;
  const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  const asOfDate = String(req.query.asOfDate || "").trim();
  if (!asOfDate || Number.isNaN(Date.parse(asOfDate))) {
    return res.status(400).json({ code: "VALIDATION_ERROR", field: "asOfDate" });
  }
  const pool = await getPool();
  const result = await pool.request()
    .input("EmployeeID", sql.Int, employeeId)
    .input("CompanyID", sql.Int, companyId)
    .input("AsOfDate", sql.Date, asOfDate)
    .execute("dbo.sp_ATLAS_GetAirfareEntitlementBalance");
  res.json({ mode: "continuous-readonly", asOfDate, rows: result.recordset });
});
```

#### `GET /api/airfare/entitlement/preview-reset`

Purpose: read-only reset/carryover/forfeiture preview.

Guard:

- `ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT`;
- admin role.

Request:

```text
companyId=1&resetDate=2026-12-31
```

Response:

```json
{
  "mode": "continuous-reset-preview-readonly",
  "resetDate": "2026-12-31",
  "rows": []
}
```

#### `GET /api/airfare/entitlement/reconciliation`

Purpose: compare legacy and continuous balances.

Guard:

- `ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT`;
- `ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION`;
- admin role.

Request:

```text
companyId=1&employeeId=123&asOfDate=2026-12-31&tolerance=0.010
```

Response:

```json
{
  "mode": "migration-reconciliation",
  "asOfDate": "2026-12-31",
  "summary": {
    "checked": 10,
    "ok": 9,
    "investigate": 1
  },
  "rows": [
    {
      "employeeId": 123,
      "legacyRemaining": 70,
      "continuousRemaining": 70,
      "difference": 0,
      "status": "OK",
      "notes": "Within tolerance"
    }
  ]
}
```

#### `POST /api/airfare/entitlement/transaction`

Patch 2.3.89 behavior: disabled.

Expected when writes are OFF:

```json
{
  "code": "FEATURE_DISABLED",
  "feature": "ENABLE_CONTINUOUS_AIRFARE_WRITES",
  "message": "Continuous airfare writes are disabled in Patch 2.3.89."
}
```

Logging for new APIs:

- route;
- user ID;
- employee ID;
- company ID;
- as-of/reset date;
- row count;
- elapsed milliseconds;
- mismatch count;
- flag state.

Diagnostics:

```json
{
  "continuousAirfareEntitlement": {
    "enabled": false,
    "reconciliationEnabled": false,
    "writesEnabled": false,
    "planCount": 0,
    "enrollmentCount": 0,
    "transactionCount": 0,
    "lastReconciliationAt": null,
    "lastMismatchCount": null
  }
}
```

### 1.4 Frontend implementation

Add component:

```text
atlas-hcm-next/app/components/AirfareEntitlementReconciliation.tsx
```

Mount:

- admin-only Diagnostics or Preferences section;
- do not add to normal user sidebar;
- do not change existing user-facing airfare screens.

Route/section label:

```text
Airfare Entitlement - Migration Debug
```

Mandatory warning:

```text
Migration Debug / Reconciliation - not used for payroll.
Read-only comparison. This does not change Year End, Opening Balances, loans, allocations, reports, or payroll results.
```

Fields:

- company;
- optional employee;
- as-of date;
- tolerance.

Columns:

- `Legacy Airfare Balance`;
- `Continuous Airfare Balance`;
- `Difference`;
- `Status`;
- `Notes`.

Guards:

```tsx
const canShow =
  user?.role === "admin" &&
  versionInfo?.features?.continuousAirfareUi === true &&
  versionInfo?.features?.continuousAirfareReconciliation === true;
```

### 1.5 Test plan for Patch 2.3.89

Existing scripts:

```text
npm run test:patch-2-3-89
npm run test:year-end-safety
npm run test:airfare-entitlement-phase1
npm run test:year-end-execution-runbook
```

Recommended additional scripts:

```text
npm run test:airfare-reconciliation
npm run test:airfare-entitlement-integration
```

Unit coverage:

- SQL procs:
  - no transactions;
  - carryover only;
  - carryover plus usage;
  - as-of date before usage;
  - company filter;
  - reset preview;
  - payroll lock rejection;
  - duplicate source idempotency.
- JS API handlers:
  - flag OFF;
  - flag ON;
  - invalid dates;
  - invalid IDs;
  - non-admin access;
  - DB failure mapping.

Integration coverage:

- seed test employees/policies/opening balances/allocations;
- run migration;
- call new APIs;
- manually calculate expected balance;
- assert continuous result;
- compare legacy vs continuous.

Reconciliation coverage:

- `OK` when values match tolerance;
- `MISSING_CONTINUOUS` when legacy exists but seed is missing;
- `INVESTIGATE` when difference exceeds BHD 0.010;
- export includes notes.

Smoke coverage:

- Year End preview still works;
- Year End close remains available;
- Year End history still works;
- opening balance screens still work;
- allocation create/edit still works;
- loans still load;
- reports still export;
- admin debug UI hidden with flags OFF;
- admin debug UI visible with flags ON.

### 1.6 Staging validation

1. Restore staging DB from production-like backup.
2. Record baseline row counts.
3. Run SQLCMD migration with agreed cutover date.
4. Run migration second time to prove idempotency.
5. Deploy backend/frontend.
6. Set staging flags:
   - entitlement true;
   - reconciliation true;
   - UI true;
   - writes false.
7. Run:
   - `npm run test:patch-2-3-89`;
   - `npm run test:year-end-safety`.
8. Login as admin.
9. Open `Airfare Entitlement - Migration Debug`.
10. Run reconciliation for:
    - all companies;
    - at least one company with no allocations;
    - at least one company with active allocations;
    - employees with opening balances;
    - employees with known edge cases.
11. Export mismatch report.
12. Classify every difference above BHD 0.010.
13. Confirm normal user cannot see debug UI.
14. Confirm legacy flows unchanged.

Staging decision gate:

- all automated tests green;
- no P0/P1 defects;
- no legacy flow regression;
- no unexplained material discrepancy;
- flag OFF rollback tested.

### 1.7 Production deployment

1. DBA takes backup/snapshot.
2. DBA runs SQLCMD migration.
3. Verify object counts and sample balance proc.
4. Deploy backend/frontend with all continuous flags OFF.
5. Verify `/api/version.features` all false.
6. Confirm new APIs return disabled.
7. Confirm admin debug UI hidden.
8. Smoke legacy:
   - preview;
   - close availability;
   - history;
   - opening balances;
   - allocation;
   - loans;
   - reports.
9. Optional approved admin validation window:
   - entitlement true;
   - reconciliation true;
   - UI true;
   - writes false.
10. Run limited reconciliation for one company or selected employees.
11. Return flags OFF unless product/QA approve admin-only monitoring mode.

Production success:

- no user-visible regression;
- no new API error spike;
- no DB blocking incident;
- reconciliation works in limited scope;
- rollback path verified.

### 1.8 Patch 2.3.89 rollback

Fast rollback:

1. Set all continuous flags false.
2. Restart service.
3. Confirm `/api/version.features` false.
4. Confirm new APIs return disabled.
5. Confirm debug UI hidden.
6. Confirm legacy Year End flows work.

Code rollback:

- deploy previous build or revert Patch 2.3.89 code commit.

DB rollback:

- preferred production approach: leave new continuous objects unused;
- optional cleanup only after DBA review and export of comparison evidence;
- no restore of legacy Year End tables is needed because Patch 2.3.89 does not modify them.

Notify:

- support lead;
- HR/payroll admin owner;
- DBA;
- engineering owner.

Message:

```text
Continuous airfare entitlement migration features have been disabled. Existing Year End, opening balances, allocations, loans, reports, and employee balances continue to use the legacy production workflow. No existing balances were changed.
```

## Part 2 - Monitoring, reconciliation, and Phase 2 decision

### Monitoring

Watch:

- error rate for `/api/airfare/entitlement/*`;
- response time above 2000 ms;
- reconciliation mismatch count;
- disabled write route attempts;
- support tickets mentioning two balances or entitlement confusion;
- DB blocking/deadlocks during reconciliation queries.

Recommended cadence:

- first week: daily check in staging/controlled production admin window;
- first month: weekly reconciliation;
- after first month: monthly until Phase 2 entry gate.

### Reconciliation process

Owner:

- QA runs report;
- engineering reviews technical mismatches;
- DBA reviews performance and data anomalies;
- HR/payroll validates business interpretation.

Workflow:

1. Run reconciliation by company and fiscal year.
2. Export CSV.
3. Classify each mismatch:
   - policy amount difference;
   - missing seed;
   - employee-company mapping issue;
   - allocation amount source mismatch;
   - legitimate legacy correction;
   - unknown.
4. Fix seed/mapping only through controlled scripts.
5. Re-run reconciliation.
6. Save report with timestamp and build version.

### Phase 2 entry criteria

Proceed to Phase 2 only when:

- Patch 2.3.89 stable for at least N agreed reconciliation cycles;
- no unexplained mismatch above BHD 0.010 in selected production validation set;
- support tickets at or below baseline;
- DBA signs off on query performance;
- QA signs off on test coverage;
- HR/payroll signs off on interpretation;
- writes flag has never been enabled accidentally.

## Part 3 - Phases 2-5 roadmap

### Phase 2 - Continuous writes and reset preview/apply

Changes:

- enable continuous transaction writes for accruals, allocations, adjustments, preview-reset, and apply-reset;
- keep legacy Year End close functional;
- use `sp_ATLAS_ApplyAirfareTransaction`;
- enforce idempotency and payroll locks.

Entry:

- Patch 2.3.89 stable;
- reconciliation green;
- write idempotency tests ready.

Exit:

- preview vs apply matches;
- no duplicate transactions;
- continuous writes explain every difference vs legacy;
- limited production scope validated.

Risks:

- duplicate accruals;
- reset logic becomes hidden Year End clone;
- backdated writes into locked periods.

Mitigation:

- idempotency keys;
- reversal transactions;
- payroll lock tests;
- limited company rollout.

### Phase 3 - Switch calculations and reports

Changes:

- continuous entitlement becomes source for new calculations and reports;
- dashboard/report APIs read continuous model;
- legacy remains read-only audit source.

Entry:

- Phase 2 stable;
- reconciliation green for N periods;
- report comparisons signed off.

Exit:

- product/HR agrees continuous is source of truth;
- all new reports use continuous model;
- no material discrepancies remain unexplained.

Risks:

- report mismatch;
- dashboard trust loss;
- hidden old exports.

Mitigation:

- report source contract tests;
- side-by-side exports;
- staged report flag.

### Phase 4 - Disable Year End close UI/API

Changes:

- hide "Close Airfare Year";
- `/api/year-end/close` returns deprecation response;
- Year End screen becomes read-only archive if retained.

Entry:

- Phase 3 stable;
- audit/history access verified;
- support trained.

Exit:

- no close UI visible;
- close API blocked;
- no users blocked or confused;
- continuous workflow complete.

Risks:

- old frontend still shows close;
- integrations call close endpoint;
- historical evidence inaccessible.

Mitigation:

- version/health validation;
- API telemetry;
- read-only archive export.

### Phase 5 - Retire legacy objects after audit retention

Changes:

- remove active code paths to legacy close logic;
- mark legacy tables/procs deprecated;
- archive or remove legacy objects only with DBA/audit/legal signoff.

Entry:

- retention/signoff complete;
- no close attempts for agreed period;
- all reports and dashboards continuous.

Exit:

- no active legacy close references;
- archive exports validated;
- docs updated.

Risks:

- audit evidence lost;
- support cannot answer old-year questions;
- installer leaves old frontend.

Mitigation:

- archive-first;
- manifest/health checks;
- support archive runbook.

## Part 4 - Final Year End removed architecture

Still exists:

- `EmployeeAirfareEntitlementPlans`;
- `EmployeeAirfarePlanEnrollments`;
- `EmployeeAirfareTransactions`;
- `EmployeeAirfareBalances`;
- `PayrollPeriodLocks`;
- read-only Year End history archive;
- audit exports.

Removed/disabled:

- close Year End UI;
- active `/api/year-end/close`;
- active Year End preview as calculation source;
- new writes to next-year `OpeningBalances` from airfare close;
- mandatory calendar-year close workflow.

Calculation model:

- balances are dated transaction sums;
- fiscal year is a reporting filter;
- allocation usage is a transaction;
- reset produces carryover/forfeiture/payout transactions;
- policy snapshot explains each transaction;
- payroll locks protect closed periods.

Audit model:

- old closes remain accessible through archive;
- new balances are explainable by transactions;
- reports can run as-of any date.

Final checklist:

- no active code path calls legacy close procs;
- no UI shows close actions;
- all automated tests pass;
- reconciliation green for N consecutive periods;
- audit/history access verified;
- rollback documented and tested;
- product, audit, DBA, HR/payroll, and support signoffs recorded.

## Part 5 - Release notes and communication templates

### Engineers/QA

Patch 2.3.89 adds continuous airfare entitlement Phase 0-1 behind feature flags. It includes additive MSSQL objects, idempotent seed/backfill, read-only APIs, admin-only reconciliation UI guidance, diagnostics expectations, and patch tests. Existing Year End behavior must remain unchanged.

Run:

```text
npm run test:patch-2-3-89
npm run test:year-end-safety
```

Known limitations:

- continuous writes remain disabled;
- reconciliation is migration/debug only;
- continuous entitlement is not source of truth yet.

### HR/admin users

Patch 2.3.89 introduces an admin-only reconciliation view for airfare entitlement migration validation. It does not change employee balances, Year End processing, opening balances, allocations, loans, or reports.

### Support

Troubleshooting:

1. Check `/api/version.features`.
2. Confirm writes are false.
3. If there is confusion, disable entitlement/reconciliation/UI flags.
4. Run reconciliation for the affected employee/company.
5. Classify result:
   - `OK`;
   - `MISSING_CONTINUOUS`;
   - `INVESTIGATE`.

Support message if disabled:

```text
The new entitlement migration tools are disabled. Existing airfare workflows and balances are unaffected.
```

### DBA

The Patch 2.3.89 migration is additive and SQLCMD-based. It creates continuous entitlement tables/procs and seeds comparison data into new tables only. Existing Year End tables/procs are not modified. Run after backup, capture row counts, run twice in staging to prove idempotency, and monitor blocking during seed/reconciliation.

### Future Phase 4 communications

Deprecation notice:

```text
Airfare Year End close is being deprecated. ATLAS now calculates airfare entitlement continuously using dated transactions. Historical Year End records remain available for audit.
```

Removal notice:

```text
Airfare Year End close has been removed from active workflows. Airfare balances are now managed through continuous entitlement transactions, reset rules, and as-of-date reporting. Historical Year End records remain available in the archive.
```

## Master control rule

Do not combine these in one PR:

- installer/version patching;
- continuous DB writes;
- report source switching;
- Year End close UI/API disablement;
- legacy archive/object retirement.

Each one changes a different failure mode. Keep them separate, flag-gated, and reversible.

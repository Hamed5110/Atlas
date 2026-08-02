# Patch 2.3.89 - Continuous Entitlement Phase 0-1 Patch Spec

Date: 2026-08-02
Target release: `2.3.89`
Scope: implement the first executable continuous airfare entitlement slice beside legacy Year End.

## Truth-mode patch boundary

Patch 2.3.89 does not remove or alter production Year End behavior.

Legacy Year End remains the operational source of truth until later phases. This patch only adds feature-flagged continuous entitlement infrastructure, read-only APIs, an admin-only reconciliation surface, diagnostics, tests, and an additive DB migration.

## Part 1 - Patch scope and change list

### Feature flags and config

Add these env vars:

```env
ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_BACKFILL=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI=false
```

Runtime shape in `server.js`:

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

Default states:

| Environment | Entitlement | Backfill | Reconciliation | Writes | UI |
|---|---:|---:|---:|---:|---:|
| dev/test | ON allowed | ON allowed | ON allowed | OFF | ON allowed |
| staging | ON after migration | ON only during seed | ON for QA/admin | OFF | ON for admin |
| production initial deploy | OFF | OFF | OFF | OFF | OFF |
| production controlled validation | ON for admin test window | OFF | ON for admin only | OFF | ON for admin only |

Expose non-secret states through `/api/version`:

```json
{
  "features": {
    "continuousAirfareEntitlement": false,
    "continuousAirfareBackfill": false,
    "continuousAirfareReconciliation": false,
    "continuousAirfareWrites": false,
    "continuousAirfareUi": false
  }
}
```

### Database changes

Add SQLCMD migration:

```text
database/migrations/2026.08.02_patch_2_3_89_continuous_entitlement_phase1.sql
```

This migration:

- loads the additive continuous entitlement blueprint;
- creates/keeps these objects idempotently:
  - `dbo.EmployeeAirfareEntitlementPlans`
  - `dbo.EmployeeAirfarePlanEnrollments`
  - `dbo.EmployeeAirfareTransactions`
  - `dbo.EmployeeAirfareBalances`
  - `dbo.PayrollPeriodLocks`
  - `dbo.vw_ATLAS_AirfareEntitlementBalanceAsOf`
  - `dbo.sp_ATLAS_GetAirfareEntitlementBalance`
  - `dbo.sp_ATLAS_PreviewAirfareEntitlementReset`
  - `dbo.sp_ATLAS_ApplyAirfareTransaction`
- seeds plans, enrollments, opening carryover, and allocation usage into continuous tables only;
- ends with object and row-count verification.

Minimal indexes/constraints are inherited from `database/ContinuousAirfareEntitlement_Blueprint.sql`:

- plan code uniqueness;
- active enrollment index;
- transaction as-of index;
- payroll period lock uniqueness;
- transaction type validation;
- JSON validation;
- foreign-key constraints to plan/enrollment objects.

Legacy tables/procs are read only in this patch:

- `OpeningBalances`
- `OpeningLoanBalances`
- `YearEndHistory`
- `YearEndEmployeeSnapshots`
- `sp_ATLAS_GetYearEndPreview`
- `sp_ATLAS_UpsertOpeningLoanBalance`
- existing `/api/year-end/*` behavior.

Run guidance:

```powershell
sqlcmd -S "<server>" -d "<database>" -E -b -i "database\migrations\2026.08.02_patch_2_3_89_continuous_entitlement_phase1.sql" -v CutoverDate="2026-01-01" CreatedBy="0"
```

Use SQL auth if needed:

```powershell
sqlcmd -S "<server>" -d "<database>" -U "<user>" -P "<password>" -b -i "database\migrations\2026.08.02_patch_2_3_89_continuous_entitlement_phase1.sql" -v CutoverDate="2026-01-01" CreatedBy="0"
```

Deployment policy:

- dev/test: run freely and rerun to prove idempotency;
- staging: DBA/dev lead reviews row counts before and after seed;
- production: run with DBA oversight, preferably outside peak payroll usage; deploy app with all flags OFF first.

### Backend API changes

Register new routes in `server.js` without modifying existing Year End route behavior.

#### `GET /api/airfare/entitlement/balance`

Query:

```text
employeeId=123&companyId=1&asOfDate=2026-12-31
```

Flag guard:

- requires `ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT`;
- flag OFF returns `404 FEATURE_DISABLED`.

Handler action:

- validate IDs and `asOfDate`;
- execute `dbo.sp_ATLAS_GetAirfareEntitlementBalance`;
- return read-only rows.

Response:

```json
{
  "mode": "continuous-readonly",
  "asOfDate": "2026-12-31",
  "rows": []
}
```

Errors:

- `400 VALIDATION_ERROR`
- `404 FEATURE_DISABLED`
- `500 CONTINUOUS_AIRFARE_BALANCE_FAILED`

#### `GET /api/airfare/entitlement/preview-reset`

Query:

```text
companyId=1&resetDate=2026-12-31
```

Flag guard:

- requires `ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT`;
- admin only;
- read-only in this patch.

Handler action:

- validate `resetDate`;
- execute `dbo.sp_ATLAS_PreviewAirfareEntitlementReset`;
- return carryover/forfeiture preview only.

Response:

```json
{
  "mode": "continuous-reset-preview-readonly",
  "resetDate": "2026-12-31",
  "rows": []
}
```

#### `GET /api/airfare/entitlement/reconciliation`

Query:

```text
companyId=1&employeeId=123&asOfDate=2026-12-31&tolerance=0.010
```

Flag guard:

- requires `ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT`;
- requires `ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION`;
- admin only.

Handler action:

- compute legacy remaining from `OpeningBalances - Allocations`;
- compute continuous remaining from continuous entitlement;
- return difference/status/notes.

Response:

```json
{
  "mode": "migration-reconciliation",
  "asOfDate": "2026-12-31",
  "tolerance": 0.01,
  "summary": {
    "checked": 0,
    "ok": 0,
    "investigate": 0
  },
  "rows": []
}
```

Statuses:

- `OK`
- `MISSING_CONTINUOUS`
- `INVESTIGATE`

#### `POST /api/airfare/entitlement/transaction`

This route stays disabled in Patch 2.3.89.

Flag guard:

- requires `ENABLE_CONTINUOUS_AIRFARE_WRITES`;
- production default is OFF.

Expected response while OFF:

```json
{
  "code": "FEATURE_DISABLED",
  "feature": "ENABLE_CONTINUOUS_AIRFARE_WRITES",
  "message": "Continuous airfare writes are disabled in Patch 2.3.89."
}
```

### Frontend changes

Add a small admin-only reconciliation component:

```text
atlas-hcm-next/app/components/AirfareEntitlementReconciliation.tsx
```

Mount location:

- preferred: Diagnostics or Preferences admin area;
- acceptable temporary location: admin-only section inside `app/page.tsx`;
- do not add normal user navigation item.

Visibility guard:

```tsx
const canShow =
  currentUser?.role === "admin" &&
  versionInfo?.features?.continuousAirfareUi === true &&
  versionInfo?.features?.continuousAirfareReconciliation === true;
```

Layout:

- title: `Airfare Entitlement - Migration Debug`
- warning: `Read-only comparison. This does not change Year End, Opening Balances, loans, allocations, reports, or payroll results.`
- filters:
  - company
  - employee optional
  - as-of date
  - tolerance
- table fields:
  - `Legacy Airfare Balance`
  - `Continuous Airfare Balance`
  - `Difference`
  - `Status`
  - `Notes`
- optional CSV export.

No existing user-facing airfare screen changes in this patch.

### Logging and diagnostics

Log each new API call:

- route;
- authenticated user ID;
- employee ID;
- company ID;
- as-of/reset date;
- flag state;
- row count;
- elapsed milliseconds;
- mismatch count for reconciliation.

Add diagnostics payload under existing health/diagnostics response or a new admin-only endpoint:

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

Warn when:

- difference absolute value is greater than BHD 0.010;
- SQL object is missing;
- query takes longer than 2000 ms;
- write route is called while writes are disabled.

## Part 2 - Test plan for Patch 2.3.89

### Unit/source tests

Existing:

- `tests/continuous-entitlement-blueprint.test.js`
- `tests/airfare-entitlement-phase1.test.js`

Add/extend:

- `tests/patch-2-3-89-continuous-entitlement.test.js`

Assertions:

- feature flags are named and default OFF;
- migration file exists and is SQLCMD-ready;
- migration references blueprint;
- migration includes idempotent seed guards;
- no legacy Year End destructive statements;
- new route contracts are documented;
- writes remain disabled.

### SQL tests

Run against a test DB:

- `sp_ATLAS_GetAirfareEntitlementBalance`
  - no transactions -> empty;
  - carryover 150 -> remaining 150;
  - carryover 150 + usage 80 -> remaining 70;
  - as-of before usage -> remaining 150;
  - company filter excludes other company.
- `sp_ATLAS_PreviewAirfareEntitlementReset`
  - carryover rule `none` -> forfeiture equals remaining;
  - carryover cap -> cap respected.
- `sp_ATLAS_ApplyAirfareTransaction`
  - duplicate source returns same existing row;
  - invalid type/negative amount/invalid JSON are rejected;
  - payroll lock throws 53004.

### JS API tests

Flag OFF:

- balance returns `404 FEATURE_DISABLED`;
- preview-reset returns `404 FEATURE_DISABLED`;
- reconciliation returns `404 FEATURE_DISABLED`;
- write returns disabled.

Flag ON:

- invalid dates return `400 VALIDATION_ERROR`;
- valid balance route maps stored proc rows to `mode=continuous-readonly`;
- reconciliation returns `summary` and row statuses;
- non-admin reconciliation returns `403`.

### Integration/reconciliation tests

Recommended files:

- `tests/airfare-entitlement-integration.test.js`
- `tests/airfare-reconciliation.test.js`

Scenarios:

| Scenario | Legacy data | Continuous seed | Expected |
|---|---|---|---|
| match | opening 150, allocation 80 | carryover 150, usage 80 | difference 0, `OK` |
| missing continuous | opening 150 | none | `MISSING_CONTINUOUS` |
| usage mismatch | opening 150, allocation 80 | carryover 150, usage 70 | `INVESTIGATE` |
| as-of date before allocation | allocation after date | usage after date | no early usage |

### Smoke tests

Pre-deployment staging:

- run migration twice;
- run seed twice;
- start app with flags OFF;
- confirm existing Year End preview/close/history still work;
- enable entitlement/reconciliation/UI in staging;
- hit new APIs;
- open admin reconciliation view;
- export mismatch CSV.

Post-deployment production:

- deploy with all flags OFF;
- confirm `/api/version.features.*` are false;
- confirm new APIs return disabled;
- confirm legacy Year End flows work;
- during approved admin test window, enable entitlement/reconciliation/UI only;
- run reconciliation for one test company or selected employees;
- turn flags OFF after validation if not yet ready for broad admin use.

### NPM scripts

Existing:

```text
npm run test:continuous-entitlement
npm run test:year-end-removal-plan
npm run test:airfare-entitlement-phase1
npm run test:year-end-execution-runbook
```

Add:

```text
npm run test:patch-2-3-89
```

Meta-script should run all four plus `tests/patch-2-3-89-continuous-entitlement.test.js`.

## Part 3 - Verification and validation

### Pre-release staging gate

1. Apply migration to staging DB with SQLCMD.
2. Verify object SELECT returns non-null IDs.
3. Capture row counts:
   - plans;
   - enrollments;
   - transactions;
   - legacy opening balances;
   - legacy allocations.
4. Run seed again and verify row counts do not grow unexpectedly.
5. Deploy backend/frontend with flags OFF.
6. Run `npm run test:patch-2-3-89`.
7. Manually test:
   - Year End preview;
   - Year End close availability;
   - opening balance screen;
   - allocation create/edit;
   - reports export;
   - loans screen.
8. Enable entitlement/reconciliation/UI in staging only.
9. Open admin reconciliation UI.
10. Spot-check employees across:
    - at least two companies;
    - employees with no allocations;
    - employees with allocations;
    - employees with opening balance;
    - employees with mismatch.

Decision gate:

- no P0/P1 defects;
- no existing Year End regression;
- no unexplained material discrepancy above BHD 0.010 in defined staging set;
- rollback by flag OFF verified.

### Production gate

1. DBA reviews and applies migration.
2. Deploy app build with all flags OFF.
3. Verify `/api/version` shows all continuous flags OFF.
4. Confirm disabled API behavior.
5. Confirm normal Year End flow still works.
6. Enable admin-only validation only if approved:
   - entitlement ON;
   - reconciliation ON;
   - UI ON;
   - writes OFF.
7. Run reconciliation for a limited company/employee set.
8. Monitor logs for:
   - API errors;
   - slow queries;
   - mismatch warnings;
   - attempted disabled writes.

Patch success criteria:

- all automated tests passing;
- production deploy with flags OFF has no user-visible change;
- legacy Year End remains functional;
- reconciliation works for the controlled validation set;
- rollback/disable path verified.

## Part 4 - Rollback plan

### Fast rollback

1. Set:
   - `ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT=false`
   - `ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION=false`
   - `ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI=false`
   - `ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES=false`
2. Restart service.
3. Verify `/api/version.features` are false.
4. Confirm new APIs return `FEATURE_DISABLED`.
5. Confirm reconciliation UI is hidden.
6. Confirm legacy Year End preview/close/history still work.

### Code rollback

- deploy previous build or revert Patch 2.3.89 commit;
- no existing Year End table data needs restore because this patch does not modify legacy Year End objects.

### DB rollback

Preferred production rollback:

- leave new objects in place but unused.

Reason:

- DB changes are additive;
- continuous rows may be useful evidence for reconciliation;
- removing DB objects during an incident adds risk.

Optional non-production cleanup can remove new continuous objects after export, but that is not part of normal production rollback.

Support message:

```text
Continuous airfare entitlement migration features have been disabled. Existing airfare balances, Year End, allocations, loans, and reports continue to use the legacy production workflow.
```

## Part 5 - Optional Patch 2.3.90 early Phase 2 preview

Safe next patch:

- keep writes OFF;
- add stronger read-only reset preview endpoint:
  - `GET /api/airfare/entitlement/preview-reset-result?companyId=&fiscalYear=&resetDate=`
- admin UI tab for preview result:
  - current continuous balance;
  - carryover;
  - forfeiture;
  - expected post-reset balance;
  - legacy Year End preview comparison.
- add tests comparing continuous reset preview to existing Year End preview.

Do not implement apply/reset writes in 2.3.90 unless:

- Phase 0-1 reconciliation has been green;
- idempotency tests are complete;
- payroll lock tests are complete;
- support/HR signoff exists.

## Part 6 - Release notes and communication

### Engineers/QA

Patch 2.3.89 adds the first executable continuous airfare entitlement layer behind feature flags. It adds additive MSSQL objects, idempotent seed/backfill, read-only entitlement balance and reconciliation APIs, an admin-only reconciliation UI plan, diagnostics, and patch-specific tests. Existing Year End behavior must remain unchanged.

Test command:

```text
npm run test:patch-2-3-89
```

Known limitation:

- continuous writes are disabled;
- reconciliation is migration/debug only;
- continuous balances are not production source of truth yet.

### HR/admin users

Patch 2.3.89 introduces an admin-only airfare entitlement reconciliation view for migration validation. It does not change employee balances, Year End processing, allocations, loans, or reports.

### Support

If an issue is reported:

1. Check `/api/version.features`.
2. Confirm writes are OFF.
3. If needed, disable all continuous flags.
4. Run reconciliation for the affected employee/company.
5. Classify status:
   - `OK`: within tolerance;
   - `MISSING_CONTINUOUS`: seed/backfill missing;
   - `INVESTIGATE`: review policy, opening balance, allocation usage, employee-company mapping.

### DBA

The migration is additive and idempotent. Run it with SQLCMD because it includes the tested continuous entitlement blueprint through a SQLCMD include directive. Review row counts before and after seed. Existing Year End objects are not modified by this patch.

## Final patch acceptance checklist

- migration script exists and is SQLCMD-ready;
- migration runs twice in test DB;
- seed runs twice without duplicate growth;
- new APIs disabled by default;
- writes remain disabled;
- admin UI hidden by default;
- legacy Year End preview/close/history unchanged;
- all patch tests pass;
- staging reconciliation reviewed;
- production deploy starts with flags OFF;
- rollback by flag OFF verified.

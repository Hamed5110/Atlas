# Patch 2.3.89 - Continuous Entitlement Phase 0-1 Patch Spec

Date: 2026-08-02
Target release: `2.3.89`
Scope: remove the executable annual close path and install the first continuous airfare entitlement model.

## Truth-mode patch boundary

Patch 2.3.89 removes the executable annual close path.

There is no big annual reset/recalculate job in the active product path. Existing historical tables can remain as archived evidence, but the application must compute eligibility, accrual, usage, and remaining balance from policy rules plus transaction history.

## Continuous entitlement model

- `EmployeeAirfareEntitlementPlans` stores rule configuration: accrual rule, accrual frequency, carryover cap, payout rule, and policy JSON.
- `EmployeeAirfarePlanEnrollments` links employees to active plans.
- `EmployeeAirfareTransactions` is the immutable ledger for `accrual`, `carryover`, `usage`, `payout`, `adjustment`, `forfeiture`, and `reversal`.
- `EmployeeAirfareBalances`/views/procs expose balance as-of a date.
- `PayrollPeriodLocks` blocks writes in locked payroll periods.
- Opening balances are legacy seed data only; they are not a required annual operation.

## Feature flags

```env
ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_BACKFILL=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES=false
ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI=false
ATLAS_CONTINUOUS_AIRFARE_ADMIN_ONLY=true
```

Runtime `/api/version` must expose:

```json
{
  "features": {
    "continuousAirfareEntitlement": false,
    "continuousAirfareBackfill": false,
    "continuousAirfareReconciliation": false,
    "continuousAirfareWrites": false,
    "continuousAirfareUi": false,
    "continuousAirfareAdminOnly": true
  }
}
```

## Database migration

Required SQLCMD migration:

```text
database/migrations/2026.08.02_patch_2_3_89_continuous_entitlement_phase1.sql
```

The migration must:

- include `database/ContinuousAirfareEntitlement_Blueprint.sql`;
- create/keep these objects idempotently:
  - `dbo.EmployeeAirfareEntitlementPlans`
  - `dbo.EmployeeAirfarePlanEnrollments`
  - `dbo.EmployeeAirfareTransactions`
  - `dbo.EmployeeAirfareBalances`
  - `dbo.PayrollPeriodLocks`
  - `dbo.vw_ATLAS_AirfareEntitlementBalanceAsOf`
  - `dbo.sp_ATLAS_GetAirfareEntitlementBalance`
  - `dbo.sp_ATLAS_ApplyAirfareTransaction`
  - `dbo.sp_ATLAS_ForecastAirfareAccruals`
- seed monthly continuous plans, active enrollments, legacy opening seed transactions, and allocation usage;
- use `NOT EXISTS` guards so it can run twice without duplicate growth;
- avoid destructive SQL such as `DROP TABLE` or `TRUNCATE TABLE`;
- avoid annual defaults such as `N'annual'`, `N'calendar_year'`, or `N'lump_sum'` in Patch 2.3.89 seed data.

Run guidance:

```powershell
sqlcmd -S "localhost\ATLAS" -d "Atlasairfare010" -E -b `
  -i "database\migrations\2026.08.02_patch_2_3_89_continuous_entitlement_phase1.sql" `
  -v CutoverDate="2026-01-01" CreatedBy="0"
```

## API contract

New continuous routes:

- `GET /api/entitlement/compute`
- `GET /api/entitlement/accruals`
- `GET /api/entitlement/usage`
- `GET /api/airfare/entitlement/balance`
- `GET /api/airfare/entitlement/reconciliation`
- `GET /api/entitlement/accrual-forecast`
- `POST /api/airfare/entitlement/transaction`

Expected response modes include `continuous-readonly`, `continuous-entitlement-compute`, `continuous-entitlement-accrual-ledger`, `continuous-entitlement-usage-ledger`, and `migration-reconciliation`.

Legacy close route policy:

- No annual close API route is registered.
- The response must point callers to:
  - `/api/entitlement/compute`
  - `/api/entitlement/accruals`
  - `/api/entitlement/usage`
  - `/api/airfare/entitlement/reconciliation`

Writes:

- `ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES=false` by default.
- Disabled feature calls must return `FEATURE_DISABLED`.
- The transaction route must remain disabled until payroll-period lock, idempotency, and approval tests are green.

## Frontend contract

- No normal navigation item for annual close.
- Opening Balance must describe itself as a legacy seed register, not a required close/carry-forward process.
- Admin diagnostics must expose `Airfare Entitlement - Migration Debug`.
- Reconciliation copy must say `Continuous Entitlement Reconciliation - not used for payroll`.
- Reconciliation columns must include `Legacy Airfare Balance`, `Continuous Airfare Balance`, `Difference`, `Status`, and `Notes`.
- Admin can export reconciliation CSV.

## Installer contract

- Patch 2.3.89 manifest version remains `2.3.89`.
- Migration plan entry must be `20260802-continuous-airfare-entitlement-phase1`.
- No migration entry may be named like an annual-close migration.
- The EXE/MSI must be interactive: visible wizard, SQL server/port prompts, logs, and user-visible error/success messages.
- The installer applies the continuous migration safely and verifies `dbo.sp_ATLAS_GetAirfareEntitlementBalance`.

## Test command

```text
npm run test:patch-2-3-89
```

Patch success criteria:

- `/api/version` shows `2.3.89`;
- continuous feature flags are visible;
- annual close APIs are not registered;
- continuous compute/accrual/usage routes exist;
- reconciliation UI is admin-only and exportable;
- migration runs twice without duplicate seed growth;
- no annual close/reset job is required for entitlement correctness.


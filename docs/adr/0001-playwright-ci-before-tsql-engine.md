# Decision: Playwright CI before MSSQL entitlement engine, then ship T-SQL behind that gate

**Date:** 2026-08-23  
**Status:** Accepted (Phase 1 shipped; Phase 2 landed)

## Choice

1. **First:** Playwright in GitHub Actions (green CI gate).
2. **Next:** Alembic + `airfare.fn_HCM_*` / `airfare.sp_HCM_CalculateEntitlement` with a thin Python wrapper and SQLite fallback.

## Research summary

| Option | Industry guidance | Fit for Atlas Aluminum |
|--------|-------------------|------------------------|
| **Playwright in CI** | Keep critical journeys in CI with traces/artifacts | Locks UI before SQL rewrite |
| **T-SQL entitlement near the data** | Set-based / integrity logic in SQL Server; evolving rules in app services with tests | SP mirrors proven Python `calculate_allocation_entitlement` |

## Phase 1 (done)

- Playwright E2E job after backend tests; visual specs skipped on Linux CI.

## Phase 2 (this work)

| Artifact | Role |
|----------|------|
| `migrations/versions/0011_hcm_entitlement_engine.py` | `grade` / `contract_type` / family + policy tables |
| `sql/atlas_aluminum/01_functions.sql` | Working days 30/360, airfare amount, EMI, next due |
| `sql/atlas_aluminum/02_sp_calculate_entitlement.sql` | `sp_HCM_CalculateEntitlement` (+ employee loader) |
| `scripts/apply_entitlement_sql.py` | Apply GO-batched SQL outside Alembic transactions |
| `infrastructure/mssql_entitlement.py` | Thin wrapper; Python fallback for SQLite/CI |

Parity target: scenarios `previous_ticket`, `new_joinee`, `opening_balance_accrual` with 30/360 + cycle-60 math matching the domain engine.

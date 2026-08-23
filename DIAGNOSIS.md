# 3389 Startup Failure — Root Cause (2026-08-22)

## Symptom
`http://127.0.0.1:3389` unreachable when using `start-api.ps1`.

## Root cause
**`start-api.ps1` runs `alembic upgrade head` before Uvicorn.** Migration `0009_soft_delete_unique` called
`Inspector.get_unique_constraints()`, which is **not implemented for MSSQL/pyodbc** and raised
`NotImplementedError`. The script exited before binding to port 3389.

Secondary issue: migration `0010_reporting_views` attempted to create views/procedures inside Alembic's
transactional DDL envelope on MSSQL, causing version-table update failures and full rollback.

## Evidence
| Hypothesis | Result |
|------------|--------|
| H1 Port conflict | **Rejected** — nothing listening on 3389 initially |
| H2 Config 3388 mismatch | **Rejected** — zero `3388` references in repo |
| H3 DB failure on startup | **Partial** — MSSQL reachable; Alembic blocked startup |
| H4 Import error | **Rejected** — `from airfare_management.api.main import app` succeeds |
| H5 Router registration | **Rejected** — Uvicorn starts when Alembic skipped |
| H6 CORS/middleware | **Rejected** — `curl /health/live` returns 200 when Uvicorn running |

Direct Uvicorn test:
```powershell
python -m uvicorn airfare_management.api.main:app --host 127.0.0.1 --port 3389
# INFO: Uvicorn running on http://127.0.0.1:3389
```

## Fixes applied
1. `migrations/versions/0009_soft_delete_unique.py` — MSSQL-safe constraint drops without `get_unique_constraints()`
2. `migrations/env.py` — `transaction_per_migration=True` on MSSQL
3. `migrations/versions/0010_reporting_views.py` — indexes only inside Alembic (views/SPs moved out)
4. `scripts/apply_reporting_sql.py` — idempotent post-migration apply for views/procedures
5. `sql/reporting_procedures.sql` — string `RAISERROR` messages (no unregistered error codes)
6. `start-api.ps1` — DB connectivity check, Alembic + reporting SQL, clear errors, browser after `/health/live`

## After fix
```powershell
.\start-api.ps1
curl http://127.0.0.1:3389/health/live
curl http://127.0.0.1:3389/
```

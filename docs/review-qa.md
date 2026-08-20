# AI Verification Review — QA

Review covers calculation correctness, state/concurrency behavior, API contracts and existing tests. Severity reflects production impact.

## Findings

### QA-01 — Month-end EMI due-date anchor drifts (High)

`domain/services.py:206-210` derives each next date from the already-clamped prior date. A schedule starting January 31 clamps to February 28 and then remains on the 28th in March, instead of returning to the preferred 31/month-end anchor.

**Fix:** preserve an immutable preferred day/month-end flag; generate each installment from the original anchor. Test Jan 29/30/31 across February in leap/non-leap years.

### QA-02 — Scenario validation can be bypassed (High)

`api/main.py:580-591` calls generic `calculate_entitlement` whenever `current_working_days` is present. A request can declare `new_joiner` without `join_date`, or `mid_year_allocation` without previous date, and bypass checks at `domain/services.py:140-145`.

**Fix:** either make override a separate privileged endpoint/permission with reason or validate scenario-required fields before either path.

### QA-03 — Concurrent payments can over-recover or lose updates (Critical)

The read/check/subtract sequence at `api/main.py:775-785` has no expected version or idempotency. Existing tests exercise loan creation/schedule but never payment concurrency.

**Fix:** database compare-and-swap and duplicate reference constraint; test two simultaneous payments where combined amount exceeds outstanding and replay of the same payroll message.

### QA-04 — Referential validation is inconsistent and hidden by SQLite (High)

Employee creation checks company explicitly, but ticket, balance and loan creation do not check employee/source ticket. SQLite in-memory tests do not enable `PRAGMA foreign_keys=ON`; therefore orphan writes can pass tests even though MSSQL may reject them.

**Fix:** validate scoped references, enable SQLite FK pragma, and run MSSQL integration/contract tests in CI.

### QA-05 — Ticket monetary invariants are incomplete (High)

`TicketCreate` permits `company_paid > ticket_cost` and arbitrary client-supplied `entitlement` (`api/main.py:135-145`). The server does not bind entitlement to an approved calculation/balance. This can inflate excess and recovery loans.

**Fix:** derive entitlement server-side from persisted policy/allocation; enforce company paid ≤ ticket cost unless an explicit audited adjustment rule exists.

### QA-06 — Preference locking is untested and non-functional (High)

`is_locked` is persisted and returned, but `resolve_preferences` receives only values (`api/main.py:834-845`), so descendants override locked ancestors. Existing preference test (`tests/test_domain.py:68-80`) tests merge only.

**Fix:** resolver carries scope metadata/lock state; add precedence, null, arrays, lock, unauthorized scope and conflicting update tests.

### QA-07 — Ticket status corruption produces server error (Medium)

`transitions[item.status]` at `api/main.py:678` assumes a valid DB value. Runtime migrations lack a status check, so legacy/manual invalid data raises `KeyError` and 500 rather than a controlled integrity error.

**Fix:** DB check plus defensive `transitions.get`; test corrupt-data handling during migration.

### QA-08 — Import commit can fail without useful row attribution (Medium)

Dry-run validates Pydantic shape but not company existence or database uniqueness (`api/main.py:483-510`). Commit inserts all records and a constraint failure becomes a generic 409, losing row-specific remediation. Full file is read before enforcing decompressed-workbook limits.

**Fix:** staged set-based validation against companies/current codes and intra-file duplicates; return row/code reasons and batch control totals.

### QA-09 — API error contracts are inconsistent (Medium)

Domain errors use custom problem JSON, FastAPI validation uses `detail` arrays, and missing loan/ticket uses `HTTPException(404, "...")` (`api/main.py:667-668`, 750-752). Clients cannot rely on one schema.

**Fix:** global handlers for validation, HTTP and unexpected errors; contract tests for 400/401/403/404/409/422/429/503.

### QA-10 — Coverage breadth does not match enterprise claims (Medium)

Only five test files exist. `test_api.py` covers health, one preview and invalid employee code; operational tests cover a single happy ticket transition and loan schedule. There are no tests for login failure/lockout, all RBAC combinations, tenant isolation, attachment limits/scans, payment, preference upsert/lock, import commit rollback, reports at scale, temporal/audit immutability, MSSQL migrations, accessibility or browser workflows.

**Fix:** risk-based pyramid: exhaustive pure calculation/state property tests; service transaction tests; MSSQL/Testcontainers migration/concurrency tests; OpenAPI contract tests; PySide6 and browser accessibility smoke; load/soak and restore drills.

### QA-11 — Test collection is coupled to the developer’s live MSSQL (High)

The 2026-08-17 verification collected 13 tests but stopped with two import errors. Importing `api.main` executes `app = create_app()` (`api/main.py:1813`), which queried live MSSQL before tests could call their SQLite `create_app(settings)`. The live `companies` table lacked five columns expected by updated ORM.

**Fix:** remove database work from module import, construct app without side effects, perform revision verification in lifespan/deployment, and set isolated test configuration before import. Add an upgrade-from-0002-to-0003 MSSQL test.

## Required calculation matrix

Cover leap day; every month-end; target before/inside/after allocation year; join date before/on/after cutoff; previous allocation on target; negative/zero/max values; carry cap 0/30/60; paid > available; huge Decimal precision; rates 0/100; terms 1/600; first due 28–31; final rounding; defer/resume; partial/full/over/duplicate/concurrent payment.

## Release gate

Do not certify financial production readiness until QA-03, QA-04 and QA-05 are closed and exercised against MSSQL under concurrency. Passing SQLite unit tests alone is not evidence of MSSQL integrity or isolation behavior.

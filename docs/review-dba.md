# AI Verification Review — DBA

Review compares SQLAlchemy metadata, Alembic revisions and `sql/mssql_schema.sql`. Live MSSQL introspection was not required to establish the source-level discrepancies; deployment must still run a read-only catalog reconciliation before migration.

## Findings

### DBA-01 — Existing databases may omit Employee → Company foreign key (Critical)

Current `EmployeeRow.company_id` declares `ForeignKey("companies.id")` (`infrastructure/database.py:48`), but `0001_initial.py:27-43` originally created employees before companies and `0003_enterprise_workflows.py` does not add the FK to upgraded databases. A deterministic seed employee references a company created later at application startup.

**Fix:** ensure Company exists before Employee, clean orphan values, then add trusted FK in an online migration.

### DBA-02 — Two incompatible schema definitions exist (Critical)

Reference DDL uses schema `airfare`, PascalCase, `uniqueidentifier` and temporal features; Alembic uses default schema/lowercase and ORM-derived portable columns. `0003` adds five tables absent from the DDL. Reference Tickets has computed `ExcessAmount` but no `Notes`/`ExcessHandling`; reference Loans omits `MonthlyInstallment`/`FirstDueDate`.

**Fix:** choose canonical naming/model, generate migration from verified deployed baseline, and add drift checks against `sys.tables`, `sys.columns`, FKs, checks and indexes.

### DBA-03 — Financial integrity checks are absent from real migrations (High)

ORM `schema.py` declares field nullability but no checks for non-negative ticket amounts, loan terms, status enums, positive versions or attachment size/scan status. Those checks exist only in reference DDL (`mssql_schema.sql:106-108`, 132-136, 185-186).

**Fix:** add constraints `WITH CHECK`, first remediate invalid rows; maintain API validation as a second layer.

### DBA-04 — Loan payment is race-prone (Critical)

`api/main.py:775-785` reads outstanding, compares and subtracts without `If-Match`, update predicate, lock or idempotency uniqueness. Two requests can both pass and over-recover/lost-update depending on isolation/version mapping. `LoanRow` does not configure SQLAlchemy `version_id_col`.

**Fix:** atomic `UPDATE ... WHERE id=? AND version=? AND outstanding>=?`, insert payment with unique source/reference, one transaction, return 409 on zero row count.

### DBA-05 — Optimistic versions are not generally enforced (High)

Only `EmployeeRow` maps `version_id_col` (`database.py:45`). OpeningBalance, Ticket, Loan and Preference have integer columns but SQLAlchemy will not compare them automatically. Ticket compares in Python; payment/preference do not require client version.

**Fix:** configure version mapping or explicit compare-and-swap consistently and expose ETags.

### DBA-06 — Audit is neither append-only nor complete in Alembic (High)

`audit_log` from `0001_initial.py:52-63` contains metadata only and no immutable trigger. The richer trigger/before-after/IP columns exist only in reference DDL. Generic `before_flush` can also add audit rows for no-op dirty records.

**Fix:** immutable permissions/trigger, explicit change detection and business reason, partition/retention, independent audit writer.

### DBA-07 — Updated ORM starts before deployed schema is converged (Critical)

`0003_enterprise_workflows.py:50-118` adds audit/version columns, and current ORM expects them. The 2026-08-17 test run failed during collection at module-level `create_app()` because live `companies` lacked `updated_at`, `created_by`, `updated_by`, `deleted_at`, and `version`. This is direct evidence of migration/runtime ordering failure.

**Fix:** apply and verify Alembic before any app worker imports/starts; readiness should compare expected revision and critical columns; deployment must fail closed before serving traffic.

### DBA-08 — Unique preference semantics differ for default NULL scope (Medium)

Reference DDL makes `ScopeId uniqueidentifier NULL` and unique index `(ScopeType,ScopeId,PreferenceKey)` (`mssql_schema.sql:155-170`). SQL Server permits multiple NULLs in this composite pattern in ways that can undermine one-default-row intent; ORM instead uses non-null empty string and supports branch/department text.

**Fix:** model typed scope keys consistently; use filtered indexes per scope type or persisted normalized scope key.

### DBA-09 — Unbounded query/report plans will degrade (Medium)

Ticket/loan/balance list and report queries lack pagination or tenant predicates. Runtime migrations do not install the covering/filtered indexes shown in reference DDL.

**Fix:** add workload-driven indexes after query shapes are tenant-scoped and paginated; use Query Store to validate.

### DBA-10 — Backup/DR is documentary only (Medium)

No deployment evidence enforces log-backup cadence, encryption, restore tests, retention or HA. This is expected outside application code but remains a production readiness gate.

**Fix:** infrastructure runbook/monitoring with RPO ≤15 minutes, RTO ≤4 hours and recorded restore exercises.

## Read-only deployment reconciliation query

Before remediation, compare `sys.schemas`, `sys.tables`, `sys.columns`, `sys.foreign_keys`, `sys.check_constraints`, `sys.indexes`, and `sys.tables.temporal_type`; record Alembic version. Do not apply the reference SQL directly to a populated database.

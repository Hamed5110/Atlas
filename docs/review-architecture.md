# AI Verification Review — Architecture

Review basis: source, tests, Alembic and MSSQL reference DDL inspected on 2026-08-17. Ratings: Critical, High, Medium, Low.

## Findings

### ARCH-01 — Runtime schema and enterprise DDL are divergent (Critical)

`migrations/versions/0002_operational_modules.py:28-44` creates lowercase SQLAlchemy tables in the default schema, `0003_enterprise_workflows.py` adds five more tables/metadata, while `sql/mssql_schema.sql:5-20` creates temporal PascalCase tables in `airfare`. They differ in tables, columns and types. Verification also proved current ORM can start against a pre-0003 live schema and fail before tests collect.

**Fix:** establish Alembic as authority; introspect deployed schema; create a tested, online-safe convergence revision and retire or generate the reference DDL from the same model.

### ARCH-02 — Use cases and infrastructure are concentrated in one route module (High)

`api/main.py:330-1810` composes infrastructure and implements authentication, lookups, imports, entitlement, ticket/ESS workflow, loans, preferences, files and reports. Ticket transition/loan creation at lines 1231–1276 and payment logic at 1382–1406 bypass application services. This prevents isolated policy evolution and makes transaction/audit behavior inconsistent.

**Fix:** introduce context application services and repository ports behind unchanged endpoints; keep `create_app` as DI root only.

### ARCH-03 — Event delivery is non-durable (High)

`application/contracts.py:55-78` is a synchronous in-memory bus. `EmployeeCommandHandler` publishes after commit at lines 136–139; a crash between commit and publish loses the event, and handler failure occurs after durable state changed.

**Fix:** write outbox events in the same transaction and dispatch with Celery; consumers use inbox deduplication.

### ARCH-04 — Claimed target stack is not deployed (High)

`compose.yaml:1-25` defines only API and an attachment volume. No Redis, Celery or Nginx exists; reports, XLSX parsing and attachment I/O execute in API request paths (`api/main.py:476-510`, 847-888, 890-918).

**Fix:** add bounded asynchronous jobs and reverse proxy as target deployment increments; retain synchronous mode only for small controlled operations.

### ARCH-05 — Polymorphic links have no integrity boundary (High)

`AttachmentRow.entity_type/entity_id` (`infrastructure/schema.py:170-172`) can point anywhere, and preference scopes are free-form IDs (`153-157`). Upload (`api/main.py:847-875`) never verifies the parent. Orphans and cross-context access are inevitable.

**Fix:** use typed association tables or a validated entity registry plus parent authorization; add cleanup and reconciliation jobs.

### ARCH-06 — Domain and ORM models drift (Medium)

Domain `Ticket` lacks route/notes and `Loan` lacks source ticket, installment amount and first due date (`domain/models.py:109-137`), while ORM has them. Most route code uses ORM rows directly, so domain invariants are not authoritative.

**Fix:** define aggregate mappings and invariant ownership; prohibit route-level ORM mutation through architecture tests.

### ARCH-07 — Reporting reads unbounded operational tables (Medium)

`GET /v1/tickets`, `/v1/loans`, balances and excess PDF have no pagination; the report loads all tickets then filters in Python (`api/main.py:895-907`).

**Fix:** server-side filters/pagination, SQL predicate `company_paid > entitlement`, streaming or asynchronous snapshot reports.

### ARCH-08 — Startup performs mutable bootstrap work (Medium)

`create_app()` inserts default company/admin during module construction (`api/main.py:341-374`), before lifespan startup. `app = create_app()` at line 1813 caused test import to hit a stale live MSSQL schema. Multiple workers race and production can silently retain bootstrap identity.

**Fix:** move bootstrap to an explicit, idempotent administrative command/migration with one-time setup and production default rejection.

## Dependency/circularity review

No import cycle was found among current domain → application → infrastructure layers, but `infrastructure.database` imports application contracts and `api.main` imports all layers. The principal risk is future circularity from the monolithic composition module and runtime import of `calculate_entitlement` at `api/main.py:581`; enforce dependency rules in CI.

## Highest-priority disposition

Converge the real schema first, then protect financial writes with application services/UoW/outbox. Introducing workers before those boundaries would distribute inconsistent behavior.

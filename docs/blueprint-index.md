# Airfare Management System — Design Blueprint

## Purpose

This blueprint defines the enterprise target for the HCM Airfare Management module and separately records verified current-state gaps. It is grounded in the FastAPI, SQLAlchemy, Alembic, MSSQL reference DDL, PySide6 and pure-JavaScript implementation present on 2026-08-17.

## Blueprint set

1. [Phase 1 — Business Analysis](phase-01-business-analysis.md): requirements, controls, rules, edge cases and dependencies.
2. [Phase 2 — Domain Modeling](phase-02-domain-modeling.md): seven bounded contexts, tactical DDD and class model.
3. [Phase 3 — Enterprise Architecture](phase-03-enterprise-architecture.md): C4, sequences, deployment and decisions.
4. [Phase 4 — Database Engineering](phase-04-database-engineering.md): ERD, DDL conformance, indexing, partitioning, audit and DR.
5. [Phase 5 — Security Architecture](phase-05-security-architecture.md): OWASP, STRIDE, identity, RBAC/ABAC/RLS and secrets.
6. [Phase 6 — API Design](phase-06-api-design.md): complete actual endpoint catalog, DTO/error conventions and missing operations.
7. [Phase 7 — UI/UX Design](phase-07-ui-ux-design.md): navigation, journeys, wireframes, grids, rule engine, themes and WCAG.
8. [Phase 8 — Service Design](phase-08-service-design.md): service boundaries, state machines, transactions and reliability.

## AI verification reports

- [Architecture Review](review-architecture.md)
- [Security Review](review-security.md)
- [DBA Review](review-dba.md)
- [QA Review](review-qa.md)

## Source-of-truth map

| Concern | Current authoritative artifact |
|---|---|
| HTTP behavior | `src/airfare_management/api/main.py` |
| Pure calculations | `src/airfare_management/domain/services.py` |
| Domain records | `src/airfare_management/domain/models.py` |
| Runtime ORM | `infrastructure/database.py`, `infrastructure/schema.py` |
| Migration path | `migrations/versions/0001_initial.py`, `0002_operational_modules.py`, `0003_enterprise_workflows.py` |
| MSSQL target/reference | `sql/mssql_schema.sql` (not equivalent to migrations) |
| Desktop | `src/airfare_management/desktop/main.py` |
| Browser client | `web/` (Vite + React 19 + TypeScript + Tailwind 4 + shadcn/ui), built to `src/airfare_management/interface/web_dist/` |
| Verification baseline | `tests/` |

## Cross-cutting target principles

1. Alembic is the only schema evolution authority.
2. Tenant and record authorization is deny-by-default at API and database boundaries.
3. Financial commands are idempotent, versioned, atomic and auditable.
4. Domain decisions persist policy version and inputs for reproducibility.
5. External effects use outbox/inbox; reports/imports/scans use durable workers.
6. Temporal state history and intent audit are complementary.
7. Web and desktop consume one versioned API and never bypass it.
8. Claims about capability require executable tests and production controls.

## Implementation priority

1. Close critical tenant authorization, attachment and payment-concurrency risks.
2. Reconcile Alembic/runtime schema with the MSSQL target and add trusted constraints.
3. Extract ticket/entitlement/loan application services with Unit of Work and outbox.
4. Implement approval chains, persisted entitlement ledger and payroll reconciliation.
5. Add OIDC/session lifecycle, worker/reverse-proxy stack and operational telemetry.
6. Complete transactional UI journeys and WCAG verification.

## Explicit non-claims

The repository now implements local refresh-token rotation/reuse handling, password history/lockout, lookups, rates, ESS requests, loan defer/restructure/bulk settlement and broad audit metadata in source. It does not currently implement Redis, Celery, Nginx, configurable approval chains, payroll/HRIS adapters, company-level row security, generalized conditional-format rules, full temporal history, or end-to-end WCAG evidence. Their presence in the blueprint means “required target,” not “already delivered.”

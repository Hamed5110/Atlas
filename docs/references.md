# Engineering references

Curated sources that informed HCM Airfare Phase 6 design decisions.

## FastAPI and application architecture

- [FastAPI dependency injection](https://fastapi.tiangolo.com/tutorial/dependencies/) — route handlers stay thin; auth and DB sessions are injected dependencies.
- Domain exceptions (`DomainError`) are mapped to HTTP problems in the API layer only; repositories and use cases never raise `HTTPException`.

## MSSQL reporting objects

- [CREATE VIEW (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-view-transact-sql) — `CREATE OR ALTER VIEW` for idempotent reporting projections.
- [CREATE PROCEDURE (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-procedure-transact-sql) — one procedure per task, parameterized filters, `TRY/CATCH` with explicit rollback.
- Filtered indexes (`WHERE deleted_at IS NULL`) align with soft-delete semantics used across operational tables.

## Vue / Tailwind admin UX (Phase 4 SPA)

- [Vue 3 composition API](https://vuejs.org/guide/introduction.html) — component-driven screens with explicit props and emits.
- [Tailwind CSS utility-first styling](https://tailwindcss.com/docs/utility-first) — 8px spacing grid, limited palette, dark-mode class strategy.

## Testing pyramid

- **pytest + branch coverage** — financial core (`domain/services.py`) guarded at 85%+ gate.
- **Hypothesis property tests** — allocation and loan invariants.
- **Playwright E2E** — login, health/metrics, visual regression (`tests/e2e/ui`), accessibility smoke (`tests/e2e/a11y`), responsive breakpoints.
- **Locust** — SLA thresholds on port **3389**.

## Security and interchange

- Spreadsheet formula injection mitigation: prefix `=`, `+`, `-`, `@` with apostrophe on XLSX export (`infrastructure/documents.py`).
- Attachment size cap via `AIRFARE_MAX_ATTACHMENT_BYTES` (default 25 MiB).

## Tooling (2026 Python ecosystem)

- **Ruff** — lint/format (`pyproject.toml`, pre-commit).
- **mypy --strict** — typed application layer.
- **uv** — recommended for CI/Docker installs (10–100× faster resolver than legacy pip workflows).
- **Bandit / pip-audit** — CI security scans.

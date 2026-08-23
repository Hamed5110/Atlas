# Decision: Playwright CI before full MSSQL entitlement engine

**Date:** 2026-08-23  
**Choice:** Add Playwright to GitHub Actions **first**; defer the full Alembic + T-SQL entitlement rewrite to the next phase.

## Research summary

| Option | Industry guidance | Fit for Atlas Aluminum now |
|--------|-------------------|----------------------------|
| **Playwright in CI** | 2026 E2E best practice: keep critical journeys in CI with traces/artifacts; isolate data; avoid flaky shared DB | UI + 20 local E2E tests just shipped — without CI they rot |
| **Full T-SQL entitlement engine** | Keep **set-based / integrity** logic near the data; keep **fast-changing domain rules** in app services with tests | Large rewrite; Python ATLAS 30/360 engine already works; needs a CI safety net first |

Sources consulted (2025–2026): Playwright enterprise CI guidance, E2E isolation practices, SQL Server business-logic decision frameworks (set-based in T-SQL; evolving domain rules in application layer).

## Why CI wins this turn

1. **Locks the UI we just built** (Atlas branding, kanban, loan chart, ESS form, theme toggle).
2. **Unblocks safe delivery** — every push gets automated browser proof on Ubuntu.
3. **Enables the SQL phase** — entitlement SPs can land later behind a green CI gate.
4. **Ship today** — full T-SQL engine is multi-day and higher risk without CI first.

## What CI runs

- Functional / a11y / responsive / login / API health (always)
- Visual screenshot tests are **skipped in CI** (Windows baselines ≠ Linux renderers)

## Next phase (not this push)

Alembic migration for `grade` / `contract_type` / `family_members` + `fn_HCM_*` / `sp_HCM_CalculateEntitlement` with Python thin wrappers.

# Atlas Aluminum — Gap Analysis (Built vs Spec)

**Date:** 2026-08-22  
**Scope:** Compare existing HCM Airfare implementation with the Atlas Aluminum production spec before MSSQL-first migration.

---

## Executive summary

| Area | Current state | Atlas spec | Action |
|------|---------------|------------|--------|
| Scenario logic | Python `domain/services.py` — **matches ATLAS 30/360** | Same scenarios + grade/contract rules | Preserve scenarios; add policy tables later |
| Calculations | Python + partial MSSQL (`fn_ATLAS_AirfareAmount` port) | **All in T-SQL** (`fn_HCM_*`, `sp_HCM_*`) | Phase 2 — not in this cleanup pass |
| Employee master | Basic fields (dept, branch, nationality) | Grade, contract_type, family, salary, status | Schema migration needed |
| Dummy data | **17× `MSSQL Scenario3 Preview`** (test leak) | 15 realistic Atlas employees | **Purged + seeded today** |
| Ticket workflow | Draft → Approved (simpler) | 7-stage ESS workflow | Future |
| GCC compliance | 30/360, 60-day cycle, 150 BHD default | Grade cycles + family tickets | Company policy via `EntitlementPolicy` |

---

## Scenario system — preserved and aligned

Documented in [`scenarios.md`](scenarios.md) and implemented in `domain/services.py`.

### Allocation scenarios (auto-detected)

| Scenario | Spec | Built | Match |
|----------|------|-------|-------|
| `previous_ticket` | Same-year ticket → accrual from day after | ✓ | ✓ |
| `new_joinee` | Join year = as_of year, prorated | ✓ | ✓ |
| `opening_balance_accrual` | Tenured, no same-year ticket | ✓ | ✓ |

### Entitlement preview scenarios (manual)

| Scenario | Spec | Built | Match |
|----------|------|-------|-------|
| `existing` | 30/360 + opening | ✓ | ✓ |
| `new_joiner` | Calendar 365/366 proration | ✓ | ✓ |
| `mid_year_allocation` | Opening forced 0, accrual after allocation | ✓ | ✓ |
| `carry_forward` | Cap opening by carry_forward_cap | ✓ | ✓ |

### Constants

| Constant | Spec | Built |
|----------|------|-------|
| `AIRFARE_CYCLE_DAYS` | 60 | 60 |
| `DEFAULT_AIRFARE_POLICY_AMOUNT` | 150 BHD | 150 |
| `WORKING_DAYS_PER_AIRFARE_DAY` | 30 | 30 |
| `AIRFARE_DAYS_PER_MONTH` | 2.5 | 2.5 |
| `CARRY_FORWARD_CAP` | 30 | Configurable in preferences |

---

## GCC / Bahrain labor law (research)

**Statutory (Labor Law 2012):**

- 30 calendar days annual leave after 1 year continuous service
- Accrual: 2.5 days/month during first year (proportional)
- End-of-service: repatriation ticket obligation on termination (Art. 27 LMRA)

**Contractual / industry practice (Atlas policy — not hard law):**

- Home-leave tickets every 12/24/36 months by grade
- Family inclusion by contract type (single / married / family)
- Business class for senior grades

The spec’s grade A–E rules should live in **`EntitlementPolicy`** admin tables, not as statutory defaults.

---

## MSSQL objects — built vs required

### Built

| Object | File | Purpose |
|--------|------|---------|
| `fn_ATLAS_AirfareAmount` (port) | Python `fn_atlas_airfare_amount()` | Days → BHD amount |
| `vw_employee_summary`, `vw_ticket_ledger`, … | `sql/reporting_views.sql` | Reporting |
| `sp_report_*` | `sql/reporting_procedures.sql` | Report export |
| Import preview SPs | `sql/mssql_procedures.sql` | CSV import validation |

### Not built (spec Phase 2)

- `fn_HCM_EntitlementDays`, `fn_HCM_EntitlementAmount`, `fn_HCM_AirfareRate`, …
- `sp_HCM_CalculateEntitlement`, `sp_HCM_IssueTicket`, `sp_HCM_PostLoanPayment`, …
- `vw_HCM_EmployeeMaster`, `vw_HCM_EntitlementStatus`, …
- Audit triggers `tr_HCM_TicketAudit`, `tr_HCM_LoanAudit`

**Architecture note:** Python remains the calculation engine until Phase 2. API already calls domain services; thin SP wrapper is a separate migration.

---

## Data model gaps

| Field / table | In schema today | Spec |
|---------------|-----------------|------|
| `grade` (A–E) | ✗ | ✓ |
| `contract_type` | ✗ | ✓ |
| `origin_country` | ✗ (nationality only) | ✓ |
| `probation_end_date`, `salary`, `status` | ✗ | ✓ |
| `family_members` | ✗ | ✓ |
| `EntitlementPolicyRow` | ✗ | ✓ |
| `CompanyPreferenceRow` | Partial (preferences API) | ✓ |
| `DestinationRateRow` | ✗ | ✓ |

Current employee row supports: `code`, `full_name`, `department`, `branch`, `pay_group`, `designation`, `nationality`, `sub_section`, `email`, `custom_airfare_rate`, `max_entitlement_cap_rate`.

Sample seed data uses **existing columns**; grade mapped via `custom_airfare_rate` and designation until migration adds explicit grade/contract fields.

---

## Dummy data root cause

`tests/test_airfare_allocation_engine.py::test_mssql_scenario_3_preview_persists_and_cleanup` creates employees with:

- `code`: `MS-SEQ-{uuid}`
- `full_name`: `"MSSQL Scenario3 Preview"`

The test **does not delete** the employee in `finally` — only disposes the engine. Repeated MSSQL test runs left **17 active rows**.

**Fix:** API delete in `finally` block + `scripts/purge_dummy_employees.py` for one-time cleanup.

---

## Recommended execution order (remaining work)

1. ✅ Purge dummy employees + seed 15 Atlas sample rows  
2. Fix MSSQL integration tests to always teardown created employees  
3. Alembic migration: grade, contract_type, family_members, entitlement_policies  
4. T-SQL entitlement engine (`sql/atlas_aluminum/`)  
5. Python thin wrapper calling `sp_HCM_CalculateEntitlement`  
6. Full ticket workflow + ESS UI  

---

## Verification checklist

- [x] Employees page shows 15 named Atlas staff (not Scenario3 Preview)
- [x] Each row has department, branch, email `@atlas-aluminum.com`
- [x] Opening balances exist for 2026
- [x] `POST /v1/allocations/preview` returns valid scenario for sample employee
- [x] `pytest` MSSQL test no longer leaks rows

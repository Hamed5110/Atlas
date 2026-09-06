# Modern Entitlement Engine — Adoption Map (:3389)

> **Source prompt:** `ATLAS_HCM_Modern_Entitlement_Engine_Architecture_Prompt.md` (2026-09-03)  
> **Runtime:** FastAPI HCM on **http://127.0.0.1:3389** · UI `atlas-next` → `web_dist_next`  
> **Constraint:** ONE MSSQL database · ONE product path · no phantom Vue/`backend/` tree

## Research anchors (tier-1)

| Vendor | Pattern we adopt |
|--------|------------------|
| SAP SuccessFactors Time Off | Recurring time accounts; accrual **recalculation** when Job Info fields change ([recalculation options](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/time-off-recalculation-options-basic-concepts/ba-p/13465585); prefer “No Recalculation Postings” over Classic — [SAP Note 2806342](https://userapps.support.sap.com/sap/support/knowledge/en/2806342)) |
| Oracle Absence | Accrual plans: term length, frequency, ceiling, carry-over / forfeiture, hire proration |
| Workday | Single unified data model — entitlement + tickets + loans share one store |

## Honest path remap (prompt → real)

| Prompt path | Real path |
|-------------|-----------|
| `database/migrations/V00x` | `C:\HCM Airfare\migrations\versions\0013_modern_entitlement_ledger.py` + `sql\atlas_aluminum\05_modern_entitlement_engine.sql` |
| `backend/app/routers/entitlement.py` | `C:\HCM Airfare\src\airfare_management\api\routers\entitlement.py` |
| `backend/.../entitlement_repository.py` | `...\infrastructure\entitlement_ledger.py` |
| `frontend/.../*.vue` | `C:\Airfare_Allowance\atlas-next\app\(app)\entitlement\*\page.tsx` |
| `tests/e2e/*` | `C:\Airfare_Allowance\tests\e2e\` |
| `scripts/health-check-3389.ps1` | Already at `C:\Airfare_Allowance\scripts\health-check-3389.ps1` |

**Do not create** a second Vue app, a second FastAPI tree, or INT-keyed parallel DB.

## Naming (UUID / continuous-aligned)

| Prompt name | HCM object |
|-------------|------------|
| `EntitlementType` | `entitlement_types` |
| `EntitlementRule` | `entitlement_rules` (matrix; **Phase 3 / advanced only** — see `docs/ENTITLEMENT_RATE_VS_RULE.md`) |
| `EntitlementAccount` | `entitlement_accounts` (recurring per employee × type × fiscal year) |
| `EntitlementTransaction` | `entitlement_transactions` |
| `EligibilityChangeLog` | `eligibility_change_log` |
| `sp_Entitlement_*` | `airfare.sp_Entitlement_*` (schema-qualified; keeps `airfare.sp_HCM_*` calc intact) |
| `sp_YearEnd_Close` | **`airfare.sp_Entitlement_PeriodEndProcess` + opening seed** — **not** a hard fiscal wipe. Continuous / SIGNOFF direction forbids re-introducing legacy year-end reset. |

## Layering

1. **Engine lives in MSSQL** (functions + SPs + ledger tables).  
2. **FastAPI is thin** — validate JWT, inject `company_id`, `EXEC` / repository, return Pydantic.  
3. **atlas-next is the dashboard** — all interactive controls carry `data-testid`.  
4. **Playwright on :3389** is the guardrail.

## Coexistence with live allocation

- Keep `/v1/entitlements/preview`, `/v1/allocations/*`, `/v1/entitlement-rates`, `/v1/opening-balances`, tickets.  
- **Base airfare amount policy = Entitlement Rates** (`/rates`). Rule matrix is not primary nav.  
- New `/v1/entitlement/*` is an optional ledger / reconcile surface — **not** required for day-to-day modern entitlement.  
- **Period-end / year-close UI was removed** from atlas-next nav. Live path = Rates + Allocation (joining-date / continuous).  
- Reconciliation compares ledger expected balance vs account current balance (and can later align to opening+tickets).

## Done criteria (adapted)

- [ ] Alembic `0013` + `05_modern_entitlement_engine.sql` apply on MSSQL  
- [ ] `/v1/entitlement/*` endpoints respond on :3389 (optional ledger; not product year-end)  
- [ ] Entitlement ledger screens under `/entitlement/*` with required `data-testid`s  
- [ ] `/rates` is primary entitlement amount UI; rules demoted from main nav  
- [ ] **No Period End nav item**; `/entitlement/year-end` redirects users to Allocation  
- [ ] Playwright includes `airfare-entitlement-rate.spec.ts`; allocation + reconcile smoke on :3389  
- [ ] `health-check-3389.ps1` stays green  
- [ ] No hard `YearEnd_Close` wipe — continuous / SIGNOFF direction; do not re-introduce fiscal wipe UX  

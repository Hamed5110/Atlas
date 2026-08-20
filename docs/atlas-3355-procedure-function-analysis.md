# ATLAS 3355 MSSQL Procedure/Function Analysis

This document captures the old `3355` SQL business logic read directly from `Atlasairfare010` (`sys.objects` + `sys.sql_modules`) and how the current HCM engine should apply it.

## Source Extraction

- Extract script: `scripts/extract_atlas_sql_objects.py`
- Output: `docs/atlas-3355-sql-objects.sql`
- Object count extracted: `52` (procedures + scalar/table functions)

## Key Legacy SQL Objects Reviewed

- `dbo.sp_ATLAS_GetAllocationEligibilityReview`
- `dbo.sp_ATLAS_CalcPolicyEntitlement`
- `dbo.fn_ATLAS_AirfareAmount`
- `dbo.fn_ATLAS_LoanEMI`
- `dbo.sp_ATLAS_DeferLoan`
- `dbo.sp_ATLAS_RestructureLoanEMI`
- `dbo.sp_Preference_RefreshLockState`

## Legacy Patterns Found (3355)

- **Rate/Policy Resolution (SQL):**
  - Selection priority in `sp_ATLAS_GetAllocationEligibilityReview`:
    1) employee-specific policy
    2) pay group
    3) department
    4) company
    5) fallback/global
- **Entitlement math in SQL (legacy):**
  - `sp_ATLAS_CalcPolicyEntitlement` uses 30/360 working-day style and cycle-based payout.
- **Loan logic:**
  - `fn_ATLAS_LoanEMI` = `ROUND(amount / tenure, 2)` (flat split).
  - Defer/restructure procedures enforce status and guardrails.
- **Preference lock behavior:**
  - Lock state is explicitly materialized and enforced via preference lock procedures/functions.

## Current HCM Algorithm (Implemented)

HCM now ports `dbo.sp_ATLAS_CalcPolicyEntitlement` and `dbo.fn_ATLAS_AirfareAmount`:

1. **Rate hierarchy**
   - `Employee_Custom_Rate` -> `Pay_Group_Rate` -> `Global_Company_Rate` (default 150)

2. **Daily rate**
   - `Daily_Rate = MaxPayout / 60` (ATLAS cycle; stale 365 preference is ignored)

3. **Working days**
   - 30/360 from `max(1 Jan of year, JoinDate, previous same-year ticket + 1)`

4. **Money**
   - Opening seed is **OpeningBHD** (days converted only when amount is 0)
   - Current airfare days = `ROUND(workingDays / 30 * 2.5, 4)`
   - Earned = `ROUND(Daily_Rate * CurrentAirfareDays, 2)`
   - Payable = `min(MaxPayout, OpeningBHD + earned) - year-to-date entitlement paid`

5. **Excess settlement**
   - LOAN EMI = `ROUND(excess / tenure, 2)` (`fn_ATLAS_LoanEMI`)
   - COMPANY_PAID and SELF_PAID routing implemented

6. **Employee 0004 (as of 2026-08-18, join 2024-01-01, opening 0, rate 150)**
   - Working days 228 → airfare days 19.0000 → **47.50 BHD** (daily rate 2.50)

## Verification Performed

- Automated tests: `pytest -q`
  - Result: `60 passed`
- Live API checks: `python scripts/verify_live.py --base-url http://127.0.0.1:3389`
  - Result: `15 passed, 0 failed`


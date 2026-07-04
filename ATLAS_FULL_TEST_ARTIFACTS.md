# ATLAS Fare & Loan Manager — Full Testing Artifacts

Date: 2026-06-16  
Scope: Backend (`server.js`) + Frontend (`atlas-hcm-next`) + SQL/business logic updates

## What was validated

- Company payable hard cap is now fixed at **BHD 150** (hard system cap), both in UI and API.
- Existing end-to-end behavior and smoke paths still pass.

## Hard-cap change implemented

- Frontend hard cap: [`atlas-hcm-next/app/page.tsx`](../../atlas-hcm-next/app/page.tsx)
  - Added `MAX_COMPANY_PAYABLE = 150`.
  - Company coverage now uses `selectedCompanyMaxPayout = min(employee max payout, 150)` and applies this in eligibility/preview math.
- Backend hard cap: [`server.js`](../../server.js)
  - Added `MAX_COMPANY_PAYABLE = 150`.
  - `normalizeAllocationAmounts()` now caps company payment at `min(employee max payout, 150)` before persisting.
- Company-only mode now blocks when company coverage cannot fully cover the ticket, forcing employee-pay/loan path.

## Test matrix

### Backend (`C:\\hcm-airfare-java\\New folder`)

1. `npm run check`
   - Result: **PASS**
   - `node --check server.js` passed.

2. `npm run test:smoke`  
   - Env: `ATLAS_TEST_USERNAME=admin ATLAS_TEST_PASSWORD=Atlas@25`
   - Result: **PASS**

3. `npm run test:loan-sql`
   - Result: **PASS**

4. `npm run test:attachments-sql`
   - Result: **PASS**

5. `npm run test:company-admin`
   - Result: **PASS**

6. `npm run test:full`
   - Env: `ATLAS_TEST_USERNAME=admin ATLAS_TEST_PASSWORD=Atlas@25`
   - Result: **PASS**
   - Latest reports:
     - [`atlas-full-system-test-20260616123640.md`](test-reports/atlas-full-system-test-20260616123640.md)
     - [`atlas-full-system-test-20260616123640.json`](test-reports/atlas-full-system-test-20260616123640.json)

### Frontend (`C:\\hcm-airfare-java\\New folder\\atlas-hcm-next`)

1. `npm run test`
   - Result: **PASS**
   - Checks passed:
     - airfare formula
     - employee import preview
     - dropdown options
     - loan dashboard source checks
     - airfare attachments source checks
     - airfare excess/reports/company backup source checks
     - opening balance source checks
     - UI layout source checks

2. `npm run build`
   - Result: **PASS**
   - Production build completed successfully.

## Result summary

- Backend: **PASS**
- Frontend: **PASS**
- Overall: **PASS**

## Notes

- The earlier `test:full` artifact failed only when credentials were wrong.
- After applying `admin / Atlas@25`, full run passes.
- Company payable now has an explicit hard upper bound of `150` at both UI and API layers.

### UI polish update (2026-06-16)

- Airfare allocation form updated (`atlas-hcm-next/app/page.tsx`):
  - Field label changed from **"Ticket fare paid by company"** to **"Ticket Amount"**.
  - **Selected Payment Option** is now an actual dropdown list (instead of read-only input) with:
    - Airfare entitlement amount
    - Paid by company
    - Paid by self employee
    - Loan for excess
- Validation:
  - `npm run build` ✅
- `http://<server-name>/` responds `200` through IIS after restart. IP fallback is discovered dynamically by `Start-ATLAS-LAN.ps1`.

## Artifact stamp

- Label: **KILLCARITIC**

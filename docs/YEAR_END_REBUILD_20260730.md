# ATLAS Year End Rebuild - 2026-07-30

## What was rebuilt

- Converted Year End from a simple preview/final-close screen into a server-driven close workbench.
- Added readiness blockers, warnings, step-by-step close evidence, preview expiry evidence, and close policy flags.
- Added explicit API history for closed Year End runs: `GET /api/year-end/history?companyId=...`.
- Strengthened SQL audit history:
  - `YearEndHistory.TotalOpeningLoanBalance`
  - `YearEndHistory.LoansCarriedForward`
  - `YearEndHistory.ReadinessJson`
  - expanded `YearEndEmployeeSnapshots` columns for opening, earned, paid, closing, loan, and close-status evidence.
- Kept final close protected by:
  - company scope
  - calendar year-end date
  - fresh preview ID/hash
  - stale-preview rejection
  - changed-data rejection
  - out-of-sequence close rejection
  - closed-year mutation SQL triggers

## Research basis

- Microsoft Dynamics GP year-end guidance emphasizes checklist-driven close routines, backup before close, and audit records.
- Microsoft Dynamics GP Payroll year-end guidance specifically calls out a backup as permanent end-of-year evidence before running close routines.
- Open-source HRMS/GitHub carry-forward issues show that year-end leave/benefit carry-forward needs visible rules and review evidence, not hidden one-click movement.

## Verification performed

- Backend syntax: `npm run check`
- Year End contract: `npm run test:year-end-safety`
- Company/admin SQL safety: `npm run test:company-admin`
- Frontend production build and TypeScript: `npm --prefix atlas-hcm-next run build`
- Frontend test pack: `npm --prefix atlas-hcm-next test`
- Full system test: `npm run test:full`

Full-system evidence:

- Markdown: `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260730060703.md`
- JSON: `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260730060703.json`

## Build artifact

- Folder: `C:\Airfare_Allowance\artifacts\patch-2.3.75-year-end-workbench`
- MSI: `C:\Airfare_Allowance\artifacts\patch-2.3.75-year-end-workbench\ATLAS-Airfare-Allowance-2.3.75-x64.msi`
- SHA256: `7E766A4EB15C0D53FA4039D6F2D82EDD4A1A71077C4DC3C857AFF3D1A53905B5`

## Operational note

Dry-run/preview remains allowed for planning. Final close is intentionally blocked until after the configured calendar close date has passed.

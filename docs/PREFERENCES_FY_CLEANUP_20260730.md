# ATLAS Preferences and Fiscal-Year Cleanup - 2026-07-30

## Source history used

- Git context: `9c24d08 docs(installer): record failure history for future fixes`
- Followed the same rule from the failure-history note: keep the fix discoverable in Git with exact behavior, tests, and artifact path.

## What changed

- Removed duplicate fiscal-year display from the frontend:
  - removed the topbar `FY ####` chip;
  - removed the repeated helper line under the sidebar fiscal-year selector;
  - removed the duplicate read-only selected-fiscal-year field from Year End closing setup.
- Preferences now allow deleting all airfare preference rows from the History tab:
  - `Select all airfare` selects every policy row, not only rows marked safe;
  - safe rows use normal delete confirmation: `DELETE`;
  - locked rows use force purge confirmation: `DELETE ALL AIRFARE`;
  - force purge clears policy links from allocations while keeping transaction snapshots.
- Backend policy delete route now supports explicit force purge:
  - `?force=true`
  - or `{ "forcePurge": true }`
  - executes `dbo.sp_ATLAS_PurgeAirfarePolicyRate`
  - records an audit entry after the purge.

## Research basis

- GitHub audit-log guidance and enterprise audit patterns confirm that destructive settings actions should be traceable.
- Frappe/ERPNext HRMS issues around deleting submitted/allocated records show that operational delete flows need explicit state handling rather than silent blocking.
- Microsoft/Dataverse audit guidance supports retaining clear change history around configuration deletion.

## Verification performed

- Backend syntax: `npm run check`
- Company/admin SQL contract: `npm run test:company-admin`
- Year End contract: `npm run test:year-end-safety`
- Frontend production build: `npm --prefix atlas-hcm-next run build`
- Frontend test pack: `npm --prefix atlas-hcm-next test`
- Full system test: `npm run test:full`

Full-system evidence:

- Markdown: `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260730065102.md`
- JSON: `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260730065102.json`

## Build artifact

- Folder: `C:\Airfare_Allowance\artifacts\patch-2.3.76-preferences-fy-cleanup`
- MSI: `C:\Airfare_Allowance\artifacts\patch-2.3.76-preferences-fy-cleanup\ATLAS-Airfare-Allowance-2.3.76-x64.msi`
- SHA256: `B38C7826CED106CDA28641842D795463E1280E372BC07EA5B84B9CE5F551F363`

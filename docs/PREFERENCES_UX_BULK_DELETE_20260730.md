# ATLAS Preferences UX and Bulk Delete Rebuild - 2026-07-30

## Problem fixed

- Preferences bulk delete was firing many API calls from the browser.
- That triggered rate limiting: `HTTP 429 Too Many Requests`.
- The Preferences screen also had too many columns in the current policy list, causing visual crowding and horizontal pressure.

## Product decision

- Global airfare default is protected and cannot be deleted.
- To change the global default, save a new global preference value.
- Company, employee, department, and pay-group airfare rules can be deleted.
- Locked non-global rules can be force purged after explicit `DELETE ALL AIRFARE` confirmation.

## What changed

- Added one bulk endpoint:
  - `POST /api/airfare-policy-rates/bulk-delete`
  - accepts up to 500 policy IDs in one request
  - protects global defaults server-side
  - writes one bulk audit record
- Updated single delete protection:
  - returns `AIRFARE_GLOBAL_DEFAULT_PROTECTED` for global default rows
- Preferences UI/UX:
  - added “Global default is protected” guidance
  - changed `Select all airfare` to `Select all non-global airfare`
  - disabled delete/selection for global default rows
  - simplified current policy table from 7 columns to 5 columns
  - kept detailed cycle/per-day data in History and Logic
  - reduced action overflow by wrapping action buttons cleanly

## Research basis

- GitHub safe-settings protects important default settings from unauthorized or accidental deletion.
- ERPNext/Frappe patterns show that default and transaction-linked settings need fallback and state protection.
- GitHub organization settings documentation emphasizes admin-controlled global settings rather than casual deletion.

## Verification

- `npm run check`
- `npm run test:company-admin`
- `npm --prefix atlas-hcm-next test`
- `npm --prefix atlas-hcm-next run build`
- `npm run test:full`

Full-system evidence:

- Markdown: `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260730084726.md`
- JSON: `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260730084726.json`

## Artifact

- Folder: `C:\Airfare_Allowance\artifacts\patch-2.3.77-preferences-ux-bulk-delete`
- MSI: `C:\Airfare_Allowance\artifacts\patch-2.3.77-preferences-ux-bulk-delete\ATLAS-Airfare-Allowance-2.3.77-x64.msi`
- SHA256: `CFC6B0328DA7EC071591B20C3A53BBFE2D449236810C248D4C02433562363BE4`

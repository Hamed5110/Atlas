# Step 7 Opening Balance Module Report

Date: 2026-07-09
Module: Opening Balance
Route: `/v2/` -> `Opening Balance`

## What was implemented

The `/v2` shell now includes a real Opening Balance module instead of a staging placeholder.

Implemented in:
- `C:\Airfare_Allowance\atlas-hcm-next\app\v2\v2-opening-balance-module.tsx`

Wired into:
- `C:\Airfare_Allowance\atlas-hcm-next\app\v2\v2-shell.tsx`

Supporting styles added in:
- `C:\Airfare_Allowance\atlas-hcm-next\app\v2\v2-shell.module.css`

## Functional coverage added

### Live contract wiring
- loads employee master from `/employees?scope=all`
- loads opening balance register from `/opening-balances?year={year}`
- loads opening loan balances from `/opening-loan-balances?year={year}`
- calculates opening amount through `/opening-balances/calculate`
- saves opening balance through `/opening-balances`
- deletes single opening balance through `/opening-balances/{employeeId}/{year}`
- bulk deletes through `/opening-balances/bulk-delete`

### UI coverage
- fiscal year switcher
- register metrics
- opening balance register table
- opening loan balance table
- add opening balance form
- edit opening balance modal
- update next year action
- single delete action
- bulk delete action
- SQL formula reference display for `dbo.fn_ATLAS_AirfareAmount`

## Verification performed

### Build verification
- `npm run build` completed successfully after updating the module

### Shell navigation verification
- `/v2` navigation still routes correctly to `Opening Balance`
- breadcrumb updates to `Opening Balance`
- no route regression introduced in the shell

### Theme/system verification
- existing `/v2` theme routing remains intact after adding the module

## Honest verification limit

The `/v2` shell keeps business modules behind the session gate.  
In the current browser verification run, there was no valid saved ATLAS session for the `/v2` origin, so the sign-in surface appeared before live Opening Balance data could be exercised through the browser.

That means:
- **implemented and compiled**: yes
- **shell route verified**: yes
- **live authenticated data verified in browser**: not yet

This is a session-state limitation, not a compile/runtime code failure in the new module.

## Expected post-sign-in behaviors to verify next

1. Opening Balance route opens directly after valid `/v2` sign-in
2. register rows load for selected year
3. opening loan balance rows load for selected year
4. previous/next year switching refreshes both tables
5. save opening balance posts to existing backend contract
6. edit modal opens and recalculates amount from MSSQL
7. delete removes selected employee/year row
8. bulk delete removes selected rows

## Current migration status

### Fully live `/v2` modules
- Sign in
- Overview
- Employees
- Airfare
- Opening Balance (implemented, awaiting authenticated browser verification)

### Next recommended module
- Employee Self-Service


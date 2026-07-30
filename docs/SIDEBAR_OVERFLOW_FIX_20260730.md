# Sidebar overflow fix - 2026-07-30

## Issue

The sidebar layout clipped and overlapped controls:

- Fiscal year controls overlapped navigation rows.
- The scrollbar appeared in the wrong visual area.
- Menu labels collided with shortcut badges.
- Footer card competed with navigation height.

## Red-team cause

The sidebar was a single flex column with mixed responsibilities. Header, context controls, nav, and footer were siblings without strict shrink/scroll boundaries, while legacy sidebar CSS still applied global overflow and collapsed-state rules.

## Fix

The sidebar is now split into four zones:

1. `atlas-sidebar-header` - logo and collapse button, `flex: 0 0 auto`.
2. `atlas-sidebar-context` - company and fiscal year controls, `flex: 0 0 auto`.
3. `atlas-sidebar-nav-zone` - only scrollable area, `flex: 1 1 auto`, `overflow-y: auto`.
4. `atlas-sidebar-footer` - status card, `flex: 0 0 auto`.

Navigation rows now use flex alignment with a far-right shortcut badge:

- `display: flex`
- `align-items: center`
- `justify-content: space-between`
- `gap: 12px`
- `margin-left: auto` on `.nav-hint`

Fiscal year controls are constrained to:

- `width: 100%`
- `min-width: 0`
- `box-sizing: border-box`
- `grid-template-columns: 34px minmax(0, 1fr) 34px`

## MSSQL preference persistence

Added:

- `database/UserPreferences_LayoutState.sql`

Includes:

- `dbo.UserPreferences`
- `dbo.sp_UserPreferences_Get`
- `dbo.sp_UserPreferences_Upsert`

The schema stores:

- `UserID`
- `SelectedCompanyID`
- `FiscalYear`
- `ThemeSettingsJSON`
- `LayoutSettingsJSON`
- `NavigationSettingsJSON`

## Live verification

- `http://192.168.15.10:3355/` reachable.
- Admin login API succeeded.

## Test verification

- `npm run check` passed.
- `npm run test:company-admin` passed.
- `npm --prefix atlas-hcm-next test` passed.
- `npm --prefix atlas-hcm-next run build` passed.
- `npm run test:full` passed.

Full system report:

- `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260730121432.md`
- `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260730121432.json`

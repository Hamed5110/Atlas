# ATLAS Dashboard, Preferences, and Installer Artifact - 2026-07-08

## Scope

| Area | Change |
|---|---|
| Overview dashboard | Rebuilt KPI money rendering so BHD values do not wrap or break inside cards |
| Analytics panel | Advanced analytics is active/open by default |
| Global Preferences | Main preference table now has direct Edit, Delete, and History locked actions |
| Preference amount | Visible UI no longer hard-limits the preference amount to BHD 150 |
| Installer path | Existing update-only desktop installer pipeline remains the packaging path |

## Open-Source Design Comparison

| Reference | Pattern applied in ATLAS |
|---|---|
| Material responsive grid | KPI tracks use stable columns, gutters, and mobile stacking |
| Material 3 cards | Cards show one topic with scannable value hierarchy |
| Odoo/ERP dashboards | Dashboard summary cards stay readable before users drill into detail |
| shadcn/Card pattern | Actions are kept in predictable card/table action areas |

## Business Intelligence UI Rule

| Rule | Implementation |
|---|---|
| Currency should not force KPI wrapping | Currency and amount render as separate visual parts |
| Large values must remain readable | KPI amount uses no-wrap/ellipsis instead of broken text |
| Analytics must feel activated | Advanced analytics panel opens by default |
| Preferences must be actionable | Global/current rows expose Edit and Delete directly |
| Historical values must stay protected | Historical rows show locked status instead of destructive action |

## Verification Targets

| Check | Expected result |
|---|---|
| Overview source | Uses `kpi-money` and `metric-money` classes |
| Overview CSS | KPI values use `white-space: nowrap` and stable grid tracks |
| Preferences source | Current preference rows use `preference-current-row` and `preference-row-actions` |
| Preferences source | New preference amount input has no fixed `max="150"` |
| Installer source | Update-only EXE pipeline remains verified by patch artifact tests |

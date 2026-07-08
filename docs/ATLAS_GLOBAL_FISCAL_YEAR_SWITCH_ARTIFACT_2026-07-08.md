# ATLAS Global Fiscal Year Switch Artifact

## Correction Summary

The previous implementation exposed year switching inside individual screens, but it did not make fiscal year a full application context. This artifact documents the corrected behavior: a single global fiscal year switch now drives the application data context across dashboard summaries, allocations, opening balances, airfare payable reports, Year End preview, and visible form defaults.

## Corrected System Rule

> Fiscal year is a workspace-level context, not a screen-level filter. When the user switches fiscal year, all year-sensitive data must reload for the selected year and every visible year-aware form must align to that year.

## Data Flow

| Area | Selected year behavior |
| --- | --- |
| Sidebar | Global Fiscal year switch is visible below Company selection. |
| Top bar | FY badge shows selected year and can reload that year. |
| Opening Balance | Register and export load `/opening-balances?year=<selected fiscal year>`. |
| Airfare Allocation | Allocation register loads `/allocations?year=<selected fiscal year>`. Allocation form defaults to the selected fiscal year. |
| Dashboard / Summary | Year summary loads `/reports/year-summary/<selected fiscal year>`. |
| Airfare Payable | Report loads `/reports/airfare-payable?year=<selected fiscal year>`. |
| Year End | Year-to-close, closing date, preview, and next-year display align to selected fiscal year. |
| Reports | Date range changes to selected fiscal year boundaries. |

## Edit / Update to Next Year Rule

| Workflow | Correct behavior |
| --- | --- |
| Edit allocation and change year | When saved, workspace reloads the allocation year so the updated allocation is visible immediately. |
| Change Allocation year field | On leaving the field, the global fiscal context switches to that year. |
| Opening Balance row | `Update next year` prepares the same employee balance for the next year and switches the workspace to that year. User must review and save intentionally. |
| Year End next-year opening | `Open next-year opening balance` uses the global fiscal switch and opens the selected next-year register. |

## Verification Requirements

| Check | Pass condition |
| --- | --- |
| Global switch source | `activeFiscalYear` exists as the central year context. |
| Data reload | `loadLiveData` accepts fiscal year and uses it for allocations, year summary, system integrity, airfare payable, and opening balances. |
| UI visibility | Sidebar contains `Fiscal year`; top bar contains `FY <year>` context chip. |
| Update to next year | Opening Balance register contains `Update next year`; allocation edit message explains year update. |
| No formula change | Existing airfare formulas and preference runtime lookup remain unchanged. |


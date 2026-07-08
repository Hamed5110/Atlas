# ATLAS Company Cleanup and Opening Balance Layout Artifact - 2026-07-08

## Issues Fixed

| Area | Reported problem | Resolution |
|---|---|---|
| Opening Balance | Row action buttons wrapped and clipped the `Update next year` label | Added a dedicated `opening-balance-row` grid with a wider action column and no-wrap action buttons |
| Opening Balance | Company-wise year switcher panel was too large and duplicated the global fiscal selector | Replaced it with a compact opening-year toolbar and register facts |
| Opening Balance | Edit had no visible update state and delete was missing | Added explicit row Edit, Update next year, and Delete actions; edit now switches the side form into update mode with Cancel edit |
| Companies | `Empty company cleanup` returned `No empty company records found for deletion` without explaining why | Added cleanup preview evidence with Protected, Blocked, and Ready counts |

## Open-Source Comparison

| Reference | Pattern | ATLAS behavior |
|---|---|---|
| ERPNext | Company transaction cleanup is separate from deleting company master records | ATLAS keeps delete conservative and shows cleanup preview first |
| Odoo | Linked companies are usually archived/deactivated instead of deleted because many records reference company IDs | ATLAS blocks linked companies and explains employee/policy blockers |
| Frappe/ERPNext deletion guard | Deletion must respect linked records and permissions | ATLAS protects ATLAS company, selected company, linked employees, and company policy values |

## Company Cleanup Rules

| Rule | Result |
|---|---|
| Company code/name is ATLAS | Protected |
| Company is currently selected | Protected |
| Employee rows reference company code, name, or database name | Blocked |
| Company-specific airfare policy values exist | Blocked |
| No usage and not protected | Ready to delete |

## Verification Targets

| Check | Expected result |
|---|---|
| Backend preview route | `/api/companies/cleanup-preview` returns total, ready, protected, blocked, and row reasons |
| Delete empty route | Deletes only Ready records and returns preview evidence when no deletion happens |
| Companies UI | Shows Preview cleanup and Delete empty companies as separate actions |
| Opening Balance UI | `Update next year` remains visible in the action column |
| Opening Balance lifecycle | Edit shows `Update opening balance`, Delete confirms selected employee/year, and both actions preserve formula rules |
| Opening Balance filter | Uses compact `Opening year` selector, previous/next buttons, and small facts instead of a large instructional matrix |
| Responsive UI | Cleanup evidence cards stack on tablet and mobile |

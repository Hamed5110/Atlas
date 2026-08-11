# ATLAS Old System vs Python Core Comparison

Status: source-of-truth comparison for the fresh Python/MSSQL build.

## Kept as business concepts

| Old concept | Python Core replacement | Validation |
| --- | --- | --- |
| Employees | `core.Employees` master records | `/api/employees`, create employee test |
| Company scope | `core.Tenants`, `core.Companies` | `/api/companies`, health database proof |
| Opening balance | `core.EntitlementEvents` with `EventType='seed'` | `/api/entitlement/events`, balance test |
| Airfare allocation | `core.AirfareAllocations` + `usage` entitlement event | `/api/allocations`, allocation write test |
| Airfare payable/balance | As-of computation from entitlement events | `/api/entitlement/balance?asOfDate=YYYY-MM-DD` |
| Loans / EMI | `core.EmployeeLoans` | `/api/loans`, create loan test |
| Diagnostics | `/api/health` with runtime/database/schema proof | health test |

## Killed from old system

| Old behavior | Reason removed |
| --- | --- |
| Annual close/reset process | Conflicted with continuous entitlement and caused reset/batch confusion. |
| Mixed old/new runtime | Caused “local not updated” and wrong port/database proof. |
| JSON application store | Not production storage; replaced by `mssql-python-core`. |
| Hidden installer assumptions | Python Core is standalone and not attached to the old installer. |
| UI cards without API proof | Every visible function now maps to an API route and test. |

## Python Core contract

- Runtime: Python
- Driver: Microsoft `mssql-python`
- Database: `AtlasPythonCore`
- Schema: `core`
- Port: `3356`
- Annual close/reset process: disabled and absent
- Entitlement model: seed/accrual/adjustment/reversal/usage event ledger
- Allocation model: allocation row plus entitlement usage event in one transaction
